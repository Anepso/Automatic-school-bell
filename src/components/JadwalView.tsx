import React, { useEffect, useRef, useState } from 'react';
import { ScheduleItem, CategoryItem, AppSettings } from '../types';
import { playSoundByName, stopAudio } from '../utils/audioEngine';
import { formatSyncTimestamp } from '../utils/syncSchedule';

interface JadwalViewProps {
  schedules: ScheduleItem[];
  categories: CategoryItem[];
  settings: AppSettings;
  onPreviewSchedule: (schedule: ScheduleItem) => Promise<void>;
  onOpenAddSchedule: (day?: string, category?: string) => void;
  onEditSchedule: (item: ScheduleItem) => void;
  onDeleteSchedule: (item: ScheduleItem) => void;
  onToggleScheduleActive: (id: string) => void;
  onOpenAddCategory: () => void;
  onEditCategory: (cat: CategoryItem) => void;
  onDeleteCategory: (category: CategoryItem) => void;
  onOpenUploadExcel: () => void;
  onOpenAiAssistant: () => void;
  onCopySchedulesToDay: (fromDay: string, toDays: string[]) => void;
  onOpenEmergencyModal: () => void;
  onRequestSync: () => void;
  lastSyncedAt: string | null;
  lastSourceFileName: string | null;
}

