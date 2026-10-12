import React, { useState, useRef } from 'react';
import { AppSettings } from '../types';
import type { BackupListEntry } from '../types/storage-bridge';
import { playWestminsterChime, stopAudio } from '../utils/audioEngine';
import { settingsLimits, validateLogoForInput, DEFAULT_SCHOOL_LOGO } from '../utils/storage';
import type { AutoStartUiState } from '../utils/autostart-ui-state';
import type { GeminiCredentialUiState } from '../utils/gemini-credential-ui';

interface PengaturanViewProps {
  settings: AppSettings;
  scheduleCount: number;
  audioFileCount: number;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onClearSchedules: () => void;
  onClearAudioFiles: () => void;
  onClearScheduleAndAudio: () => void;

  // ---- B4 persistent storage ------------------------------------------
  backups: BackupListEntry[];
  isBackupBusy: boolean;
  onRefreshBackups: () => void;
  onCreateBackup: () => void;
  onExportBackup: () => void;
  onRequestRestore: (entry: BackupListEntry) => void;

  // ---- B5.2 F-03 Unit 2D: auto-start row --------------------------------
  // `autoStartUi` is resolved by `App.tsx` from the persisted preference plus
  // the observed `AutoStartStatus`, so this component stays presentational: it
  // renders a decision and reports intent, and performs no I/O of its own.
  autoStartUi: AutoStartUiState;
  onToggleAutoStart: () => void;

  // ---- B7 Stage B-2: Gemini BYOK credential (D-1) -------------------------
  // Same division of labour as `autoStartUi`: `App.tsx` performs the IPC and
  // holds the status, this component renders a decision and reports intent. The
  // key is never a prop and never component state that outlives the submit —
  // see `handleSubmitGeminiKey` below.
  geminiCredentialUi: GeminiCredentialUiState;
  isGeminiCredentialBusy: boolean;
  onSaveGeminiKey: (apiKey: string) => Promise<{ ok: boolean; message?: string }>;
  onDeleteGeminiKey: () => Promise<{ ok: boolean; message?: string }>;
}

/** Stable id so the visible label can name the switch via `htmlFor`. */
const AUTO_START_SWITCH_ID = 'settings-auto-start-windows';

/**
 * Status-line colour per tone. Presentation only — the wording and the
 * enabled/disabled decision come from `autoStartUi`.
 */
const AUTO_START_TONE_TEXT: Record<AutoStartUiState['tone'], string> = {
  waiting: 'text-[#5A5E69]',
  pending: 'text-[#3525CD]',
  active: 'text-[#15803D]',
  inactive: 'text-[#5A5E69]',
  mismatch: 'text-[#92400E]',
  unavailable: 'text-[#92400E]',
};

/** Same palette as the auto-start row, so status colour means one thing. */
const GEMINI_CREDENTIAL_TONE_TEXT: Record<GeminiCredentialUiState['tone'], string> = {
  waiting: 'text-[#5A5E69]',
  active: 'text-[#15803D]',
  inactive: 'text-[#5A5E69]',
  warning: 'text-[#92400E]',
};

/** True whenever a credential file exists, readable or not. */
const GEMINI_CREDENTIAL_STORED = new Set(['configured', 'unreadable']);

