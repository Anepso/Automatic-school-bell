import * as XLSX from 'xlsx';
import { ScheduleItem } from '../types';

export interface ParsedRowResult {
  rowNumber: number;
  time: string;
  name: string;
  description: string;
  soundName: string;
  day: string;
  category: string;
  active: boolean;
  isValid: boolean;
  errors: string[];
}

export interface ExcelImportResult {
  fileName: string;
  totalRows: number;
  validRows: ParsedRowResult[];
  invalidRows: ParsedRowResult[];
}

export function validateTimeFormat(timeStr: string): { valid: boolean; normalized: string } {
  if (!timeStr) return { valid: false, normalized: '' };

  // Clean string
  let clean = timeStr.trim().replace('.', ':');

  // Check if it's Excel serial time or decimal
  const num = parseFloat(clean);
  if (!isNaN(num) && num >= 0 && num < 1 && !clean.includes(':')) {
    const totalMinutes = Math.round(num * 24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return {
      valid: true,
      normalized: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    };
  }

  // Regex for HH:MM or H:MM
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return {
        valid: true,
        normalized: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      };
    }
  }

  return { valid: false, normalized: clean };
}

export async function parseExcelOrCsvFile(
  file: File,
  defaultDay: string = 'Senin',
  defaultCategory: string = 'Reguler'
): Promise<ExcelImportResult> {
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array' });

  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];

  // Convert to JSON array of objects
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const validRows: ParsedRowResult[] = [];
  const invalidRows: ParsedRowResult[] = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for 0-index, +1 for header row
    const errors: string[] = [];

    // Find keys flexibly
    const timeKey = Object.keys(row).find((k) =>
      /jam|waktu|time|pukul/i.test(k)
    ) || Object.keys(row)[0];

    const nameKey = Object.keys(row).find((k) =>
      /nama|kegiatan|aktivitas|activity|name|acara/i.test(k)
    ) || Object.keys(row)[1];

    const descKey = Object.keys(row).find((k) =>
      /deskripsi|keterangan|catatan|desc/i.test(k)
    );

    const soundKey = Object.keys(row).find((k) =>
      /suara|audio|sound|bell/i.test(k)
    );

    const dayKey = Object.keys(row).find((k) =>
      /hari|day/i.test(k)
    );

    const categoryKey = Object.keys(row).find((k) =>
      /kategori|category/i.test(k)
    );

    const rawTime = String(row[timeKey] || '').trim();
    const timeValidation = validateTimeFormat(rawTime);
    if (!timeValidation.valid) {
      errors.push(`Format waktu tidak valid: "${rawTime}". Harus format HH:MM (00:00 - 23:59).`);
    }

    const rawName = String(row[nameKey] || '').trim();
    if (!rawName) {
      errors.push('Nama kegiatan tidak boleh kosong.');
    }

    const rawDesc = descKey ? String(row[descKey] || '').trim() : '';
    const rawSound = soundKey && String(row[soundKey] || '').trim() ? String(row[soundKey]).trim() : 'normal.mp3';
    const rawDay = dayKey && String(row[dayKey] || '').trim() ? String(row[dayKey]).trim() : defaultDay;
    const rawCategory = categoryKey && String(row[categoryKey] || '').trim() ? String(row[categoryKey]).trim() : defaultCategory;

    const parsedItem: ParsedRowResult = {
      rowNumber,
      time: timeValidation.normalized,
      name: rawName,
      description: rawDesc || `Bel otomatis ${rawName}`,
      soundName: rawSound.endsWith('.mp3') || rawSound.endsWith('.wav') ? rawSound : `${rawSound}.mp3`,
      day: rawDay,
      category: rawCategory,
      active: true,
      isValid: errors.length === 0,
      errors,
    };

    if (errors.length === 0) {
      validRows.push(parsedItem);
    } else {
      invalidRows.push(parsedItem);
    }
  });

  return {
    fileName: file.name,
    totalRows: rawRows.length,
    validRows,
    invalidRows,
  };
}

export function downloadSampleExcel() {
  const sampleData = [
    { Jam: '07:00', 'Nama Kegiatan': 'Bel Masuk & Upacara', Keterangan: 'Apel pagi lapangan utama', 'Suara Bel': 'masuk.mp3', Hari: 'Senin', Kategori: 'Reguler' },
    { Jam: '07:45', 'Nama Kegiatan': 'Pelajaran 1', Keterangan: 'Mulai KBM jam ke-1 & 2', 'Suara Bel': 'normal.mp3', Hari: 'Senin', Kategori: 'Reguler' },
    { Jam: '09:30', 'Nama Kegiatan': 'Istirahat Pertama', Keterangan: 'Waktu istirahat 30 menit', 'Suara Bel': 'istirahat.mp3', Hari: 'Senin', Kategori: 'Reguler' },
    { Jam: '10:00', 'Nama Kegiatan': 'Pelajaran 2', Keterangan: 'Lanjutan KBM jam ke-3 s.d 5', 'Suara Bel': 'normal.mp3', Hari: 'Senin', Kategori: 'Reguler' },
    { Jam: '13:00', 'Nama Kegiatan': 'Bel Pulang Sekolah', Keterangan: 'Akhir KBM hari Senin', 'Suara Bel': 'pulang.mp3', Hari: 'Senin', Kategori: 'Reguler' },
  ];

  const ws = XLSX.utils.json_to_sheet(sampleData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template Jadwal');
  XLSX.writeFile(wb, 'Template_Jadwal_Bel_SMA_Kusuma_Bangsa.xlsx');
}
