import React, { useState, useRef } from 'react';
import { parseExcelOrCsvFile, downloadSampleExcel, ExcelImportResult } from '../../utils/excelImport';
import { CategoryItem } from '../../types';
import type { ImportSourceRow } from '../../utils/storage';
import type { ConfirmationDialogRequest } from './ConfirmationDialog';

interface UploadExcelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (payload: {
    fileName: string;
    rows: ImportSourceRow[];
    skippedRowCount: number;
  }) => void;
  onRequestConfirmation: (request: ConfirmationDialogRequest) => void;
  categories: CategoryItem[];
}

export const UploadExcelModal: React.FC<UploadExcelModalProps> = ({
  isOpen,
  onClose,
  onImport,
  onRequestConfirmation,
  categories,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ExcelImportResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [targetDay, setTargetDay] = useState('Senin');
  const [targetCategory, setTargetCategory] = useState('Reguler');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileSelected = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsProcessing(true);
    try {
      const result = await parseExcelOrCsvFile(selectedFile, targetDay, targetCategory);
      setParseResult(result);
    } catch (err) {
      console.error('Failed to parse file', err);
      alert('Gagal membaca file Excel/CSV. Pastikan format file sesuai.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleApplyImport = () => {
    if (!parseResult || parseResult.validRows.length === 0) return;

    // Raw validated rows are handed to the shared sync path, which owns id
    // generation, soundId resolution and upsert matching.
    const rows: ImportSourceRow[] = parseResult.validRows.map((r) => ({
      time: r.time,
      name: r.name,
      description: r.description,
      soundName: r.soundName,
      day: r.day || targetDay,
      category: r.category || targetCategory,
    }));

    const fileName = file?.name || 'file yang dipilih';
    const invalidCount = parseResult.invalidRows.length;

    onRequestConfirmation({
      title: 'Impor jadwal?',
      description: `${rows.length} baris valid dari "${fileName}" akan diimpor.`,
      impact: invalidCount > 0
        ? `${invalidCount} baris tidak valid akan dilewati.`
        : 'Semua baris valid.',
      confirmLabel: `Impor ${rows.length} Jadwal`,
      tone: 'primary',
      onConfirm: () => {
        onImport({ fileName, rows, skippedRowCount: invalidCount });
        onClose();
      },
    });
  };

  return (
    <div className="fixed inset-0 bg-[#293040]/40 backdrop-blur-[1.5px] z-50 flex items-center justify-center p-6 overflow-y-auto select-none">
      <div className="w-full max-w-[720px] bg-white rounded-xl shadow-2xl border border-[#E5E7EB] p-6 flex flex-col relative z-20 animate-fade-in max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#E9EDFF] flex items-center justify-center text-[#3525CD]">
              <span className="material-symbols-outlined text-[24px]">upload_file</span>
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-[#141b2b] leading-tight">
                Impor Jadwal dari Excel / CSV
              </h2>
              <p className="text-[12px] text-[#464555] mt-0.5">
                Unggah file spreadsheet untuk menambahkan atau memperbarui jadwal bel otomatis.
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

        {/* Upload Drop Zone & Target selectors */}
        <div className="mt-4 flex flex-col gap-4 overflow-y-auto pr-1">
          {/* Default Assignment Options */}
          <div className="grid grid-cols-2 gap-3 bg-[#F1F3FF] p-3 rounded-xl border border-[#E5E7EB]">
            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium text-[#141b2b]">
                Hari Default (Jika Kosong di File)
              </label>
              <select
                className="h-8 px-2.5 rounded-lg bg-white border border-[#E5E7EB] text-[13px] text-[#141b2b] outline-none"
                onChange={(e) => setTargetDay(e.target.value)}
                value={targetDay}
              >
                <option value="Senin">Senin</option>
                <option value="Selasa">Selasa</option>
                <option value="Rabu">Rabu</option>
                <option value="Kamis">Kamis</option>
                <option value="Jumat">Jumat</option>
                <option value="Sabtu">Sabtu</option>
                <option value="Semua">Semua Hari</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium text-[#141b2b]">
                Kategori Default
              </label>
              <select
                className="h-8 px-2.5 rounded-lg bg-white border border-[#E5E7EB] text-[13px] text-[#141b2b] outline-none"
                onChange={(e) => setTargetCategory(e.target.value)}
                value={targetCategory}
              >
                <option value="Reguler">Reguler</option>
                {categories
                  .filter((c) => c.isCustom)
                  .map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {/* Drag & Drop Zone */}
          <div
            className="border-2 border-dashed border-[#C7C4D8] hover:border-[#4F46E5] bg-[#F9F9FF] rounded-xl p-5 flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleFileSelected(e.target.files[0]);
                }
              }}
              ref={fileInputRef}
              type="file"
            />
            <div className="w-12 h-12 rounded-xl bg-[#E9EDFF] text-[#3525CD] flex items-center justify-center mb-2">
              <span className="material-symbols-outlined text-[26px]">drive_folder_upload</span>
            </div>
            <p className="text-[14px] font-medium text-[#141b2b]">
              {file ? file.name : 'Pilih file Excel (.xlsx, .xls) atau CSV'}
            </p>
            <p className="text-[12px] text-[#464555] mt-1">
              Tarik dan lepaskan file ke sini atau klik untuk menelusuri komputer
            </p>

            <button
              className="mt-3 text-[12px] text-[#3525CD] hover:underline font-medium flex items-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                downloadSampleExcel();
              }}
              type="button"
            >
              <span className="material-symbols-outlined text-[15px]">download</span>
              Unduh Template Contoh Excel
            </button>
          </div>

          {/* Validation & Preview Table */}
          {isProcessing && (
            <div className="p-6 text-center text-[#464555] text-sm">
              <span className="material-symbols-outlined text-[24px] animate-spin text-[#3525CD]">
                progress_activity
              </span>
              <p className="mt-2">Memeriksa dan memvalidasi baris data...</p>
            </div>
          )}

          {parseResult && (
            <div className="flex flex-col gap-2">
              {/* Summary Status Strip */}
              <div className="flex items-center justify-between text-xs px-1">
                <span className="text-[#464555]">
                  Total Terdeteksi: <strong>{parseResult.totalRows} baris</strong>
                </span>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-[#DCFCE7] text-[#16A34A] font-semibold">
                    ✓ {parseResult.validRows.length} Valid
                  </span>
                  {parseResult.invalidRows.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-[#FFDAD6] text-[#BA1A1A] font-semibold">
                      ✕ {parseResult.invalidRows.length} Butuh Koreksi
                    </span>
                  )}
                </div>
              </div>

              {/* Table Preview */}
              <div className="max-h-56 overflow-y-auto border border-[#E5E7EB] rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#F1F3FF] text-[#464555] font-semibold sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Jam</th>
                      <th className="py-2 px-3">Kegiatan</th>
                      <th className="py-2 px-3">Suara</th>
                      <th className="py-2 px-3">Hari/Kategori</th>
                      <th className="py-2 px-3">Validasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {parseResult.validRows.map((r, i) => (
                      <tr className="hover:bg-slate-50" key={`valid-${i}`}>
                        <td className="py-2 px-3 font-semibold text-[#141b2b]">{r.time}</td>
                        <td className="py-2 px-3 font-medium text-[#141b2b]">{r.name}</td>
                        <td className="py-2 px-3 font-mono text-[#464555]">{r.soundName}</td>
                        <td className="py-2 px-3 text-[#464555]">{r.day} ({r.category})</td>
                        <td className="py-2 px-3">
                          <span className="text-[11px] text-[#16A34A] font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></span> Siap Impor
                          </span>
                        </td>
                      </tr>
                    ))}
                    {parseResult.invalidRows.map((r, i) => (
                      <tr className="bg-rose-50/50 hover:bg-rose-50" key={`invalid-${i}`}>
                        <td className="py-2 px-3 text-[#BA1A1A] font-mono">{r.time || 'N/A'}</td>
                        <td className="py-2 px-3 text-[#141b2b]">{r.name || '(Kosong)'}</td>
                        <td className="py-2 px-3 text-[#464555]">{r.soundName}</td>
                        <td className="py-2 px-3 text-[#464555]">{r.day}</td>
                        <td className="py-2 px-3 text-[#BA1A1A] text-[11px]" title={r.errors.join(' ')}>
                          {r.errors[0]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 mt-3 border-t border-[#E5E7EB]">
          <span className="text-[12px] text-[#464555]">
            Mendukung Excel (.xlsx, .xls) dan CSV
          </span>
          <div className="flex items-center gap-2">
            <button
              className="h-9 px-4 rounded-lg bg-[#F1F3FF] text-[#141b2b] hover:bg-[#E9EDFF] font-medium text-[13px] transition-colors"
              onClick={onClose}
              type="button"
            >
              Batal
            </button>
            <button
              className="h-9 px-5 rounded-lg bg-[#4F46E5] text-white hover:bg-[#4338CA] font-medium text-[13px] shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              disabled={!parseResult || parseResult.validRows.length === 0}
              onClick={handleApplyImport}
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">file_download_done</span>
              Impor {parseResult?.validRows.length || 0} Jadwal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
