import React, { useState } from 'react';
import { playEmergencySiren, stopAudio } from '../../utils/audioEngine';

interface EmergencyModalProps {
  isOpen: boolean;
  onClose: () => void;
  volume: number;
}

export const EmergencyModal: React.FC<EmergencyModalProps> = ({
  isOpen,
  onClose,
  volume,
}) => {
  const [isSounding, setIsSounding] = useState(false);

  if (!isOpen) return null;

  const handleStartSiren = () => {
    setIsSounding(true);
    playEmergencySiren(volume, 10).finally(() => {
      setIsSounding(false);
    });
  };

  const handleStop = () => {
    stopAudio();
    setIsSounding(false);
  };

  return (
    <div className="fixed inset-0 bg-[#293040]/60 backdrop-blur-xs z-50 flex items-center justify-center p-6 select-none">
      <div className="w-full max-w-[460px] bg-white rounded-2xl shadow-2xl border border-rose-200 p-6 flex flex-col items-center text-center animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
          <span className="material-symbols-outlined text-[36px] animate-pulse">
            e911_emergency
          </span>
        </div>

        <h2 className="text-xl font-bold text-slate-900">
          Mode Override Darurat / Evakuasi
        </h2>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          Bunyikan sirine darurat segera ke seluruh speaker sekolah untuk penanganan bencana atau evakuasi darurat.
        </p>

        <div className="w-full bg-rose-50 border border-rose-200 rounded-xl p-3 my-4 text-rose-800 text-xs text-left flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] text-rose-600 mt-0.5">warning</span>
          <span>
            Pemberitahuan: Bunyi sirine ini akan menimpa seluruh jadwal reguler yang sedang aktif.
          </span>
        </div>

        <div className="flex items-center gap-3 w-full mt-2">
          {isSounding ? (
            <button
              className="flex-1 py-3 px-4 bg-slate-900 hover:bg-black text-white font-semibold rounded-xl text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              onClick={handleStop}
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">stop_circle</span>
              Hentikan Sirine
            </button>
          ) : (
            <button
              className="flex-1 py-3 px-4 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl text-sm transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer animate-pulse"
              onClick={handleStartSiren}
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">campaign</span>
              Bunyikan Sirine Sekarang
            </button>
          )}

          <button
            className="py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl text-sm transition-all"
            onClick={() => {
              handleStop();
              onClose();
            }}
            type="button"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
