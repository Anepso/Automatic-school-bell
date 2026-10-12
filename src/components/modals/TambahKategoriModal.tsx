import React, { useState, useEffect } from 'react';
import { CategoryItem } from '../../types';

interface TambahKategoriModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (category: Partial<CategoryItem>) => void;
  editingCategory: CategoryItem | null;
}

export const TambahKategoriModal: React.FC<TambahKategoriModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingCategory,
}) => {
  const [name, setName] = useState('Jadwal Ujian');
  const [description, setDescription] = useState('Jadwal khusus periode penilaian akhir semester');

  useEffect(() => {
    if (editingCategory) {
      setName(editingCategory.name);
      setDescription(editingCategory.description);
    } else {
      setName('');
      setDescription('');
    }
  }, [editingCategory, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSave({
      id: editingCategory ? editingCategory.id : `cat-custom-${Date.now()}`,
      name: name.trim(),
      description: description.trim() || `Kategori jadwal ${name.trim()}`,
      isCustom: true,
      badgeType: 'Khusus',
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-[#293040]/40 backdrop-blur-[1.5px] z-50 flex items-center justify-center p-6 overflow-y-auto select-none">
      <div className="w-full max-w-[500px] bg-white rounded-xl shadow-xl border border-[#E5E7EB] p-6 flex flex-col relative z-20 animate-fade-in">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#E9EDFF] flex items-center justify-center text-[#3525CD]">
              <span className="material-symbols-outlined text-[24px]">create_new_folder</span>
            </div>
            <div>
              <h2 className="text-[18px] leading-tight text-[#141b2b] font-semibold">
                {editingCategory ? 'Ubah Kategori' : 'Tambah Kategori'}
              </h2>
              <p className="text-[12px] text-[#464555] mt-0.5">
                Buat kategori jadwal baru untuk mengelompokkan jadwal bel.
              </p>
            </div>
          </div>
          <button
            aria-label="Tutup"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-[#464555] hover:bg-[#F1F3FF] hover:text-[#141b2b] transition-colors"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Form */}
        <form className="flex flex-col gap-4 mt-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[#141b2b]">
              Nama Kategori
            </label>
            <input
              className="h-10 px-3 rounded-lg bg-white text-[#141b2b] text-[14px] border border-[#E5E7EB] shadow-xs outline-none focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent transition-all"
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: Jadwal Ujian, Class Meeting, Ramadhan..."
              required
              type="text"
              value={name}
            />
            <span className="text-[11px] text-[#464555]">
              Nama unik untuk mengelompokkan waktu bel
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-[#141b2b]">
              Deskripsi <span className="text-[12px] text-[#464555] font-normal">(Opsional)</span>
            </label>
            <textarea
              className="p-3 rounded-lg bg-white text-[#141b2b] text-[14px] border border-[#E5E7EB] shadow-xs outline-none focus:ring-2 focus:ring-[#4F46E5] focus:border-transparent resize-none"
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contoh: Jadwal khusus periode penilaian akhir semester"
              rows={3}
              value={description}
            />
          </div>

          {/* Info callout */}
          <div className="p-3 rounded-lg bg-[#E9EDFF] flex items-start gap-2.5 border border-[#E5E7EB]">
            <span className="material-symbols-outlined text-[#3525CD] text-[18px] mt-0.5">
              info
            </span>
            <span className="text-[12px] text-[#464555] leading-relaxed">
              Dapat diaktifkan menggantikan jadwal reguler kapan saja melalui tab kategori.
            </span>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-4 mt-1 border-t border-[#E5E7EB]">
            <button
              className="h-9 px-4 rounded-lg bg-[#F1F3FF] text-[#141b2b] hover:bg-[#E9EDFF] text-[13px] font-medium transition-colors shadow-xs"
              onClick={onClose}
              type="button"
            >
              Batal
            </button>
            <button
              className="h-9 px-5 rounded-lg bg-[#4F46E5] text-white hover:bg-[#4338CA] text-[13px] font-medium transition-opacity shadow-xs flex items-center gap-1.5"
              type="submit"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
              Simpan Kategori
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
