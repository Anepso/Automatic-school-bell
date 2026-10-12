import type { ScheduleItem, CategoryItem, AudioFileItem, AppSettings } from './index';
import type { ImportSourceSnapshot, SyncMeta } from '../utils/storage';

/**
 * Renderer-visible contract of the `schoolBellStorage` bridge exposed by
 * `electron/preload.cjs`.
 *
 * Every call resolves to a result envelope instead of rejecting, because an
 * `ipcRenderer.invoke` rejection arrives as an opaque
 * "Error invoking remote method ..." string with the typed code mangled into the
 * message. The envelope keeps `error.code` intact so the UI can branch on
 * `STORAGE_CONFLICT`, `AUDIO_TOO_LARGE`, `STORAGE_MIGRATION_FAILED`, and so on.
 */
export type StorageErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_CORRUPT'
  | 'STORAGE_MIGRATION_FAILED'
  | 'STORAGE_CONFLICT'
  | 'STORAGE_INVALID_INPUT'
  | 'STORAGE_UNSUPPORTED_VERSION'
  | 'STORAGE_READ_ONLY'
  | 'STORAGE_FORBIDDEN'
  | 'STORAGE_BRIDGE_FAILED'
  | 'STORAGE_UNKNOWN'
  | 'AUDIO_INVALID'
  | 'AUDIO_TOO_LARGE'
  | 'AUDIO_NOT_FOUND'
  | 'AUDIO_WRITE_FAILED'
  | 'BACKUP_FAILED'
  | 'RESTORE_FAILED';

export interface StorageErrorInfo {
  code: StorageErrorCode;
  message: string;
  details: unknown;
}

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageErrorInfo };

export interface SyncStateValue {
  schedules: ScheduleItem[];
  lastImportSource: ImportSourceSnapshot | null;
  syncMeta: SyncMeta | null;
}

export interface HydrateResult {
  ready: boolean;
  dataVersion: number | null;
  degraded: boolean;
  storageError: StorageErrorInfo | null;
  syncState: SyncStateValue | null;
  settings: Partial<AppSettings> | null;
  categories: CategoryItem[] | null;
  audioMetadata: AudioFileItem[] | null;
  migration: { state: string; warnings?: string[] };
  /** True only for a brand-new install that has no legacy data and no store contents. */
  firstRun: boolean;
  warnings: string[];
}

export interface AggregateDoc<T = unknown> {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  value: T;
  checksum?: string;
}

export interface CommitResult {
  revision: number;
  updatedAt: string;
}

export interface AudioImportResult {
  audioId: string;
  storageName: string;
  bytes: number;
  mime: string;
}

export interface AudioReadResult {
  mime: string;
  bytes: ArrayBuffer;
}

export interface BackupListEntry {
  file: string;
  path: string;
  bytes: number;
  valid: boolean;
  dataVersion: number | null;
}

export interface RestorePreview {
  dryRun: true;
  dataVersion: number;
  aggregates: string[];
  audio: string[];
}

export interface RestoreResult {
  dryRun: false;
  dataVersion: number;
  restored: string[];
  missingAudio: string[];
  safetyBackup: string | null;
}

/**
 * B5.1 — the settings bounds the main process enforces, published read-only so
 * the renderer can validate for UX without restating the numbers. The main
 * process remains the authority; see `electron/settings-schema.cjs`.
 */
export interface SettingsLimits {
  maxSchoolNameLength: number;
  maxSpeakerNameLength: number;
  minBellVolume: number;
  maxBellVolume: number;
  maxLogoBytes: number;
  logoMimeAllowlist: readonly string[];
}

export interface StorageBridge {
  isPersistent: true;
  settingsLimits: SettingsLimits;
  hydrate: (legacyPayload: Record<string, string>) => Promise<StorageResult<HydrateResult>>;
  getAggregate: (name: 'syncState' | 'settings' | 'categories' | 'audioMetadata') =>
    Promise<StorageResult<AggregateDoc>>;
  getMigrationStatus: () => Promise<StorageResult<{ state: string; lastError: string | null }>>;
  retryMigration: (legacyPayload: Record<string, string>) =>
    Promise<StorageResult<{ state: string; warnings: string[] }>>;
  commitAggregate: (
    name: 'settings' | 'categories' | 'audioMetadata',
    value: unknown,
    expectedRevision?: number | null,
  ) => Promise<StorageResult<CommitResult>>;
  commitSyncState: (
    payload: { schedules: ScheduleItem[]; lastImportSource: ImportSourceSnapshot | null; syncMeta: SyncMeta | null },
    expectedRevision?: number | null,
  ) => Promise<StorageResult<CommitResult>>;
  drain: () => Promise<StorageResult<{ ok: boolean }>>;
  importAudio: (audio: { audioId: string; bytes: ArrayBuffer; mime: string; ext: string }) =>
    Promise<StorageResult<AudioImportResult>>;
  readAudio: (audioId: string) => Promise<StorageResult<AudioReadResult>>;
  deleteAudio: (audioId: string) => Promise<StorageResult<{ audioId: string; deleted: boolean }>>;
  gcAudio: (referenced: Array<{ id: string; storageName?: string }>) =>
    Promise<StorageResult<{ removed: string[]; kept: string[]; bytesFreed: number }>>;
  backupNow: (reason?: string) => Promise<StorageResult<{ file: string; bytes: number; createdAt: string }>>;
  listBackups: () => Promise<StorageResult<BackupListEntry[]>>;
  restore: (file: string, options?: { dryRun?: boolean }) =>
    Promise<StorageResult<RestorePreview | RestoreResult>>;
  exportBackup: () =>
    Promise<StorageResult<{ canceled: boolean; path?: string; bytes?: number }>>;
}

/** Narrows an unknown value to the result envelope without trusting it. */
export function isStorageResult<T>(value: unknown): value is StorageResult<T> {
  return Boolean(value) && typeof value === 'object' && 'ok' in (value as Record<string, unknown>);
}

/** Human-readable fallback used when the bridge is missing entirely. */
export function storageUnavailableMessage(): StorageErrorInfo {
  return {
    code: 'STORAGE_UNAVAILABLE',
    message: 'Penyimpanan permanen tidak tersedia. Perubahan tidak akan tersimpan.',
    details: null,
  };
}

export function getStorageBridge(): StorageBridge | null {
  const bridge = (window as Window & { schoolBellStorage?: StorageBridge }).schoolBellStorage;
  return bridge && bridge.isPersistent === true ? bridge : null;
}
