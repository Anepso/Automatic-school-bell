import React, { useState, useRef, useEffect } from 'react';
import { AudioFileItem, AudioCategoryType, AppSettings } from '../types';
import type { ConfirmationDialogRequest } from './modals/ConfirmationDialog';
import { playSoundByName, stopAudio } from '../utils/audioEngine';

interface SuaraViewProps {
  audioFiles: AudioFileItem[];
  settings: AppSettings;
  /**
   * Hands the raw `File`s to the parent, which imports the binary into the
   * main-process store before recording metadata. Never a `blob:` URL.
   */
  onImportCustomAudio: (files: File[]) => void;
  onDeleteAudio: (audio: AudioFileItem) => void;
  onRequestConfirmation: (request: ConfirmationDialogRequest) => void;
  onSetDefaultBell: (fileName: string) => void;
  /**
   * Resolves a playback URL for a stored asset. Returns `null` to fall back to
   * the synthesized tone.
   */
  onResolveAudioUrl?: (audio: AudioFileItem) => Promise<string | null>;
}

export const SuaraView: React.FC<SuaraViewProps> = ({
  audioFiles,
  settings,
  onImportCustomAudio,
  onDeleteAudio,
  onRequestConfirmation,
  onSetDefaultBell,
  onResolveAudioUrl,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('Semua');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('Terbaru Diunggah');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 7;

  // Active deck player state
  const [activeAudio, setActiveAudio] = useState<AudioFileItem | null>(audioFiles[0] ?? null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isTestingMainSpeaker, setIsTestingMainSpeaker] = useState(false);
  const [playProgress, setPlayProgress] = useState(44); // percent

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeAudio && audioFiles.some((audio) => audio.id === activeAudio.id)) return;
    stopAudio();
    setIsPlaying(false);
    setActiveAudio(audioFiles[0] ?? null);
  }, [activeAudio, audioFiles]);

  // Filter audio files
  const filteredFiles = audioFiles.filter((item) => {
    if (selectedCategory !== 'Semua') {
      if (selectedCategory === 'Bel Rutin & Masuk' && item.category !== 'Bel Rutin') return false;
      if (selectedCategory === 'Istirahat & Pulang' && item.category !== 'Istirahat' && item.category !== 'Pulang') return false;
      if (selectedCategory === 'Lagu Wajib & Mars' && item.category !== 'Lagu Wajib' && item.category !== 'Mars Sekolah') return false;
      if (selectedCategory === 'Ujian & Peringatan' && item.category !== 'Ujian') return false;
      if (selectedCategory === 'Pengumuman / Voice' && item.category !== 'Pengumuman') return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = item.title.toLowerCase().includes(q);
      const matchFile = item.fileName.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      return matchName || matchFile || matchDesc;
    }

    return true;
  });

  // Sort
  const sortedFiles = [...filteredFiles].sort((a, b) => {
    if (sortBy === 'Nama (A-Z)') return a.title.localeCompare(b.title);
    if (sortBy === 'Durasi (Terpanjang)') return b.duration.localeCompare(a.duration);
    return 0; // Default
  });

  const totalPages = Math.ceil(sortedFiles.length / itemsPerPage) || 1;
  const paginatedFiles = sortedFiles.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const handleTogglePlay = (audio: AudioFileItem) => {
    if (activeAudio?.id === audio.id && isPlaying) {
      stopAudio();
      setIsPlaying(false);
    } else {
      stopAudio();
      setActiveAudio(audio);
      setIsPlaying(true);

      void (async () => {
        let customUrl = audio.customAudioUrl;
        if (!customUrl && onResolveAudioUrl) {
          try {
            customUrl = (await onResolveAudioUrl(audio)) ?? undefined;
          } catch {
            customUrl = undefined;
          }
        }
        await playSoundByName(audio.fileName, settings.bellVolume, customUrl);
        setIsPlaying(false);
      })();
    }
  };

  const handleStopAudio = () => {
    stopAudio();
    setIsPlaying(false);
  };

  const handleSpeakerTest = () => {
    setIsTestingMainSpeaker(true);
    playSoundByName('bel_masuk_apel.mp3', settings.bellVolume).finally(() => {
      setIsTestingMainSpeaker(false);
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const selectedFiles = Array.from(e.target.files);
    e.target.value = '';
    onRequestConfirmation({
      title: selectedFiles.length === 1 ? 'Tambahkan suara?' : 'Tambahkan file suara?',
      description: selectedFiles.length === 1
        ? `File "${selectedFiles[0].name}" akan ditambahkan ke bank suara.`
        : `${selectedFiles.length} file audio akan ditambahkan ke bank suara.`,
      impact: 'File akan tersedia untuk dipilih pada jadwal bel.',
      confirmLabel: selectedFiles.length === 1 ? 'Tambah Suara' : `Tambah ${selectedFiles.length} Suara`,
      tone: 'primary',
      onConfirm: () => {
        // The parent performs the durable import: the binary goes to the main
        // process first, then the metadata. Creating a `blob:` URL here would
        // die with the renderer (BS-3).
        onImportCustomAudio(selectedFiles);
      },
    });
  };

  return (
    <div className="flex flex-col w-full select-none">
      <div className="p-6 flex flex-col gap-6 max-w-[1600px] w-full mx-auto">
        {/* Top Header & Primary Action Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-xl shadow-xs border border-[#E5E7EB]">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-[24px] font-semibold text-[#141b2b] tracking-tight">
                Library Suara Bel
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E9EDFF] text-[#3525CD] text-[12px] font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3525CD] animate-pulse"></span>
                Total {audioFiles.length} File Audio • Format MP3, WAV
              </span>
            </div>
            <p className="text-[13px] text-[#464555]">
              Kelola kumpulan file audio bel sekolah, nada lonceng, lagu kebangsaan, dan rekaman pengumuman otomatis {settings.schoolName}.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              className="h-9 px-3.5 inline-flex items-center gap-2 rounded-lg bg-[#F1F3FF] text-[#141b2b] hover:bg-[#E9EDFF] transition-colors text-[14px] font-medium shadow-xs border border-[#E5E7EB] cursor-pointer"
              onClick={handleSpeakerTest}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-[#3525CD]">
                {isTestingMainSpeaker ? 'graphic_eq' : 'volume_up'}
              </span>
              <span>{isTestingMainSpeaker ? 'Menguji Speaker...' : 'Tes Speaker Utama'}</span>
            </button>

            <button
              className="h-9 px-3.5 inline-flex items-center gap-2 rounded-lg bg-[#F1F3FF] text-[#141b2b] hover:bg-[#E9EDFF] transition-colors text-[14px] font-medium shadow-xs border border-[#E5E7EB] cursor-pointer"
              onClick={() => alert('Folder audio: C:\\ProgramData\\SchoolBell\\AudioBank')}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-[#464555]">
                folder_open
              </span>
              <span>Buka Folder Suara</span>
            </button>

            <button
              className="h-9 px-4 inline-flex items-center gap-2 rounded-lg bg-[#3525CD] hover:bg-[#4F46E5] text-white transition-colors text-[14px] font-medium shadow-xs cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">cloud_upload</span>
              <span>+ Upload Audio Baru</span>
            </button>

            <input
              accept="audio/*"
              className="hidden"
              multiple
              onChange={handleFileUpload}
              ref={fileInputRef}
              type="file"
            />
          </div>
        </div>

        {/* Quick Stats Audio Status Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl shadow-xs border border-[#E5E7EB] flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[#E9EDFF] flex items-center justify-center shrink-0 text-[#3525CD]">
              <span className="material-symbols-outlined text-[24px]">timer</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] text-[#464555] uppercase tracking-wider">
                Total Durasi
              </span>
              <span className="text-[16px] font-semibold text-[#141b2b] truncate">
                42 Menit 18 Detik
              </span>
              <span className="text-[12px] text-[#5A5E69] mt-0.5">Semua bank audio tersimpan</span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-xs border border-[#E5E7EB] flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[#E9EDFF] flex items-center justify-center shrink-0 text-[#3525CD]">
              <span className="material-symbols-outlined text-[24px]">hard_drive</span>
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex justify-between items-center">
                <span className="text-[12px] text-[#464555] uppercase tracking-wider">
                  Penyimpanan Terpakai
                </span>
                <span className="text-[12px] font-semibold text-[#3525CD]">9.2%</span>
              </div>
              <span className="text-[16px] font-semibold text-[#141b2b] truncate">
                184 MB / 2 GB
              </span>
              <div className="w-full bg-[#E1E8FD] h-1.5 rounded-full mt-1.5 overflow-hidden">
                <div className="bg-[#3525CD] h-full rounded-full" style={{ width: '9.2%' }}></div>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-xs border border-[#E5E7EB] flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[#E9EDFF] flex items-center justify-center shrink-0 text-[#3525CD]">
              <span className="material-symbols-outlined text-[24px]">audio_file</span>
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[12px] text-[#464555] uppercase tracking-wider">
                Format Didukung
              </span>
              <span className="text-[16px] font-semibold text-[#141b2b] truncate">
                MP3, WAV, OGG
              </span>
              <span className="text-[12px] text-[#5A5E69] mt-0.5">Maks. 25 MB per file</span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl shadow-xs border border-[#E5E7EB] flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-lg bg-[#DCFCE7] flex items-center justify-center shrink-0 text-[#16A34A]">
              <span className="material-symbols-outlined text-[24px]">speaker_group</span>
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-[#464555] uppercase tracking-wider">
                  Status Output
                </span>
                <span className="w-2 h-2 rounded-full bg-[#16A34A] inline-block"></span>
              </div>
              <span className="text-[16px] font-semibold text-[#141b2b] truncate">
                Speaker Kelas Utama
              </span>
              <span className="text-[12px] text-[#16A34A] truncate font-medium">
                Realtek Audio (Siap Aktif)
              </span>
            </div>
          </div>
        </div>

        {/* Active Media Player Panel (Windows Fluent Audio Deck) */}
        {activeAudio ? (
        <div className="bg-white rounded-xl shadow-md border border-[#E5E7EB] p-5 flex flex-col gap-4 relative overflow-hidden">
          <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-5 relative z-10">
            {/* Audio Info */}
            <div className="flex items-center gap-4 min-w-[280px]">
              <div className="w-[52px] h-[52px] rounded-xl bg-[#3525CD] flex items-center justify-center text-white shadow-xs shrink-0">
                <span className="material-symbols-outlined text-[28px]">graphic_eq</span>
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[16px] font-semibold text-[#141b2b] truncate" id="player-title">
                    {activeAudio.fileName}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-[#E9EDFF] text-[#3525CD] text-[11px] font-semibold">
                    {activeAudio.category}
                  </span>
                </div>
                <p className="text-[13px] text-[#464555] truncate">
                  {activeAudio.description} • Stereo 44.1kHz • 320 kbps
                </p>
              </div>
            </div>

            {/* Waveform Visualizer & Seekbar */}
            <div className="flex flex-col flex-1 max-w-2xl px-1">
              {/* Waveform Display Bars */}
              <div className="flex items-end justify-between gap-[3px] h-10 px-2 py-1 bg-[#F1F3FF] rounded-lg">
                <span className="w-1.5 h-3 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-6 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-8 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-5 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-9 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-7 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-4 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-8 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-6 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-10 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-7 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-9 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-5 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-8 bg-[#3525CD] rounded-full"></span>
                <span className="w-1.5 h-4 bg-[#3525CD] rounded-full"></span>
                {/* Playhead Divider */}
                <span className="w-1.5 h-10 bg-[#C3C0FF] rounded-full animate-pulse"></span>
                <span className="w-1.5 h-6 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-8 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-5 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-7 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-9 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-6 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-4 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-8 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-5 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-3 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-7 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-6 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-4 bg-[#DCE2F7] rounded-full"></span>
                <span className="w-1.5 h-2 bg-[#DCE2F7] rounded-full"></span>
              </div>

              {/* Timeline Scrubber */}
              <div className="flex items-center gap-3 mt-1.5">
                <span className="text-[12px] text-[#464555] font-mono">00:14</span>
                <div
                  className="relative flex-1 h-1.5 bg-[#E1E8FD] rounded-full cursor-pointer group"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const pct = Math.round((clickX / rect.width) * 100);
                    setPlayProgress(pct);
                  }}
                >
                  <div
                    className="h-full bg-[#3525CD] rounded-full"
                    style={{ width: `${playProgress}%` }}
                  ></div>
                  <div
                    className="absolute -top-1 w-3.5 h-3.5 bg-[#3525CD] rounded-full border-2 border-white shadow-xs -ml-1.5 transition-transform group-hover:scale-125"
                    style={{ left: `${playProgress}%` }}
                  ></div>
                </div>
                <span className="text-[12px] text-[#464555] font-mono">
                  {activeAudio.duration}
                </span>
              </div>
            </div>

            {/* Controls Cluster */}
            <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
              <div className="flex items-center gap-1.5">
                <button
                  aria-label="Loop"
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
                    isLooping
                      ? 'bg-[#3525CD] text-white'
                      : 'text-[#3525CD] bg-[#E9EDFF] hover:bg-[#E1E8FD]'
                  }`}
                  onClick={() => setIsLooping(!isLooping)}
                  title="Ulang Otomatis"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">repeat</span>
                </button>
                <button
                  aria-label="Play / Pause"
                  className="w-10 h-10 rounded-full bg-[#3525CD] text-white flex items-center justify-center shadow hover:bg-[#4F46E5] transition-all cursor-pointer"
                  onClick={() => handleTogglePlay(activeAudio)}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[22px]">
                    {isPlaying ? 'pause' : 'play_arrow'}
                  </span>
                </button>
                <button
                  aria-label="Stop"
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[#464555] hover:bg-[#F1F3FF] transition-colors cursor-pointer"
                  onClick={handleStopAudio}
                  title="Hentikan Audio"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">stop</span>
                </button>
              </div>

              <div className="flex items-center gap-2 px-2.5 py-1 bg-[#F1F3FF] rounded-lg border border-[#E5E7EB]">
                <span className="material-symbols-outlined text-[18px] text-[#464555]">
                  volume_up
                </span>
                <div
                  aria-label={`Volume Bel ${settings.bellVolume}%`}
                  className="w-16 h-1 bg-[#DCE2F7] rounded-lg overflow-hidden"
                  role="img"
                >
                  <div
                    className="h-1 bg-[#3525CD] rounded-lg"
                    style={{ width: `${settings.bellVolume}%` }}
                  />
                </div>
                <span className="text-[11px] text-[#464555] font-mono">{settings.bellVolume}%</span>
              </div>

              <button
                className="h-9 px-3 rounded-lg bg-[#E9EDFF] text-[#3525CD] hover:bg-[#E1E8FD] text-[14px] font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                onClick={() => onSetDefaultBell(activeAudio.fileName)}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">task_alt</span>
                <span>Atur Sebagai Bel Masuk</span>
              </button>
            </div>
          </div>
        </div>
        ) : (
          <div className="bg-white rounded-xl shadow-xs border border-[#E5E7EB] p-8 flex flex-col items-center text-center gap-2">
            <span className="material-symbols-outlined text-[32px] text-[#5A5E69]">library_music</span>
            <h2 className="text-[16px] font-semibold text-[#141b2b]">Bank suara kosong</h2>
            <p className="text-[13px] text-[#5A5E69]">
              Belum ada file audio. Unggah audio baru untuk mengisi kembali bank suara.
            </p>
          </div>
        )}

        {/* Filter Categories Tabs */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {[
              { label: 'Semua Suara', count: audioFiles.length, val: 'Semua' },
              { label: 'Bel Rutin & Masuk', count: audioFiles.filter((item) => item.category === 'Bel Rutin').length, val: 'Bel Rutin & Masuk' },
              { label: 'Istirahat & Pulang', count: audioFiles.filter((item) => item.category === 'Istirahat' || item.category === 'Pulang').length, val: 'Istirahat & Pulang' },
              { label: 'Lagu Wajib & Mars', count: audioFiles.filter((item) => item.category === 'Lagu Wajib' || item.category === 'Mars Sekolah').length, val: 'Lagu Wajib & Mars' },
              { label: 'Ujian & Peringatan', count: audioFiles.filter((item) => item.category === 'Ujian').length, val: 'Ujian & Peringatan' },
              { label: 'Pengumuman / Voice', count: audioFiles.filter((item) => item.category === 'Pengumuman').length, val: 'Pengumuman / Voice' },
            ].map((tab) => {
              const isActive = selectedCategory === tab.val;
              return (
                <button
                  className={`px-4 py-2 rounded-lg font-medium text-[14px] whitespace-nowrap flex items-center gap-2 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#E9EDFF] text-[#3525CD] shadow-xs'
                      : 'text-[#464555] hover:bg-[#F1F3FF] hover:text-[#141b2b]'
                  }`}
                  key={tab.label}
                  onClick={() => {
                    setSelectedCategory(tab.val);
                    setCurrentPage(1);
                  }}
                  type="button"
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-2 py-0.5 text-[11px] rounded-full ${
                      isActive
                        ? 'bg-white text-[#3525CD] font-semibold'
                        : 'bg-[#E1E8FD] text-[#464555]'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Action Search & Sorting Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3 rounded-xl shadow-xs border border-[#E5E7EB]">
            <div className="relative flex-1 max-w-lg">
              <span className="material-symbols-outlined absolute left-3 top-2 text-[#464555] text-[18px]">
                search
              </span>
              <input
                className="w-full h-9 pl-9 pr-3 bg-[#F1F3FF] rounded-lg text-[#141b2b] placeholder:text-[#464555] text-[14px] focus:outline-none focus:bg-white border border-[#E5E7EB] transition-colors"
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Cari nama file audio, tag, atau peruntukan bel..."
                type="text"
                value={searchQuery}
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <div className="flex items-center gap-1.5 bg-[#F1F3FF] px-3 h-9 rounded-lg text-[#141b2b] border border-[#E5E7EB]">
                <span className="material-symbols-outlined text-[18px] text-[#464555]">sort</span>
                <span className="text-[12px] text-[#464555]">Urutkan:</span>
                <select
                  className="bg-transparent text-[14px] font-medium text-[#141b2b] focus:outline-none cursor-pointer"
                  onChange={(e) => setSortBy(e.target.value)}
                  value={sortBy}
                >
                  <option>Terbaru Diunggah</option>
                  <option>Nama (A-Z)</option>
                  <option>Durasi (Terpanjang)</option>
                  <option>Paling Sering Digunakan</option>
                </select>
              </div>
              <button
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#F1F3FF] hover:bg-[#E9EDFF] text-[#464555] border border-[#E5E7EB] transition-colors cursor-pointer"
                title="Tampilan List"
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">view_list</span>
              </button>
              <button
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#F1F3FF] hover:bg-[#E9EDFF] text-[#464555] border border-[#E5E7EB] transition-colors cursor-pointer"
                onClick={() => alert('Folder audio berhasil dimuat ulang.')}
                title="Muat Ulang Folder"
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
              </button>
            </div>
          </div>
        </div>

        {/* Audio Library Data Table */}
        <div className="bg-white rounded-xl shadow-xs border border-[#E5E7EB] overflow-hidden flex flex-col">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F1F3FF]/70 text-[#464555] text-[12px] font-semibold uppercase tracking-wider border-b border-[#E5E7EB]">
                  <th className="py-3 px-4 w-12 text-center">PLAY</th>
                  <th className="py-3 px-4">NAMA AUDIO & DESKRIPSI</th>
                  <th className="py-3 px-4 w-36">KATEGORI</th>
                  <th className="py-3 px-4 w-28">DURASI</th>
                  <th className="py-3 px-4 w-28">UKURAN</th>
                  <th className="py-3 px-4 w-52">DIGUNAKAN DI</th>
                  <th className="py-3 px-4 w-32 text-right">AKSI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB] text-[#141b2b] text-[14px]">
                {paginatedFiles.length === 0 ? (
                  <tr>
                    <td className="py-10 text-center text-[13px] text-[#5A5E69]" colSpan={7}>
                      Tidak ada file suara tersimpan.
                    </td>
                  </tr>
                ) : (
                paginatedFiles.map((row) => {
                  const isCurrent = activeAudio?.id === row.id && isPlaying;
                  return (
                    <tr
                      className={`hover:bg-[#F1F3FF]/80 transition-colors group ${
                        isCurrent ? 'bg-[#E9EDFF]/60' : ''
                      }`}
                      key={row.id}
                    >
                      {/* Play */}
                      <td className="py-3.5 px-4 text-center">
                        <button
                          className={`w-8 h-8 rounded-full flex items-center justify-center mx-auto transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-[#3525CD] text-white shadow-xs'
                              : 'bg-[#F1F3FF] text-[#464555] group-hover:bg-[#3525CD] group-hover:text-white'
                          }`}
                          onClick={() => handleTogglePlay(row)}
                          title={isCurrent ? 'Jeda Audio' : 'Putar Audio'}
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {isCurrent ? 'pause' : 'play_arrow'}
                          </span>
                        </button>
                      </td>

                      {/* Nama Audio & Deskripsi */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isCurrent ? 'text-[#3525CD]' : 'text-[#141b2b]'}`}>
                            {row.title}
                          </span>
                          {isCurrent && (
                            <span className="w-2 h-2 rounded-full bg-[#3525CD] animate-pulse" title="Sedang diputar"></span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[#464555] text-[12px] mt-0.5">
                          <code className="font-mono bg-[#E1E8FD] px-1.5 py-0.5 rounded text-[11px] text-[#3525CD]">
                            {row.fileName}
                          </code>
                          <span>• {row.description}</span>
                        </div>
                      </td>

                      {/* Kategori */}
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#E9EDFF] text-[#3525CD] text-[11px] font-semibold">
                          <span className="material-symbols-outlined text-[14px]">
                            notifications_active
                          </span>
                          {row.category}
                        </span>
                      </td>

                      {/* Durasi */}
                      <td className="py-3.5 px-4 font-mono text-[13px] text-[#464555]">
                        {row.duration}
                      </td>

                      {/* Ukuran */}
                      <td className="py-3.5 px-4 font-mono text-[13px] text-[#464555]">
                        {row.size}
                      </td>

                      {/* Digunakan di */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="inline-flex items-center gap-1 text-[12px] text-[#3525CD] font-medium">
                            <span className="material-symbols-outlined text-[14px]">
                              event_repeat
                            </span>
                            {row.usedIn}
                          </span>
                          <span className="text-[11px] text-[#5A5E69]">{row.usedInSub}</span>
                        </div>
                      </td>

                      {/* Aksi */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#464555] hover:bg-[#E9EDFF] hover:text-[#3525CD] transition-colors cursor-pointer"
                            onClick={() => {
                              const newTitle = prompt('Ubah judul file audio:', row.title);
                              if (newTitle) row.title = newTitle;
                            }}
                            title="Edit Metadata"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          <button
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#464555] hover:bg-[#E9EDFF] hover:text-[#3525CD] transition-colors cursor-pointer"
                            onClick={() => alert(`Mengunduh ${row.fileName}...`)}
                            title="Unduh File"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[18px]">download</span>
                          </button>
                          <button
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#464555] hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                            onClick={() => onDeleteAudio(row)}
                            title="Hapus Suara"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination & Status Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-[#F1F3FF]/40 border-t border-[#E5E7EB]">
            <span className="text-[13px] text-[#464555]">
              Menampilkan <strong className="text-[#141b2b] font-medium">
                {paginatedFiles.length > 0
                  ? `${(currentPage - 1) * itemsPerPage + 1} - ${(currentPage - 1) * itemsPerPage + paginatedFiles.length}`
                  : '0'}
              </strong> dari{' '}
              <strong className="text-[#141b2b] font-medium">{sortedFiles.length} file</strong> audio aktif
            </span>

            <div className="flex items-center gap-1.5">
              <button
                className="px-2.5 py-1 rounded bg-white text-[#464555] text-[12px] shadow-xs border border-[#E5E7EB] hover:bg-[#E9EDFF] transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                Sebelumnya
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }).map((_, i) => (
                  <span
                    className={`w-7 h-7 flex items-center justify-center rounded text-[12px] cursor-pointer ${
                      currentPage === i + 1
                        ? 'bg-[#3525CD] text-white font-semibold'
                        : 'hover:bg-[#E9EDFF] text-[#464555]'
                    }`}
                    key={i}
                    onClick={() => setCurrentPage(i + 1)}
                  >
                    {i + 1}
                  </span>
                ))}
              </div>

              <button
                className="px-2.5 py-1 rounded bg-white text-[#464555] text-[12px] shadow-xs border border-[#E5E7EB] hover:bg-[#E9EDFF] transition-colors flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                type="button"
              >
                Selanjutnya
                <span className="material-symbols-outlined text-[16px]">chevron_right</span>
              </button>
            </div>
          </div>
        </div>

        {/* Drag & Drop Audio Upload Card */}
        <div
          className="bg-white p-6 rounded-xl shadow-xs border border-[#E5E7EB] flex flex-col items-center justify-center text-center group cursor-pointer transition-all hover:bg-[#F1F3FF]/50"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-14 h-14 rounded-full bg-[#E9EDFF] flex items-center justify-center text-[#3525CD] group-hover:scale-110 transition-transform mb-3">
            <span className="material-symbols-outlined text-[28px]">upload_file</span>
          </div>
          <h3 className="text-[16px] font-semibold text-[#141b2b] mb-1">
            Tarik & jatuhkan file audio MP3/WAV ke sini
          </h3>
          <p className="text-[13px] text-[#464555] max-w-md mb-4">
            Atau klik untuk menelusuri file dari folder komputer. File otomatis divalidasi dengan format bitrate 128kbps - 320kbps.
          </p>
          <div className="flex items-center gap-3">
            <button
              className="h-9 px-4 rounded-lg bg-[#E9EDFF] hover:bg-[#E1E8FD] text-[#3525CD] text-[14px] font-medium transition-colors inline-flex items-center gap-2 cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">folder_open</span>
              <span>Pilih File dari PC</span>
            </button>
            <span className="text-[12px] text-[#5A5E69]">
              Mendukung multi-select hingga 10 file sekaligus
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
