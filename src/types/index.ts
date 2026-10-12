export interface ScheduleItem {
  id: string;
  time: string; // HH:mm format, e.g. "07:00"
  name: string;
  description: string;
  soundId: string;
  soundName: string;
  duration: string;
  day: string; // "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", etc.
  category: string; // "Reguler", "Jadwal Ujian", "Class Meeting", "Ramadhan", etc.
  active: boolean;
}

export interface CategoryItem {
  id: string;
  name: string;
  description: string;
  isCustom: boolean;
  badgeType?: 'Utama' | 'Reguler' | 'Khusus' | string;
}

export type AudioCategoryType =
  | 'Bel Rutin'
  | 'Lagu Wajib'
  | 'Mars Sekolah'
  | 'Istirahat'
  | 'Ujian'
  | 'Pulang'
  | 'Pengumuman';

export interface AudioFileItem {
  id: string;
  title: string;
  fileName: string;
  description: string;
  category: AudioCategoryType;
  duration: string;
  size: string;
  usedIn: string;
  usedInSub: string;
  /**
   * Ephemeral renderer URL used only for immediate preview/playback.
   * Never persisted — it is rebuilt from the stored binary on every launch.
   */
  customAudioUrl?: string;
  toneType?: 'chime' | 'westminster' | 'bell' | 'siren' | 'triple' | 'soft';

  // ---- persistent asset fields (B4) -------------------------------------
  /** File name of the stored binary, e.g. `snd-custom-1712.mp3`. Absent for built-in synthesized sounds. */
  storageName?: string;
  /** Size of the stored binary in bytes. */
  bytes?: number;
  /** MIME type sniffed/validated at import time. */
  mime?: string;
  /** SHA-256 of the stored binary, used to detect drift. */
  checksum?: string;
  /**
   * True when the legacy `blob:` record survived migration but the binary did
   * not (BS-3). Such records stay listed but fall back to a synthesized tone.
   */
  needsReupload?: boolean;
}

export interface AppSettings {
  schoolName: string;
  schoolLogo: string;
  autoStartWindows: boolean;
  autoBellActive: boolean;
  selectedSpeaker: string;
  bellVolume: number; // 0 - 100
  systemPaused: boolean;
  outputSpeakerName: string;
}

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  analysis?: string;
  scheduleAction?: 'CREATE' | 'ANALYZE' | 'MODIFY' | 'INFO';
  categoryName?: string;
  applicableDays?: string[];
  suggestedItems?: Array<{
    time: string;
    name: string;
    description: string;
    soundName: string;
    duration: string;
    active: boolean;
  }>;
  applied?: boolean;
}
