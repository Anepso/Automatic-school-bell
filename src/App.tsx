import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar, NavTab } from './components/Sidebar';
import { SystemTray } from './components/SystemTray';
import { DashboardView } from './components/DashboardView';
import { JadwalView } from './components/JadwalView';
import { SuaraView } from './components/SuaraView';
import { PengaturanView } from './components/PengaturanView';
import {
  getGeminiCredentialBridge,
  isGeminiCredentialStatus,
  type GeminiCredentialStatus,
} from './types/gemini-bridge';
import { resolveGeminiCredentialUi } from './utils/gemini-credential-ui';
import { AiAssistantDrawer } from './components/AiAssistantDrawer';
import { TambahJadwalModal } from './components/modals/TambahJadwalModal';
import { TambahKategoriModal } from './components/modals/TambahKategoriModal';
import { UploadExcelModal } from './components/modals/UploadExcelModal';
import { EmergencyModal } from './components/modals/EmergencyModal';
import { ConfirmationDialog, type ConfirmationDialogRequest } from './components/modals/ConfirmationDialog';

import {
  ScheduleItem,
  CategoryItem,
  AudioFileItem,
  AppSettings,
} from './types';
import {
  hydratePersistentStorage,
  commitSyncState,
  commitSettings,
  commitCategories,
  commitAudioMetadata,
  importAudioAsset,
  deleteAudioAsset,
  gcAudioAssets,
  releaseAudioUrl,
  nextCustomAudioId,
  resolveAudioUrl,
  createBackupNow,
  listAvailableBackups,
  restoreBackup,
  exportBackupFile,
  type SyncMeta,
  type ImportSourceRow,
  type ImportSourceSnapshot,
sanitizeSettingsPatch,
    // B5 School Identity (B5-SI-04/05): seed from the canonical constants so
    // there is exactly one default school name and the logo never renders blank
    // before hydration.
    DEFAULT_SCHOOL_NAME,
    DEFAULT_SCHOOL_LOGO,
  } from './utils/storage';
import { applyUpsertPlanDurable, buildImportSnapshot } from './utils/syncApply';
import {
  computeUpsertPlan,
  buildSyncConfirmationCopy,
  buildSyncResultCopy,
  formatSyncTimestamp,
  type UpsertPlan,
} from './utils/syncSchedule';
import { playSoundByName, playWestminsterChime, stopAudio, warmAudioContext } from './utils/audioEngine';
import {
  findMatchingSchedule,
  findNextSchedule,
  getScheduleClockText,
  getScheduleDayName,
  getScheduleMinuteKey,
} from './utils/scheduler';
import type { BackupListEntry } from './types/storage-bridge';
import type { AutoStartStatus } from './types/autostart-bridge';
import {
  getAutoStartStatus,
  setAutoStartEnabled,
  describeAutoStartStatus,
} from './utils/autostart';
import {
  resolveAutoStartUiState,
  canRequestAutoStartChange,
  nextAutoStartRequest,
} from './utils/autostart-ui-state';

type NativeTrayAction = 'toggle-pause' | 'test-bell' | 'open-settings';

const TRAY_REFRESH_INTERVAL_MS = 15000;

type NativeResumeReason = 'resume' | 'unlock-screen';

interface DesktopBridge {
  isDesktop: true;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
  updateTrayStatus: (status: { paused: boolean; nextBellTime: string | null }) => void;
  onTrayAction: (listener: (action: NativeTrayAction) => void) => () => void;
  onAppResumed: (listener: (event: { reason: NativeResumeReason }) => void) => () => void;
}

