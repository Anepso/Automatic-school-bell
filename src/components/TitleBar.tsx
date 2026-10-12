import React from 'react';
import { AppSettings } from '../types';
import { DEFAULT_SCHOOL_LOGO } from '../utils/storage';

interface TitleBarProps {
  settings: AppSettings;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  isMaximized: boolean;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  settings,
  onMinimize,
  onMaximize,
  onClose,
  isMaximized,
}) => {
  return (
    <header className="electron-drag-region fixed top-0 left-[240px] right-0 h-10 bg-white border-b border-[#E5E7EB] z-40 flex items-center justify-between px-4 select-none">
      <div className="flex items-center gap-2">
        <img
          alt={`${settings.schoolName} School Bell Logo`}
          className="h-5 w-auto object-contain rounded"
          src={settings.schoolLogo || DEFAULT_SCHOOL_LOGO}
          onError={(e) => {
            (e.target as HTMLImageElement).src = DEFAULT_SCHOOL_LOGO;
          }}
        />
        <span className="text-[12px] text-[#6B7280] font-normal">
          {settings.schoolName} - Smart School Bell v1.0.0
        </span>
      </div>

      <div className="flex items-center h-full">
        {/* Windows Controls */}
        <div className="electron-no-drag flex items-center h-full -mr-4">
          <button
            aria-label="Minimize"
            className="h-10 w-11 flex items-center justify-center text-[#6B7280] hover:bg-[#F1F3FF] hover:text-[#111827] transition-colors"
            type="button"
            onClick={onMinimize}
            title="Minimize ke taskbar"
          >
            <span className="material-symbols-outlined text-[16px]">remove</span>
          </button>
          <button
            aria-label="Maximize"
            className="h-10 w-11 flex items-center justify-center text-[#6B7280] hover:bg-[#F1F3FF] hover:text-[#111827] transition-colors"
            type="button"
            onClick={onMaximize}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            <span className="material-symbols-outlined text-[14px]">
              {isMaximized ? 'filter_none' : 'check_box_outline_blank'}
            </span>
          </button>
          <button
            aria-label="Close"
            className="h-10 w-11 flex items-center justify-center text-[#6B7280] hover:bg-[#DC2626] hover:text-white transition-colors"
            type="button"
            onClick={onClose}
            title="Sembunyikan ke System Tray"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      </div>
    </header>
  );
};
