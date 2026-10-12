import React, { useState, useEffect } from 'react';
import { ScheduleItem, AppSettings } from '../types';
import { DEFAULT_SCHOOL_LOGO } from '../utils/storage';
import { playSoundByName, stopAudio } from '../utils/audioEngine';
import { findNextSchedule, formatCountdown } from '../utils/scheduler';
import type { ConfirmationDialogRequest } from './modals/ConfirmationDialog';

interface DashboardViewProps {
  schedules: ScheduleItem[];
  settings: AppSettings;
  onNavigateToJadwal: () => void;
  onOpenAiAssistant: () => void;
  onOpenEmergencyModal: () => void;
  onTriggerBellNow: (schedule: ScheduleItem) => void;
  onRequestConfirmation?: (request: ConfirmationDialogRequest) => void;
  onRequestSync?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  schedules,
  settings,
  onNavigateToJadwal,
  onOpenAiAssistant,
  onOpenEmergencyModal,
  onTriggerBellNow,
  onRequestConfirmation,
  onRequestSync,
}) => {
  const [currentTimeStr, setCurrentTimeStr] = useState('09:27');
  const [currentDateStr, setCurrentDateStr] = useState('Senin, 29 September 2026');
  const [countdownStr, setCountdownStr] = useState('02:17');
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const [isTestingSpeaker, setIsTestingSpeaker] = useState(false);
  const [showToast, setShowToast] = useState(true);

  // Live time ticker
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      setCurrentTimeStr(`${hh}:${mm}`);

      const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
      const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
      const dayName = days[now.getDay()];
      const dayNum = now.getDate();
      const monthName = months[now.getMonth()];
      const year = now.getFullYear();
      setCurrentDateStr(`${dayName}, ${dayNum} ${monthName} ${year}`);
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Determine current day's schedules
  const now = new Date();
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const todayName = dayNames[now.getDay()];
  const todaySchedules = schedules
    .filter((s) => s.day === todayName || s.day === 'Semua')
    .sort((a, b) => a.time.localeCompare(b.time));

  // Determine next bell (display only; firing uses findMatchingSchedule)
  const nextScheduleResult = findNextSchedule(schedules, now);
  const nextBell = nextScheduleResult?.schedule ?? null;
  const nextBellTime = nextScheduleResult?.schedule.time ?? null;
  const nextBellDayOffset = nextScheduleResult?.dayOffset ?? 0;

  // Dynamic countdown calculation to next bell
  useEffect(() => {
    if (!nextBellTime) return;
    const calculateCountdown = () => {
      const current = new Date();
      const [targetH, targetM] = nextBellTime.split(':').map(Number);
      // Real Date arithmetic so month/year/week rollover and DST are handled.
      const targetDate = new Date(
        current.getFullYear(),
        current.getMonth(),
        current.getDate() + nextBellDayOffset,
        targetH,
        targetM,
        0,
        0
      );

      setCountdownStr(formatCountdown((targetDate.getTime() - current.getTime()) / 1000));
    };

    calculateCountdown();
    const interval = setInterval(calculateCountdown, 1000);
    return () => clearInterval(interval);
  }, [nextBellTime, nextBellDayOffset]);

  const handlePreviewAudio = () => {
    if (isPlayingPreview) {
      stopAudio();
      setIsPlayingPreview(false);
    } else {
      setIsPlayingPreview(true);
      playSoundByName(nextBell?.soundName || 'istirahat.mp3', settings.bellVolume).finally(() => {
        setIsPlayingPreview(false);
      });
    }
  };

  const handleTestBell = () => {
    setIsTestingSpeaker(true);
    playSoundByName('normal.mp3', settings.bellVolume).finally(() => {
      setIsTestingSpeaker(false);
    });
  };

  return (
    <div className="w-full max-w-[1200px] mx-auto p-8 select-none">
      <div className="flex flex-col gap-6">
        {/* Top Header & Identity Area */}
        <header className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-[#F1F3FF] border border-[#E5E7EB] flex items-center justify-center shadow-xs p-1.5 shrink-0">
              <img
                alt={`${settings.schoolName} School Bell Logo`}
                className="h-full w-full object-contain rounded-lg"
                src={settings.schoolLogo || DEFAULT_SCHOOL_LOGO}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = DEFAULT_SCHOOL_LOGO;
                }}
              />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-[24px] font-semibold text-[#141b2b] tracking-tight">
                  Dashboard
                </h1>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold bg-[#E9EDFF] text-[#3525CD]">
                  v1.0.0
                </span>
              </div>
              <p className="text-[14px] text-[#464555]">
                Pantau jadwal dan status sistem bel sekolah {settings.schoolName}.
              </p>
            </div>
          </div>

          {/* Quick Action Controls */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg shadow-xs border border-[#E5E7EB]">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#16A34A] animate-pulse"></span>
              <span className="text-[12px] font-semibold text-[#16A34A]">
                Auto-Scheduler Sync
              </span>
            </div>
            <button
              className="h-9 px-3.5 rounded-lg bg-white hover:bg-[#F1F3FF] text-[#141b2b] text-[14px] font-medium shadow-xs border border-[#E5E7EB] flex items-center gap-2 transition-colors cursor-pointer"
              onClick={() => {
                // Shared synchronization contract (UPSERT from last import source).
                // Handled by App so Dashboard and Jadwal behave identically.
                onRequestSync?.();
              }}
              type="button"
            >
              <span className="material-symbols-outlined text-[18px] text-[#464555]">
                sync
              </span>
              Sinkronkan
            </button>
          </div>
        </header>

        {/* Top Row: Time Widget + Next Bell Highlight */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Current Time Widget (5 cols) */}
          <div className="lg:col-span-5 bg-white rounded-xl p-6 shadow-xs border border-[#E5E7EB] flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -right-8 -bottom-8 w-40 h-40 bg-[#F1F3FF] rounded-full opacity-60 pointer-events-none"></div>
            <div className="flex items-center justify-between z-10">
              <span className="text-[12px] font-semibold tracking-wider text-[#5A5E69] uppercase">
                Waktu Sistem Windows
              </span>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold ${
                settings.systemPaused
                  ? 'bg-[#FEF3C7] text-[#B45309]'
                  : 'bg-[#DCFCE7] text-[#16A34A]'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${settings.systemPaused ? 'bg-[#D97706]' : 'bg-[#16A34A]'}`} />
                {settings.systemPaused ? 'Bel Dijeda' : 'Bel Otomatis Aktif'}
              </span>
            </div>

            <div className="my-4 z-10">
              <div className="text-[52px] font-bold text-[#141b2b] tracking-tight leading-none [font-variant-numeric:tabular-nums]">
                {currentTimeStr}
              </div>
              <div className="text-[14px] text-[#464555] font-medium mt-2 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[18px] text-[#777587]">
                  calendar_today
                </span>
                <span>{currentDateStr}</span>
              </div>
            </div>

            <div className="pt-3 border-t-0 flex items-center justify-between text-[#5A5E69] z-10">
              <div className="flex items-center gap-1.5 text-[12px] text-[#464555]">
                <span className="material-symbols-outlined text-[16px] text-[#3525CD]">
                  schedule
                </span>
                Zona: WIB (UTC+7)
              </div>
              <span className="text-[12px] text-[#777587]">Latensi: 12ms</span>
            </div>
          </div>

          {/* Right Highlight Card: NEXT BELL (7 cols) */}
          <div className="lg:col-span-7 bg-[#EEF2FF] rounded-xl p-6 shadow-xs border border-[#C7D2FE] flex flex-col justify-between relative overflow-hidden">
            <div className="absolute right-0 top-0 w-48 h-full bg-gradient-to-l from-[#3525CD]/10 to-transparent pointer-events-none"></div>
            <div className="flex items-center justify-between relative z-10">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${nextBell ? 'bg-[#3525CD] animate-ping' : 'bg-[#9CA3AF]'}`}
                />
                <span className="text-[12px] font-semibold uppercase tracking-wider text-[#3525CD]">
                  BEL BERIKUTNYA
                </span>
              </div>
              {nextBell ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#C7D2FE]/70 text-[#3525CD] font-medium text-[13px] shadow-xs">
                  <span className="material-symbols-outlined text-[16px]">hourglass_top</span>
                  <span>
                    dalam <strong className="font-semibold [font-variant-numeric:tabular-nums]">{countdownStr}</strong>
                  </span>
                </div>
              ) : (
                <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/80 text-[#5A5E69] text-[12px] font-medium border border-[#E5E7EB]">
                  Tidak ada jadwal
                </span>
              )}
            </div>

            {nextBell ? (
              <>
                <div className="my-3 flex items-baseline gap-4 relative z-10">
                  <span className="text-[44px] leading-tight font-bold text-[#141b2b] [font-variant-numeric:tabular-nums] tracking-tight">
                    {nextBell.time}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-[18px] font-semibold text-[#3525CD] leading-tight">
                      {nextBell.name}
                    </span>
                    <span className="text-[13px] text-[#5A5E69]">
                      {nextBell.description}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 bg-white/80 backdrop-blur-xs rounded-lg px-4 py-2.5 relative z-10 border border-[#E5E7EB]">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-md bg-[#EEF2FF] flex items-center justify-center text-[#3525CD] shrink-0">
                      <span className="material-symbols-outlined text-[18px]">volume_up</span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[14px] font-medium text-[#141b2b] truncate">
                        {nextBell.name}
                      </span>
                      <span className="text-[12px] text-[#777587] truncate">
                        {nextBell.soundName} (Preset bel otomatis)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="h-8 px-3 rounded-lg bg-white hover:bg-[#F1F3FF] text-[#3525CD] text-[12px] font-semibold shadow-xs border border-[#E5E7EB] flex items-center gap-1.5 transition-colors cursor-pointer"
                      onClick={handlePreviewAudio}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {isPlayingPreview ? 'stop' : 'play_arrow'}
                      </span>
                      {isPlayingPreview ? 'Stop' : 'Pratinjau'}
                    </button>
                    <button
                      className="h-8 px-3 rounded-lg bg-[#4F46E5] hover:bg-[#4338CA] text-white text-[12px] font-semibold shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                      onClick={() => onTriggerBellNow(nextBell)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        notifications_active
                      </span>
                      Bunyikan Sekarang
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="relative z-10 my-5 flex min-h-[150px] flex-col items-center justify-center gap-2 text-center">
                <span className="material-symbols-outlined text-[32px] text-[#5A5E69]">
                  event_busy
                </span>
                <h2 className="text-[16px] font-semibold text-[#141b2b]">
                  Belum ada jadwal berikutnya
                </h2>
                <p className="max-w-sm text-[13px] text-[#5A5E69]">
                  Tambahkan jadwal bel untuk melihat waktu dan kegiatan berikutnya di sini.
                </p>
                <button
                  className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#4F46E5] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[#4338CA]"
                  onClick={onNavigateToJadwal}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[17px]">add</span>
                  Tambah Jadwal
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Middle Row: Schedule & Control Widgets */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left (8 cols): Today's Schedule List */}
          <div className="lg:col-span-8 bg-white rounded-xl shadow-xs border border-[#E5E7EB] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-5 flex items-center justify-between border-b border-[#E5E7EB]">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#E9EDFF] flex items-center justify-center text-[#3525CD]">
                  <span className="material-symbols-outlined text-[20px]">calendar_today</span>
                </div>
                <div>
                  <h2 className="text-[16px] font-semibold text-[#141b2b]">Jadwal Hari Ini</h2>
                  <p className="text-[13px] text-[#464555]">
                    Jadwal reguler semester ganjil
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold bg-[#F1F3FF] text-[#3525CD]">
                  {todayName} • {todaySchedules.length} Jadwal
                </span>
                <button
                  className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-[#F1F3FF] text-[#5A5E69] transition-colors"
                  onClick={onNavigateToJadwal}
                  title="Lihat Detail Jadwal"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">more_vert</span>
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex flex-col divide-y divide-[#E5E7EB]">
              {todaySchedules.map((item) => {
                const isCompleted = item.time < currentTimeStr;
                const isNext = item.id === nextBell?.id;

                if (isNext) {
                  return (
                    <div
                      className="flex items-center justify-between px-5 py-4 bg-[#EEF2FF] shadow-inner relative"
                      key={item.id}
                    >
                      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-[#4F46E5]"></div>
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#4F46E5] flex items-center justify-center text-white shrink-0 shadow-xs animate-pulse">
                          <span className="material-symbols-outlined text-[18px]">notifications</span>
                        </div>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="text-[15px] font-semibold text-[#141b2b]">
                              {item.name}
                            </span>
                            <span className="inline-block w-2 h-2 rounded-full bg-[#4F46E5]"></span>
                          </div>
                          <span className="text-[12px] text-[#4F46E5]">
                            {item.soundName} • {item.description}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <span className="text-[15px] font-semibold text-[#4F46E5] [font-variant-numeric:tabular-nums]">
                          {item.time}
                        </span>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-semibold text-[#4F46E5] bg-[#C7D2FE]">
                          Selanjutnya
                        </span>
                      </div>
                    </div>
                  );
                }

                if (isCompleted) {
                  return (
                    <div
                      className="flex items-center justify-between px-5 py-3.5 bg-white/50 hover:bg-[#F1F3FF]/40 transition-colors"
                      key={item.id}
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-[#E1E8FD] flex items-center justify-center text-[#777587] shrink-0">
                          <span className="material-symbols-outlined text-[18px]">check</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[14px] font-medium text-[#5A5E69] line-through">
                            {item.name}
                          </span>
                          <span className="text-[12px] text-[#777587]">
                            {item.soundName} • {item.description}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <span className="text-[14px] text-[#5A5E69] [font-variant-numeric:tabular-nums]">
                          {item.time}
                        </span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] font-normal text-[#5A5E69] bg-[#F1F3FF]">
                          Selesai
                        </span>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    className="flex items-center justify-between px-5 py-3.5 bg-white hover:bg-[#F1F3FF]/40 transition-colors"
                    key={item.id}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-[#E9EDFF] flex items-center justify-center text-[#464555] shrink-0">
                        <span className="material-symbols-outlined text-[18px]">schedule</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[14px] font-medium text-[#141b2b]">
                          {item.name}
                        </span>
                        <span className="text-[12px] text-[#464555]">
                          {item.soundName} • {item.description}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <span className="text-[14px] font-medium text-[#141b2b] [font-variant-numeric:tabular-nums]">
                        {item.time}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] text-[#464555] bg-[#F1F3FF]">
                        Mendatang
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="p-4 bg-[#F1F3FF] flex items-center justify-between border-t border-[#E5E7EB]">
              <div className="flex items-center gap-2 text-[#464555] text-[13px]">
                <span className="material-symbols-outlined text-[16px] text-[#777587]">
                  tune
                </span>
                <span>Jadwal aktif disinkronkan otomatis dari kalender akademik.</span>
              </div>
              <button
                className="inline-flex items-center gap-1 text-[#4F46E5] hover:text-[#4338CA] text-[14px] font-medium transition-colors cursor-pointer"
                onClick={onNavigateToJadwal}
                type="button"
              >
                Lihat Semua Jadwal
                <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
              </button>
            </div>
          </div>

          {/* Right (4 cols): Utility Widgets Stack */}
          <div className="lg:col-span-4 flex flex-col gap-5">
            {/* Speaker Status Card */}
            <div className="bg-white rounded-xl p-5 shadow-xs border border-[#E5E7EB] flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[20px]">volume_up</span>
                  </div>
                  <h3 className="text-[16px] font-semibold text-[#141b2b]">Speaker</h3>
                </div>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#DCFCE7] text-[#16A34A] text-[12px] font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></span>
                  Siap
                </span>
              </div>

              <div className="bg-[#F1F3FF] rounded-lg p-3 flex flex-col gap-1.5 border border-[#E5E7EB]">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-[#464555]">Output Device</span>
                  <span className="text-[12px] font-semibold text-[#3525CD]">Utama</span>
                </div>
                <p className="text-[13px] text-[#141b2b] font-medium truncate">
                  Speakers (Realtek High Definition Audio)
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="material-symbols-outlined text-[14px] text-[#777587]">
                    graphic_eq
                  </span>
                  <div className="w-full bg-[#DCE2F7] rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-[#4F46E5] h-1.5 rounded-full transition-all"
                      style={{ width: `${settings.bellVolume}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-[#777587]">{settings.bellVolume}%</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  className="flex-1 h-9 px-3 rounded-lg bg-[#F1F3FF] hover:bg-[#E9EDFF] text-[#141b2b] text-[14px] font-medium flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
                  onClick={handleTestBell}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px] text-[#3525CD]">
                    {isTestingSpeaker ? 'volume_up' : 'campaign'}
                  </span>
                  {isTestingSpeaker ? 'Membunyikan...' : 'Tes Bel'}
                </button>
              </div>
            </div>

            {/* Dashboard AI Shortcut Card */}
            <div className="bg-white rounded-xl p-5 shadow-xs border border-[#E5E7EB] flex flex-col justify-between relative overflow-hidden group hover:shadow-md transition-shadow">
              <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-[#EEF2FF] rounded-full pointer-events-none group-hover:scale-110 transition-transform"></div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#EEF2FF] text-[#3525CD] text-[12px] font-semibold">
                    <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                    AI Assistant
                  </span>
                  <span className="text-[11px] text-[#777587]">Gemini</span>
                </div>
                <h4 className="text-[16px] font-semibold text-[#141b2b] mt-2">
                  Atur Jadwal Lebih Cepat
                </h4>
                <p className="text-[13px] text-[#464555] mt-1">
                  Butuh bantuan mengatur jadwal bel khusus ujian, hari libur, atau upacara bendera? AI dapat mengaturnya dalam detik.
                </p>
              </div>

              <div className="mt-4 pt-3">
                <button
                  className="w-full h-9 rounded-lg bg-[#EEF2FF] hover:bg-[#E0E7FF] text-[#3525CD] text-[13px] font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  onClick={onOpenAiAssistant}
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                  Buka AI Assistant
                </button>
              </div>
            </div>

            {/* Quick Emergency Override Mini-Card */}
            <div className="bg-white rounded-xl p-4 shadow-xs border border-[#E5E7EB] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#FFDAD6] text-[#BA1A1A] flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[18px]">warning</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[14px] font-medium text-[#141b2b]">
                    Darurat / Evakuasi
                  </span>
                  <span className="text-[12px] text-[#777587]">Sirine manual segera</span>
                </div>
              </div>
              <button
                className="h-8 px-2.5 rounded-lg bg-[#BA1A1A] text-white hover:bg-[#93000A] text-[12px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                onClick={onOpenEmergencyModal}
                type="button"
              >
                <span className="material-symbols-outlined text-[14px]">e911_emergency</span>
                Sirine
              </button>
            </div>
          </div>
        </section>

        {/* Bottom Notification Toast Preview */}
        {showToast && (
          <aside
            aria-live="polite"
            className="fixed bottom-14 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-[#E5E7EB] shadow-xl animate-fade-in max-w-sm"
          >
            <div className="w-7 h-7 rounded-full bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[18px]">check_circle</span>
            </div>
            <div className="flex flex-col min-w-0 pr-2">
              <p className="text-[13px] text-[#141b2b] font-medium leading-tight truncate">
                Sistem Berjalan Normal
              </p>
              <p className="text-[11px] text-[#464555] truncate">
                Sistem bel berjalan otomatis sesuai jadwal
              </p>
            </div>
            <button
              className="w-6 h-6 rounded-md hover:bg-[#F1F3FF] text-[#777587] hover:text-[#141b2b] flex items-center justify-center transition-colors cursor-pointer"
              onClick={() => setShowToast(false)}
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </aside>
        )}
      </div>
    </div>
  );
};
