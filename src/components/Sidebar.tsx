import React from 'react';
import { AppSettings } from '../types';
import { DEFAULT_SCHOOL_LOGO } from '../utils/storage';

export type NavTab = 'dashboard' | 'jadwal' | 'suara' | 'pengaturan';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenAiDrawer: () => void;
  isAiDrawerOpen: boolean;
  settings: AppSettings;
  onToggleSystemPause: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  onOpenAiDrawer,
  isAiDrawerOpen,
  settings,
  onToggleSystemPause,
}) => {
  const isPaused = settings.systemPaused;

  return (
    <aside className="fixed left-0 top-0 h-full w-[240px] bg-white border-r border-[#E5E7EB] z-50 flex flex-col justify-between shadow-[0_1px_2px_0_rgba(17,24,39,0.04)] select-none">
      <div className="flex flex-col">
        {/* School Branding Box */}
        <div className="p-4 border-b border-[#E5E7EB] flex items-center gap-3">
          <img
            alt={`${settings.schoolName} School Bell Logo`}
            className="h-[38px] w-[38px] rounded-lg object-contain bg-[#F1F3FF] p-0.5 border border-[#E5E7EB]"
            src={settings.schoolLogo || DEFAULT_SCHOOL_LOGO}
            onError={(e) => {
              (e.target as HTMLImageElement).src = DEFAULT_SCHOOL_LOGO;
            }}
          />
          <div className="flex flex-col min-w-0">
            <span className="font-medium text-[14px] text-[#141b2b] truncate leading-tight">
              {settings.schoolName}
            </span>
            <span className="text-[12px] text-[#464555] truncate leading-tight mt-0.5">
              School Bell
            </span>
          </div>
        </div>

        {/* Navigation Categories */}
        <div className="px-3 py-4 flex flex-col gap-4">
          {/* MAIN */}
          <div className="flex flex-col">
            <span className="px-3 mb-1.5 text-[11px] text-[#464555] font-semibold tracking-wider uppercase">
              MAIN
            </span>
            <nav className="flex flex-col gap-1">
              <button
                className={`flex items-center gap-3 px-3 h-10 rounded-lg text-left transition-colors ${
                  currentTab === 'dashboard'
                    ? 'bg-[#E9EDFF] text-[#3525CD] font-medium'
                    : 'text-[#464555] hover:bg-[#F1F3FF] hover:text-[#141b2b]'
                }`}
                onClick={() => onSelectTab('dashboard')}
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">dashboard</span>
                <span className="text-[14px]">Dashboard</span>
              </button>

              <button
                className={`flex items-center gap-3 px-3 h-10 rounded-lg text-left transition-colors ${
                  currentTab === 'jadwal'
                    ? 'bg-[#E9EDFF] text-[#3525CD] font-medium'
                    : 'text-[#464555] hover:bg-[#F1F3FF] hover:text-[#141b2b]'
                }`}
                onClick={() => onSelectTab('jadwal')}
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">calendar_clock</span>
                <span className="text-[14px]">Jadwal</span>
              </button>

              <button
                className={`flex items-center gap-3 px-3 h-10 rounded-lg text-left transition-colors ${
                  currentTab === 'suara'
                    ? 'bg-[#E9EDFF] text-[#3525CD] font-medium'
                    : 'text-[#464555] hover:bg-[#F1F3FF] hover:text-[#141b2b]'
                }`}
                onClick={() => onSelectTab('suara')}
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">volume_up</span>
                <span className="text-[14px]">Suara</span>
              </button>
            </nav>
          </div>

          {/* SMART */}
          <div className="flex flex-col">
            <span className="px-3 mb-1.5 text-[11px] text-[#464555] font-semibold tracking-wider uppercase">
              SMART
            </span>
            <nav className="flex flex-col gap-1">
              <button
                className={`flex items-center justify-between px-3 h-10 rounded-lg text-left transition-colors ${
                  isAiDrawerOpen
                    ? 'bg-[#E9EDFF] text-[#3525CD] font-medium ring-1 ring-[#4F46E5]/30'
                    : 'text-[#464555] hover:bg-[#F1F3FF] hover:text-[#141b2b]'
                }`}
                onClick={onOpenAiDrawer}
                type="button"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[20px] text-[#3525CD]">auto_awesome</span>
                  <span className="text-[14px]">AI Assistant</span>
                </div>
                <span className="bg-[#4F46E5]/10 text-[#4F46E5] text-[10px] px-1.5 py-0.5 rounded font-semibold">
                  PRO
                </span>
              </button>
            </nav>
          </div>

          {/* SYSTEM */}
          <div className="flex flex-col">
            <span className="px-3 mb-1.5 text-[11px] text-[#464555] font-semibold tracking-wider uppercase">
              SYSTEM
            </span>
            <nav className="flex flex-col gap-1">
              <button
                className={`flex items-center gap-3 px-3 h-10 rounded-lg text-left transition-colors ${
                  currentTab === 'pengaturan'
                    ? 'bg-[#E9EDFF] text-[#3525CD] font-medium'
                    : 'text-[#464555] hover:bg-[#F1F3FF] hover:text-[#141b2b]'
                }`}
                onClick={() => onSelectTab('pengaturan')}
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">settings</span>
                <span className="text-[14px]">Pengaturan</span>
              </button>
            </nav>
          </div>
        </div>
      </div>

      {/* Footer System Status Badge */}
      <div className="p-4 border-t border-[#E5E7EB] bg-white">
        <div className="flex items-center gap-1 px-1 mb-2">
          <p className="px-1 mb-4 text-[11px] text-[#777587]">
            Crafted by{' '}
            <a
              href="https://github.com/Anepso"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#777587] hover:text-[#4F46E5] hover:underline underline-offset-2 transition-colors cursor-pointer"
            >
              Anep'so
            </a>
            <span className="mx-1 text-[#D1D5DB]">·</span>
            <span>v1.0.0</span>
          </p>
        </div>
        <button
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-full border w-fit mb-1.5 cursor-pointer transition-all hover:opacity-90 active:scale-95 ${
            isPaused
              ? 'bg-[#FEF3C7] border-[#FDE68A] text-[#B45309]'
              : 'bg-[#DCFCE7] border-[#BBF7D0] text-[#16A34A]'
          }`}
          onClick={onToggleSystemPause}
          title={isPaused ? 'Klik untuk Mengaktifkan Bel' : 'Klik untuk Menjeda Sistem Bel'}
          type="button"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isPaused ? 'bg-[#D97706]' : 'bg-[#16A34A] animate-pulse'
            }`}
          />
          <span className="text-[12px] font-semibold">
            {isPaused ? 'Sistem Dijeda' : 'Sistem Aktif'}
          </span>
        </button>
        <p className="px-1 text-[12px] text-[#464555] truncate">
          Berjalan di System Tray
        </p>
      </div>
    </aside>
  );
};
