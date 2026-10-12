export const DEFAULT_SCHOOL_NAME = 'SMA Kusuma Bangsa';

/**
 * Bundled default school identity mark (PD-1).
 *
 * These are the exact bytes of `electron/assets/school-bell-tray.png` (256x256 PNG),
 * inlined as a data URL on purpose:
 *
 *  - it removes the runtime dependency on a third-party CDN for the default logo,
 *  - `validateLogo` only accepts an empty string, an http(s) URL or a base64 data URL,
 *    so a filesystem path such as `/school-logo.png` would be rejected by the B5.1
 *    contract. Inlining keeps that contract untouched (PD-4).
 *  - it behaves identically in the Vite dev server and in the packaged build, with no
 *    new public directory, no new dependency and no network request.
 *
 * To change the mark, replace the bytes below with a new PNG of the same origin.
 */
export const DEFAULT_SCHOOL_LOGO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAAAIGNIUk0AAHomAACAhAAA+gAAAIDo' +
  'AAB1MAAA6mAAADqYAAAXcJy6UTwAAAJ/UExURf////39/+bl+8zJ97Cs85aR74B67HZv625n6mZf' +
  '6FtS51NK5k9G5efm+/X1/srH952Y8XFq6nJq6p6Z8cvI99/e+qOe8XVu61FI5VJJ5aOf8eDe+vPy' +
  '/bm19Xhx62xk6a2p8+7u/dDO+IJ87dHO+P7+/8TB9sPA9m9o6uTj+3537Hly6+Hf+/j4/qei8puW' +
  '8Pb2/mJa6GNb6MvJ9/z8/1BH5fv7/urp/HNs6ujm/MjF91pS58nG97Wx9KGc8ZGM74qE7pWP75WQ' +
  '76ah8ray9LKu9FtT5+no/Pz7/pON78jG9/f3/pKM73Rt65yX8FVN5qSf8vX0/aCb8WFZ6NrZ+t7c' +
  '+mRc6Ozr/Pf2/tzb+tvZ+lVM5qKd8eHg+1JK5qWh8uPh+3t07Hpz65OO78bE98fE93Bp6ndw69LQ' +
  '+IN97e/u/XJr6n957JmU8K6q89TR+e7t/PPz/e3s/JiT8J+a8c7L+PLx/X137FRL5mBY6M3K+Pn4' +
  '/tHP+Ojn/GVd6LGt883L+Gtj6b679b269Wpi6V1V57Ov9L+89peS8IF77G1m6aej8m9n6s/M+GZe' +
  '6Gdf6Xhy6/Hw/X127JCK75SP74iB7YyH7oV/7Xx17Pr6/tbU+dnX+bSx9I2H7l9X58K/9sG+9oN8' +
  '7VdO5qmk8lxU56un86qm8llR55eR8Nza+mlh6Wli6YyG7q+r815W54aA7ZqV8NTS+XRs6n947M/N' +
  '+KCc8eXk+4uF7t/d+oF67NbT+Y+J7o6J7ri09Le09FdP5llQ5trY+bSw9KWg8r259dXT+evq/ImD' +
  '7vTz/VZN5vDv/fn5/oR+7dPR+FhP5oZ/7Xp06+Lh+8bD96yo86ik8iZA8h4AAAABYktHRACIBR1I' +
  'AAAACXBIWXMAAABgAAAAYADwa0LPAAAAB3RJTUUH6gkdChYHWwPa1QAAACV0RVh0ZGF0ZTpjcmVh' +
  'dGUAMjAyNi0wOS0yOVQxMDoyMToxNSswMDowMB1aIwYAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYt' +
  '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' +
  '3v//rWhYEdvKoQAAAABJRU5ErkJggg==';

export const DEFAULT_CATEGORIES: CategoryItem[] = [
  { id: 'cat-senin', name: 'Senin', description: 'Jadwal hari Senin format reguler dan upacara bendera', isCustom: false, badgeType: 'Reguler' },
  { id: 'cat-selasa', name: 'Selasa', description: 'Jadwal reguler hari Selasa', isCustom: false, badgeType: 'Reguler' },
  { id: 'cat-rabu', name: 'Rabu', description: 'Jadwal reguler hari Rabu', isCustom: false, badgeType: 'Reguler' },
  { id: 'cat-kamis', name: 'Kamis', description: 'Jadwal reguler hari Kamis', isCustom: false, badgeType: 'Reguler' },
  { id: 'cat-jumat', name: 'Jumat', description: 'Jadwal Jumat berkah durasi pendek sholat Jumat', isCustom: false, badgeType: 'Reguler' },
  { id: 'cat-sabtu', name: 'Sabtu', description: 'Jadwal kegiatan ekstrakurikuler Sabtu', isCustom: false, badgeType: 'Reguler' },
  { id: 'cat-ujian', name: 'Jadwal Ujian', description: 'Jadwal khusus periode penilaian akhir semester (PAS/PTS)', isCustom: true, badgeType: 'Khusus' },
  { id: 'cat-classmeeting', name: 'Class Meeting', description: 'Jadwal bel kompetisi seni dan olahraga antar kelas', isCustom: true, badgeType: 'Khusus' },
  { id: 'cat-ramadhan', name: 'Ramadhan', description: 'Jadwal jam belajar khusus bulan suci Ramadhan', isCustom: true, badgeType: 'Khusus' },
];

