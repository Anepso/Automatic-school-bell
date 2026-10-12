import React, { useState, useEffect } from 'react';
import { ScheduleItem, CategoryItem, AudioFileItem } from '../../types';
import type { ConfirmationDialogRequest } from './ConfirmationDialog';
import { playSoundByName, stopAudio } from '../../utils/audioEngine';

interface TambahJadwalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (item: Partial<ScheduleItem>) => void;
  onRequestConfirmation: (request: ConfirmationDialogRequest) => void;
  editingItem: ScheduleItem | null;
  categories: CategoryItem[];
  audioFiles: AudioFileItem[];
  defaultDay?: string;
  defaultCategory?: string;
  volume: number;
}

export const TambahJadwalModal: React.FC<TambahJadwalModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onRequestConfirmation,
  editingItem,
  categories,
  audioFiles,
  defaultDay = 'Senin',
  defaultCategory = 'Reguler',
  volume,
}) => {
  const [name, setName] = useState('Istirahat');
  const [time, setTime] = useState('09:30');
  const [dayCategory, setDayCategory] = useState('Senin');
  const [selectedSound, setSelectedSound] = useState('istirahat.mp3');
  const [active, setActive] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (editingItem) {
      setName(editingItem.name);
      setTime(editingItem.time);
      setDayCategory(editingItem.category !== 'Reguler' ? editingItem.category : editingItem.day);
      setSelectedSound(editingItem.soundName);
      setActive(editingItem.active);
    } else {
      setName('Istirahat');
      setTime('09:30');
      setDayCategory(defaultCategory !== 'Reguler' ? defaultCategory : defaultDay);
      setSelectedSound('istirahat.mp3');
      setActive(true);
    }
    setIsPlaying(false);
    stopAudio();
  }, [editingItem, isOpen, defaultDay, defaultCategory]);

  if (!isOpen) return null;

  const currentAudio = audioFiles.find((a) => a.fileName === selectedSound) || audioFiles[0];

  const handleTestSound = () => {
    if (isPlaying) {
      stopAudio();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      playSoundByName(selectedSound, volume).then(() => {
        setIsPlaying(false);
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    stopAudio();
    setIsPlaying(false);

    // Determine day vs category
    const isCustomCat = categories.some((c) => c.name === dayCategory && c.isCustom);
    const resolvedDay = isCustomCat ? 'Semua' : dayCategory;
    const resolvedCategory = isCustomCat ? dayCategory : 'Reguler';

    const schedule = {
      id: editingItem ? editingItem.id : `sch-${Date.now()}`,
      name: name.trim() || 'Bel Sekolah',
      time,
      description: editingItem?.description || `Bel ${name}`,
      soundId: currentAudio ? currentAudio.id : 'snd-1',
      soundName: selectedSound,
      duration: currentAudio ? currentAudio.duration : '0:10',
      day: resolvedDay,
      category: resolvedCategory,
      active,
    };

    onRequestConfirmation({
      title: editingItem ? 'Simpan perubahan jadwal?' : 'Tambah jadwal?',
      description: `${schedule.name} pada ${time}, ${isCustomCat ? dayCategory : resolvedDay} akan ${editingItem ? 'diperbarui' : 'ditambahkan'}.`,
      impact: active
        ? 'Jadwal ini akan aktif sesuai hari dan waktu yang dipilih.'
        : 'Jadwal tersimpan dalam keadaan nonaktif.',
      confirmLabel: editingItem ? 'Simpan Perubahan' : 'Simpan Jadwal',
      tone: 'primary',
      onConfirm: () => {
        onSave(schedule);
        onClose();
      },
    });
  };

  return (
    <div className="fixed inset-0 bg-[#293040]/40 backdrop-blur-[1.5px] z-50 flex items-center justify-center p-6 overflow-y-auto select-none">
      <div className="w-full max-w-[540px] bg-white rounded-xl shadow-xl p-6 flex flex-col relative z-20 border border-[#E5E7EB] animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between pb-3">
          <div className="flex flex-col">
            <h2 className="text-[20px] font-semibold text-[#141b2b] tracking-tight leading-tight">
              {editingItem ? 'Ubah Jadwal' : 'Tambah Jadwal'}
            </h2>
            <p className="text-[13px] text-[#464555] mt-0.5">
              Tambahkan waktu dan audio bel baru ke dalam jadwal sekolah.
            </p>
          </div>
          <button
            aria-label="Tutup"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-[#464555] hover:bg-[#F1F3FF] hover:text-[#141b2b] transition-colors"
            onClick={() => {
              stopAudio();
              onClose();
            }}
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Form */}
        <form className="flex flex-col gap-4 mt-2" onSubmit={handleSubmit}>
          {/* Nama Kegiatan */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[#141b2b]">
              Nama Kegiatan
            </label>
            <input
              className="h-9 px-3 rounded-lg bg-white text-[#141b2b] text-[14px] border border-[#E5E7EB] shadow-xs outline-none focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent transition-all"
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Bel Masuk, Istirahat..."
              required
              type="text"
              value={name}
            />
          </div>

          {/* Jam & Hari / Kategori */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-[#141b2b]">
                Jam (24 Jam)
              </label>
              <div className="relative flex items-center">
                <input
                  className="h-9 w-full pl-3 pr-9 rounded-lg bg-white text-[#141b2b] text-[14px] border border-[#E5E7EB] shadow-xs outline-none focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent font-medium"
                  onChange={(e) => setTime(e.target.value)}
                  placeholder="07:00"
                  required
                  type="time"
                  value={time}
                />
                <span className="material-symbols-outlined text-[18px] text-[#464555] absolute right-2.5 pointer-events-none">
                  schedule
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-medium text-[#141b2b]">
                Hari / Kategori
              </label>
              <div className="relative flex items-center">
                <select
                  className="h-9 w-full px-3 pr-8 rounded-lg bg-white text-[#141b2b] text-[14px] border border-[#E5E7EB] shadow-xs outline-none focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent appearance-none cursor-pointer"
                  onChange={(e) => setDayCategory(e.target.value)}
                  value={dayCategory}
                >
                  <optgroup label="Hari Reguler">
                    <option value="Senin">Senin</option>
                    <option value="Selasa">Selasa</option>
                    <option value="Rabu">Rabu</option>
                    <option value="Kamis">Kamis</option>
                    <option value="Jumat">Jumat</option>
                    <option value="Sabtu">Sabtu</option>
                  </optgroup>
                  <optgroup label="Kategori Khusus">
                    {categories
                      .filter((c) => c.isCustom)
                      .map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                  </optgroup>
                </select>
                <span className="material-symbols-outlined text-[18px] text-[#464555] absolute right-2.5 pointer-events-none">
                  expand_more
                </span>
              </div>
            </div>
          </div>

          {/* Suara Bel & Tes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[#141b2b]">
              Suara Bel
            </label>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <select
                  className="h-9 w-full px-3 pr-8 rounded-lg bg-white text-[#141b2b] text-[14px] border border-[#E5E7EB] shadow-xs outline-none focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent appearance-none cursor-pointer"
                  onChange={(e) => setSelectedSound(e.target.value)}
                  value={selectedSound}
                >
                  {audioFiles.map((sound) => (
                    <option key={sound.id} value={sound.fileName}>
                      {sound.title} ({sound.fileName})
                    </option>
                  ))}
                </select>
                <span className="material-symbols-outlined text-[18px] text-[#464555] absolute right-2.5 pointer-events-none">
                  expand_more
                </span>
              </div>
              <button
                className={`h-9 px-3 rounded-lg font-medium text-[13px] transition-colors flex items-center gap-1.5 whitespace-nowrap shadow-xs cursor-pointer ${
                  isPlaying
                    ? 'bg-[#7FFC97] text-[#002109]'
                    : 'bg-[#E9EDFF] text-[#3525CD] hover:bg-[#E1E8FD]'
                }`}
                onClick={handleTestSound}
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">
                  {isPlaying ? 'pause' : 'play_arrow'}
                </span>
                <span>{isPlaying ? 'Stop' : 'Tes'}</span>
              </button>
            </div>
            <p className="text-[12px] text-[#464555]">
              Durasi file: {currentAudio?.duration || '00:08'} • Format Stereo 44.1kHz
            </p>
          </div>

          {/* Status Jadwal Switch */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-[#F1F3FF] mt-1 border border-[#E5E7EB]">
            <div className="flex flex-col">
              <span className="text-[13px] font-semibold text-[#141b2b]">
                Status Jadwal
              </span>
              <span className="text-[12px] text-[#464555]">
                Aktifkan bel ini secara otomatis sesuai jadwal
              </span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                checked={active}
                className="sr-only peer"
                onChange={(e) => setActive(e.target.checked)}
                type="checkbox"
              />
              <div className="w-11 h-6 bg-[#DCE2F7] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#4F46E5]"></div>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 mt-2 border-t border-[#E5E7EB]">
            <div className="flex items-center gap-1.5 text-[#464555]">
              <span className="material-symbols-outlined text-[16px]">info</span>
              <span className="text-[12px]">Tersimpan lokal di PC</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                className="h-9 px-4 rounded-lg bg-[#F1F3FF] text-[#141b2b] hover:bg-[#E9EDFF] font-medium text-[13px] transition-colors shadow-xs"
                onClick={() => {
                  stopAudio();
                  onClose();
                }}
                type="button"
              >
                Batal
              </button>
              <button
                className="h-9 px-4 rounded-lg bg-[#4F46E5] text-white hover:bg-[#4338CA] font-medium text-[13px] transition-opacity shadow-xs flex items-center gap-1.5"
                type="submit"
              >
                <span className="material-symbols-outlined text-[16px]">check</span>
                Simpan Jadwal
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
