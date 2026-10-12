import React, { useState, useEffect, useRef } from 'react';
import { AppSettings, ScheduleItem } from '../types';
import { playWestminsterChime, playTwoToneBell } from '../utils/audioEngine';

interface SystemTrayProps {
  isWindowVisible: boolean;
  onRestoreWindow: () => void;
  onOpenSettings: () => void;
  settings: AppSettings;
  onTogglePause: () => void;
  nextBell: ScheduleItem | null;
  onExitApp: () => void;
}

export const SystemTray: React.FC<SystemTrayProps> = ({
  isWindowVisible,
  onRestoreWindow,
  onOpenSettings,
  settings,
  onTogglePause,
  nextBell,
  onExitApp,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Close tray menu on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTestBell = () => {
    playWestminsterChime(settings.bellVolume);
    setToastMessage('🔔 Sedang memutar tes bel sekolah...');
    setTimeout(() => setToastMessage(null), 4000);
    setIsMenuOpen(false);
  };

  return (
    <>
      {/* Toast Notification when in tray or bell rings */}
      {toastMessage && (
        <aside
          aria-live="polite"
          className="fixed bottom-14 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-white border border-[#E5E7EB] shadow-2xl animate-fade-in max-w-sm"
        >
          <div className="w-8 h-8 rounded-full bg-[#DCFCE7] text-[#16A34A] flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[18px]">notifications_active</span>
          </div>
          <div className="flex flex-col min-w-0 pr-2">
            <p className="text-[13px] text-[#141b2b] font-medium leading-tight truncate">
              School Bell Notifikasi
            </p>
            <p className="text-[11px] text-[#464555] truncate mt-0.5">
              {toastMessage}
            </p>
          </div>
          <button
            className="w-6 h-6 rounded-md hover:bg-[#F1F3FF] text-[#777587] hover:text-[#141b2b] flex items-center justify-center transition-colors"
            onClick={() => setToastMessage(null)}
            type="button"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </aside>
      )}

      {/* When window is minimized, show helpful desktop overlay banner */}
      {!isWindowVisible && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 flex flex-col items-center justify-center p-6 select-none">
          <div className="bg-white rounded-2xl p-7 shadow-2xl border border-slate-200 max-w-md w-full flex flex-col items-center text-center animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-[#EEF2FF] border border-[#C7D2FE] flex items-center justify-center text-[#4F46E5] mb-4 shadow-sm">
              <span className="material-symbols-outlined text-[32px]">notifications_active</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900">
              School Bell Berjalan di Latar Belakang
            </h2>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
              Jendela utama telah diminimalkan ke <strong>Windows System Tray</strong>. Penjadwal otomatis tetap aktif dan bel akan tetap berbunyi tepat waktu.
            </p>

            {nextBell && (
              <div className="w-full bg-[#F8FAFC] border border-slate-200 rounded-xl p-3.5 my-4 flex items-center justify-between text-left">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#E0E7FF] text-[#4F46E5] flex items-center justify-center font-bold text-xs">
                    {nextBell.time}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-800">{nextBell.name}</p>
                    <p className="text-[11px] text-slate-400">{nextBell.soundName}</p>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  Siap Aktif
                </span>
              </div>
            )}

            <div className="flex items-center gap-3 w-full mt-2">
              <button
                className="flex-1 py-2.5 px-4 bg-[#4F46E5] hover:bg-[#4338CA] text-white font-medium rounded-xl text-sm transition-all shadow-sm flex items-center justify-center gap-2"
                onClick={onRestoreWindow}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                Buka Jendela School Bell
              </button>
              <button
                className="py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl text-sm transition-all"
                onClick={handleTestBell}
                type="button"
                title="Tes Bel Sekarang"
              >
                Tes Bel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Windows Taskbar Tray Simulation Bar */}
      {!isWindowVisible && (
        <footer className="fixed bottom-0 left-0 right-0 h-10 bg-white/95 backdrop-blur border-t border-[#E5E7EB] z-50 flex items-center justify-between px-3 select-none text-xs">
        {/* Left Windows Start / App Indicator */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#F1F3FF] text-[#3525CD] font-medium text-[12px]">
            <span className="material-symbols-outlined text-[16px]">desktop_windows</span>
            <span>Windows System Taskbar</span>
          </div>

          {!isWindowVisible && (
            <button
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#4F46E5] text-white text-[12px] font-medium hover:bg-[#4338CA] transition-colors"
              onClick={onRestoreWindow}
              type="button"
            >
              <span className="material-symbols-outlined text-[14px]">desktop_windows</span>
              <span>Buka School Bell</span>
            </button>
          )}
        </div>

        {/* Right System Notification Area (System Tray) */}
        <div className="flex items-center gap-2 relative" ref={menuRef}>
          {/* Bell Icon in System Tray */}
          <button
            className={`flex items-center gap-1.5 px-2 py-1 rounded hover:bg-[#F1F3FF] transition-colors relative ${
              isMenuOpen ? 'bg-[#E9EDFF] text-[#3525CD]' : 'text-[#464555]'
            }`}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            onContextMenu={(e) => {
              e.preventDefault();
              setIsMenuOpen(true);
            }}
            title="School Bell System Tray (Klik kanan / kiri untuk menu)"
            type="button"
          >
            <div className="relative">
              <span className="material-symbols-outlined text-[18px] text-[#4F46E5]">notifications</span>
              <span
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${
                  settings.systemPaused ? 'bg-[#D97706]' : 'bg-[#16A34A] animate-pulse'
                }`}
              />
            </div>
            <span className="text-[11px] font-medium text-slate-700 hidden sm:inline">
              School Bell
            </span>
          </button>

          {/* Tray Context Menu Popup */}
          {isMenuOpen && (
            <div className="absolute right-0 bottom-11 w-56 bg-white rounded-xl shadow-2xl border border-[#E5E7EB] py-1.5 z-50 flex flex-col text-slate-700 animate-fade-in">
              <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-xs text-slate-900 leading-tight">School Bell</p>
                  <p className="text-[10px] text-slate-400">{settings.schoolName} v2.4</p>
                </div>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    settings.systemPaused
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-emerald-100 text-emerald-700'
                  }`}
                >
                  {settings.systemPaused ? 'Dijeda' : 'Aktif'}
                </span>
              </div>

              {/* Action 1: Buka School Bell */}
              <button
                className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[#F1F3FF] hover:text-[#3525CD] transition-colors text-left font-medium"
                onClick={() => {
                  onRestoreWindow();
                  setIsMenuOpen(false);
                }}
                type="button"
              >
                <span className="material-symbols-outlined text-[16px] text-slate-500">open_in_new</span>
                <span>Buka School Bell</span>
              </button>

              {/* Action 2: Tes Bel */}
              <button
                className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[#F1F3FF] hover:text-[#3525CD] transition-colors text-left font-medium"
                onClick={handleTestBell}
                type="button"
              >
                <span className="material-symbols-outlined text-[16px] text-[#4F46E5]">notifications_active</span>
                <span>Tes Bel</span>
              </button>

              {/* Action 3: Jeda/Lanjutkan Bel */}
              <button
                className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[#F1F3FF] hover:text-[#3525CD] transition-colors text-left font-medium"
                onClick={() => {
                  onTogglePause();
                  setIsMenuOpen(false);
                }}
                type="button"
              >
                <span
                  className={`material-symbols-outlined text-[16px] ${
                    settings.systemPaused ? 'text-emerald-600' : 'text-amber-600'
                  }`}
                >
                  {settings.systemPaused ? 'play_arrow' : 'pause'}
                </span>
                <span>
                  {settings.systemPaused ? 'Lanjutkan Bel' : 'Jeda Bel'}
                </span>
              </button>

              {/* Action 4: Pengaturan */}
              <button
                className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-[#F1F3FF] hover:text-[#3525CD] transition-colors text-left font-medium"
                onClick={() => {
                  onRestoreWindow();
                  onOpenSettings();
                  setIsMenuOpen(false);
                }}
                type="button"
              >
                <span className="material-symbols-outlined text-[16px] text-slate-500">settings</span>
                <span>Pengaturan</span>
              </button>

              <div className="h-px bg-slate-100 my-1" />

              {/* Action 5: Keluar */}
              <button
                className="flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-rose-50 text-rose-600 transition-colors text-left font-medium"
                onClick={() => {
                  setIsMenuOpen(false);
                  onExitApp();
                }}
                type="button"
              >
                <span className="material-symbols-outlined text-[16px] text-rose-500">power_settings_new</span>
                <span>Keluar Aplikasi</span>
              </button>
            </div>
          )}

          {/* Volume icon */}
          <div className="flex items-center gap-1 text-[#464555] px-1.5 py-1">
            <span className="material-symbols-outlined text-[16px]">volume_up</span>
            <span className="text-[11px]">{settings.bellVolume}%</span>
          </div>

          {/* Clock in tray */}
          <div className="px-2 py-1 text-slate-600 font-mono text-[12px] font-semibold border-l border-slate-200">
            {currentTime}
          </div>
        </div>
        </footer>
      )}
    </>
  );
};