export default function App() {
  const desktopBridge = (window as Window & { schoolBellDesktop?: DesktopBridge }).schoolBellDesktop;

  // Authoritative state lives in the main process. Until hydration resolves the
  // scheduler must not run and no success may be claimed, so every list starts
  // empty instead of briefly showing the demo defaults over real user data.
  const [storageReady, setStorageReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [isStorageDegraded, setIsStorageDegraded] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFileItem[]>([]);
const [settings, setSettings] = useState<AppSettings>({
      schoolName: DEFAULT_SCHOOL_NAME,
      schoolLogo: DEFAULT_SCHOOL_LOGO,
    autoStartWindows: true,
    autoBellActive: true,
    selectedSpeaker: 'realtek',
    bellVolume: 80,
    systemPaused: false,
    outputSpeakerName: 'Zona Utama (Seluruh Sekolah)',
  });

  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isWindowVisible, setIsWindowVisible] = useState(true);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);

  // Modals
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(null);
  const [modalDefaultDay, setModalDefaultDay] = useState('Senin');
  const [modalDefaultCategory, setModalDefaultCategory] = useState('Reguler');

  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryItem | null>(null);

  const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
  const [isEmergencyModalOpen, setIsEmergencyModalOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationDialogRequest | null>(null);

  // Synchronization metadata (local-first, no network).
  // The BS-6 snapshot and metadata now live in the same durable document as
  // the schedules, so they are React state rather than a separate localStorage key.
  const [syncMeta, setSyncMeta] = useState<SyncMeta>({ lastSyncedAt: null, lastSourceFileName: null });
  const [lastImportSource, setLastImportSource] = useState<ImportSourceSnapshot | null>(null);

  // Toast notification
  const [toastNotification, setToastNotification] = useState<{ title: string; desc: string } | null>(null);

  // ---- B5.2 F-03 Unit 2D: auto-start (desired vs observed) ---------------
  // `settings.autoStartWindows` is DESIRED (user intent). `autoStartStatus` is
  // OBSERVED (what Windows reports). They are never merged and the observation
  // is never written back into the persisted preference.
  const [autoStartStatus, setAutoStartStatus] = useState<AutoStartStatus | null>(null);
  const [autoStartPending, setAutoStartPending] = useState(false);
  // Synchronous counterpart to `autoStartPending`. React state cannot gate a
  // second click that lands in the same tick, and this is what actually makes
  // "one write at a time" true rather than merely displayed.
  const autoStartPendingRef = useRef(false);

  // Background bell scheduler
  const lastTriggeredMinute = useRef<string>('');
  // Mirrors `storageReady` for use inside stable callbacks without re-creating
  // the 1s interval on every hydration.
  const storageReadyRef = useRef(false);
  useLayoutEffect(() => {
    storageReadyRef.current = storageReady;
  }, [storageReady]);

  // Scheduler reads live state through refs so the interval is created once and
  // is never torn down by unrelated settings or schedule edits.
  const schedulesRef = useRef<ScheduleItem[]>(schedules);
  const settingsRef = useRef<AppSettings>(settings);
  const audioFilesRef = useRef<AudioFileItem[]>(audioFiles);

  useLayoutEffect(() => {
    schedulesRef.current = schedules;
  }, [schedules]);

  useLayoutEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useLayoutEffect(() => {
    audioFilesRef.current = audioFiles;
  }, [audioFiles]);

  // -------------------------------------------------------------------------
  // Durable state commits
  //
  // Every schedule change — CRUD, copy-to-day, AI apply, and the BS-6 sync path
  // — funnels through `commitSyncTriple`, which writes schedules, snapshot, and
  // metadata as ONE main-process transaction. A signature guard makes the
  // debounced effect below a no-op after an explicit commit, so no path can
  // double-write or interleave with a sync.
  // -------------------------------------------------------------------------
  const lastImportSourceRef = useRef<ImportSourceSnapshot | null>(null);
  const syncMetaRef = useRef<SyncMeta>({ lastSyncedAt: null, lastSourceFileName: null });
  const lastCommittedSignature = useRef<string>('');

  useLayoutEffect(() => {
    lastImportSourceRef.current = lastImportSource;
  }, [lastImportSource]);

  useLayoutEffect(() => {
    syncMetaRef.current = syncMeta;
  }, [syncMeta]);

  const signatureOf = (
    list: ScheduleItem[],
    snapshot: ImportSourceSnapshot | null,
    meta: SyncMeta,
  ) => JSON.stringify([list, snapshot, meta]);

  const reportStorageFailure = useCallback((message: string) => {
    setIsStorageDegraded(true);
    setStorageNotice(message);
  }, []);

  const showToast = useCallback((title: string, desc: string) => {
    setToastNotification({ title, desc });
    setTimeout(() => setToastNotification(null), 5000);
  }, []);

  /**
   * Single durable write for the sync triple.
   * `silent` is used by the debounced effect, which must not spam the user with
   * a toast for every keystroke-driven state change.
   */
  const commitSyncTriple = useCallback(
    async (
      nextSchedules: ScheduleItem[],
      nextSnapshot: ImportSourceSnapshot | null,
      nextMeta: SyncMeta,
      options: { announce?: (ok: boolean) => void } = {},
    ) => {
      const signature = signatureOf(nextSchedules, nextSnapshot, nextMeta);
      lastCommittedSignature.current = signature;

      const result = await commitSyncState(nextSchedules, nextSnapshot, nextMeta);
      if (!result.ok) {
        reportStorageFailure(`Jadwal belum tersimpan: ${result.error.message}`);
        options.announce?.(false);
        return false;
      }

      options.announce?.(true);
      return true;
    },
    [reportStorageFailure],
  );

  // ---- B5.2 F-03 Unit 2D: auto-start (desired vs observed) ---------------
  // The Settings row carries two independent facts and never merges them:
  //   desired  = settings.autoStartWindows  (persisted user intent)
  //   observed = autoStartStatus            (what Windows actually reports)
  // All auto-start I/O goes through the typed facade in `./utils/autostart`;
  // this component never touches `window.electron`, `ipcRenderer` or the
  // `schoolBellAutoStart` object directly.

  // Read observed state once per activation of the Settings row. The
  // dependency is deliberately the boolean below and nothing else: no polling,
  // no interval, no retry loop, no renderer-side boot reconciliation, and no
  // extra IPC round trip when an unrelated setting changes. `storageReady` is
  // part of the gate so no observation is ever taken from renderer defaults
  // before hydration resolves.
  const autoStartSurfaceActive = storageReady && currentTab === 'pengaturan';
  useEffect(() => {
    if (!autoStartSurfaceActive) return;
    let cancelled = false;

    void (async () => {
      const status = await getAutoStartStatus();
      if (cancelled) return;
      setAutoStartStatus(status);
    })();

    return () => {
      cancelled = true;
    };
  }, [autoStartSurfaceActive]);

  // `describeAutoStartStatus` owns the error-code → wording mapping for all
  // eight codes, so it is injected rather than reimplemented in the view model.
  const autoStartStatusMessage =
    autoStartStatus === null ? null : describeAutoStartStatus(autoStartStatus);

  const autoStartUiInput = useMemo(
    () => ({
      desired: settings.autoStartWindows,
      status: autoStartStatus,
      pending: autoStartPending,
      storageReady,
      statusMessage: autoStartStatusMessage,
    }),
    [settings.autoStartWindows, autoStartStatus, autoStartPending, storageReady, autoStartStatusMessage],
  );

  const autoStartUi = useMemo(() => resolveAutoStartUiState(autoStartUiInput), [autoStartUiInput]);

  /**
   * Explicit user toggle — Unit 2D Decision B.
   *
   * The ordering is the entire point. The OS operation runs first, and the
   * persisted preference moves only once Windows has confirmed the requested
   * state. Reversing these two lines would let a refused write leave the
   * renderer advertising an intent that was never accepted, and would blur an
   * OS failure into a storage failure.
   */
  const handleToggleAutoStart = useCallback(async () => {
    // Policy guard (shared with the rendered `disabled` state) plus a
    // synchronous ref guard, so a second click in the same tick is dropped
    // instead of racing the first write.
    if (!canRequestAutoStartChange(autoStartUiInput)) return;
    if (autoStartPendingRef.current) return;

    // Read the live preference rather than a captured one, so the request is
    // the inverse of what the user is actually looking at.
    const requested = nextAutoStartRequest(settingsRef.current.autoStartWindows);

    autoStartPendingRef.current = true;
    setAutoStartPending(true);

    try {
      const result = await setAutoStartEnabled(requested);

      // `result` is the fresh observation — it replaces the previous one
      // without a second `getStatus()` call, which also keeps Decision B's
      // "refresh observed state" from turning into a polling pattern.
      setAutoStartStatus(result);

      // The OS refused outright. Keep the stored preference exactly as it was:
      // the user did not change their mind, Windows simply declined. The row now
      // renders `unavailable` with `describeAutoStartStatus(result)`.
      if (!result.supported) return;

      // The write was accepted but the OS did not adopt the requested state.
      // Unit 2A's `setEnabled` is write-then-read-back (`autostart-ipc.cjs:206`)
      // and returns the observed value, never the request — so a supported
      // result whose `enabled` differs from `requested` is a legitimate outcome
      // (policy refusal, Task Manager disabled the entry, partial apply), not an
      // error. The preference must NOT advance to a state Windows never reached.
      //
      // This is the same second guard the main-process reconciler applies at
      // `autostart-sync.cjs:227`. Without it the renderer persists an intent
      // Windows did not accept, which is the one lie the F-03 union exists to
      // prevent. The observation set just above is deliberately kept, so the
      // existing desired-vs-observed presentation reports the real state.
      if (result.enabled !== requested) return;

      // Windows confirmed the requested state, so the desired value may move.
      // `requested` is used deliberately — never `result.enabled`, which is an
      // observation and would turn this into an observed → persisted write-back.
      const next: AppSettings = { ...settingsRef.current, autoStartWindows: requested };
      setSettings(next);

      // Persist through the existing `commitSettings()` and *inspect* the
      // result, which the incidental settings effect deliberately cannot do.
      // A storage failure is reported through the existing storage failure
      // convention and is not relabelled as an auto-start failure: the OS
      // change did succeed, only the write did not. The desired value is left
      // as the user set it, because reverting would contradict Windows and
      // misrepresent the user's intent.
      const persisted = await commitSettings(next);
      if (!persisted.ok) {
        reportStorageFailure(
          `Preferensi run otomatis belum tersimpan: ${persisted.error.message}`,
        );
      }
    } finally {
      autoStartPendingRef.current = false;
      setAutoStartPending(false);
    }
  }, [autoStartUiInput, reportStorageFailure]);

  // ---- B7 Stage B-2: Gemini BYOK credential (D-1) -------------------------
  // Only two booleans ever live in the renderer: whether a credential exists and
  // whether `safeStorage` is usable. The key itself is never read back across
  // the bridge, so there is nothing here that could be logged, screenshotted by
  // an error report, or serialised into React DevTools state.
  const [geminiCredentialStatus, setGeminiCredentialStatus] = useState<GeminiCredentialStatus | null>(null);
  const [isGeminiCredentialBusy, setIsGeminiCredentialBusy] = useState(false);
  const geminiCredentialBusyRef = useRef(false);

  const geminiCredentialUi = useMemo(
    () => resolveGeminiCredentialUi(geminiCredentialStatus),
    [geminiCredentialStatus],
  );

  // Reads status, and treats a bridge that is absent — a browser dev server, a
  // test harness — as a normal unavailable state rather than a crash. That is why
  // `npm run dev` in a plain browser still renders the whole Settings page.
  const refreshGeminiCredentialStatus = useCallback(async () => {
    const bridge = getGeminiCredentialBridge();
    if (!bridge) {
      setGeminiCredentialStatus({ configured: false, available: false, readable: false });
      return;
    }
    try {
      const envelope = await bridge.getStatus();
      if (envelope.ok && isGeminiCredentialStatus(envelope.value)) {
        setGeminiCredentialStatus(envelope.value);
        return;
      }
      setGeminiCredentialStatus({ configured: false, available: false, readable: false });
    } catch {
      setGeminiCredentialStatus({ configured: false, available: false, readable: false });
    }
  }, []);

  useEffect(() => {
    void refreshGeminiCredentialStatus();
  }, [refreshGeminiCredentialStatus]);

  /**
   * Persist a key the user typed, then drop the input.
   *
   * Two things are deliberate. The renderer sends the key and never reads one
   * back, so a successful save returns only a status. And the input field is
   * cleared on success, because leaving a secret sitting in a DOM node — where it
   * survives tab switches, is included in "copy page" behaviour, and is reachable
   * from any future code that walks the form — is the one way this key could
   * outlive the moment it was typed.
   */
  const handleSaveGeminiKey = useCallback(
    async (apiKey: string) => {
      if (geminiCredentialBusyRef.current) return { ok: false, message: 'Penyimpanan sedang berjalan.' };

      const bridge = getGeminiCredentialBridge();
      if (!bridge) return { ok: false, message: 'Jembatan kredensial tidak tersedia di lingkungan ini.' };

      geminiCredentialBusyRef.current = true;
      setIsGeminiCredentialBusy(true);
      try {
        const envelope = await bridge.setKey(apiKey);
        if (envelope.ok && isGeminiCredentialStatus(envelope.value)) {
          setGeminiCredentialStatus(envelope.value);
          return { ok: true };
        }
        // `envelope.error.message` is a fixed string written by the main process
        // (`electron/gemini-credential-store.cjs`); it names the failure and
        // never includes the submitted value.
        return { ok: false, message: envelope.error?.message ?? 'Kredensial gagal disimpan.' };
      } catch {
        return { ok: false, message: 'Kredensial gagal disimpan.' };
      } finally {
        geminiCredentialBusyRef.current = false;
        setIsGeminiCredentialBusy(false);
      }
    },
    [],
  );

  const handleDeleteGeminiKey = useCallback(async () => {
    if (geminiCredentialBusyRef.current) return { ok: false, message: 'Penyimpanan sedang berjalan.' };

    const bridge = getGeminiCredentialBridge();
    if (!bridge) return { ok: false, message: 'Jembatan kredensial tidak tersedia di lingkungan ini.' };

    geminiCredentialBusyRef.current = true;
    setIsGeminiCredentialBusy(true);
    try {
      const envelope = await bridge.deleteKey();
      if (envelope.ok && isGeminiCredentialStatus(envelope.value)) {
        setGeminiCredentialStatus(envelope.value);
        return { ok: true };
      }
      return { ok: false, message: envelope.error?.message ?? 'Kredensial gagal dihapus.' };
    } catch {
      return { ok: false, message: 'Kredensial gagal dihapus.' };
    } finally {
      geminiCredentialBusyRef.current = false;
      setIsGeminiCredentialBusy(false);
    }
  }, []);

  // ---- Hydration ---------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const outcome = await hydratePersistentStorage();

      if (cancelled) return;

      if (!outcome.ok) {
        reportStorageFailure(
          `${outcome.error.message} Jadwal yang tampil hanya sementara dan akan hilang saat aplikasi ditutup.`,
        );
        setStorageReady(true);
        return;
      }

      const state = outcome.state;
      setSchedules(state.schedules);
      setCategories(state.categories);
      setAudioFiles(state.audioFiles);
      setSettings(state.settings);
      setSyncMeta(state.syncMeta);
      setLastImportSource(state.lastImportSource);

      // Mark the hydrated triple as already committed so the debounced effect
      // below does not immediately rewrite what we just read.
      lastCommittedSignature.current = signatureOf(
        state.schedules,
        state.lastImportSource,
        state.syncMeta,
      );

      if (state.degraded) setIsStorageDegraded(true);
      if (state.warnings.length > 0) setStorageNotice(state.warnings.join(' '));

      // Legacy blob audio records survive as metadata but have no binary.
      const orphaned = state.audioFiles.filter((f) => !f.storageName && f.fileName && !f.toneType);
      if (orphaned.length > 0) {
        setAudioFiles(
          state.audioFiles.map((f) =>
            !f.storageName && f.fileName && !f.toneType ? { ...f, needsReupload: true } : f,
          ),
        );
      }

      setStorageReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [reportStorageFailure]);

  // ---- Debounced incidental writes ---------------------------------------
  // B5 Volume (F-05): `bellVolume` changes continuously while the slider is
  // dragged, so committing on every settings change enqueued a burst of whole
  // settings writes. Hold the latest value in a ref so the final slider position
  // can still be flushed, and inspect the commit result instead of discarding it.
  const pendingSettingsRef = useRef<AppSettings | null>(null);

  const flushPendingSettings = useCallback(() => {
    const pending = pendingSettingsRef.current;
    if (!pending) return;
    pendingSettingsRef.current = null;
    void commitSettings(pending).then((result) => {
      if (!result.ok) {
        reportStorageFailure(`Preferensi aplikasi belum tersimpan: ${result.error.message}`);
      }
    });
  }, [reportStorageFailure]);

  useEffect(() => {
    if (!storageReady) return;

    const signature = signatureOf(schedules, lastImportSource, syncMeta);
    if (signature === lastCommittedSignature.current) return;

    const timer = setTimeout(() => {
      void commitSyncTriple(schedules, lastImportSource, syncMeta);
    }, 400);

    return () => clearTimeout(timer);
  }, [storageReady, schedules, lastImportSource, syncMeta, commitSyncTriple]);

  useEffect(() => {
    if (!storageReady) return;

    pendingSettingsRef.current = settings;
    const timer = setTimeout(() => {
      flushPendingSettings();
    }, 400);

    return () => clearTimeout(timer);
  }, [storageReady, settings, flushPendingSettings]);

  // Unmounting must not discard the last slider value, so whatever is still
  // pending is written out immediately rather than waiting for its timer.
  useEffect(() => {
    return () => {
      flushPendingSettings();
    };
  }, [flushPendingSettings]);

  useEffect(() => {
    if (!storageReady) return;
    void commitCategories(categories);
  }, [storageReady, categories]);

  useEffect(() => {
    if (!storageReady) return;
    void commitAudioMetadata(audioFiles);
  }, [storageReady, audioFiles]);

  // Global keydown handler for F12 (Emergency Override)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F12') {
        e.preventDefault();
        setIsEmergencyModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // -------------------------------------------------------------------------
  // Audio playback with persistent-asset resolution
  //
  // Built-in sounds keep the existing synthesized fallback. Custom uploads are
  // read back from the main process on demand and handed to the unchanged
  // `playSoundByName` as a `customUrl`. A missing or unreadable asset falls
  // back to the synthesized tone and warns, instead of failing silently.
  // -------------------------------------------------------------------------
  const playScheduleSound = useCallback(
    async (schedule: ScheduleItem, volume: number) => {
      const asset = audioFilesRef.current.find((f) => f.id === schedule.soundId);

      if (asset && asset.storageName) {
        const resolved = await resolveAudioUrl(asset);
        if (resolved.ok) {
          playSoundByName(schedule.soundName, volume, resolved.url);
          return;
        }
        reportStorageFailure(
          `Audio "${asset.title}" tidak dapat diputar (${resolved.error.message}). Nada bawaan digunakan.`,
        );
      } else if (asset?.needsReupload) {
        reportStorageFailure(`Audio "${asset.title}" perlu diunggah ulang. Nada bawaan digunakan.`);
      }

      playSoundByName(schedule.soundName, volume);
    },
    [reportStorageFailure],
  );

  // Automatic Background Bell Scheduler (Continuous loop)
  const runSchedulerTick = useCallback(() => {
    // Never fire a bell from unvalidated state: a bell triggered against
    // pre-hydration data would ring for the wrong schedule.
    if (!storageReadyRef.current) return;

    const currentSchedules = schedulesRef.current;
    const currentSettings = settingsRef.current;

    if (!currentSettings.autoBellActive || currentSettings.systemPaused) {
      return;
    }

    const now = new Date();
    const currentTimeFormatted = getScheduleClockText(now);
    const todayDayName = getScheduleDayName(now);
    const minuteKey = getScheduleMinuteKey(now);

    // Prevent triggering multiple times in the same minute
    if (lastTriggeredMinute.current === minuteKey) {
      return;
    }

    // Check for matching active schedules today
    const matchingSchedule = findMatchingSchedule(
      currentSchedules,
      todayDayName,
      currentTimeFormatted
    );

    if (matchingSchedule) {
      lastTriggeredMinute.current = minuteKey;
      void playScheduleSound(matchingSchedule, currentSettings.bellVolume);

      setToastNotification({
        title: `Bel Berbunyi: ${matchingSchedule.name}`,
        desc: `Waktu: ${matchingSchedule.time} • Audio: ${matchingSchedule.soundName}`,
      });

      setTimeout(() => setToastNotification(null), 6000);
    }
  }, [playScheduleSound]);

  useEffect(() => {
    // The interval itself stays mounted, but the tick is a no-op until the
    // store has been read, so a slow disk cannot cause a missed or wrong bell.
    const schedulerInterval = setInterval(runSchedulerTick, 1000);

    return () => clearInterval(schedulerInterval);
  }, [runSchedulerTick]);

  // Resume/unlock re-check: main only signals that time moved on; the renderer
  // still decides with its own clock. This is a current-minute re-check only,
  // not a catch-up or replay policy for bells missed while suspended.
  useEffect(() => {
    if (!desktopBridge) return;

    return desktopBridge.onAppResumed(() => {
      runSchedulerTick();
    });
  }, [desktopBridge, runSchedulerTick]);

  // Unlock the AudioContext from a user gesture / window focus so a fully
  // automatic first bell is not dropped by the autoplay policy.
  useEffect(() => {
    const warm = () => warmAudioContext();

    window.addEventListener('pointerdown', warm);
    window.addEventListener('keydown', warm);
    window.addEventListener('focus', warm);
    return () => {
      window.removeEventListener('pointerdown', warm);
      window.removeEventListener('keydown', warm);
      window.removeEventListener('focus', warm);
    };
  }, []);

  // Next upcoming bell for system tray display
  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNowTimestamp(Date.now()), TRAY_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const now = new Date(nowTimestamp);
  const nextScheduleResult = findNextSchedule(schedules, now);
  const nextBell = nextScheduleResult?.schedule ?? null;

  useEffect(() => {
    desktopBridge?.updateTrayStatus({
      paused: settings.systemPaused,
      nextBellTime: nextBell?.time ?? null,
    });
  }, [settings.systemPaused, nextBell?.time]);

  // Window control actions
  const handleMinimize = () => {
    if (desktopBridge) {
      desktopBridge.minimize();
      return;
    }

    setIsWindowVisible(false);
    setToastNotification({
      title: 'School Bell Diminimalkan',
      desc: 'Aplikasi tetap berjalan di System Tray dan bel tetap berbunyi tepat waktu.',
    });
    setTimeout(() => setToastNotification(null), 5000);
  };

  const handleMaximize = () => {
    desktopBridge?.toggleMaximize();
    setIsMaximized(!isMaximized);
  };

  const handleClose = () => {
    if (desktopBridge) {
      desktopBridge.close();
      return;
    }

    setIsWindowVisible(false);
    setToastNotification({
      title: 'School Bell Berjalan di System Tray',
      desc: 'Jendela utama ditutup. Sistem bel otomatis tetap siaga di latar belakang.',
    });
    setTimeout(() => setToastNotification(null), 5000);
  };

  const handleToggleSystemPause = () => {
    const newPauseState = !settings.systemPaused;
    setSettings((prev) => ({ ...prev, systemPaused: newPauseState }));
    if (newPauseState) {
      stopAudio();
    }
  };

  const handleTriggerBellNow = (schedule: ScheduleItem) => {
    void playScheduleSound(schedule, settings.bellVolume);
    setToastNotification({
      title: `Bel Dibunyikan Manual: ${schedule.name}`,
      desc: `Preset suara: ${schedule.soundName} (${schedule.duration})`,
    });
    setTimeout(() => setToastNotification(null), 5000);
  };

  // Schedule CRUD
  const handleSaveSchedule = (item: Partial<ScheduleItem>) => {
    if (editingSchedule) {
      setSchedules((prev) =>
        prev.map((s) => (s.id === editingSchedule.id ? ({ ...s, ...item } as ScheduleItem) : s))
      );
    } else {
      setSchedules((prev) => [...prev, item as ScheduleItem]);
    }
    setEditingSchedule(null);
  };

  const handleDeleteSchedule = (id: string) => {
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  const handleRequestDeleteSchedule = (schedule: ScheduleItem) => {
    setConfirmation({
      title: 'Hapus jadwal?',
      description: `Jadwal "${schedule.name}" pada ${schedule.day}, ${schedule.time} akan dihapus.`,
      impact: 'Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Hapus Jadwal',
      onConfirm: () => handleDeleteSchedule(schedule.id),
    });
  };

  const clearAudioLibrary = () => {
    stopAudio();
    audioFiles.forEach((audio) => {
      if (audio.customAudioUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(audio.customAudioUrl);
      }
    });
    setAudioFiles([]);
  };

  const notifyDataCleared = (title: string, desc: string) => {
    setToastNotification({ title, desc });
    setTimeout(() => setToastNotification(null), 5000);
  };

  const handleClearSchedules = () => {
    if (schedules.length === 0) return;
    setConfirmation({
      title: 'Hapus semua jadwal?',
      description: `${schedules.length} jadwal akan dihapus permanen.`,
      impact: 'Data suara dan pengaturan sekolah tetap tersimpan. Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Hapus Jadwal',
      onConfirm: () => {
        setSchedules([]);
        notifyDataCleared('Semua jadwal dihapus', 'Data suara dan pengaturan tetap tersimpan.');
      },
    });
  };

  const handleClearAudioFiles = () => {
    if (audioFiles.length === 0) return;
    setConfirmation({
      title: 'Hapus semua data suara?',
      description: `${audioFiles.length} file suara akan dihapus permanen.`,
      impact: 'Jadwal dan pengaturan sekolah tetap tersimpan. Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Hapus Suara',
      onConfirm: () => {
        clearAudioLibrary();
        notifyDataCleared('Semua data suara dihapus', 'Jadwal dan pengaturan tetap tersimpan.');
      },
    });
  };

  const handleClearScheduleAndAudio = () => {
    if (schedules.length === 0 && audioFiles.length === 0) return;
    setConfirmation({
      title: 'Hapus jadwal dan suara?',
      description: `${schedules.length} jadwal dan ${audioFiles.length} file suara akan dihapus permanen.`,
      impact: 'Kategori dan pengaturan sekolah tetap tersimpan. Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Hapus Keduanya',
      onConfirm: () => {
      setSchedules([]);
      clearAudioLibrary();
      notifyDataCleared('Data jadwal dan suara dihapus', 'Kategori dan pengaturan sekolah tidak berubah.');
      },
    });
  };

  const handleToggleScheduleActive = (id: string) => {
    setSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, active: !s.active } : s))
    );
  };

  // Category CRUD
  const handleSaveCategory = (cat: Partial<CategoryItem>) => {
    if (editingCategory) {
      const updatedCategory = { ...editingCategory, ...cat } as CategoryItem;
      setCategories((prev) =>
        prev.map((c) => (c.id === editingCategory.id ? updatedCategory : c))
      );
      if (updatedCategory.name !== editingCategory.name) {
        setSchedules((prev) =>
          prev.map((schedule) =>
            schedule.category === editingCategory.name
              ? { ...schedule, category: updatedCategory.name }
              : schedule
          )
        );
      }
    } else {
      setCategories((prev) => [...prev, cat as CategoryItem]);
    }
    setEditingCategory(null);
  };

  const handleDeleteCategory = (id: string) => {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    setCategories((prev) => prev.filter((c) => c.id !== id));
    // Also remove schedules associated with this custom category
    setSchedules((prev) => prev.filter((s) => s.category !== cat.name));
  };

  const handleRequestDeleteCategory = (category: CategoryItem) => {
    const relatedScheduleCount = schedules.filter((schedule) => schedule.category === category.name).length;
    setConfirmation({
      title: 'Hapus kategori?',
      description: `Kategori "${category.name}" akan dihapus.`,
      impact: relatedScheduleCount > 0
        ? `${relatedScheduleCount} jadwal yang memakai kategori ini juga akan dihapus. Tindakan ini tidak dapat dibatalkan.`
        : 'Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Hapus Kategori',
      onConfirm: () => handleDeleteCategory(category.id),
    });
  };

  /**
   * Imports uploaded sounds. Binary lands in the main process first, then the
   * metadata aggregate, so a failure can never leave a metadata record pointing
   * at a file that does not exist.
   */
  const handleImportCustomAudio = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const imported: AudioFileItem[] = [];
      const failures: string[] = [];

      for (const file of files) {
        const audioId = nextCustomAudioId();
        const result = await importAudioAsset(
          audioId,
          file,
          file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' '),
          'Bel Rutin',
          audioFilesRef.current,
        );

        if (result.ok) {
          imported.push(result.asset);
        } else {
          failures.push(`${file.name}: ${result.error.message}`);
          // Roll back a binary that was written before the metadata step failed
          // is not needed here (importAudioAsset only fails before writing or
          // returns the written handle), but a stray orphan is cheap to remove.
          void deleteAudioAsset(audioId);
        }
      }

      if (imported.length > 0) {
        setAudioFiles((prev) => {
          const next = [...imported, ...prev];
          audioFilesRef.current = next;
          return next;
        });

        const committed = await commitAudioMetadata([...imported, ...audioFilesRef.current]);
        if (!committed.ok) {
          showToast('Penyimpanan gagal', committed.error.message);
        }
      }

      if (failures.length > 0) {
        showToast(
          `${failures.length} file gagal diunggah`,
          failures.slice(0, 3).join(' • '),
        );
      } else if (imported.length > 0) {
        showToast(
          'Suara ditambahkan',
          `${imported.length} file audio tersimpan permanen dan siap dipakai pada jadwal bel.`,
        );
      }
    },
    [showToast],
  );

  const handleRequestDeleteAudio = (audio: AudioFileItem) => {
    setConfirmation({
      title: 'Hapus suara?',
      description: `File suara "${audio.title}" akan dihapus dari pustaka.`,
      impact: 'Jadwal dan pengaturan tetap tersimpan. Tindakan ini tidak dapat dibatalkan.',
      confirmLabel: 'Hapus Suara',
      onConfirm: () => {
        void (async () => {
          if (audio.storageName) {
            const removed = await deleteAudioAsset(audio.id);
            if (!removed.ok) {
              showToast('Gagal menghapus', removed.error.message);
              return;
            }
          }
          if (audio.customAudioUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(audio.customAudioUrl);
          }
          releaseAudioUrl(audio.id);

          const next = audioFilesRef.current.filter((item) => item.id !== audio.id);
          audioFilesRef.current = next;
          setAudioFiles(next);
          await commitAudioMetadata(next);

          // Collect binaries no longer referenced by any record.
          void gcAudioAssets(next);
        })();
      },
    });
  };

  const handleRequestExit = () => {
    setConfirmation({
      title: 'Keluar dari aplikasi?',
      description: 'School Bell akan ditutup dan tidak berjalan di latar belakang.',
      impact: 'Penjadwalan otomatis dan audio akan dihentikan.',
      confirmLabel: 'Keluar',
      onConfirm: () => {
        stopAudio();
        setIsWindowVisible(false);
      },
    });
  };

  useEffect(() => {
    if (!desktopBridge) return;

    return desktopBridge.onTrayAction((action) => {
      if (action === 'toggle-pause') {
        handleToggleSystemPause();
      } else if (action === 'test-bell') {
        // B5 Volume (F-08): read through the ref, which is refreshed every
        // render, so the tray subscription no longer has to be torn down and
        // re-registered on every volume slider step. `test-bell` still uses the
        // current application volume.
        playWestminsterChime(settingsRef.current.bellVolume);
      } else {
        setCurrentTab('pengaturan');
        setIsAiDrawerOpen(false);
      }
    });
  }, [settings.systemPaused]);

  // Copy schedules to other days
  const handleCopySchedulesToDay = (fromDay: string, toDays: string[]) => {
    const sourceSchedules = schedules.filter((s) => s.day === fromDay);
    if (sourceSchedules.length === 0) return;

    const newSchedules: ScheduleItem[] = [];
    toDays.forEach((targetDay) => {
      sourceSchedules.forEach((src, idx) => {
        newSchedules.push({
          ...src,
          id: `sch-copy-${Date.now()}-${targetDay}-${idx}`,
          day: targetDay,
        });
      });
    });

    setSchedules((prev) => [...prev, ...newSchedules]);
    alert(`Berhasil menyalin ${sourceSchedules.length} jadwal ke hari: ${toDays.join(', ')}.`);
  };

  // ---------------------------------------------------------------------
  // Shared synchronization (UPSERT) — single path for Dashboard + Jadwal
  // ---------------------------------------------------------------------

  /**
   * Apply a precomputed plan through the single BS-6 write gate.
   *
   * BS-6: `applyUpsertPlanDurable` refuses to write for a no-op, so no path can
   * persist a snapshot without a real change.
   * BS-11: the scheduler ref is updated synchronously, before the async commit
   * resolves, so no bell can fire from the pre-sync schedule in that window.
   */
  const applyUpsertPlan = useCallback(
    async (plan: UpsertPlan, snapshot: ImportSourceSnapshot) => {
      const outcome = await applyUpsertPlanDurable(plan, snapshot, {
        // Refs are advanced inside the commit callback so they move in the same
        // tick as the durable write is requested.
        commit: async (nextSchedules, nextSnapshot, nextMeta) => {
          schedulesRef.current = nextSchedules;
          lastImportSourceRef.current = nextSnapshot;
          syncMetaRef.current = nextMeta;

          setSchedules(nextSchedules);
          setLastImportSource(nextSnapshot);
          setSyncMeta(nextMeta);

          return commitSyncTriple(nextSchedules, nextSnapshot, nextMeta);
        },
      });

      if (outcome.status === 'applied') return true;

      if (outcome.status === 'failed') {
        // Roll the optimistic ref/state back so the UI cannot claim a sync that
        // never reached disk.
        schedulesRef.current = schedules;
        lastImportSourceRef.current = lastImportSource;
        syncMetaRef.current = syncMeta;
        setSchedules(schedules);
        setLastImportSource(lastImportSource);
        setSyncMeta(syncMeta);
        return false;
      }

      return false;
    },
    [commitSyncTriple, schedules, lastImportSource, syncMeta],
  );

  /**
   * Case A: last import source exists -> upsert from the persisted snapshot.
   * Case B: no source -> open the existing upload flow (no fake success).
   */
  const handleRequestSync = useCallback(() => {
    const snapshot = lastImportSourceRef.current;

    if (!snapshot || snapshot.rows.length === 0) {
      setIsExcelModalOpen(true);
      showToast(
        'Belum ada sumber tersinkron',
        'Pilih file Excel/CSV untuk dijadikan sumber sinkronisasi.'
      );
      return;
    }

    // Everything is computed BEFORE confirmation.
    const plan = computeUpsertPlan(schedulesRef.current, snapshot.rows, {
      audioFiles: audioFilesRef.current,
      fileName: snapshot.fileName,
      skippedRowCount: snapshot.skippedRowCount,
    });

    if (plan.isNoop) {
      const copy = buildSyncResultCopy(plan);
      showToast(copy.title, copy.desc);
      return;
    }

    const { description, impact } = buildSyncConfirmationCopy(plan);
    setConfirmation({
      title: 'Sinkronkan jadwal?',
      description: `Sumber: ${snapshot.fileName}. ${description}`,
      impact,
      confirmLabel: 'Sinkronkan',
      tone: 'primary',
      onConfirm: () => {
        // The replay reuses the stored snapshot verbatim; a re-import must go
        // through handleImportExcelSchedules to replace it.
        void (async () => {
          const committed = await applyUpsertPlan(plan, snapshot);
          const copy = buildSyncResultCopy(plan);
          if (committed) showToast(copy.title, copy.desc);
          else showToast('Sinkronisasi gagal', 'Jadwal tidak berubah dan sumber sinkronisasi tidak diperbarui.');
        })();
      },
    });
  }, [applyUpsertPlan, showToast]);

  // Excel import: initial synchronization. Shares the same upsert path.
  const handleImportExcelSchedules = useCallback(
    (payload: { fileName: string; rows: ImportSourceRow[]; skippedRowCount: number }) => {
      if (payload.rows.length === 0) return;

      // BS-6: plan first. A no-op must not create or replace the snapshot.
      const plan = computeUpsertPlan(schedulesRef.current, payload.rows, {
        audioFiles: audioFilesRef.current,
        fileName: payload.fileName,
        skippedRowCount: payload.skippedRowCount,
      });

      if (plan.isNoop) {
        const copy = buildSyncResultCopy(plan);
        showToast(copy.title, copy.desc);
        return;
      }

      // The snapshot exists only because the user actually applied a change.
      const snapshot = buildImportSnapshot(
        payload.fileName,
        payload.rows,
        payload.skippedRowCount,
      );

      void (async () => {
        const committed = await applyUpsertPlan(plan, snapshot);
        const copy = buildSyncResultCopy(plan);
        if (committed) showToast(copy.title, copy.desc);
        else showToast('Impor gagal', 'Jadwal tidak tersimpan. Sumber sinkronisasi tidak diubah.');
      })();
    },
    [applyUpsertPlan, showToast]
  );

  // AI Generated Schedule Application
  const handleApplyAiSchedule = (categoryName: string, days: string[], items: ScheduleItem[]) => {
    // Add category if not exists
    if (!categories.some((c) => c.name.toLowerCase() === categoryName.toLowerCase())) {
      const newCat: CategoryItem = {
        id: `cat-ai-${Date.now()}`,
        name: categoryName,
        description: `Kategori bel dibuat otomatis dengan bantuan AI Assistant`,
        isCustom: true,
        badgeType: 'Khusus',
      };
      setCategories((prev) => [...prev, newCat]);
    }

    // Add schedules
    setSchedules((prev) => [...prev, ...items]);

    // Switch to Jadwal tab to view
    setCurrentTab('jadwal');
    setToastNotification({
      title: `Jadwal AI Berhasil Diterapkan`,
      desc: `${items.length} sesi bel baru untuk "${categoryName}" telah aktif di sistem.`,
    });
    setTimeout(() => setToastNotification(null), 6000);
  };

  // -------------------------------------------------------------------------
  // Backup / restore (B4 MUST)
  // -------------------------------------------------------------------------
  const [backups, setBackups] = useState<BackupListEntry[]>([]);
  const [isBackupBusy, setIsBackupBusy] = useState(false);

  const handleRefreshBackups = useCallback(async () => {
    const result = await listAvailableBackups();
    if (!result.ok) {
      reportStorageFailure(result.error.message);
      return;
    }
    setBackups(result.value);
  }, [reportStorageFailure]);

  useEffect(() => {
    if (storageReady) void handleRefreshBackups();
  }, [storageReady, handleRefreshBackups]);

  const handleCreateBackup = useCallback(async () => {
    setIsBackupBusy(true);
    const result = await createBackupNow('manual');
    setIsBackupBusy(false);

    if (!result.ok) {
      showToast('Backup gagal', result.error.message);
      return;
    }
    await handleRefreshBackups();
    showToast('Backup dibuat', `${result.value.file} (${(result.value.bytes / 1024).toFixed(0)} KB)`);
  }, [handleRefreshBackups, showToast]);

  const handleExportBackup = useCallback(async () => {
    setIsBackupBusy(true);
    const result = await exportBackupFile();
    setIsBackupBusy(false);

    if (!result.ok) {
      showToast('Ekspor gagal', result.error.message);
      return;
    }
    if (result.value.canceled) return;
    showToast('Backup diekspor', `Disimpan ke ${result.value.path}`);
  }, [showToast]);

  const handleRequestRestore = useCallback(
    (entry: BackupListEntry) => {
      setConfirmation({
        title: 'Pulihkan data dari backup?',
        description: `Data saat ini akan diganti dengan isi backup "${entry.file}".`,
        impact: 'Backup pengaman dibuat otomatis sebelum pemulihan. Jadwal dan audio akan berubah.',
        confirmLabel: 'Pulihkan',
        tone: 'danger',
        onConfirm: () => {
          void (async () => {
            setIsBackupBusy(true);
            const result = await restoreBackup(entry.file);
            setIsBackupBusy(false);

            if (!result.ok) {
              showToast('Pemulihan gagal', result.error.message);
              return;
            }

            const restored = result.value;
            if (restored.dryRun) {
              showToast('Pemulihan dibatalkan', 'Tidak ada data yang diubah.');
              return;
            }

            if (restored.missingAudio.length > 0) {
              reportStorageFailure(
                `${restored.missingAudio.length} berkas audio tidak ditemukan di backup dan akan memakai nada bawaan.`,
              );
            }

            // Re-read authoritative state rather than trusting the restore echo.
            const outcome = await hydratePersistentStorage();
            if (outcome.ok) {
              const state = outcome.state;
              schedulesRef.current = state.schedules;
              settingsRef.current = state.settings;
              audioFilesRef.current = state.audioFiles;
              lastImportSourceRef.current = state.lastImportSource;
              syncMetaRef.current = state.syncMeta;
              lastCommittedSignature.current = JSON.stringify([
                state.schedules, state.lastImportSource, state.syncMeta,
              ]);
              setSchedules(state.schedules);
              setCategories(state.categories);
              setAudioFiles(state.audioFiles);
              setSettings(state.settings);
              setSyncMeta(state.syncMeta);
              setLastImportSource(state.lastImportSource);
            }

            await handleRefreshBackups();
            showToast('Data dipulihkan', 'Jadwal, pengaturan, dan audio telah dimuat dari backup.');
          })();
        },
      });
    },
    [handleRefreshBackups, reportStorageFailure, showToast],
  );

  return (
    <div className="min-h-screen bg-[#F7F8FC] text-[#141b2b] select-none flex flex-col font-['Inter'] relative pb-10">
      {/* Storage status: shown until the store has been read, then only while degraded. */}
      {(!storageReady || storageNotice) && (
        <div
          className={`px-5 py-2.5 text-[13px] font-medium flex items-center justify-between gap-4 ${
            isStorageDegraded
              ? 'bg-[#FEF3C7] text-[#92400E] border-b border-[#FDE68A]'
              : 'bg-[#E9EDFF] text-[#3525CD] border-b border-[#D9DEFF]'
          }`}
        >
          <span className="min-w-0 truncate">
            {storageNotice ?? 'Memuat data tersimpan…'}
          </span>
          {storageNotice && (
            <button
              type="button"
              className="shrink-0 px-2.5 py-1 rounded-md bg-white/70 hover:bg-white border border-black/5"
              onClick={() => setStorageNotice(null)}
            >
              Tutup
            </button>
          )}
        </div>
      )}

      {/* Windows Application Window Wrapper */}
      {isWindowVisible && (
        <div
          className={`flex-1 flex flex-col transition-all ${
            isMaximized ? 'w-full' : 'w-full'
          }`}
        >
          {/* Top Windows Native Title Bar */}
          <TitleBar
            isMaximized={isMaximized}
            onClose={handleClose}
            onMaximize={handleMaximize}
            onMinimize={handleMinimize}
            settings={settings}
          />

          {/* Persistent Sidebar */}
          <Sidebar
            currentTab={currentTab}
            isAiDrawerOpen={isAiDrawerOpen}
            onOpenAiDrawer={() => setIsAiDrawerOpen(!isAiDrawerOpen)}
            onSelectTab={(tab) => setCurrentTab(tab)}
            onToggleSystemPause={handleToggleSystemPause}
            settings={settings}
          />

          {/* Main Operational Canvas */}
          <main className="pl-[240px] pt-10 min-h-screen">
            {currentTab === 'dashboard' && (
              <DashboardView
                onNavigateToJadwal={() => setCurrentTab('jadwal')}
                onOpenAiAssistant={() => setIsAiDrawerOpen(true)}
                onOpenEmergencyModal={() => setIsEmergencyModalOpen(true)}
                onRequestConfirmation={setConfirmation}
                onRequestSync={handleRequestSync}
                onTriggerBellNow={handleTriggerBellNow}
                schedules={schedules}
                settings={settings}
              />
            )}

            {currentTab === 'jadwal' && (
              <JadwalView
                categories={categories}
                lastSyncedAt={syncMeta.lastSyncedAt}
                lastSourceFileName={syncMeta.lastSourceFileName}
                onRequestSync={handleRequestSync}
                onCopySchedulesToDay={handleCopySchedulesToDay}
                onDeleteCategory={handleRequestDeleteCategory}
                onDeleteSchedule={handleRequestDeleteSchedule}
                onEditCategory={(cat) => {
                  setEditingCategory(cat);
                  setIsCategoryModalOpen(true);
                }}
                onEditSchedule={(item) => {
                  setEditingSchedule(item);
                  setIsScheduleModalOpen(true);
                }}
                onOpenAddCategory={() => {
                  setEditingCategory(null);
                  setIsCategoryModalOpen(true);
                }}
                onOpenAddSchedule={(day, cat) => {
                  setEditingSchedule(null);
                  setModalDefaultDay(day || 'Senin');
                  setModalDefaultCategory(cat || 'Reguler');
                  setIsScheduleModalOpen(true);
                }}
                onOpenAiAssistant={() => setIsAiDrawerOpen(true)}
                onOpenEmergencyModal={() => setIsEmergencyModalOpen(true)}
                onOpenUploadExcel={() => setIsExcelModalOpen(true)}
                onPreviewSchedule={(schedule) =>
                  playScheduleSound(schedule, settings.bellVolume)
                }
                onToggleScheduleActive={handleToggleScheduleActive}
                schedules={schedules}
                settings={settings}
              />
            )}

            {currentTab === 'suara' && (
              <SuaraView
                audioFiles={audioFiles}
                onImportCustomAudio={(files) => void handleImportCustomAudio(files)}
                onDeleteAudio={handleRequestDeleteAudio}
                onRequestConfirmation={setConfirmation}
                onSetDefaultBell={(fileName) => {
                  alert(`"${fileName}" berhasil disetel sebagai bel default sekolah.`);
                }}
                onResolveAudioUrl={async (audio) => {
                  const resolved = await resolveAudioUrl(audio);
                  return resolved.ok ? resolved.url : null;
                }}
                settings={settings}
              />
            )}

            {currentTab === 'pengaturan' && (
              <PengaturanView
                audioFileCount={audioFiles.length}
                autoStartUi={autoStartUi}
                backups={backups}
                geminiCredentialUi={geminiCredentialUi}
                isBackupBusy={isBackupBusy}
                isGeminiCredentialBusy={isGeminiCredentialBusy}
                onClearAudioFiles={handleClearAudioFiles}
                onClearSchedules={handleClearSchedules}
                onClearScheduleAndAudio={handleClearScheduleAndAudio}
                onCreateBackup={() => void handleCreateBackup()}
                onExportBackup={() => void handleExportBackup()}
                onRefreshBackups={() => void handleRefreshBackups()}
                onRequestRestore={handleRequestRestore}
                onDeleteGeminiKey={handleDeleteGeminiKey}
                onSaveGeminiKey={handleSaveGeminiKey}
                onToggleAutoStart={() => {
                  void handleToggleAutoStart();
                }}
                onUpdateSettings={(newSettings) => setSettings((prev) => ({ ...prev, ...sanitizeSettingsPatch(prev, newSettings).patch }))}
                scheduleCount={schedules.length}
                settings={settings}
              />
            )}
          </main>
        </div>
      )}

      {/* AI Assistant Flyout Drawer */}
      <AiAssistantDrawer
        audioFiles={audioFiles}
        categories={categories}
        currentSchedules={schedules}
        isOpen={isAiDrawerOpen}
        onApplySchedule={handleApplyAiSchedule}
        onClose={() => setIsAiDrawerOpen(false)}
        schoolName={settings.schoolName}
        volume={settings.bellVolume}
      />

      {/* Windows System Tray Simulation Bar */}
      {!desktopBridge && (
        <SystemTray
          isWindowVisible={isWindowVisible}
          nextBell={nextBell}
          onExitApp={handleRequestExit}
          onOpenSettings={() => {
            setIsWindowVisible(true);
            setCurrentTab('pengaturan');
          }}
          onRestoreWindow={() => setIsWindowVisible(true)}
          onTogglePause={handleToggleSystemPause}
          settings={settings}
        />
      )}

      {/* Global In-App Toast Notification */}
      {toastNotification && (
        <aside
          aria-live="polite"
          className="fixed bottom-14 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-[#E5E7EB] shadow-2xl animate-fade-in max-w-sm"
        >
          <div className="w-8 h-8 rounded-full bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[18px]">notifications_active</span>
          </div>
          <div className="flex flex-col min-w-0 pr-2">
            <p className="text-[13px] text-[#141b2b] font-medium leading-tight truncate">
              {toastNotification.title}
            </p>
            <p className="text-[11px] text-[#464555] truncate mt-0.5">
              {toastNotification.desc}
            </p>
          </div>
          <button
            className="w-6 h-6 rounded-md hover:bg-[#F1F3FF] text-[#777587] hover:text-[#141b2b] flex items-center justify-center transition-colors cursor-pointer"
            onClick={() => setToastNotification(null)}
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </aside>
      )}

      {/* Modals */}
      <TambahJadwalModal
        audioFiles={audioFiles}
        categories={categories}
        defaultCategory={modalDefaultCategory}
        defaultDay={modalDefaultDay}
        editingItem={editingSchedule}
        isOpen={isScheduleModalOpen}
        onClose={() => {
          setIsScheduleModalOpen(false);
          setEditingSchedule(null);
        }}
        onRequestConfirmation={setConfirmation}
        onSave={handleSaveSchedule}
        volume={settings.bellVolume}
      />

      <TambahKategoriModal
        editingCategory={editingCategory}
        isOpen={isCategoryModalOpen}
        onClose={() => {
          setIsCategoryModalOpen(false);
          setEditingCategory(null);
        }}
        onSave={handleSaveCategory}
      />

      <UploadExcelModal
        categories={categories}
        isOpen={isExcelModalOpen}
        onClose={() => setIsExcelModalOpen(false)}
        onImport={handleImportExcelSchedules}
        onRequestConfirmation={setConfirmation}
      />

      <EmergencyModal
        isOpen={isEmergencyModalOpen}
        onClose={() => setIsEmergencyModalOpen(false)}
        volume={settings.bellVolume}
      />

      {confirmation && (
        <ConfirmationDialog
          confirmLabel={confirmation.confirmLabel}
          description={confirmation.description}
          impact={confirmation.impact}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const confirmAction = confirmation.onConfirm;
            setConfirmation(null);
            confirmAction();
          }}
          tone={confirmation.tone}
          title={confirmation.title}
        />
      )}
    </div>
  );
}