export const JadwalView: React.FC<JadwalViewProps> = ({
  schedules,
  categories,
  settings,
  onPreviewSchedule,
  onOpenAddSchedule,
  onEditSchedule,
  onDeleteSchedule,
  onToggleScheduleActive,
  onOpenAddCategory,
  onEditCategory,
  onDeleteCategory,
  onOpenUploadExcel,
  onOpenAiAssistant,
  onCopySchedulesToDay,
  onOpenEmergencyModal,
  onRequestSync,
  lastSyncedAt,
  lastSourceFileName,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTab, setSelectedTab] = useState('Senin'); // 'Semua', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', or custom category name
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [copyModalOpen, setCopyModalOpen] = useState(false);
  const [selectedTargetDays, setSelectedTargetDays] = useState<string[]>(['Selasa']);
  const previousCategories = useRef(categories);

  useEffect(() => {
    const selectedPreviousCategory = previousCategories.current.find((previousCategory) => {
      return previousCategory.isCustom && previousCategory.name === selectedTab;
    });

    if (selectedPreviousCategory) {
      const updatedCategory = categories.find((category) => category.id === selectedPreviousCategory.id);
      setSelectedTab(updatedCategory?.name ?? 'Senin');
    }

    previousCategories.current = categories;
  }, [categories, selectedTab]);

  // Filter schedules
  const filteredSchedules = schedules.filter((item) => {
    // Tab filter
    if (selectedTab !== 'Semua') {
      const isCustomCategory = categories.some((c) => c.name === selectedTab && c.isCustom);
      if (isCustomCategory) {
        if (item.category !== selectedTab) return false;
      } else {
        if (item.day !== selectedTab && item.day !== 'Semua') return false;
      }
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      const matchSound = item.soundName.toLowerCase().includes(q);
      const matchTime = item.time.toLowerCase().includes(q);
      return matchName || matchDesc || matchSound || matchTime;
    }

    return true;
  }).sort((a, b) => a.time.localeCompare(b.time));

  // Determine badge for selectedTab
  const getDayShort = (tab: string) => {
    if (tab === 'Senin') return 'Sn';
    if (tab === 'Selasa') return 'Sl';
    if (tab === 'Rabu') return 'Rb';
    if (tab === 'Kamis') return 'Km';
    if (tab === 'Jumat') return 'Jm';
    if (tab === 'Sabtu') return 'Sb';
    if (tab === 'Semua') return 'All';
    return tab.slice(0, 2).toUpperCase();
  };

  const handlePlaySound = (item: ScheduleItem) => {
    if (playingId === item.id) {
      stopAudio();
      setPlayingId(null);
    } else {
      setPlayingId(item.id);
      void onPreviewSchedule(item)
        .catch((error: unknown) => {
          console.error('Failed to preview schedule sound', error);
        })
        .finally(() => {
          setPlayingId(null);
        });
    }
  };

  const handleTestSequence = async () => {
    stopAudio();
    for (const item of filteredSchedules) {
      setPlayingId(item.id);
      await playSoundByName(item.soundName, settings.bellVolume);
      await new Promise((r) => setTimeout(r, 600));
    }
    setPlayingId(null);
  };

  const nextBell = filteredSchedules.find((s) => s.active) || filteredSchedules[0];

  return (
    <div className="w-full max-w-[1200px] mx-auto p-8 select-none">
      <div className="flex flex-col w-full gap-6">
        {/* Top Headline & Action Bar Area */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-[24px] font-semibold text-[#141b2b] tracking-tight">
                Jadwal
              </h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#E9EDFF] text-[#3525CD] text-[12px] font-semibold">
                Semester Genap 2024/2025
              </span>
            </div>
            <p className="text-[14px] text-[#5A5E69] mt-0.5">
              Kelola jadwal bel otomatis berdasarkan hari, sesi belajar, dan kategori khusus.
            </p>
          </div>

          {/* Quick Actions (AI, Upload, Add) */}
          <div className="flex items-center gap-2.5 whitespace-nowrap">
            <button
              className="group inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-[#E9EDFF] text-[#3525CD] font-medium text-[14px] shadow-xs hover:bg-[#E1E8FD] transition-all cursor-pointer active:scale-[0.98]"
              onClick={onOpenAiAssistant}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-[#3525CD] transition-transform group-hover:rotate-12">
                auto_awesome
              </span>
              <span>Buat dengan AI</span>
            </button>

            <button
              className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-white text-[#141b2b] font-medium text-[14px] shadow-xs hover:bg-[#F1F3FF] transition-colors border border-[#E5E7EB] active:scale-[0.98] cursor-pointer"
              onClick={onOpenUploadExcel}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-[#5A5E69]">
                upload_file
              </span>
              <span>Upload Excel</span>
            </button>

            <button
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#4F46E5] text-white font-medium text-[14px] shadow-xs hover:bg-[#3525CD] transition-all shadow-[#4F46E5]/20 active:scale-[0.98] cursor-pointer"
              onClick={() => onOpenAddSchedule(selectedTab !== 'Semua' ? selectedTab : 'Senin', selectedTab)}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              <span>Tambah Jadwal</span>
            </button>
          </div>
        </div>

        {/* Search & Secondary Filter Toolbar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-white rounded-xl shadow-xs border border-[#E5E7EB]">
          {/* Search Input */}
          <div className="relative w-full md:w-80">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#5A5E69] text-[18px] pointer-events-none">
              search
            </span>
            <input
              className="w-full h-[38px] pl-9 pr-3 rounded-lg bg-[#F9F9FF] text-[14px] text-[#141b2b] placeholder:text-[#5A5E69] focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#4F46E5] border border-[#E5E7EB] transition-all"
              id="scheduleSearch"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama bel, kegiatan, atau sound..."
              type="text"
              value={searchQuery}
            />
          </div>

          {/* Right Controls: Audio Output Status & Refresh */}
          <div className="flex items-center gap-3 self-end md:self-auto">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F9F9FF] text-[#5A5E69] text-[12px] border border-[#E5E7EB]">
              <span className="material-symbols-outlined text-[16px] text-[#3525CD]">
                volume_up
              </span>
              <span>
                Output Speaker: <strong className="text-[#141b2b] font-medium">{settings.outputSpeakerName}</strong>
              </span>
            </div>
            <button
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#F9F9FF] text-[#5A5E69] hover:text-[#141b2b] hover:bg-[#E9EDFF] border border-[#E5E7EB] transition-colors cursor-pointer"
              onClick={() => {
                alert('Jadwal bel berhasil dimuat ulang dari penyimpanan lokal.');
              }}
              title="Muat ulang jadwal"
              type="button"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
          </div>
        </div>

        {/* Dynamic Day Filter & Custom Category Pills */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 pb-1">
            {/* Standard Days */}
            {['Semua', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'].map((day) => {
              const isActive = selectedTab === day;
              return (
                <button
                  className={`tab-pill px-3.5 py-1.5 rounded-lg font-medium text-[14px] whitespace-nowrap flex items-center gap-1.5 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#4F46E5] text-white shadow-xs'
                      : 'text-[#5A5E69] hover:text-[#141b2b] hover:bg-white bg-white/60 border border-[#E5E7EB]'
                  }`}
                  key={day}
                  onClick={() => setSelectedTab(day)}
                  type="button"
                >
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-white"></span>}
                  <span>{day}</span>
                </button>
              );
            })}

            {/* Separator line */}
            <span className="h-5 w-px bg-[#C7C4D8]/50 mx-1 shrink-0" />

            {/* Custom Categories */}
            {categories
              .filter((c) => c.isCustom)
              .map((cat) => {
                const isActive = selectedTab === cat.name;
                return (
                  <div
                    className={`group relative flex items-center rounded-lg shadow-xs pl-3 pr-1 py-1 whitespace-nowrap border transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#4F46E5] text-white border-[#4F46E5]'
                        : 'bg-white text-[#141b2b] border-[#E5E7EB] hover:bg-[#F1F3FF]'
                    }`}
                    key={cat.id}
                    onClick={() => setSelectedTab(cat.name)}
                  >
                    <span className="text-[14px] font-medium mr-1">{cat.name}</span>
                    <button
                      className={`w-6 h-6 rounded flex items-center justify-center transition-colors cursor-pointer ${
                        isActive
                          ? 'text-white hover:bg-white/20'
                          : 'text-[#5A5E69] hover:text-[#141b2b] hover:bg-[#E1E8FD]'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(activeMenuId === cat.id ? null : cat.id);
                      }}
                      title="Opsi kategori"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">more_vert</span>
                    </button>

                    {/* Category Dropdown Menu */}
                    {activeMenuId === cat.id && (
                      <div className="absolute right-0 top-9 w-36 bg-white rounded-lg shadow-xl border border-[#E5E7EB] py-1 z-30 flex flex-col text-slate-700 animate-fade-in">
                        <button
                          className="px-3 py-1.5 text-xs text-left hover:bg-[#F1F3FF] flex items-center gap-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(null);
                            onEditCategory(cat);
                          }}
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[14px]">edit</span>
                          Ubah Nama
                        </button>
                        <button
                          className="px-3 py-1.5 text-xs text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenuId(null);
                            onDeleteCategory(cat);
                          }}
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                          Hapus Kategori
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Add Category Button */}
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F1F3FF] text-[#3525CD] font-medium text-[14px] hover:bg-[#E9EDFF] border border-[#E5E7EB] transition-colors whitespace-nowrap cursor-pointer"
              onClick={onOpenAddCategory}
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              <span>Tambah Kategori</span>
            </button>
          </div>
        </div>

        {/* Operational Overview & Selected Header */}
        <div className="flex items-end justify-between px-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E2DFFF] flex items-center justify-center text-[#3525CD] text-[16px] font-semibold">
              {getDayShort(selectedTab)}
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-semibold text-[#141b2b]">
                  {selectedTab}
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#E1E8FD] text-[#464555] text-[12px]">
                  {categories.some((c) => c.name === selectedTab && c.isCustom)
                    ? 'Kategori Khusus'
                    : 'Format Reguler'}
                </span>
              </div>
              <p className="text-[13px] text-[#5A5E69]">
                {filteredSchedules.length} jadwal aktif • Bel berikutnya:{' '}
                <strong className="text-[#3525CD] font-medium">
                  {nextBell ? `${nextBell.name} (${nextBell.time} WIB)` : 'Tidak ada'}
                </strong>
              </p>
            </div>
          </div>

          {/* Batch actions / Sound Test Trigger */}
          <div className="hidden sm:flex items-center gap-2">
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-[#5A5E69] hover:text-[#141b2b] text-[14px] font-medium shadow-xs border border-[#E5E7EB] transition-colors cursor-pointer"
              onClick={handleTestSequence}
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">playlist_play</span>
              <span>Tes Urutan Suara</span>
            </button>
            <button
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white text-[#5A5E69] hover:text-[#141b2b] text-[14px] font-medium shadow-xs border border-[#E5E7EB] transition-colors cursor-pointer"
              onClick={() => setCopyModalOpen(true)}
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">content_copy</span>
              <span>Salin ke Hari Lain</span>
            </button>
          </div>
        </div>

        {/* Schedule Management Table */}
        <div className="bg-white rounded-xl shadow-xs border border-[#E5E7EB] overflow-hidden flex flex-col">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[760px]">
              <thead>
                <tr className="bg-[#F1F3FF] text-[#5A5E69] text-[12px] font-semibold uppercase tracking-wider h-11 border-b border-[#E5E7EB]">
                  <th className="pl-6 pr-4 py-2 w-[130px]">Jam</th>
                  <th className="px-4 py-2 w-[280px]">Kegiatan</th>
                  <th className="px-4 py-2 w-[240px]">Suara</th>
                  <th className="px-4 py-2 w-[140px]">Status</th>
                  <th className="pr-6 pl-4 py-2 w-[90px] text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredSchedules.length === 0 ? (
                  <tr>
                    <td className="py-12 text-center text-[#5A5E69] text-sm" colSpan={5}>
                      <span className="material-symbols-outlined text-[32px] text-[#C7C4D8] block mb-2">
                        event_busy
                      </span>
                      Belum ada jadwal bel untuk {selectedTab}.
                      <div className="mt-3">
                        <button
                          className="px-3 py-1.5 bg-[#4F46E5] text-white rounded-lg text-xs font-medium hover:bg-[#4338CA] cursor-pointer"
                          onClick={() => onOpenAddSchedule(selectedTab, selectedTab)}
                          type="button"
                        >
                          + Tambah Jadwal Sekarang
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredSchedules.map((row) => (
                    <tr
                      className="group h-[54px] hover:bg-[#F1F3FF]/70 transition-colors"
                      key={row.id}
                    >
                      {/* Jam */}
                      <td className="pl-6 pr-4 py-2 font-medium text-[14px] text-[#141b2b]">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px] text-[#3525CD]">
                            schedule
                          </span>
                          <span className="font-semibold tracking-tight text-[#141b2b]">
                            {row.time}
                          </span>
                        </div>
                      </td>

                      {/* Kegiatan */}
                      <td className="px-4 py-2">
                        <div className="flex flex-col">
                          <span className="text-[14px] font-medium text-[#141b2b]">
                            {row.name}
                          </span>
                          <span className="text-[12px] text-[#5A5E69]">
                            {row.description}
                          </span>
                        </div>
                      </td>

                      {/* Suara */}
                      <td className="px-4 py-2">
                        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#E9EDFF] text-[#141b2b] max-w-fit">
                          <button
                            className="w-5 h-5 rounded-full bg-[#4F46E5] text-white flex items-center justify-center hover:bg-[#3525CD] transition-transform active:scale-95 cursor-pointer"
                            onClick={() => handlePlaySound(row)}
                            title="Putar contoh suara"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[13px]">
                              {playingId === row.id ? 'stop' : 'play_arrow'}
                            </span>
                          </button>
                          <span className="text-[13px] font-mono text-[#141b2b]">
                            {row.soundName}
                          </span>
                          <span className="text-[10px] text-[#5A5E69]">{row.duration}</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-2">
                        <button
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12px] font-semibold cursor-pointer transition-colors ${
                            row.active
                              ? 'bg-[#DCFCE7] text-[#16A34A]'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                          onClick={() => onToggleScheduleActive(row.id)}
                          title="Klik untuk mengubah status aktif"
                          type="button"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              row.active ? 'bg-[#16A34A]' : 'bg-slate-400'
                            }`}
                          />
                          <span>{row.active ? 'Aktif' : 'Nonaktif'}</span>
                        </button>
                      </td>

                      {/* Aksi */}
                      <td className="pr-6 pl-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            className="w-8 h-8 rounded-lg text-[#5A5E69] hover:text-[#3525CD] hover:bg-[#E9EDFF] transition-colors flex items-center justify-center opacity-80 group-hover:opacity-100 cursor-pointer"
                            onClick={() => onEditSchedule(row)}
                            title="Ubah jadwal"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          <button
                            className="w-8 h-8 rounded-lg text-[#5A5E69] hover:text-[#BA1A1A] hover:bg-rose-50 transition-colors flex items-center justify-center cursor-pointer"
                            onClick={() => onDeleteSchedule(row)}
                            title="Hapus jadwal"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-[18px]">delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Table Footer / Summary Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5 bg-[#F1F3FF]/50 border-t border-[#E5E7EB]">
            <div className="flex items-center gap-2 text-[13px] text-[#5A5E69]">
              <span className="material-symbols-outlined text-[16px] text-[#5A5E69]">
                event_available
              </span>
              <span>
                Menampilkan <strong className="text-[#141b2b] font-medium">{filteredSchedules.length}</strong> jadwal untuk kategori <strong className="text-[#141b2b] font-medium">{selectedTab}</strong>
              </span>
            </div>
            <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1.5 text-[12px] text-[#5A5E69]">
                <span className="material-symbols-outlined text-[15px] text-[#16A34A]">
                  sync
                </span>
                <span>
                  Terakhir disinkronkan:{' '}
                  <strong className="text-[#141b2b] font-medium">
                    {formatSyncTimestamp(lastSyncedAt)}
                  </strong>
                </span>
              </div>
              <span className="text-[11px] text-[#5A5E69]">
                Sumber: {lastSourceFileName ?? 'Belum ada sumber tersinkron'}
              </span>
            </div>
            <button
              className="text-[#3525CD] hover:underline text-[12px] font-medium cursor-pointer"
              onClick={onRequestSync}
              title="Sinkronkan ulang dari file Excel terakhir"
              type="button"
            >
              Sinkronkan
            </button>
            </div>
          </div>
        </div>

        {/* Operational Infobox & Quick Tips Card Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-white shadow-xs border border-[#E5E7EB] flex items-start gap-3.5">
            <div className="w-9 h-9 rounded-lg bg-[#E9EDFF] text-[#3525CD] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">timer</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[14px] text-[#141b2b] font-semibold">
                Toleransi Presisi Waktu
              </span>
              <p className="text-[13px] text-[#5A5E69] mt-0.5">
                Sinkronisasi NTP Windows aktif dengan deviasi kurang dari 0.2 detik ke server induk.
              </p>
            </div>
          </div>

          <div
            className="p-4 rounded-xl bg-white shadow-xs border border-[#E5E7EB] flex items-start gap-3.5 cursor-pointer hover:bg-rose-50/40 transition-colors"
            onClick={onOpenEmergencyModal}
          >
            <div className="w-9 h-9 rounded-lg bg-[#FFDAD6] text-[#BA1A1A] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">emergency</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[14px] text-[#141b2b] font-semibold">
                Mode Override Darurat
              </span>
              <p className="text-[13px] text-[#5A5E69] mt-0.5">
                Jadwal dapat dihentikan seketika melalui tombol Darurat di header atau panel cepat F12.
              </p>
            </div>
          </div>

          <div
            className="p-4 rounded-xl bg-white shadow-xs border border-[#E5E7EB] flex items-start gap-3.5 cursor-pointer hover:bg-[#EEF2FF]/40 transition-colors"
            onClick={onOpenAiAssistant}
          >
            <div className="w-9 h-9 rounded-lg bg-[#E9EDFF] text-[#3525CD] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[20px]">smart_toy</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[14px] text-[#141b2b] font-semibold">
                Otomasi Jadwal Khusus
              </span>
              <p className="text-[13px] text-[#5A5E69] mt-0.5">
                Kategori Ujian dan Class Meeting dapat diaktifkan otomatis berdasarkan tanggal kalender.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Salin ke Hari Lain Modal */}
      {copyModalOpen && (
        <div className="fixed inset-0 bg-[#293040]/40 backdrop-blur-[1.5px] z-50 flex items-center justify-center p-6 select-none">
          <div className="w-full max-w-[450px] bg-white rounded-xl shadow-xl border border-[#E5E7EB] p-5 flex flex-col animate-fade-in">
            <h3 className="text-base font-semibold text-[#141b2b]">
              Salin Jadwal dari {selectedTab}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Pilih hari tujuan untuk menyalin {filteredSchedules.length} jadwal:
            </p>

            <div className="grid grid-cols-2 gap-2 my-4">
              {['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
                .filter((d) => d !== selectedTab)
                .map((day) => (
                  <label
                    className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 text-xs font-medium cursor-pointer hover:bg-slate-50"
                    key={day}
                  >
                    <input
                      checked={selectedTargetDays.includes(day)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTargetDays([...selectedTargetDays, day]);
                        } else {
                          setSelectedTargetDays(selectedTargetDays.filter((d) => d !== day));
                        }
                      }}
                      type="checkbox"
                    />
                    <span>{day}</span>
                  </label>
                ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                className="h-8 px-3 rounded-lg bg-slate-100 text-xs font-medium hover:bg-slate-200 text-slate-700"
                onClick={() => setCopyModalOpen(false)}
                type="button"
              >
                Batal
              </button>
              <button
                className="h-8 px-4 rounded-lg bg-[#4F46E5] text-xs font-medium text-white hover:bg-[#4338CA] shadow-sm disabled:opacity-50"
                disabled={selectedTargetDays.length === 0}
                onClick={() => {
                  onCopySchedulesToDay(selectedTab, selectedTargetDays);
                  setCopyModalOpen(false);
                }}
                type="button"
              >
                Salin Jadwal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