export const PengaturanView: React.FC<PengaturanViewProps> = ({
  settings,
  scheduleCount,
  audioFileCount,
  onUpdateSettings,
  onClearSchedules,
  onClearAudioFiles,
  onClearScheduleAndAudio,
  backups,
  isBackupBusy,
  onRefreshBackups,
  onCreateBackup,
  onExportBackup,
  onRequestRestore,
  autoStartUi,
  onToggleAutoStart,
  geminiCredentialUi,
  isGeminiCredentialBusy,
  onSaveGeminiKey,
  onDeleteGeminiKey,
}) => {
  const [isTestingAudio, setIsTestingAudio] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const limits = settingsLimits();

  // The API key lives here only between typing and submit, and is cleared on
  // every path out of `handleSubmitGeminiKey`. Holding it in component state is
  // unavoidable — the user must be able to correct a typo before saving — but it
  // is deliberately not written anywhere: no storage, no URL, no attribute, and
  // `autoComplete="off"` keeps the password manager out of it too.
  const [geminiKeyDraft, setGeminiKeyDraft] = useState('');
  const [geminiKeyFeedback, setGeminiKeyFeedback] = useState<string | null>(null);

  const handleSubmitGeminiKey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!geminiCredentialUi.canSubmit || isGeminiCredentialBusy) return;

    const submitted = geminiKeyDraft;
    // Cleared before awaiting, so the plaintext leaves the DOM and component
    // state regardless of how the save ends. On failure the user retypes, which
    // beats leaving a secret in the tree where an error snapshot, a form
    // serialiser, or any future code walking this form could pick it up.
    setGeminiKeyDraft('');

    const result = await onSaveGeminiKey(submitted);
    setGeminiKeyFeedback(result.ok ? null : (result.message ?? 'Kredensial gagal disimpan.'));
  };

  const handleDeleteGeminiKey = async () => {
    if (isGeminiCredentialBusy) return;
    const result = await onDeleteGeminiKey();
    setGeminiKeyFeedback(result.ok ? null : (result.message ?? 'Kredensial gagal dihapus.'));
  };

  const resetLogoInput = () => {
    // Clearing the value lets the user pick the same file again after a rejection.
    if (logoInputRef.current) logoInputRef.current.value = '';
  };

  const handleTestSpeaker = () => {
    setIsTestingAudio(true);
    playWestminsterChime(settings.bellVolume).finally(() => {
      setIsTestingAudio(false);
    });
  };

  /**
   * B5.1 F-02 — reject an unusable logo before it becomes a settings change.
   *
   * The size and MIME checks here are for immediate feedback only; the main
   * process re-validates the value and is what actually prevents the write. A
   * rejected upload leaves the persisted settings untouched.
   */
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reject = (message: string) => {
      setLogoError(message);
      resetLogoInput();
    };

    if (!limits.logoMimeAllowlist.includes(file.type)) {
      reject('Format logo tidak didukung. Gunakan PNG, JPG, GIF, WEBP, atau SVG.');
      return;
    }
    if (file.size > limits.maxLogoBytes) {
      reject('Ukuran logo melebihi 2MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result !== 'string') {
        reject('Logo tidak dapat dibaca.');
        return;
      }
      const problem = validateLogoForInput(result);
      if (problem) {
        reject(problem);
        return;
      }
      setLogoError(null);
      onUpdateSettings({ schoolLogo: result });
    };
    reader.onerror = () => reject('Logo tidak dapat dibaca.');
    reader.readAsDataURL(file);
  };