export const DEFAULT_SCHEDULES: ScheduleItem[] = [
  // SENIN
  { id: 'sch-1', time: '07:00', name: 'Bel Masuk', description: 'Upacara bendera / apel pagi', soundId: 'snd-1', soundName: 'masuk.mp3', duration: '0:14', day: 'Senin', category: 'Reguler', active: true },
  { id: 'sch-2', time: '07:45', name: 'Pelajaran 1', description: 'Mulai KBM jam ke-1 & 2', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Senin', category: 'Reguler', active: true },
  { id: 'sch-3', time: '09:30', name: 'Istirahat', description: 'Waktu istirahat sesi 1 (30 menit)', soundId: 'snd-4', soundName: 'istirahat.mp3', duration: '0:12', day: 'Senin', category: 'Reguler', active: true },
  { id: 'sch-4', time: '10:00', name: 'Pelajaran 2', description: 'Lanjutan KBM jam ke-3 s.d 5', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Senin', category: 'Reguler', active: true },
  { id: 'sch-5', time: '13:00', name: 'Bel Pulang', description: 'Akhir kegiatan belajar mengajar hari Senin', soundId: 'snd-7', soundName: 'pulang.mp3', duration: '0:18', day: 'Senin', category: 'Reguler', active: true },

  // SELASA
  { id: 'sch-6', time: '07:00', name: 'Bel Masuk & Literasi', description: 'Pembiasaan pagi dan menyanyikan Indonesia Raya', soundId: 'snd-1', soundName: 'masuk.mp3', duration: '0:14', day: 'Selasa', category: 'Reguler', active: true },
  { id: 'sch-7', time: '07:30', name: 'Pelajaran 1', description: 'KBM sesi pagi', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Selasa', category: 'Reguler', active: true },
  { id: 'sch-8', time: '09:45', name: 'Istirahat 1', description: 'Istirahat pertama 30 menit', soundId: 'snd-4', soundName: 'istirahat.mp3', duration: '0:12', day: 'Selasa', category: 'Reguler', active: true },
  { id: 'sch-9', time: '10:15', name: 'Pelajaran 2', description: 'KBM sesi siang', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Selasa', category: 'Reguler', active: true },
  { id: 'sch-10', time: '12:15', name: 'Istirahat Sholat Dzuhur', description: 'Sholat berjamaah & makan siang', soundId: 'snd-4', soundName: 'istirahat.mp3', duration: '0:12', day: 'Selasa', category: 'Reguler', active: true },
  { id: 'sch-11', time: '15:15', name: 'Bel Pulang Sekolah', description: 'Akhir KBM hari Selasa', soundId: 'snd-7', soundName: 'pulang.mp3', duration: '0:18', day: 'Selasa', category: 'Reguler', active: true },

  // RABU
  { id: 'sch-12', time: '07:00', name: 'Bel Masuk & Doa Bersama', description: 'Persiapan awal KBM', soundId: 'snd-1', soundName: 'masuk.mp3', duration: '0:14', day: 'Rabu', category: 'Reguler', active: true },
  { id: 'sch-13', time: '07:30', name: 'Pelajaran 1', description: 'KBM jam 1 s.d 4', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Rabu', category: 'Reguler', active: true },
  { id: 'sch-14', time: '09:45', name: 'Istirahat 1', description: 'Waktu istirahat pagi', soundId: 'snd-4', soundName: 'istirahat.mp3', duration: '0:12', day: 'Rabu', category: 'Reguler', active: true },
  { id: 'sch-15', time: '12:15', name: 'Istirahat Dzuhur', description: 'Sholat Dzuhur berjamaah', soundId: 'snd-4', soundName: 'istirahat.mp3', duration: '0:12', day: 'Rabu', category: 'Reguler', active: true },
  { id: 'sch-16', time: '15:15', name: 'Bel Pulang', description: 'Akhir KBM hari Rabu', soundId: 'snd-7', soundName: 'pulang.mp3', duration: '0:18', day: 'Rabu', category: 'Reguler', active: true },

  // KAMIS
  { id: 'sch-17', time: '07:00', name: 'Bel Masuk & Senam Pagi', description: 'Kebugaran jasmani / apel pagi', soundId: 'snd-1', soundName: 'masuk.mp3', duration: '0:14', day: 'Kamis', category: 'Reguler', active: true },
  { id: 'sch-18', time: '07:45', name: 'Pelajaran 1', description: 'KBM sesi 1', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Kamis', category: 'Reguler', active: true },
  { id: 'sch-19', time: '09:45', name: 'Istirahat', description: 'Istirahat 30 menit', soundId: 'snd-4', soundName: 'istirahat.mp3', duration: '0:12', day: 'Kamis', category: 'Reguler', active: true },
  { id: 'sch-20', time: '15:15', name: 'Bel Pulang', description: 'Akhir KBM hari Kamis', soundId: 'snd-7', soundName: 'pulang.mp3', duration: '0:18', day: 'Kamis', category: 'Reguler', active: true },

  // JUMAT
  { id: 'sch-21', time: '07:00', name: 'Bel Masuk & Yasinan/Rohani', description: 'Pembiasaan keagamaan hari Jumat', soundId: 'snd-1', soundName: 'masuk.mp3', duration: '0:14', day: 'Jumat', category: 'Reguler', active: true },
  { id: 'sch-22', time: '07:30', name: 'Pelajaran 1', description: 'KBM sesi pendek Jumat', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Jumat', category: 'Reguler', active: true },
  { id: 'sch-23', time: '09:15', name: 'Istirahat', description: 'Istirahat singkat 20 menit', soundId: 'snd-4', soundName: 'istirahat.mp3', duration: '0:12', day: 'Jumat', category: 'Reguler', active: true },
  { id: 'sch-24', time: '11:30', name: 'Bel Pulang & Persiapan Jumatan', description: 'Akhir KBM hari Jumat', soundId: 'snd-7', soundName: 'pulang.mp3', duration: '0:18', day: 'Jumat', category: 'Reguler', active: true },

  // SABTU
  { id: 'sch-25', time: '07:30', name: 'Bel Masuk Ekskul', description: 'Kegiatan pramuka & ekstrakurikuler', soundId: 'snd-1', soundName: 'masuk.mp3', duration: '0:14', day: 'Sabtu', category: 'Reguler', active: true },
  { id: 'sch-26', time: '11:00', name: 'Selesai Ekskul', description: 'Penutupan kegiatan Sabtu', soundId: 'snd-7', soundName: 'pulang.mp3', duration: '0:18', day: 'Sabtu', category: 'Reguler', active: true },

  // JADWAL UJIAN
  { id: 'sch-27', time: '07:15', name: 'Bel Masuk Ruang Ujian', description: 'Pemeriksaan identitas & doa bersama', soundId: 'snd-1', soundName: 'masuk.mp3', duration: '0:14', day: 'Semua', category: 'Jadwal Ujian', active: true },
  { id: 'sch-28', time: '07:30', name: 'Mulai Ujian Sesi 1', description: 'Mengerjakan soal mata pelajaran ke-1', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Semua', category: 'Jadwal Ujian', active: true },
  { id: 'sch-29', time: '09:00', name: 'Selesai Ujian Sesi 1', description: 'Waktu ujian ke-1 habis', soundId: 'snd-6', soundName: 'ujian_selesai.mp3', duration: '0:15', day: 'Semua', category: 'Jadwal Ujian', active: true },
  { id: 'sch-30', time: '09:30', name: 'Mulai Ujian Sesi 2', description: 'Mengerjakan soal mata pelajaran ke-2', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Semua', category: 'Jadwal Ujian', active: true },
  { id: 'sch-31', time: '11:00', name: 'Selesai Ujian & Pulang', description: 'Pengumpulan lembar ujian & pulang', soundId: 'snd-7', soundName: 'pulang.mp3', duration: '0:18', day: 'Semua', category: 'Jadwal Ujian', active: true },

  // CLASS MEETING
  { id: 'sch-32', time: '07:30', name: 'Apel Pagi Pembukaan', description: 'masuk.mp3 • Durasi 0:14', soundId: 'snd-1', soundName: 'masuk.mp3', duration: '0:14', day: 'Kamis', category: 'Class Meeting', active: true },
  { id: 'sch-33', time: '08:00', name: 'Sesi Lomba 1 (Futsal & Basket)', description: 'normal.mp3 • Durasi 0:08', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Kamis', category: 'Class Meeting', active: true },
  { id: 'sch-34', time: '09:45', name: 'Sesi Lomba 2 & E-Sport', description: 'normal.mp3 • Durasi 0:08', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Kamis', category: 'Class Meeting', active: true },
  { id: 'sch-35', time: '10:45', name: 'Istirahat Bersama (30 Menit)', description: 'istirahat.mp3 • Durasi 0:12', soundId: 'snd-4', soundName: 'istirahat.mp3', duration: '0:12', day: 'Kamis', category: 'Class Meeting', active: true },
  { id: 'sch-36', time: '11:15', name: 'Sesi Final & Penutupan', description: 'normal.mp3 • Durasi 0:08', soundId: 'snd-5', soundName: 'normal.mp3', duration: '0:08', day: 'Kamis', category: 'Class Meeting', active: true },
  { id: 'sch-37', time: '12:30', name: 'Bel Selesai / Pulang', description: 'pulang.mp3 • Durasi 0:18', soundId: 'snd-7', soundName: 'pulang.mp3', duration: '0:18', day: 'Kamis', category: 'Class Meeting', active: true },
];

export const DEFAULT_AUDIO_FILES: AudioFileItem[] = [
  {
    id: 'snd-1',
    title: 'Nada Bel Masuk Standar',
    fileName: 'bel_masuk_apel.mp3',
    description: '3 nada lonceng pembuka apel pagi',
    category: 'Bel Rutin',
    duration: '00:32',
    size: '1.4 MB',
    usedIn: 'Senin - Jumat 06:45',
    usedInSub: 'Jadwal Reguler & Apel',
    toneType: 'westminster'
  },
  {
    id: 'snd-2',
    title: 'Indonesia Raya (3 Stanza)',
    fileName: 'indonesia_raya_3stanza.mp3',
    description: 'Upacara bendera hari Senin dan peringatan hari nasional',
    category: 'Lagu Wajib',
    duration: '03:45',
    size: '8.6 MB',
    usedIn: 'Senin 07:00',
    usedInSub: 'Upacara Hari Senin',
    toneType: 'chime'
  },
  {
    id: 'snd-3',
    title: 'Mars SMA Kusuma Bangsa',
    fileName: 'mars_kusuma.mp3',
    description: 'Lagu almamater resmi & aransemen orkestra paduan suara',
    category: 'Mars Sekolah',
    duration: '02:15',
    size: '5.2 MB',
    usedIn: 'Apel & Pelepasan',
    usedInSub: 'Manual & Khusus',
    toneType: 'chime'
  },
  {
    id: 'snd-4',
    title: 'Bel Istirahat Pertama',
    fileName: 'istirahat_1.mp3',
    description: 'Nada melodi ganda riang penanda istirahat 30 menit',
    category: 'Istirahat',
    duration: '00:18',
    size: '920 KB',
    usedIn: 'Setiap Hari 10:15',
    usedInSub: 'Semua Sesi Reguler',
    toneType: 'triple'
  },
  {
    id: 'snd-5',
    title: 'Bel Pergantian Jam KBM',
    fileName: 'ganti_jam.mp3',
    description: '2 ketukan lonceng Westminster pendek penanda ganti guru',
    category: 'Bel Rutin',
    duration: '00:08',
    size: '410 KB',
    usedIn: '6x Setiap Hari',
    usedInSub: '08:00, 08:45, 09:30...',
    toneType: 'bell'
  },
  {
    id: 'snd-6',
    title: 'Peringatan Waktu Ujian Habis',
    fileName: 'ujian_selesai.mp3',
    description: 'Nada lonceng khusus tanda berakhirnya sesi tes semester',
    category: 'Ujian',
    duration: '00:15',
    size: '750 KB',
    usedIn: 'Jadwal Ujian STS/SAS',
    usedInSub: 'Saat Mode Ujian Aktif',
    toneType: 'bell'
  },
  {
    id: 'snd-7',
    title: 'Bel Pulang & Doa Penutup',
    fileName: 'pulang_doa.mp3',
    description: 'Lonceng panjang penanda tuntas KBM diiringi instrumental khidmat',
    category: 'Pulang',
    duration: '01:10',
    size: '2.8 MB',
    usedIn: 'Senin - Kamis 15:15',
    usedInSub: 'Jumat 11:30',
    toneType: 'westminster'
  },
  {
    id: 'snd-8',
    title: 'Pengumuman Apel Pagi',
    fileName: 'apel_pagi.wav',
    description: 'Pemberitahuan baris-berbaris di lapangan utama',
    category: 'Pengumuman',
    duration: '00:24',
    size: '1.8 MB',
    usedIn: 'Senin 06:45',
    usedInSub: 'Sebelum Upacara',
    toneType: 'chime'
  },
  {
    id: 'snd-9',
    title: 'Nada Pengumuman Chime 3-Tone',
    fileName: 'chime_3tone.mp3',
    description: 'Nada intro speaker sebelum siaran suara mikrofon',
    category: 'Pengumuman',
    duration: '00:05',
    size: '180 KB',
    usedIn: 'Manual Broadcast',
    usedInSub: 'Intro Suara Mic',
    toneType: 'triple'
  },
  {
    id: 'snd-10',
    title: 'Sirine Evakuasi / Bahaya',
    fileName: 'sirine_darurat.wav',
    description: 'Sirine frekuensi tinggi darurat gempa / kebakaran',
    category: 'Pengumuman',
    duration: '00:45',
    size: '3.1 MB',
    usedIn: 'Mode Override Darurat',
    usedInSub: 'Tombol Cepat Sirine',
    toneType: 'siren'
  },
  {
    id: 'snd-11',
    title: 'Peringatan Ujian Kurang 10 Menit',
    fileName: 'ujian_10menit.mp3',
    description: 'Pemberitahuan persiapan pengisian lembar jawaban',
    category: 'Ujian',
    duration: '00:12',
    size: '620 KB',
    usedIn: 'Jadwal Ujian',
    usedInSub: '10 Menit Sebelum Akhir',
    toneType: 'bell'
  },
  {
    id: 'snd-12',
    title: 'Bel Istirahat Sholat Dzuhur',
    fileName: 'bel_dzuhur.mp3',
    description: 'Pemberitahuan waktu sholat Dzuhur dan istirahat makan',
    category: 'Istirahat',
    duration: '00:30',
    size: '1.2 MB',
    usedIn: 'Senin - Kamis 12:15',
    usedInSub: 'Sesi Sholat Berjamaah',
    toneType: 'triple'
  },
  {
    id: 'snd-13',
    title: 'Lagu Mengheningkan Cipta',
    fileName: 'mengheningkan_cipta.mp3',
    description: 'Instrumen khidmat saat sesi upacara bendera',
    category: 'Lagu Wajib',
    duration: '02:40',
    size: '6.4 MB',
    usedIn: 'Senin 07:15',
    usedInSub: 'Upacara Bendera',
    toneType: 'chime'
  },
  {
    id: 'snd-14',
    title: 'Lagu Bagimu Negeri',
    fileName: 'bagimu_negeri.mp3',
    description: 'Lagu nasional penutup apel dan upacara',
    category: 'Lagu Wajib',
    duration: '01:50',
    size: '4.2 MB',
    usedIn: 'Upacara Khusus',
    usedInSub: 'Hari Peringatan Nasional',
    toneType: 'chime'
  }
];

export const DEFAULT_SETTINGS: AppSettings = {
  schoolName: DEFAULT_SCHOOL_NAME,
  schoolLogo: DEFAULT_SCHOOL_LOGO,
  autoStartWindows: true,
  autoBellActive: true,
  selectedSpeaker: 'realtek',
  bellVolume: 80,
  systemPaused: false,
  outputSpeakerName: 'Zona Utama (Seluruh Sekolah)',
};

// ---------------------------------------------------------------------------
// B4 persistent storage facade (Stage A §10, §11)
//
// The renderer is the execution owner but NOT the storage owner. All durable
// writes go through the `schoolBellStorage` bridge to the main process, which
// owns the atomic files. `localStorage` survives here only as a read-only
// migration source: it is never written to again (BS-1/BS-4).
// ---------------------------------------------------------------------------

import {
  getStorageBridge,
  isStorageResult,
  storageUnavailableMessage,
  type BackupListEntry,
  type CommitResult,
  type RestorePreview,
  type RestoreResult,
  type HydrateResult,
  type SettingsLimits,
  type StorageErrorInfo,
  type StorageResult,
  type SyncStateValue,
} from '../types/storage-bridge';
import type { AudioFileItem, AppSettings, CategoryItem, ScheduleItem } from '../types';

/** Legacy keys. Read exactly once, for migration, then treated as read-only. */
const LEGACY_KEYS = {
  SCHEDULES: 'schoolbell_schedules_v2',
  CATEGORIES: 'schoolbell_categories_v2',
  AUDIO_FILES: 'schoolbell_audio_files_v2',
  SETTINGS: 'schoolbell_settings_v2',
  LAST_IMPORT_SOURCE: 'schoolbell_last_import_source_v1',
  SYNC_META: 'schoolbell_sync_meta_v1',
} as const;

/**
 * A single normalized row captured from the last successfully parsed Excel/CSV file.
 * This is a persisted *snapshot* of parse output, never a browser `File` handle.
 */
export interface ImportSourceRow {
  time: string;
  name: string;
  description: string;
  soundName: string;
  day: string;
  category: string;
}

/** Metadata + normalized rows of the last import that the user actually applied. */
export interface ImportSourceSnapshot {
  fileName: string;
  importedAt: string;
  rows: ImportSourceRow[];
  skippedRowCount: number;
}

/** Local-only synchronization metadata (no network involved). */
export interface SyncMeta {
  lastSyncedAt: string | null;
  lastSourceFileName: string | null;
}

export const EMPTY_SYNC_META: SyncMeta = { lastSyncedAt: null, lastSourceFileName: null };

/**
 * B5.1 — settings limits for renderer-side UX checks.
 *
 * These mirror `electron/settings-schema.cjs`, which is the authority. The
 * fallback exists only for the browser-hosted path where no preload bridge is
 * present; when the bridge is available the published limits are used so the
 * numbers cannot drift apart.
 */
const FALLBACK_SETTINGS_LIMITS: SettingsLimits = Object.freeze({
  maxSchoolNameLength: 200,
  maxSpeakerNameLength: 120,
  minBellVolume: 0,
  maxBellVolume: 100,
  maxLogoBytes: 2 * 1024 * 1024,
  logoMimeAllowlist: Object.freeze(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml']),
});

export function settingsLimits(): SettingsLimits {
  const bridge = getStorageBridge();
  const published = bridge && (bridge as { settingsLimits?: SettingsLimits }).settingsLimits;
  if (!published) return FALLBACK_SETTINGS_LIMITS;
  return {
    maxSchoolNameLength: published.maxSchoolNameLength ?? FALLBACK_SETTINGS_LIMITS.maxSchoolNameLength,
    maxSpeakerNameLength: published.maxSpeakerNameLength ?? FALLBACK_SETTINGS_LIMITS.maxSpeakerNameLength,
    minBellVolume: published.minBellVolume ?? FALLBACK_SETTINGS_LIMITS.minBellVolume,
    maxBellVolume: published.maxBellVolume ?? FALLBACK_SETTINGS_LIMITS.maxBellVolume,
    maxLogoBytes: published.maxLogoBytes ?? FALLBACK_SETTINGS_LIMITS.maxLogoBytes,
    logoMimeAllowlist: published.logoMimeAllowlist?.length
      ? published.logoMimeAllowlist
      : FALLBACK_SETTINGS_LIMITS.logoMimeAllowlist,
  };
}

/** Bytes of a base64 data-URL payload, without decoding it. */
function dataUrlDecodedBytes(value: string): number {
  const comma = value.indexOf(',');
  if (comma < 0) return 0;
  const base64 = value.slice(comma + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * B5.1 F-02 — mirror of the main-process signature sniff, limited to the head of
 * the payload so the renderer does not decode a 2 MB blob just to show a message.
 * Kept deliberately small; `electron/settings-schema.cjs` remains the authority.
 */
function payloadLooksLikeImage(declaredMime: string, base64: string): boolean {
  const head = base64.slice(0, 44); // enough for RIFF/WEBP and an <svg> prolog
  let bytes: number[];
  try {
    bytes = Array.from(atob(head.padEnd(head.length + ((4 - (head.length % 4)) % 4), '=')), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const starts = (signature: number[]) => signature.every((byte, i) => bytes[i] === byte);
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));

  if (declaredMime === 'image/png' && starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true;
  if ((declaredMime === 'image/jpeg' || declaredMime === 'image/jpg') && starts([0xff, 0xd8, 0xff])) return true;
  if (declaredMime === 'image/gif' && starts([0x47, 0x49, 0x46, 0x38])) return true;
  if (declaredMime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (declaredMime === 'image/svg+xml') return /<svg[\s>]/i.test(String.fromCharCode(...bytes));
  return false;
}

/**
 * B5.1 F-02 — renderer-side logo check for immediate feedback.
 *
 * Returns `null` when the value is acceptable, otherwise a message for the
 * user. This never decides: the main process re-validates the same value and is
 * the authority that can reject a write.
 */
export function validateLogoForInput(value: string): string | null {
  const limits = settingsLimits();
  if (value === '') return null;
  if (/^https?:\/\/\S+$/.test(value)) {
    return value.length <= 4096 ? null : 'Alamat logo terlalu panjang.';
  }
  const match = /^data:(image\/(?:png|jpeg|jpg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return 'Format logo tidak didukung. Gunakan PNG, JPG, GIF, WEBP, atau SVG.';
  if (!limits.logoMimeAllowlist.includes(match[1])) return 'Format logo tidak didukung.';
  if (dataUrlDecodedBytes(value) > limits.maxLogoBytes) return 'Ukuran logo melebihi 2MB.';
  // The OS reports `file.type` from the extension, so a text file renamed to
  // `.png` still claims `image/png`. Sniff the real bytes here so the user sees
  // the reason immediately instead of a silent no-op; main re-checks regardless.
  if (!payloadLooksLikeImage(match[1], match[2])) {
    return 'Isi berkas bukan gambar yang valid.';
  }
  return null;
}

/**
 * B5.1 F-01 — clamp a candidate `AppSettings` patch before it reaches the
 * store, so ordinary UI input can never produce a value the main process would
 * reject. Rejected keys are dropped from the returned patch, which leaves the
 * current in-memory value — and therefore the persisted settings — unchanged.
 */
export function sanitizeSettingsPatch(
  _current: AppSettings,
  patch: Partial<AppSettings>,
): { patch: Partial<AppSettings>; messages: string[] } {
  const limits = settingsLimits();
  const next: Partial<AppSettings> = { ...patch };
  const messages: string[] = [];

  if (typeof next.bellVolume === 'number') {
    const volume = Math.round(next.bellVolume);
    if (!Number.isFinite(volume) || volume < limits.minBellVolume || volume > limits.maxBellVolume) {
      delete next.bellVolume;
      messages.push(`Volume bel harus antara ${limits.minBellVolume}-${limits.maxBellVolume}.`);
    } else {
      next.bellVolume = volume;
    }
  }

// Mirrors `electron/settings-schema.cjs` (PD-3): a name is 1..max characters.
    // An empty value is dropped rather than stored, so the previous name stays.
    if (typeof next.schoolName === 'string') {
      if (next.schoolName.length === 0) {
        delete next.schoolName;
        messages.push('Nama sekolah tidak boleh kosong.');
      } else if (next.schoolName.length > limits.maxSchoolNameLength) {
        delete next.schoolName;
        messages.push(`Nama sekolah maksimal ${limits.maxSchoolNameLength} karakter.`);
      }
    }

  if (typeof next.schoolLogo === 'string') {
    const problem = validateLogoForInput(next.schoolLogo);
    if (problem) {
      delete next.schoolLogo;
      messages.push(problem);
    }
  }

  return { patch: next, messages };
}

/** Fully resolved application state after hydration. */
export interface HydratedState {
  schedules: ScheduleItem[];
  categories: CategoryItem[];
  audioFiles: AudioFileItem[];
  settings: AppSettings;
  syncMeta: SyncMeta;
  lastImportSource: ImportSourceSnapshot | null;
  degraded: boolean;
  firstRun: boolean;
  warnings: string[];
  storageError: StorageErrorInfo | null;
}

export type HydrateOutcome =
  | { ok: true; state: HydratedState }
  | { ok: false; error: StorageErrorInfo; state: HydratedState };

/**
 * Reads the six legacy `localStorage` keys verbatim for migration.
 * Returns raw strings exactly as stored so the main process can quarantine
 * unparseable bytes instead of silently substituting defaults.
 */
export function readLegacyPayload(): Record<string, string> {
  const payload: Record<string, string> = {};
  if (typeof localStorage === 'undefined') return payload;
  for (const key of Object.values(LEGACY_KEYS)) {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) payload[key] = raw;
    } catch {
      // A blocked/oversized localStorage must not block startup.
    }
  }
  return payload;
}

function unavailable<T>(): StorageResult<T> {
  return { ok: false, error: storageUnavailableMessage() };
}

/**
 * Hydrates authoritative state from the main process.
 *
 * Defaults are applied only when the store is genuinely empty, so a store that
 * legitimately contains zero schedules never gets refilled with 37 demo rows
 * (BS-2). `firstRun` is the single signal that a brand-new install may be seeded.
 */
export async function hydratePersistentStorage(): Promise<HydrateOutcome> {
  const bridge = getStorageBridge();
  if (!bridge) {
    return { ok: false, error: storageUnavailableMessage(), state: fallbackState() };
  }

  let result: StorageResult<HydrateResult>;
  try {
    result = await bridge.hydrate(readLegacyPayload());
  } catch (error) {
    return {
      ok: false,
      error: { code: 'STORAGE_BRIDGE_FAILED', message: describe(error), details: null },
      state: fallbackState(),
    };
  }

  if (!isStorageResult<HydrateResult>(result) || !result.ok) {
    const error = isStorageResult<HydrateResult>(result) ? result.error : storageUnavailableMessage();
    return { ok: false, error, state: fallbackState() };
  }

  const payload = result.value;
  if (!payload.ready) {
    const error = payload.storageError ?? storageUnavailableMessage();
    return { ok: false, error, state: fallbackState() };
  }

  const storeHasSchedules = Array.isArray(payload.syncState?.schedules) && payload.syncState.schedules.length > 0;
  const firstRun = payload.firstRun === true;

  const state: HydratedState = {
    // BS-2: an empty persisted store means "the user deleted everything", not
    // "never configured". Only a true first run gets the demo defaults.
    schedules: storeHasSchedules ? payload.syncState!.schedules : firstRun ? DEFAULT_SCHEDULES : [],
    categories: payload.categories && payload.categories.length > 0 ? payload.categories : DEFAULT_CATEGORIES,
    audioFiles: payload.audioMetadata && payload.audioMetadata.length > 0
      ? payload.audioMetadata
      : firstRun ? DEFAULT_AUDIO_FILES : [],
    settings: { ...DEFAULT_SETTINGS, ...(payload.settings ?? {}) },
    syncMeta: { ...EMPTY_SYNC_META, ...(payload.syncState?.syncMeta ?? {}) },
    lastImportSource: payload.syncState?.lastImportSource ?? null,
    degraded: payload.degraded === true,
    firstRun,
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    storageError: null,
  };

  if (firstRun) {
    // Persist the seeded defaults immediately so the next launch reads a real
    // store instead of re-deciding "first run" again.
    await bridge.commitSyncState({
      schedules: state.schedules,
      lastImportSource: null,
      syncMeta: state.syncMeta,
    });
    await bridge.commitAggregate('categories', state.categories);
    await bridge.commitAggregate('audioMetadata', state.audioFiles);
    await bridge.commitAggregate('settings', state.settings);
  }

  return { ok: true, state };
}

function fallbackState(): HydratedState {
  return {
    schedules: [],
    categories: [],
    audioFiles: [],
    settings: DEFAULT_SETTINGS,
    syncMeta: EMPTY_SYNC_META,
    lastImportSource: null,
    degraded: true,
    firstRun: false,
    warnings: [],
    storageError: storageUnavailableMessage(),
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ---------------------------------------------------------------------------
// Atomic sync state (BS-6)
// ---------------------------------------------------------------------------

export interface SyncStateCommit extends SyncStateValue {
  syncMeta: SyncMeta | null;
}

/**
 * Commits `schedules`, the sync snapshot, and the sync metadata in ONE main
 * process transaction (Stage A §4). The caller must already have determined
 * that the change is a real, non-no-op change.
 */
export async function commitSyncState(
  schedules: ScheduleItem[],
  lastImportSource: ImportSourceSnapshot | null,
  syncMeta: SyncMeta,
): Promise<StorageResult<CommitResult>> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.commitSyncState({ schedules, lastImportSource, syncMeta });
}

export async function commitSettings(settings: AppSettings): Promise<StorageResult<CommitResult>> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.commitAggregate('settings', settings);
}

export async function commitCategories(categories: CategoryItem[]): Promise<StorageResult<CommitResult>> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.commitAggregate('categories', categories);
}

export async function commitAudioMetadata(files: AudioFileItem[]): Promise<StorageResult<CommitResult>> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.commitAggregate('audioMetadata', files);
}

/** Waits for every queued durable write to land (used before quit/restore). */
export async function drainPersistentStorage(): Promise<void> {
  const bridge = getStorageBridge();
  if (!bridge) return;
  try {
    await bridge.drain();
  } catch {
    // Nothing actionable; the main process logs the failure itself.
  }
}

// ---------------------------------------------------------------------------
// Audio assets (BS-3)
// ---------------------------------------------------------------------------

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
};

export function audioExtensionFor(fileName: string, mime: string): string | null {
  const fromMime = AUDIO_EXTENSIONS[mime.toLowerCase().trim()];
  if (fromMime) return fromMime;
  const match = /\.([a-z0-9]{2,5})$/i.exec(fileName.trim());
  if (!match) return null;
  const ext = match[1].toLowerCase();
  return ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext) ? ext : null;
}

let customAudioCounter = 0;

/**
 * Stable id for an uploaded asset. The legacy `snd-custom-<ms>-<n>` shape is
 * preserved so previously imported schedules keep resolving to the same id.
 */
export function nextCustomAudioId(): string {
  customAudioCounter += 1;
  return `snd-custom-${Date.now()}-${customAudioCounter}`;
}

export interface AudioAsset {
  item: AudioFileItem;
  storageName: string;
  bytes: number;
  mime: string;
}

/**
 * Uploads a custom sound: binary first, metadata second.
 *
 * If the metadata commit fails the binary is rolled back so the store never
 * keeps an unreferenced blob, and the caller is told the upload did not happen.
 */
export async function importAudioAsset(
  audioId: string,
  file: File,
  title: string,
  category: AudioFileItem['category'],
  existing: AudioFileItem[],
): Promise<{ ok: true; asset: AudioFileItem } | { ok: false; error: StorageErrorInfo }> {
  const bridge = getStorageBridge();
  if (!bridge) return { ok: false, error: storageUnavailableMessage() };

  const ext = audioExtensionFor(file.name, file.type);
  if (!ext) {
    return {
      ok: false,
      error: { code: 'AUDIO_INVALID', message: 'Format audio tidak didukung.', details: null },
    };
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (error) {
    return { ok: false, error: { code: 'AUDIO_READ_FAILED' as StorageErrorInfo['code'], message: describe(error), details: null } };
  }

  const imported = await bridge.importAudio({ audioId, bytes, mime: file.type || '', ext });
  if (!imported.ok) return { ok: false, error: imported.error };

  const item: AudioFileItem = {
    ...(existing.find((f) => f.id === audioId) ?? {}),
    id: audioId,
    title: title || file.name,
    fileName: file.name,
    description: 'Audio kustom',
    category,
    duration: '--:--',
    size: formatBytes(imported.value.bytes),
    usedIn: 'Bel kustom',
    usedInSub: 'Dipilih manual',
    storageName: imported.value.storageName,
    bytes: imported.value.bytes,
    mime: imported.value.mime,
  };
  delete item.customAudioUrl;

  return { ok: true, asset: item };
}

export async function deleteAudioAsset(audioId: string): Promise<StorageResult<{ audioId: string; deleted: boolean }>> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.deleteAudio(audioId);
}

export async function gcAudioAssets(files: AudioFileItem[]): Promise<StorageResult<{ removed: string[] }>> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.gcAudio(files.map((f) => ({ id: f.id, storageName: f.storageName })));
}

const urlCache = new Map<string, string>();

/**
 * Returns a renderer object URL for a stored asset, building it on first use.
 * The URL is ephemeral and never persisted (BS-3).
 */
export async function resolveAudioUrl(
  audio: AudioFileItem,
): Promise<{ ok: true; url: string } | { ok: false; error: StorageErrorInfo }> {
  if (audio.customAudioUrl) return { ok: true, url: audio.customAudioUrl };
  if (!audio.storageName) {
    return { ok: false, error: { code: 'AUDIO_NOT_FOUND', message: 'Berkas audio tidak tersimpan.', details: null } };
  }

  const cached = urlCache.get(audio.id);
  if (cached) return { ok: true, url: cached };

  const bridge = getStorageBridge();
  if (!bridge) return { ok: false, error: storageUnavailableMessage() };

  const read = await bridge.readAudio(audio.id);
  if (!read.ok) return { ok: false, error: read.error };

  const url = URL.createObjectURL(new Blob([read.value.bytes], { type: read.value.mime || 'audio/mpeg' }));
  urlCache.set(audio.id, url);
  return { ok: true, url };
}

/** Drops a cached object URL (on delete or before re-importing the same id). */
export function releaseAudioUrl(audioId: string): void {
  const url = urlCache.get(audioId);
  if (!url) return;
  URL.revokeObjectURL(url);
  urlCache.delete(audioId);
}

export function releaseAllAudioUrls(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Backup / restore (B4 MUST)
// ---------------------------------------------------------------------------

export async function createBackupNow(reason = 'manual') {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable<{ file: string; bytes: number; createdAt: string }>();
  return bridge.backupNow(reason);
}

export async function listAvailableBackups(): Promise<StorageResult<BackupListEntry[]>> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.listBackups();
}

export async function restoreBackup(
  file: string,
  dryRun = false,
): Promise<StorageResult<RestorePreview | RestoreResult>> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.restore(file, { dryRun });
}

export async function exportBackupFile(): Promise<
  StorageResult<{ canceled: boolean; path?: string; bytes?: number }>
> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.exportBackup();
}

export async function retryMigration(): Promise<StorageResult<{ state: string; warnings: string[] }>> {
  const bridge = getStorageBridge();
  if (!bridge) return unavailable();
  return bridge.retryMigration(readLegacyPayload());
}

/** Test/bootstrap escape hatch: forget the in-renderer object URL cache. */
export function __resetFacadeCache(): void {
  releaseAllAudioUrls();
  customAudioCounter = 0;
}