// PD-2: "Hapus Logo" clears the persisted value (schoolLogo = ''). The
    // display layer falls back to the bundled mark, and no remote default is
    // written back to disk.
    const handleResetLogo = () => {
      setLogoError(null);
      onUpdateSettings({ schoolLogo: '' });
    };

  return (
    <div className="w-full max-w-[1200px] mx-auto p-8 select-none">
      <div className="flex flex-col w-full">
        <div className="max-w-[880px] mx-auto w-full flex flex-col gap-6">
          {/* Page Header */}
          <div className="flex items-center justify-between pb-2">
            <div className="flex flex-col">
              <h1 className="text-[24px] font-semibold text-[#141b2b] tracking-tight">
                Pengaturan
              </h1>
              <p className="text-[14px] text-[#5A5E69] mt-0.5">
                Atur sistem, speaker, dan perilaku aplikasi School Bell.
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#E1E8FD] text-[#464555] text-[12px] font-semibold">
              <span className="material-symbols-outlined text-[16px] text-[#005522]">
                cloud_done
              </span>
              <span>Tersinkronisasi Otomatis</span>
            </div>
          </div>

          {/* Section 1: Sistem */}
          <div className="bg-white rounded-xl p-6 shadow-xs border border-[#E5E7EB] flex flex-col gap-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#F1F3FF] flex items-center justify-center text-[#3525CD]">
                  <span className="material-symbols-outlined text-[22px]">tune</span>
                </div>
                <div className="flex flex-col">
                  <h2 className="text-[16px] font-semibold text-[#141b2b]">Sistem</h2>
                  <p className="text-[13px] text-[#5A5E69]">
                    Atur bagaimana School Bell berjalan di Windows.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 mt-1">
              {/* Row 1: Auto Start Windows */}
              <div className="flex items-center justify-between py-2 px-1">
                <div className="flex flex-col pr-6">
                  <label
                    className="text-[14px] font-medium text-[#141b2b]"
                    htmlFor={AUTO_START_SWITCH_ID}
                  >
                    Jalankan otomatis saat Windows dimulai
                  </label>
                  <span
                    className="text-[13px] text-[#5A5E69] mt-0.5"
                    id={`${AUTO_START_SWITCH_ID}-description`}
                  >
                    School Bell akan berjalan otomatis ketika Windows dinyalakan.
                  </span>
                  {/* Observed OS state. Distinct from the switch above, which is
                      the user's persisted preference — the two are never merged. */}
                  <span
                    aria-live="polite"
                    className={`text-[13px] mt-1 ${AUTO_START_TONE_TEXT[autoStartUi.tone]}`}
                    id={`${AUTO_START_SWITCH_ID}-status`}
                  >
                    {autoStartUi.message}
                  </span>
                </div>
                <button
                  aria-busy={autoStartUi.ariaBusy}
                  aria-checked={autoStartUi.checked}
                  aria-describedby={`${AUTO_START_SWITCH_ID}-description ${AUTO_START_SWITCH_ID}-status`}
                  aria-disabled={autoStartUi.disabled}
                  className={`system-toggle relative inline-flex h-6 w-11 shrink-0 rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none ${
                    autoStartUi.checked ? 'bg-[#4F46E5]' : 'bg-[#DCE2F7]'
                  } ${
                    autoStartUi.disabled
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer'
                  }`}
                  disabled={autoStartUi.disabled}
                  id={AUTO_START_SWITCH_ID}
                  onClick={onToggleAutoStart}
                  role="switch"
                  type="button"
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                      autoStartUi.checked ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div className="h-[1px] w-full bg-[#E1E8FD]"></div>

              {/* Row 2: Auto Play Bell */}
              <div className="flex items-center justify-between py-2 px-1">
                <div className="flex flex-col pr-6">
                  <span className="text-[14px] font-medium text-[#141b2b]">
                    Jalankan bel otomatis
                  </span>
                  <span className="text-[13px] text-[#5A5E69] mt-0.5">
                    Bel akan dimainkan secara otomatis sesuai jadwal yang aktif.
                  </span>
                </div>
                <button
                  aria-checked={settings.autoBellActive}
                  className={`system-toggle relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none ${
                    settings.autoBellActive ? 'bg-[#4F46E5]' : 'bg-[#DCE2F7]'
                  }`}
                  onClick={() =>
                    onUpdateSettings({ autoBellActive: !settings.autoBellActive })
                  }
                  role="switch"
                  type="button"
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                      settings.autoBellActive ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Speaker */}
          <div className="bg-white rounded-xl p-6 shadow-xs border border-[#E5E7EB] flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#F1F3FF] flex items-center justify-center text-[#3525CD]">
                <span className="material-symbols-outlined text-[22px]">volume_up</span>
              </div>
              <div className="flex flex-col">
                <h2 className="text-[16px] font-semibold text-[#141b2b]">Speaker</h2>
                <p className="text-[13px] text-[#5A5E69]">
                  Bel diputar melalui perangkat audio default Windows.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-6 pt-1">
              {/* Output audio — School Bell follows the Windows default output
                  device and does not select, store, or route to a specific one. */}
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium text-[#141b2b]">
                  Output audio
                </span>
                <div className="p-3.5 rounded-lg bg-[#F1F3FF] border border-[#E5E7EB] flex flex-col gap-1">
                  <span className="text-[14px] font-medium text-[#141b2b]">
                    Bel akan diputar melalui perangkat audio default Windows.
                  </span>
                  <span className="text-[13px] text-[#5A5E69]">
                    Untuk mengganti speaker yang digunakan, ubah perangkat output
                    default di pengaturan suara Windows.
                  </span>
                </div>
              </div>

              {/* Volume Range Slider */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-medium text-[#141b2b]" htmlFor="volume-range">
                    Volume Bel
                  </label>
                  <span className="text-[12px] font-semibold text-[#3525CD]">
                    {settings.bellVolume}%
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-[18px] text-[#5A5E69]">
                    volume_down
                  </span>
                  <div className="relative flex-1 flex items-center">
                    <input
                      className="w-full h-2 bg-[#E9EDFF] rounded-lg appearance-none cursor-pointer accent-[#4F46E5]"
                      id="volume-range"
                      max="100"
                      min="0"
                      onChange={(e) => onUpdateSettings({ bellVolume: Number(e.target.value) })}
                      type="range"
                      value={settings.bellVolume}
                    />
                  </div>
                  <span className="material-symbols-outlined text-[18px] text-[#5A5E69]">
                    volume_up
                  </span>
                </div>
              </div>

              <div className="h-[1px] w-full bg-[#E1E8FD]"></div>

              {/* Test Speaker & Audio Meter Visualization */}
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    className={`h-9 px-4 rounded-lg text-[#141b2b] hover:bg-[#F1F3FF] transition-colors shadow-xs border border-[#E5E7EB] text-[14px] font-medium flex items-center gap-2 cursor-pointer ${
                      isTestingAudio ? 'bg-[#E9EDFF] text-[#3525CD]' : 'bg-white'
                    }`}
                    onClick={handleTestSpeaker}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px] text-[#3525CD]">
                      {isTestingAudio ? 'stop' : 'play_arrow'}
                    </span>
                    <span>{isTestingAudio ? 'Hentikan Tes' : 'Tes Speaker'}</span>
                  </button>
                  <span
                    className={`text-[13px] font-medium transition-colors duration-200 ${
                      isTestingAudio ? 'text-[#3525CD]' : 'text-[#16A34A]'
                    }`}
                  >
                    {isTestingAudio ? '● Memutar Nada Uji...' : '● Perangkat Siap'}
                  </span>
                </div>

                {/* Soundwave Visualizer Graphic Component */}
                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F1F3FF] rounded-lg border border-[#E5E7EB]">
                  <span className="text-[12px] text-[#5A5E69] mr-1">Tingkat Output</span>
                  <div className="flex items-end gap-0.5 h-4">
                    <div className="w-1 h-2 rounded-full bg-[#4F46E5] animate-pulse"></div>
                    <div className="w-1 h-3.5 rounded-full bg-[#4F46E5] animate-pulse" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-1 h-4 rounded-full bg-[#4F46E5] animate-pulse" style={{ animationDelay: '300ms' }}></div>
                    <div className="w-1 h-2.5 rounded-full bg-[#4F46E5] animate-pulse" style={{ animationDelay: '450ms' }}></div>
                    <div className="w-1 h-1 rounded-full bg-[#DCE2F7]"></div>
                    <div className="w-1 h-1 rounded-full bg-[#DCE2F7]"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Identitas Sekolah */}
          <div className="bg-white rounded-xl p-6 shadow-xs border border-[#E5E7EB] flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#F1F3FF] flex items-center justify-center text-[#3525CD]">
                <span className="material-symbols-outlined text-[22px]">domain</span>
              </div>
              <div className="flex flex-col">
                <h2 className="text-[16px] font-semibold text-[#141b2b]">Identitas Sekolah</h2>
                <p className="text-[13px] text-[#5A5E69]">
                  Sesuaikan nama dan logo sekolah yang ditampilkan di sidebar dan dashboard.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-6 pt-1">
              {/* Logo Preview & Actions */}
              <div className="flex items-center gap-5">
                <div className="w-16 h-16 rounded-xl bg-[#F1F3FF] p-1.5 flex items-center justify-center shrink-0 shadow-xs border border-[#E5E7EB]">
                  <img
                    alt={`${settings.schoolName} Logo`}
                    className="w-full h-full object-contain rounded-lg"
src={settings.schoolLogo || DEFAULT_SCHOOL_LOGO}
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = DEFAULT_SCHOOL_LOGO;
                      }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2.5">
                    <button
                      className="h-9 px-3.5 rounded-lg bg-white text-[#141b2b] hover:bg-[#F1F3FF] transition-colors shadow-xs border border-[#E5E7EB] text-[14px] font-medium flex items-center gap-1.5 cursor-pointer"
                      onClick={() => logoInputRef.current?.click()}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px] text-[#5A5E69]">
                        photo_camera
                      </span>
                      <span>Ganti Logo</span>
                    </button>
                    <button
                      className="h-9 px-3 rounded-lg text-[#BA1A1A] hover:bg-[#FFDAD6]/30 transition-colors text-[14px] font-medium flex items-center gap-1 cursor-pointer"
                      onClick={handleResetLogo}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                      <span>Hapus Logo</span>
                    </button>
                    <input
                      accept="image/*"
                      className="hidden"
                      onChange={handleLogoUpload}
                      ref={logoInputRef}
                      type="file"
                    />
                  </div>
                  <p className="text-[12px] text-[#5A5E69]">
                    Format didukung: PNG, JPG, GIF, WEBP, SVG (Maks. 2MB)
                  </p>
                  {logoError && (
                    <p
                      className="text-[12px] text-[#BA1A1A]"
                      data-testid="logo-error"
                      role="alert"
                    >
                      {logoError}
                    </p>
                  )}
                </div>
              </div>

              <div className="h-[1px] w-full bg-[#E1E8FD]"></div>

              {/* Nama Sekolah Field */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-medium text-[#141b2b]" htmlFor="school-name-input">
                  Nama Sekolah
                </label>
                <input
                  className="w-full h-10 px-3.5 bg-white text-[#141b2b] text-[14px] rounded-lg shadow-xs border border-[#E5E7EB] focus:outline-none focus:ring-2 focus:ring-[#4F46E5]"
                  id="school-name-input"
                  maxLength={limits.maxSchoolNameLength}
onChange={(e) => {
                      const value = e.target.value;
                      // PD-3: an empty name is not an identity. Mirrors
                      // electron/settings-schema.cjs (1..max characters).
                      if (value.length === 0) {
                        setNameError('Nama sekolah tidak boleh kosong.');
                        return;
                      }
                      if (value.length > limits.maxSchoolNameLength) {
                        setNameError(`Nama sekolah maksimal ${limits.maxSchoolNameLength} karakter.`);
                        return;
                      }
                      setNameError(null);
                      onUpdateSettings({ schoolName: value });
                    }}
                  type="text"
                  value={settings.schoolName}
                />
                <p className="text-[12px] text-[#5A5E69] mt-0.5">
                  Nama ini akan tampil di seluruh aplikasi dan notifikasi.
                </p>
                {nameError && (
                  <p className="text-[12px] text-[#BA1A1A]" role="alert">
                    {nameError}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Section 4: Data Management */}
          <div className="bg-white rounded-xl p-6 shadow-xs border border-[#FECACA] flex flex-col gap-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-50 flex items-center justify-center text-[#BA1A1A] shrink-0">
                <span className="material-symbols-outlined text-[22px]">delete_sweep</span>
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-[16px] font-semibold text-[#141b2b]">Data Jadwal & Suara</h2>
                <p className="text-[13px] text-[#5A5E69]">
                  Hapus seluruh jadwal dan data file suara. Kategori serta pengaturan sekolah tetap tersimpan.
                </p>
                <span className="text-[12px] font-medium text-[#5A5E69]">
                  {scheduleCount} jadwal · {audioFileCount} file suara
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="h-10 px-3.5 rounded-lg border border-[#FECACA] text-[#BA1A1A] hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-medium flex items-center justify-center gap-2"
                disabled={scheduleCount === 0}
                onClick={onClearSchedules}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">event_busy</span>
                Hapus Jadwal Saja
              </button>
              <button
                className="h-10 px-3.5 rounded-lg border border-[#FECACA] text-[#BA1A1A] hover:bg-rose-50 disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-medium flex items-center justify-center gap-2"
                disabled={audioFileCount === 0}
                onClick={onClearAudioFiles}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">volume_off</span>
                Hapus Suara Saja
              </button>
              <button
                className="h-10 px-3.5 rounded-lg bg-[#BA1A1A] text-white hover:bg-[#991B1B] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-medium flex items-center justify-center gap-2"
                disabled={scheduleCount === 0 && audioFileCount === 0}
                onClick={onClearScheduleAndAudio}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
                Hapus Jadwal & Suara
              </button>
            </div>
          </div>

          {/* Section 5: Aplikasi */}
          <div className="bg-white rounded-xl p-6 shadow-xs border border-[#E5E7EB] flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#F1F3FF] flex items-center justify-center text-[#3525CD]">
                  <span className="material-symbols-outlined text-[22px]">info</span>
                </div>
                <div className="flex flex-col">
                  <h2 className="text-[16px] font-semibold text-[#141b2b]">Informasi Aplikasi</h2>
                  <p className="text-[13px] text-[#5A5E69]">
                    Spesifikasi runtime dan basis data internal.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[#16A34A] text-[12px] font-semibold">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                <span>Perubahan pengaturan disimpan otomatis</span>
              </div>
            </div>

            {/* Metadata Key-Value List */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-3.5 rounded-lg bg-[#F1F3FF] border border-[#E5E7EB] flex flex-col gap-1">
                <span className="text-[12px] text-[#5A5E69] uppercase tracking-wider font-semibold">
                  Versi Aplikasi
                </span>
                <span className="text-[14px] font-medium text-[#141b2b]">
                  v1.0.0
                </span>
              </div>
              <div className="p-3.5 rounded-lg bg-[#F1F3FF] border border-[#E5E7EB] flex flex-col gap-1">
                <span className="text-[12px] text-[#5A5E69] uppercase tracking-wider font-semibold">
                  Status Sistem
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#16A34A] animate-pulse"></span>
                  <span className="text-[14px] font-medium text-[#141b2b]">
                    {settings.systemPaused ? 'Dijeda (System Tray)' : 'Aktif (System Tray)'}
                  </span>
                </div>
              </div>
              <div className="p-3.5 rounded-lg bg-[#F1F3FF] border border-[#E5E7EB] flex flex-col gap-1">
                <span className="text-[12px] text-[#5A5E69] uppercase tracking-wider font-semibold">
                  Penyimpanan Jadwal
                </span>
                <span className="text-[14px] font-medium text-[#141b2b] truncate" title="Folder data pengguna">
                  Lokal &amp; permanen (folder data aplikasi)
                </span>
              </div>
            </div>
          </div>

          {/* Section 6: Backup & Restore (B4) */}
          <div className="bg-white rounded-xl p-6 shadow-xs border border-[#E5E7EB] flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-[#F1F3FF] flex items-center justify-center text-[#3525CD]">
                  <span className="material-symbols-outlined text-[22px]">backup</span>
                </div>
                <div className="flex flex-col">
                  <h2 className="text-[16px] font-semibold text-[#141b2b]">Cadangkan &amp; Pulihkan Data</h2>
                  <p className="text-[13px] text-[#5A5E69]">
                    Backup berisi seluruh jadwal, pengaturan, dan berkas audio.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 text-[#5A5E69] text-[12px] font-semibold">
                <span className="material-symbols-outlined text-[16px]">shield</span>
                <span>Dilakukan sebelum pemulihan</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                className="h-10 px-3.5 rounded-lg bg-[#3525CD] text-white hover:bg-[#2A1BA8] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-medium flex items-center justify-center gap-2"
                disabled={isBackupBusy}
                onClick={onCreateBackup}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">backup</span>
                Backup Sekarang
              </button>
              <button
                className="h-10 px-3.5 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F7F8FC] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-medium flex items-center justify-center gap-2"
                disabled={isBackupBusy}
                onClick={onExportBackup}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Ekspor ke File…
              </button>
              <button
                className="h-10 px-3.5 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F7F8FC] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-medium flex items-center justify-center gap-2"
                disabled={isBackupBusy}
                onClick={onRefreshBackups}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                Segarkan Daftar
              </button>
            </div>

            {backups.length === 0 ? (
              <p className="text-[13px] text-[#5A5E69]">
                Belum ada backup tersimpan. Backup otomatis dibuat saat migrasi data dan sebelum pemulihan.
              </p>
            ) : (
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
                {backups.map((entry) => (
                  <div
                    key={entry.file}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[#E5E7EB]"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[13px] font-medium text-[#141b2b] truncate">
                        {entry.file.replace(/^backup-/, '').replace(/\.zip$/, '').replace(/-/g, ' ')}
                      </span>
                      <span className="text-[12px] text-[#5A5E69]">
                        {(entry.bytes / 1024).toFixed(0)} KB
                        {entry.dataVersion !== null ? ` • versi data ${entry.dataVersion}` : ''}
                        {entry.valid ? '' : ' • bermasalah'}
                      </span>
                    </div>
                    <button
                      className="h-8 px-3 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F7F8FC] disabled:opacity-50 disabled:cursor-not-allowed text-[12px] font-medium shrink-0"
                      disabled={isBackupBusy || !entry.valid}
                      onClick={() => onRequestRestore(entry)}
                      type="button"
                    >
                      Pulihkan
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 7: Gemini API Key (B7 Stage B-2, D-1 BYOK) */}
          <div className="bg-white rounded-xl p-6 shadow-xs border border-[#E5E7EB] flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#F1F3FF] flex items-center justify-center text-[#3525CD]">
                <span className="material-symbols-outlined text-[22px]">key</span>
              </div>
              <div className="flex flex-col">
                <h2 className="text-[16px] font-semibold text-[#141b2b]">Gemini API Key</h2>
                <p className="text-[13px] text-[#5A5E69]">
                  Kunci milik Anda sendiri, disimpan terenkripsi oleh sistem operasi.
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-[#F7F8FC] border border-[#E5E7EB] p-3.5 flex flex-col gap-1">
              <span className="text-[12px] text-[#5A5E69] leading-relaxed">
                School Bell tidak pernah menyertakan kunci untuk Anda. Anda menempelkan
                kunci Google AI Studio milik Anda sendiri; kunci dienkripsi oleh
                penyimpanan aman sistem operasi di folder data pengguna, dan tidak pernah
                masuk file pengaturan, jadwal, log, maupun paket aplikasi.
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <span
                className={`text-[13px] ${GEMINI_CREDENTIAL_TONE_TEXT[geminiCredentialUi.tone]}`}
                id="settings-gemini-credential-status"
              >
                {geminiCredentialUi.message}
              </span>
              {geminiKeyFeedback && (
                <span
                  className="text-[13px] text-[#92400E]"
                  id="settings-gemini-credential-feedback"
                  role="status"
                >
                  {geminiKeyFeedback}
                </span>
              )}
            </div>

            <form
              className="flex flex-col gap-3 sm:flex-row sm:items-start"
              onSubmit={handleSubmitGeminiKey}
            >
              <div className="flex flex-col gap-1.5 flex-1">
                <label
                  className="text-[12px] font-semibold text-[#5A5E69] uppercase tracking-wider"
                  htmlFor="settings-gemini-credential-input"
                >
                  API Key
                </label>
                <input
                  aria-describedby="settings-gemini-credential-status"
                  autoComplete="off"
                  className="h-10 px-3 rounded-lg border border-[#E5E7EB] bg-white text-[14px] text-[#141b2b] placeholder:text-[#9AA0AE] focus:outline-none focus:border-[#4F46E5] disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!geminiCredentialUi.canSubmit || isGeminiCredentialBusy}
                  id="settings-gemini-credential-input"
                  onChange={(event) => setGeminiKeyDraft(event.target.value)}
                  placeholder="AIza..."
                  spellCheck={false}
                  type="password"
                  value={geminiKeyDraft}
                />
              </div>
              <div className="flex items-center gap-2 pt-0 sm:pt-[22px]">
                <button
                  className="h-10 px-4 rounded-lg bg-[#4F46E5] text-white text-[13px] font-semibold hover:bg-[#4338CA] disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={
                    !geminiCredentialUi.canSubmit ||
                    isGeminiCredentialBusy ||
                    geminiKeyDraft.trim().length === 0
                  }
                  type="submit"
                >
                  {GEMINI_CREDENTIAL_STORED.has(geminiCredentialUi.kind) ? 'Ganti' : 'Simpan'}
                </button>
                {/* Offered whenever something is stored, including an unreadable
                    blob: removal is the user's decision, never an automatic one. */}
                {GEMINI_CREDENTIAL_STORED.has(geminiCredentialUi.kind) && (
                  <button
                    className="h-10 px-4 rounded-lg bg-white border border-[#E5E7EB] text-[#141b2b] text-[13px] font-medium hover:bg-[#F7F8FC] disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={isGeminiCredentialBusy}
                    onClick={() => {
                      void handleDeleteGeminiKey();
                    }}
                    type="button"
                  >
                    Hapus
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
