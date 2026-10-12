'use strict';

/**
 * School Bell persistent storage (Stage B4).
 *
 * Design contract: STAGE_B4_PERSISTENT_STORAGE_STAGE_A_FOLLOWUP.md
 *
 *  - Main process is the ONLY writer. The renderer has no filesystem access.
 *  - JSON aggregates on disk. The sync triple (schedules + lastImportSource +
 *    syncMeta) lives in ONE document so a sync apply commits atomically via a
 *    single rename (Stage A §5.2).
 *  - Every write: tmp file -> fsync -> atomic rename. The previous revision is
 *    retained as `<name>.prev` for recovery (Stage A §9.4).
 *  - Corruption is quarantined verbatim and recovered from `.prev`/backup.
 *    It is NEVER replaced by defaults (BS-1).
 *  - No silent failures: every operation returns a typed result (Stage A §9).
 *
 * Relocation note (Stage A §7.3): this release intentionally runs IN PLACE
 * under the current `app.getPath('userData')`. Moving `userData` relocates the
 * Chromium profile that still holds the legacy `localStorage`, so migration and
 * relocation must ship as separate releases (B4.10).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');
const { createZip, readZip, crc32 } = require('./zip.cjs');
const { LIMITS, validateSettings, sanitizeSettings } = require('./settings-schema.cjs');

const CURRENT_SCHEMA_VERSION = 1;

const AGGREGATES = ['syncState', 'settings', 'categories', 'audioMetadata'];

const AUDIO_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const AUDIO_EXT_ALLOWLIST = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'];
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;

const LOG_MAX_BYTES = 1024 * 1024;
const LOG_MAX_FILES = 5;

const SYNC_STATE_DEFAULTS = { schedules: [], lastImportSource: null, syncMeta: null };

let root = null;
let dirs = null;
let manifest = null;
let writeQueue = Promise.resolve();
let audioIndex = new Map();
let storageUnavailable = null;
let restoring = false;
let recoveredAggregates = new Set();
let corruptAggregates = new Set();

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const ERROR_CODES = new Set([
  'STORAGE_UNAVAILABLE',
  'STORAGE_WRITE_FAILED',
  'STORAGE_READ_FAILED',
  'STORAGE_CORRUPT',
  'STORAGE_MIGRATION_FAILED',
  'STORAGE_CONFLICT',
  'STORAGE_INVALID_INPUT',
  'STORAGE_UNSUPPORTED_VERSION',
  'STORAGE_READ_ONLY',
  'AUDIO_WRITE_FAILED',
  'AUDIO_NOT_FOUND',
  'AUDIO_TOO_LARGE',
  'AUDIO_INVALID',
  'BACKUP_FAILED',
  'RESTORE_FAILED',
  'INTERNAL',
]);

class StorageError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'StorageError';
    this.code = ERROR_CODES.has(code) ? code : 'INTERNAL';
    this.detail = detail;
  }
}

function fail(code, message, detail) {
  return new StorageError(code, message, detail);
}

// ---------------------------------------------------------------------------
// Logging (Stage A §9.5)
// ---------------------------------------------------------------------------

function log(level, code, context) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    level,
    code,
    dataVersion: manifest ? manifest.dataVersion : null,
    ...context,
  });

  if (!dirs || !dirs.logs) {
    console.log(`[storage] ${line}`);
    return;
  }

  try {
    fs.appendFileSync(path.join(dirs.logs, 'storage.log'), `${line}\n`);
    rotateLogs();
  } catch {
    console.log(`[storage] ${line}`);
  }
}

function rotateLogs() {
  const current = path.join(dirs.logs, 'storage.log');
  if (!fs.existsSync(current)) return;
  if (fs.statSync(current).size < LOG_MAX_BYTES) return;

  for (let i = LOG_MAX_FILES - 1; i >= 1; i -= 1) {
    const from = path.join(dirs.logs, `storage.${i}.log`);
    const to = path.join(dirs.logs, `storage.${i + 1}.log`);
    if (fs.existsSync(from)) fs.renameSync(from, to);
  }
  fs.renameSync(current, path.join(dirs.logs, 'storage.1.log'));
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function dataPath(aggregate) {
  return path.join(dirs.data, `${aggregate}.json`);
}

function manifestPath() {
  return path.join(dirs.data, 'manifest.json');
}

function migrationPath() {
  return path.join(root, 'migration.json');
}

function aggregateIsValid(name) {
  return AGGREGATES.includes(name);
}

// ---------------------------------------------------------------------------
// Atomic primitives (Stage A §5, §9)
// ---------------------------------------------------------------------------

function fsyncDir(dir) {
  // Directory fsync is a POSIX durability nicety; Windows has no equivalent
  // and relies on the file handle close inside rename.
  if (process.platform === 'win32') return;
  try {
    const fd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* best effort */
  }
}

function classifyWriteError(error) {
  const code = error && error.code;
  if (code === 'ENOSPC') return fail('STORAGE_WRITE_FAILED', 'Penyimpanan penuh: perubahan belum tersimpan.', code);
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
    return fail('STORAGE_WRITE_FAILED', 'Izin ditolak: perubahan belum tersimpan.', code);
  }
  if (code === 'EBUSY' || code === 'EPERM_LOCK') {
    return fail('STORAGE_WRITE_FAILED', 'Berkas sedang dikunci oleh proses lain.', code);
  }
  return fail('STORAGE_WRITE_FAILED', 'Gagal menyimpan data ke disk.', code || String(error));
}

/**
 * Durable atomic replace: write tmp, fsync, retain previous as .prev, rename.
 */
function atomicWrite(targetPath, buffer) {
  const dir = path.dirname(targetPath);
  const tmp = path.join(dirs.tmp, `${path.basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  const prev = `${targetPath}.prev`;

  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeSync(fd, buffer, 0, buffer.length, 0);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw classifyWriteError(error);
  }

  try {
    if (fs.existsSync(targetPath)) {
      const prevTmp = `${prev}.tmp`;
      fs.copyFileSync(targetPath, prevTmp);
      const prevFd = fs.openSync(prevTmp, 'r+');
      try { fs.fsyncSync(prevFd); } finally { fs.closeSync(prevFd); }
      fs.renameSync(prevTmp, prev);
    }
    fs.renameSync(tmp, targetPath);
    fsyncDir(dir);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw classifyWriteError(error);
  }
}

/**
 * Atomic write for a destination OUTSIDE the store (used by export).
 *
 * The temp file is staged inside the destination's own directory so the final
 * rename is always same-filesystem; staging it under `dirs.tmp` would fail with
 * EXDEV when the user exports to a USB stick or another volume.
 */
function atomicWriteExternal(targetPath, buffer) {
  const dir = path.dirname(targetPath);
  const tmp = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeSync(fd, buffer, 0, buffer.length, 0);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw classifyWriteError(error);
  }
  try {
    fs.renameSync(tmp, targetPath);
    fsyncDir(dir);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw classifyWriteError(error);
  }
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath);
  return JSON.parse(raw.toString('utf8'));
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function quarantine(filePath, reason) {
  if (!fs.existsSync(filePath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tag = String(reason || 'unknown').replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 40);
  const target = path.join(dirs.quarantine, `${path.basename(filePath)}.${stamp}.${tag}.corrupt`);
  try {
    fs.renameSync(filePath, target);
    log('error', 'STORAGE_CORRUPT', { file: path.basename(filePath), reason, quarantined: path.basename(target) });
    return target;
  } catch (error) {
    log('error', 'STORAGE_CORRUPT', { file: path.basename(filePath), reason, quarantineFailed: String(error) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

function emptyAggregate(aggregate) {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: 0,
    updatedAt: null,
    checksum: null,
    value: aggregate === 'syncState' ? { ...SYNC_STATE_DEFAULTS } : null,
  };
}

function isWellFormedAggregate(doc, aggregate) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.schemaVersion !== CURRENT_SCHEMA_VERSION) return false;
  if (!Number.isInteger(doc.revision) || doc.revision < 0) return false;

  if (aggregate === 'syncState') {
    const v = doc.value;
    return Boolean(v) && Array.isArray(v.schedules) && v.schedules.every((s) => s && typeof s === 'object');
  }
  if (aggregate === 'audioMetadata') {
    return Array.isArray(doc.value) && doc.value.every((a) => a && typeof a === 'object' && typeof a.id === 'string');
  }
  if (aggregate === 'categories') {
    return Array.isArray(doc.value) && doc.value.every((c) => c && typeof c === 'object');
  }
  if (aggregate === 'settings') {
    // B5.1: the on-disk shape check stays exactly as B4 defined it (any object).
    // Payload-level validation lives in `settings-schema.cjs` and is enforced on
    // the WRITE path. Tightening this check would turn a pre-B5.1 install that
    // stored, say, an out-of-range bellVolume into a quarantined "corrupt"
    // document, which is a destructive migration — explicitly out of scope.
    // Such values are instead repaired in memory by `sanitizeSettings` on read.
    return Boolean(doc.value) && typeof doc.value === 'object' && !Array.isArray(doc.value);
  }
  return false;
}

function sealAggregate(aggregate, value, revision, updatedAt) {
  const doc = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision,
    updatedAt,
    value,
  };
  const body = Buffer.from(JSON.stringify(doc), 'utf8');
  doc.checksum = sha256(body);
  return { doc, buffer: Buffer.from(JSON.stringify(doc), 'utf8') };
}

/**
 * Read one aggregate.
 *
 * Corruption is never replaced by defaults (BS-1). The damaged bytes are
 * quarantined verbatim, the last-known-good `.prev` revision is used, and — when
 * `heal` is set — the recovered value is written back to disk so the store does
 * not silently decay into an empty state on the next boot.
 */
function readAggregate(aggregate, options = {}) {
  const heal = options.heal === true;
  const file = dataPath(aggregate);

  if (!fs.existsSync(file)) {
    if (heal) recoveredAggregates.add(aggregate);
    return emptyAggregate(aggregate);
  }

  let doc;
  try {
    doc = readJsonFile(file);
  } catch (error) {
    quarantine(file, 'unparseable');
    return recoverAggregate(aggregate, heal);
  }

  if (!isWellFormedAggregate(doc, aggregate)) {
    quarantine(file, 'shape-or-version');
    return recoverAggregate(aggregate, heal);
  }

  if (typeof doc.checksum === 'string') {
    const copy = { ...doc };
    delete copy.checksum;
    const actual = sha256(Buffer.from(JSON.stringify(copy), 'utf8'));
    if (actual !== doc.checksum) {
      quarantine(file, 'checksum-mismatch');
      return recoverAggregate(aggregate, heal);
    }
  }

  return doc;
}

function recoverAggregate(aggregate, heal) {
  const prev = `${dataPath(aggregate)}.prev`;

  if (heal) {
    recoveredAggregates.add(aggregate);
    corruptAggregates.add(aggregate);
  }

  if (!fs.existsSync(prev)) {
    log('error', 'STORAGE_CORRUPT', { file: `${aggregate}.json`, recoveredFrom: 'none' });
    return emptyAggregate(aggregate);
  }

  let doc;
  try {
    doc = readJsonFile(prev);
  } catch {
    return emptyAggregate(aggregate);
  }
  if (!isWellFormedAggregate(doc, aggregate)) return emptyAggregate(aggregate);

  log('warn', 'STORAGE_CORRUPT', { file: `${aggregate}.json`, recoveredFrom: 'prev-revision' });

  // Self-heal: put the recovered value back on disk as a fresh revision so the
  // store keeps a valid document (and monotonic revisions) across reboots.
  if (heal && !restoring) {
    try {
      const revision = Math.max(
        doc.revision,
        manifest && manifest.aggregates && manifest.aggregates[aggregate]
          ? manifest.aggregates[aggregate].revision
          : 0,
      ) + 1;
      const { buffer } = sealAggregate(aggregate, doc.value, revision, new Date().toISOString());
      atomicWrite(dataPath(aggregate), buffer);
      manifest.aggregates[aggregate] = { revision, updatedAt: new Date().toISOString() };
      writeManifest();
      log('warn', 'STORAGE_CORRUPT', { file: `${aggregate}.json`, healed: true, revision });
      return { ...doc, revision };
    } catch (error) {
      log('error', 'STORAGE_CORRUPT', { file: `${aggregate}.json`, healFailed: String(error && error.message) });
    }
  }

  return doc;
}

function nextRevision(aggregate) {
  const current = manifest && manifest.aggregates && manifest.aggregates[aggregate];
  return current && Number.isInteger(current.revision) ? current.revision + 1 : 1;
}

function writeManifest() {
  const buffer = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  atomicWrite(manifestPath(), buffer);
}

function persistAggregate(aggregate, value, expectedRevision) {
  if (storageUnavailable) throw storageUnavailable;
  if (restoring) throw fail('STORAGE_READ_ONLY', 'Penyimpanan sedang dipulihkan.');
  if (!aggregateIsValid(aggregate)) throw fail('STORAGE_INVALID_INPUT', 'Aggregate tidak dikenal.');

  const onDisk = readAggregate(aggregate);

  if (expectedRevision !== undefined && expectedRevision !== null) {
    if (onDisk.revision !== expectedRevision) {
      throw fail('STORAGE_CONFLICT', 'Data berubah di luar aplikasi. Muat ulang dan coba lagi.', {
        expected: expectedRevision,
        actual: onDisk.revision,
      });
    }
  }

  const revision = nextRevision(aggregate);
  const updatedAt = new Date().toISOString();
  const { buffer } = sealAggregate(aggregate, value, revision, updatedAt);

  atomicWrite(dataPath(aggregate), buffer);

  manifest.aggregates[aggregate] = { revision, updatedAt };
  writeManifest();

  if (aggregate === 'audioMetadata') refreshAudioIndex(value);

  log('info', 'STORAGE_WRITE_OK', { aggregate, revision, bytes: buffer.length });
  return { revision, updatedAt };
}

function enqueue(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(() => undefined, () => undefined);
  return run;
}

function drain() {
  return writeQueue.then(
    () => ({ ok: true }),
    (error) => {
      log('error', 'STORAGE_WRITE_FAILED', { during: 'drain', error: String(error && error.message) });
      return { ok: false };
    },
  );
}

// ---------------------------------------------------------------------------
// Audio assets
// ---------------------------------------------------------------------------

function refreshAudioIndex(metadata) {
  audioIndex = new Map();
  if (!Array.isArray(metadata)) return;
  for (const item of metadata) {
    if (item && typeof item.id === 'string' && typeof item.storageName === 'string') {
      audioIndex.set(item.id, item.storageName);
    }
  }
}

function buildAudioIndexFromDisk() {
  audioIndex = new Map();
  if (!fs.existsSync(dirs.audio)) return;
  for (const entry of fs.readdirSync(dirs.audio)) {
    const dot = entry.lastIndexOf('.');
    if (dot <= 0) continue;
    audioIndex.set(entry.slice(0, dot), entry);
  }
}

function resolveAudioFile(audioId) {
  if (typeof audioId !== 'string' || !AUDIO_ID_RE.test(audioId)) {
    throw fail('STORAGE_INVALID_INPUT', 'Audio id tidak valid.');
  }
  const known = audioIndex.get(audioId);
  if (known) {
    const direct = path.join(dirs.audio, known);
    if (isInside(dirs.audio, direct) && fs.existsSync(direct)) return direct;
  }
  // Fall back to a constrained directory scan (metadata may be stale).
  if (fs.existsSync(dirs.audio)) {
    for (const entry of fs.readdirSync(dirs.audio)) {
      if (entry === audioId || entry.startsWith(`${audioId}.`)) {
        const candidate = path.join(dirs.audio, entry);
        if (isInside(dirs.audio, candidate)) return candidate;
      }
    }
  }
  throw fail('AUDIO_NOT_FOUND', 'Berkas audio tidak ditemukan.');
}

function sniffAudio(bytes, ext) {
  const b = Buffer.from(bytes);
  if (b.length < 12) return false;
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE') return ext === 'wav';
  if (b.toString('ascii', 4, 8) === 'ftyp') return ext === 'mp4' || ['m4a', 'aac', 'mp3'].includes(ext);
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return ['mp3', 'aac'].includes(ext);
  if (b.toString('ascii', 0, 4) === 'OggS') return ext === 'ogg';
  if (b.toString('ascii', 0, 4) === 'fLaC') return ext === 'flac';
  return false;
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function importAudio({ audioId, bytes, mime, ext }) {
  if (storageUnavailable) throw storageUnavailable;

  if (typeof audioId !== 'string' || !AUDIO_ID_RE.test(audioId)) {
    throw fail('STORAGE_INVALID_INPUT', 'Audio id tidak valid.');
  }
  const normalizedExt = String(ext || '').replace(/^\./, '').toLowerCase();
  if (!AUDIO_EXT_ALLOWLIST.includes(normalizedExt)) {
    throw fail('AUDIO_INVALID', 'Format audio tidak didukung.');
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buffer.length === 0) throw fail('AUDIO_INVALID', 'Berkas audio kosong.');
  if (buffer.length > MAX_AUDIO_BYTES) throw fail('AUDIO_TOO_LARGE', 'Ukuran audio melebihi batas.');
  if (!sniffAudio(buffer, normalizedExt)) {
    throw fail('AUDIO_INVALID', 'Isi berkas tidak cocok dengan format yang dipilih.');
  }

  const storageName = `${audioId}.${normalizedExt}`;
  const target = path.join(dirs.audio, storageName);
  if (!isInside(dirs.audio, target)) throw fail('STORAGE_INVALID_INPUT', 'Lokasi audio tidak valid.');

  try {
    atomicWrite(target, buffer);
  } catch (error) {
    throw fail('AUDIO_WRITE_FAILED', 'Gagal menyimpan berkas audio.', String(error && error.message));
  }

  audioIndex.set(audioId, storageName);
  log('info', 'AUDIO_WRITE_OK', { audioId, storageName, bytes: buffer.length });
  return { audioId, storageName, bytes: buffer.length, mime: String(mime || ''), checksum: sha256(buffer) };
}

const MIME_BY_AUDIO_EXT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

function readAudio(audioId) {
  if (storageUnavailable) throw storageUnavailable;
  const file = resolveAudioFile(audioId);
  try {
    const bytes = fs.readFileSync(file);
    const ext = path.extname(file).replace(/^\./, '').toLowerCase();
    return {
      audioId,
      storageName: path.basename(file),
      mime: MIME_BY_AUDIO_EXT[ext] || 'application/octet-stream',
      bytes,
    };
  } catch (error) {
    throw fail('AUDIO_NOT_FOUND', 'Berkas audio tidak dapat dibaca.', String(error && error.message));
  }
}

function deleteAudio(audioId) {
  if (storageUnavailable) throw storageUnavailable;
  let file = null;
  try {
    file = resolveAudioFile(audioId);
  } catch (error) {
    if (error && error.code === 'AUDIO_NOT_FOUND') {
      audioIndex.delete(audioId);
      return { deleted: false };
    }
    throw error;
  }
  try {
    fs.unlinkSync(file);
  } catch (error) {
    throw fail('AUDIO_WRITE_FAILED', 'Gagal menghapus berkas audio.', String(error && error.message));
  }
  audioIndex.delete(audioId);
  log('info', 'AUDIO_DELETE_OK', { audioId });
  return { deleted: true };
}

function gcAudio(metadata) {
  if (storageUnavailable) throw storageUnavailable;
  const referenced = new Set();
  if (Array.isArray(metadata)) {
    for (const item of metadata) {
      if (item && typeof item.id === 'string' && typeof item.storageName === 'string') {
        referenced.add(item.storageName);
      }
    }
  }
  const removed = [];
  for (const entry of fs.readdirSync(dirs.audio)) {
    if (entry.endsWith('.prev')) continue;
    if (referenced.has(entry)) continue;
    const full = path.join(dirs.audio, entry);
    if (!isInside(dirs.audio, full)) continue;
    try {
      const staged = path.join(dirs.tmp, `${entry}.${Date.now()}.orphan`);
      fs.renameSync(full, staged);
      fs.unlinkSync(staged);
      removed.push(entry);
    } catch (error) {
      log('warn', 'AUDIO_WRITE_FAILED', { during: 'gc', entry, error: String(error && error.message) });
    }
  }
  if (removed.length) log('info', 'AUDIO_GC', { removed: removed.length });
  return { removed };
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function resolveRoot() {
  // B4-R1: stay in the current userData so the legacy Chromium profile (and the
  // localStorage still inside it) remains reachable. Relocation is B4.10.
  return app.getPath('userData');
}

function initStore() {
  root = resolveRoot();
  dirs = {
    root,
    data: path.join(root, 'data'),
    audio: path.join(root, 'audio'),
    assets: path.join(root, 'assets'),
    backups: path.join(root, 'backups'),
    logs: path.join(root, 'logs'),
    tmp: path.join(root, 'tmp'),
    quarantine: path.join(root, 'quarantine'),
  };

  try {
    for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    storageUnavailable = fail('STORAGE_UNAVAILABLE', 'Folder penyimpanan tidak dapat dibuat.', String(error && error.message));
    log('error', 'STORAGE_UNAVAILABLE', { error: String(error && error.message) });
    throw storageUnavailable;
  }

  // Verify the store is actually writable BEFORE the app claims it works.
  const probe = path.join(dirs.tmp, `probe.${process.pid}.tmp`);
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (error) {
    storageUnavailable = fail('STORAGE_UNAVAILABLE', 'Folder penyimpanan tidak dapat ditulis.', String(error && error.message));
    log('error', 'STORAGE_UNAVAILABLE', { error: String(error && error.message) });
    throw storageUnavailable;
  }

  cleanTmp();

  if (fs.existsSync(manifestPath())) {
    try {
      manifest = readJsonFile(manifestPath());
    } catch (error) {
      quarantine(manifestPath(), 'manifest-unparseable');
      manifest = null;
    }
  }

  // Refuse to touch a store written by a newer build. This check must happen
  // BEFORE any manifest normalisation, otherwise a valid integer dataVersion
  // from a future build would be silently adopted and downgraded.
  if (manifest && Number.isInteger(manifest.dataVersion) && manifest.dataVersion > CURRENT_SCHEMA_VERSION) {
    storageUnavailable = fail(
      'STORAGE_UNSUPPORTED_VERSION',
      'Data tersimpan dibuat oleh versi aplikasi yang lebih baru.',
      { found: manifest.dataVersion, supported: CURRENT_SCHEMA_VERSION },
    );
    log('error', 'STORAGE_UNSUPPORTED_VERSION', { found: manifest.dataVersion, supported: CURRENT_SCHEMA_VERSION });
    throw storageUnavailable;
  }

  if (!manifest || !Number.isInteger(manifest.dataVersion)) {
    manifest = {
      dataVersion: Number.isInteger(manifest && manifest.dataVersion)
        ? manifest.dataVersion
        : CURRENT_SCHEMA_VERSION,
      appVersion: app.getVersion(),
      createdAt: manifest && manifest.createdAt ? manifest.createdAt : new Date().toISOString(),
      aggregates: (manifest && manifest.aggregates) || {},
    };
    try {
      writeManifest();
    } catch (error) {
      storageUnavailable = fail('STORAGE_UNAVAILABLE', 'Manifest penyimpanan tidak dapat ditulis.', String(error && error.message));
      throw storageUnavailable;
    }
  } else {
    manifest.appVersion = app.getVersion();
  }

  if (!manifest.aggregates || typeof manifest.aggregates !== 'object') manifest.aggregates = {};

  writeLock();
  buildAudioIndexFromDisk();

  log('info', 'STORAGE_READY', { root, dataVersion: manifest.dataVersion });
  return { root, dataVersion: manifest.dataVersion };
}

function cleanTmp() {
  try {
    for (const entry of fs.readdirSync(dirs.tmp)) {
      try { fs.unlinkSync(path.join(dirs.tmp, entry)); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

function writeLock() {
  try {
    atomicWrite(path.join(root, 'lock.json'), Buffer.from(JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      appVersion: app.getVersion(),
    }, null, 2), 'utf8'));
  } catch { /* advisory only */ }
}

function clearLock() {
  try {
    fs.unlinkSync(path.join(root, 'lock.json'));
  } catch { /* ignore */ }
}

function isStaleLock() {
  const file = path.join(root, 'lock.json');
  if (!fs.existsSync(file)) return false;
  try {
    const info = readJsonFile(file);
    if (!Number.isInteger(info.pid)) return false;
    try {
      process.kill(info.pid, 0);
      return false;
    } catch (error) {
      return error && error.code === 'ESRCH';
    }
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Migration (Stage A §10)
// ---------------------------------------------------------------------------

const LEGACY_KEYS = {
  schedules: 'schoolbell_schedules_v2',
  categories: 'schoolbell_categories_v2',
  audioFiles: 'schoolbell_audio_files_v2',
  settings: 'schoolbell_settings_v2',
  lastImportSource: 'schoolbell_last_import_source_v1',
  syncMeta: 'schoolbell_sync_meta_v1',
};

function readMigration() {
  if (!fs.existsSync(migrationPath())) {
    return { state: 'UNINITIALIZED', fromVersion: null, toVersion: CURRENT_SCHEMA_VERSION, lastError: null };
  }
  try {
    return readJsonFile(migrationPath());
  } catch (error) {
    log('warn', 'STORAGE_MIGRATION_FAILED', { during: 'read-marker', error: String(error && error.message) });
    return { state: 'FAILED', fromVersion: null, toVersion: CURRENT_SCHEMA_VERSION, lastError: 'marker-unreadable' };
  }
}

function writeMigration(state) {
  const buffer = Buffer.from(JSON.stringify(state, null, 2), 'utf8');
  atomicWrite(migrationPath(), buffer);
}

function storeHasAnyData() {
  for (const aggregate of AGGREGATES) {
    if (fs.existsSync(dataPath(aggregate))) return true;
  }
  return false;
}

/**
 * Stable fingerprint of the legacy payload the renderer actually handed us.
 *
 * The legacy keys are never deleted, so every launch re-presents the same
 * bytes. Without a fingerprint we cannot tell "nothing new since the migration"
 * (the normal case) from "legacy data appeared or changed after we committed"
 * (a rollback to the old app, or a first boot whose read came back empty).
 */
function legacyFingerprint(legacy) {
  const parts = Object.values(LEGACY_KEYS)
    .filter((key) => legacy[key] !== undefined && legacy[key] !== null)
    .sort()
    .map((key) => `${key}\u0000${String(legacy[key])}`);
  if (parts.length === 0) return null;
  return crypto.createHash('sha256').update(parts.join('\u0001'), 'utf8').digest('hex').slice(0, 32);
}

/**
 * Migrate legacy localStorage payloads into the store.
 * Idempotent, crash-safe, and never deletes the legacy source.
 */
function runMigration(legacyPayload) {
  const legacy = legacyPayload && typeof legacyPayload === 'object' ? legacyPayload : {};
  const warnings = [];

  try {
    const marker = readMigration();
    const hasLegacy = Object.values(LEGACY_KEYS).some((key) => legacy[key] !== undefined && legacy[key] !== null);
    const hasStore = storeHasAnyData();

    const fingerprint = legacyFingerprint(legacy);

    if (marker.state === 'SUCCESS' || marker.state === 'COMMITTED') {
      // Unchanged legacy data is the normal every-launch case: stay silent.
      if (!hasLegacy) {
        return { state: 'CURRENT', migrated: false, firstRun: false, warnings: [] };
      }
      // A marker written before fingerprints existed (an older build) has
      // already migrated this data. Adopt the fingerprint silently instead of
      // warning on every single launch.
      if (!Object.prototype.hasOwnProperty.call(marker, 'legacyFingerprint')) {
        try {
          writeMigration({ ...marker, legacyFingerprint: fingerprint, completedAt: new Date().toISOString() });
        } catch { /* the next launch retries the adoption */ }
        return { state: 'CURRENT', migrated: false, firstRun: false, warnings: [] };
      }
      if (marker.legacyFingerprint === fingerprint) {
        return { state: 'CURRENT', migrated: false, firstRun: false, warnings: [] };
      }
      // Legacy data appeared or changed after we committed (e.g. the user
      // rolled back to the previous app version, or the first boot read
      // localStorage while it was still empty). Re-evaluate instead of
      // short-circuiting, otherwise that data is stranded with no warning.
      log('warn', 'STORAGE_MIGRATION_FAILED', { reason: 'legacy-after-commit', previousState: marker.state });
      if (hasStore) {
        // Precedence is unchanged: the store wins and legacy is never merged.
        // Warn loudly so this does not read as silent data loss.
        warnings.push('Data localStorage lama berubah setelah migrasi selesai, tetapi penyimpanan baru sudah berisi data, jadi data lama tidak ditimpa.');
        try {
          writeMigration({ ...marker, legacyFingerprint: fingerprint, completedAt: new Date().toISOString() });
        } catch { /* warning is already surfaced */ }
        return { state: 'CURRENT', migrated: false, firstRun: false, warnings };
      }
      // Empty store with new legacy data present: fall through and migrate.
    }

    // RUNNING/FAILED means a previous attempt died mid-write. The bytes on disk
    // are therefore a partial migration, NOT a completed store, and must be
    // discarded and rebuilt rather than treated as authoritative.
    const resuming = marker.state === 'RUNNING' || marker.state === 'FAILED';
    if (resuming) {
      warnings.push('Migrasi sebelumnya terhenti di tengah jalan dan diulang dari data localStorage.');
      log('warn', 'STORAGE_MIGRATION_FAILED', { reason: 'resume-after-interrupt', previousState: marker.state });
    }

    if (!hasLegacy) {
      writeMigration({
        state: 'COMMITTED', fromVersion: null, toVersion: CURRENT_SCHEMA_VERSION,
        startedAt: marker.startedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(), lastError: null, note: 'no-legacy-data',
        legacyFingerprint: null,
      });
      // Nothing to migrate and nothing in the store: a genuinely new install.
      return { state: 'CURRENT', migrated: false, firstRun: !hasStore, warnings };
    }

    if (hasStore && !resuming) {
      // Precedence (Stage A §10.5): the store wins. Legacy is never merged.
      writeMigration({
        state: 'COMMITTED', fromVersion: null, toVersion: CURRENT_SCHEMA_VERSION,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
        lastError: null, note: 'store-precedence-legacy-preserved',
      });
      warnings.push('Data lokal sudah ada di penyimpanan baru; data localStorage lama tidak ditimpa.');
      log('warn', 'STORAGE_MIGRATION_FAILED', { reason: 'store-precedence' });
      return { state: 'CURRENT', migrated: false, firstRun: false, warnings };
    }

    // Roll back any partial write from the interrupted attempt so the rebuild
    // starts from a clean, verifiable state.
    if (resuming) {
      for (const aggregate of AGGREGATES) {
        for (const suffix of ['', '.prev']) {
          const file = `${dataPath(aggregate)}${suffix}`;
          if (fs.existsSync(file)) {
            quarantine(file, 'partial-migration-rollback');
            fs.rmSync(file, { force: true });
          }
        }
      }
      manifest.aggregates = {};
      try { writeManifest(); } catch { /* verified again below */ }
    }

    writeMigration({
      state: 'RUNNING', fromVersion: null, toVersion: CURRENT_SCHEMA_VERSION,
      startedAt: marker.startedAt || new Date().toISOString(), completedAt: null, lastError: null,
    });

    // SNAPSHOTTING: keep the legacy bytes verbatim, always.
    const legacySnapshot = path.join(dirs.backups, `legacy-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    atomicWrite(legacySnapshot, Buffer.from(JSON.stringify({
      capturedAt: new Date().toISOString(),
      keys: LEGACY_KEYS,
      raw: legacy,
    }, null, 2), 'utf8'));

    const parseOr = (raw, fallback) => {
      if (raw === undefined || raw === null) return { value: fallback, corrupt: false, present: false };
      if (typeof raw !== 'string') return { value: fallback, corrupt: true, present: true, reason: 'not-a-string' };
      try {
        const parsed = JSON.parse(raw);
        return { value: parsed, corrupt: false, present: true };
      } catch {
        return { value: fallback, corrupt: true, present: true, reason: 'unparseable' };
      }
    };

    // BS-2: a legacy array holding nulls / primitives / non-objects must not
    // abort the whole migration and must not silently drop the valid rows.
    const sanitizeArray = (parsed, name) => {
      if (!parsed.present) return { value: null, dropped: 0 };
      if (parsed.corrupt) return { value: null, dropped: 0 };
      if (!Array.isArray(parsed.value)) {
        parsed.corrupt = true;
        parsed.reason = 'wrong-top-level-type';
        return { value: null, dropped: 0 };
      }
      const kept = parsed.value.filter((row) => row && typeof row === 'object' && !Array.isArray(row));
      const dropped = parsed.value.length - kept.length;
      return { value: kept, dropped };
    };

    const schedules = parseOr(legacy[LEGACY_KEYS.schedules], null);
    const categories = parseOr(legacy[LEGACY_KEYS.categories], null);
    const audioFiles = parseOr(legacy[LEGACY_KEYS.audioFiles], null);
    const settings = parseOr(legacy[LEGACY_KEYS.settings], null);
    const lastImport = parseOr(legacy[LEGACY_KEYS.lastImportSource], null);
    const syncMeta = parseOr(legacy[LEGACY_KEYS.syncMeta], null);

    const schedulesClean = sanitizeArray(schedules, 'schedules');
    const categoriesClean = sanitizeArray(categories, 'categories');
    const audioClean = sanitizeArray(audioFiles, 'audioFiles');

    if (settings.present && !settings.corrupt && (typeof settings.value !== 'object' || settings.value === null || Array.isArray(settings.value))) {
      settings.corrupt = true;
      settings.reason = 'wrong-top-level-type';
    }

    for (const [name, parsed] of Object.entries({ schedules, categories, audioFiles, settings, lastImport, syncMeta })) {
      if (parsed.corrupt) {
        warnings.push(`Data "${name}" rusak dan tidak dipindahkan. Salinan aslinya ada di backup legacy.`);
        log('warn', 'STORAGE_CORRUPT', { during: 'migration', key: name, reason: parsed.reason });
      }
    }

    for (const [name, clean] of Object.entries({ jadwal: schedulesClean, kategori: categoriesClean, audio: audioClean })) {
      if (clean.dropped > 0) {
        warnings.push(`${clean.dropped} baris data "${name}" tidak valid dan dilewati.`);
        log('warn', 'STORAGE_CORRUPT', { during: 'migration', key: name, reason: 'invalid-rows', dropped: clean.dropped });
      }
    }

    // Blob URLs cannot survive migration (BS-3). Keep the record, drop the URL.
    let audioValue = null;
    if (Array.isArray(audioClean.value)) {
      audioValue = audioClean.value.map((item) => {
        const copy = { ...item };
        if (typeof copy.customAudioUrl === 'string' && copy.customAudioUrl.startsWith('blob:')) {
          delete copy.customAudioUrl;
        }
        return copy;
      });
      const dropped = audioClean.value.filter((i) => i && typeof i.customAudioUrl === 'string' && i.customAudioUrl.startsWith('blob:')).length;
      if (dropped > 0) warnings.push(`${dropped} berkas audio kustom tidak dapat dipulihkan dari localStorage dan perlu diunggah ulang.`);
    }

    // BS-6 repair (Stage A §4.4 R-1): syncMeta is authoritative for the replay basis.
    let snapshotValue = lastImport.value;
    let metaValue = syncMeta.value;
    if (snapshotValue && metaValue && snapshotValue.fileName !== metaValue.lastSourceFileName) {
      warnings.push('Sumber sinkronisasi dan jadwal tidak cocok; sumber lama (dari metadata) dipertahankan.');
      snapshotValue = null;
    }
    if (metaValue && typeof metaValue === 'object') {
      metaValue = { lastSyncedAt: metaValue.lastSyncedAt ?? null, lastSourceFileName: metaValue.lastSourceFileName ?? null };
    }

    // WRITING (fixed order, Stage A §10.3)
    // Only aggregates that actually have legacy content are written. A user who
    // never imported an Excel file legitimately has no lastImportSource, so
    // verification must not demand that every file exists.
    const written = [];
    if (settings.value && typeof settings.value === 'object' && !Array.isArray(settings.value)) {
      persistAggregate('settings', settings.value);
      written.push('settings');
    }
    if (Array.isArray(categoriesClean.value)) { persistAggregate('categories', categoriesClean.value); written.push('categories'); }
    if (Array.isArray(audioValue)) { persistAggregate('audioMetadata', audioValue); written.push('audioMetadata'); }
    persistAggregate('syncState', {
      schedules: Array.isArray(schedulesClean.value) ? schedulesClean.value : [],
      lastImportSource: snapshotValue,
      syncMeta: metaValue,
    });
    written.push('syncState');

    // VERIFYING (only what was written; syncState is always mandatory)
    for (const aggregate of written) {
      if (!fs.existsSync(dataPath(aggregate))) {
        throw fail('STORAGE_MIGRATION_FAILED', `Verifikasi migrasi gagal: ${aggregate} tidak tertulis.`);
      }
      const doc = readAggregate(aggregate);
      if (!isWellFormedAggregate(doc, aggregate)) {
        throw fail('STORAGE_MIGRATION_FAILED', `Verifikasi migrasi gagal: ${aggregate} tidak valid.`);
      }
    }

    writeMigration({
      state: 'COMMITTED', fromVersion: null, toVersion: CURRENT_SCHEMA_VERSION,
      startedAt: marker.startedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(), lastError: null, note: 'migrated',
      legacySnapshot: path.basename(legacySnapshot),
      legacyFingerprint: fingerprint,
    });

    // Reversible by construction: take a backup right after a successful migration.
    try {
      backupNow('post-migration');
    } catch (error) {
      warnings.push('Backup otomatis setelah migrasi gagal dibuat.');
      log('warn', 'BACKUP_FAILED', { during: 'post-migration', error: String(error && error.message) });
    }

    log('info', 'STORAGE_MIGRATION_OK', { note: 'migration-succeeded', warnings: warnings.length });
    return { state: 'CURRENT', migrated: true, firstRun: false, warnings };
  } catch (error) {
    const code = error && error.code === 'STORAGE_MIGRATION_FAILED' ? 'STORAGE_MIGRATION_FAILED' : 'STORAGE_MIGRATION_FAILED';
    try {
      const marker = readMigration();
      writeMigration({ ...marker, state: 'FAILED', lastError: String(error && error.message) });
    } catch { /* ignore */ }
    log('error', code, { error: String(error && error.message) });
    /* rethrown below */
    throw fail('STORAGE_MIGRATION_FAILED', 'Migrasi data gagal. Data lama Anda tetap aman di localStorage.', String(error && error.message));
  }
}

// ---------------------------------------------------------------------------
// Hydrate / public API
// ---------------------------------------------------------------------------

function hydrate(legacyPayload) {
  if (storageUnavailable) {
    return {
      ready: false, dataVersion: null, degraded: true,
      storageError: { code: storageUnavailable.code, message: storageUnavailable.message },
      syncState: null, settings: null, categories: null, audioMetadata: [], migration: { state: 'FAILED' }, warnings: [], firstRun: false,
    };
  }

  recoveredAggregates = new Set();
  corruptAggregates = new Set();

  const migration = runMigration(legacyPayload);
  const warnings = [...migration.warnings];

  const syncDoc = readAggregate('syncState', { heal: true });
  const settingsDoc = readAggregate('settings', { heal: true });
  const categoriesDoc = readAggregate('categories', { heal: true });
  const audioDoc = readAggregate('audioMetadata', { heal: true });

  refreshAudioIndex(audioDoc.value);

  if (corruptAggregates.size > 0) {
    warnings.push(
      `Data "${[...corruptAggregates].join(', ')}" rusak. Versi sebelumnya dipulihkan otomatis; berkas rusak disimpan di folder quarantine.`,
    );
  }

  return {
    ready: true,
    dataVersion: manifest.dataVersion,
    degraded: corruptAggregates.size > 0,
    storageError: null,
    syncState: syncDoc.value,
    settings: settingsDoc.value ? sanitizeSettings(settingsDoc.value) : settingsDoc.value,
    categories: Array.isArray(categoriesDoc.value) ? categoriesDoc.value : [],
    audioMetadata: Array.isArray(audioDoc.value) ? audioDoc.value : [],
    migration: { state: migration.state, warnings: migration.warnings },
    firstRun: migration.firstRun === true,
    warnings,
  };
}

function getAggregate(name) {
  if (storageUnavailable) throw storageUnavailable;
  if (!aggregateIsValid(name)) throw fail('STORAGE_INVALID_INPUT', 'Aggregate tidak dikenal.');
  const doc = readAggregate(name, { heal: true });
  // B5.1: hand the renderer only values it can safely consume. A document
  // written before the schema existed keeps its bytes on disk; the unusable
  // keys are simply absent here, so the renderer's defaults apply.
  if (name === 'settings' && doc.value) {
    return { ...doc, value: sanitizeSettings(doc.value) };
  }
  return doc;
}

function commitAggregate(name, value, expectedRevision) {
  // B5.1 F-01/F-02: validate BEFORE the write is queued so a rejected payload
  // never reaches the atomic-write engine and never advances a revision.
  if (name === 'settings') {
    const verdict = validateSettings(value);
    if (!verdict.ok) {
      // `details` is what `storage-ipc.cjs` forwards to the renderer, so the
      // UI can point at the offending field rather than guessing.
      const error = fail('STORAGE_INVALID_INPUT', verdict.message);
      error.details = { field: verdict.field };
      throw error;
    }
  }
  return enqueue(() => persistAggregate(name, value, expectedRevision));
}

function commitSyncState(payload, expectedRevision) {
  return enqueue(() => {
    if (!payload || typeof payload !== 'object') {
      throw fail('STORAGE_INVALID_INPUT', 'Data sinkronisasi tidak valid.');
    }
    const { schedules, lastImportSource, syncMeta } = payload;
    if (!Array.isArray(schedules)) throw fail('STORAGE_INVALID_INPUT', 'Jadwal tidak valid.');
    if (lastImportSource !== null && lastImportSource !== undefined && typeof lastImportSource !== 'object') {
      throw fail('STORAGE_INVALID_INPUT', 'Sumber sinkronisasi tidak valid.');
    }
    if (syncMeta !== null && syncMeta !== undefined && typeof syncMeta !== 'object') {
      throw fail('STORAGE_INVALID_INPUT', 'Metadata sinkronisasi tidak valid.');
    }
    return persistAggregate('syncState', { schedules, lastImportSource, syncMeta }, expectedRevision);
  });
}

function getMigrationStatus() {
  return readMigration();
}

function retryMigration(legacyPayload) {
  const marker = readMigration();
  if (marker.state !== 'FAILED') return { state: marker.state, warnings: [] };
  return runMigration(legacyPayload);
}

// ---------------------------------------------------------------------------
// Backup / restore (Stage A §12)
// ---------------------------------------------------------------------------

function buildPayload() {
  const entries = [];
  entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });

  const checksums = {};
  for (const aggregate of AGGREGATES) {
    const file = dataPath(aggregate);
    if (!fs.existsSync(file)) continue;
    const buffer = fs.readFileSync(file);
    entries.push({ name: `data/${aggregate}.json`, data: buffer });
    checksums[`data/${aggregate}.json`] = crc32(buffer);
  }

  if (fs.existsSync(dirs.audio)) {
    for (const entry of fs.readdirSync(dirs.audio)) {
      if (entry.endsWith('.prev')) continue;
      const full = path.join(dirs.audio, entry);
      if (!isInside(dirs.audio, full)) continue;
      const buffer = fs.readFileSync(full);
      entries.push({ name: `audio/${entry}`, data: buffer });
      checksums[`audio/${entry}`] = crc32(buffer);
    }
  }

  entries.push({ name: 'checksums.json', data: Buffer.from(JSON.stringify(checksums, null, 2), 'utf8') });
  return entries;
}

function backupNow(reason) {
  if (storageUnavailable) throw storageUnavailable;
  try {
    const entries = buildPayload();
    const archive = createZip(entries);
    if (archive.length > MAX_BACKUP_BYTES) {
      throw fail('BACKUP_FAILED', 'Ukuran backup melebihi batas.');
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dirs.backups, `backup-${stamp}.zip`);
    if (!isInside(dirs.backups, target)) throw fail('BACKUP_FAILED', 'Lokasi backup tidak valid.');
    atomicWrite(target, archive);
    log('info', 'BACKUP_OK', { reason: reason || 'manual', bytes: archive.length, file: path.basename(target) });
    return { path: target, file: path.basename(target), bytes: archive.length, createdAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw fail('BACKUP_FAILED', 'Gagal membuat backup.', String(error && error.message));
  }
}

function listBackups() {
  if (!fs.existsSync(dirs.backups)) return [];
  return fs.readdirSync(dirs.backups)
    .filter((f) => f.startsWith('backup-') && f.endsWith('.zip'))
    .map((file) => {
      const full = path.join(dirs.backups, file);
      let size = 0;
      try { size = fs.statSync(full).size; } catch { /* ignore */ }

      // Cheap integrity probe so the UI can hide unusable archives.
      let valid = false;
      let dataVersion = null;
      try {
        const entries = readZip(fs.readFileSync(full));
        validateArchive(entries);
        const manifestEntry = entries.find((e) => e.name === 'manifest.json');
        if (manifestEntry) {
          const parsed = JSON.parse(manifestEntry.data.toString('utf8'));
          dataVersion = Number.isInteger(parsed.dataVersion) ? parsed.dataVersion : null;
        }
        valid = true;
      } catch { /* invalid archive stays listed but flagged */ }

      return { file, path: full, bytes: size, valid, dataVersion };
    })
    .sort((a, b) => (a.file < b.file ? 1 : -1));
}

function validateArchive(entries) {
  const checksumsEntry = entries.find((e) => e.name === 'checksums.json');
  if (!checksumsEntry) throw fail('RESTORE_FAILED', 'Backup tidak valid: checksums.json hilang.');

  let checksums;
  try {
    checksums = JSON.parse(checksumsEntry.data.toString('utf8'));
  } catch {
    throw fail('RESTORE_FAILED', 'Backup tidak valid: checksums rusak.');
  }

  for (const entry of entries) {
    if (entry.name === 'checksums.json') continue;
    const expected = checksums[entry.name];
    if (expected === undefined) continue;
    if (crc32(entry.data) !== expected) {
      throw fail('RESTORE_FAILED', `Backup tidak valid: checksum ${entry.name} tidak cocok.`);
    }
  }

  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (!manifestEntry) throw fail('RESTORE_FAILED', 'Backup tidak valid: manifest hilang.');
  let backupManifest;
  try {
    backupManifest = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch {
    throw fail('RESTORE_FAILED', 'Backup tidak valid: manifest rusak.');
  }
  if (!Number.isInteger(backupManifest.dataVersion)) {
    throw fail('RESTORE_FAILED', 'Backup tidak valid: versi data tidak dikenal.');
  }
  if (backupManifest.dataVersion > CURRENT_SCHEMA_VERSION) {
    throw fail('STORAGE_UNSUPPORTED_VERSION', 'Backup dibuat oleh versi aplikasi yang lebih baru.');
  }
  return { checksums, manifest: backupManifest, entries };
}

function restore(backupFile, options = {}) {
  if (storageUnavailable) throw storageUnavailable;
  const dryRun = options.dryRun === true;

  const target = path.basename(String(backupFile || ''));
  if (!target.startsWith('backup-') || !target.endsWith('.zip')) {
    throw fail('STORAGE_INVALID_INPUT', 'Backup tidak dikenal.');
  }
  const full = path.join(dirs.backups, target);
  if (!isInside(dirs.backups, full)) throw fail('STORAGE_INVALID_INPUT', 'Lokasi backup tidak valid.');
  if (!fs.existsSync(full)) throw fail('RESTORE_FAILED', 'Berkas backup tidak ditemukan.');

  let entries;
  try {
    entries = readZip(fs.readFileSync(full));
  } catch (error) {
    throw fail('RESTORE_FAILED', 'Backup tidak dapat dibaca.', String(error && error.message));
  }

  const validated = validateArchive(entries);
  if (dryRun) {
    return {
      dryRun: true, dataVersion: validated.manifest.dataVersion,
      aggregates: entries.filter((e) => e.name.startsWith('data/')).map((e) => e.name),
      audio: entries.filter((e) => e.name.startsWith('audio/')).map((e) => e.name),
    };
  }

  // Make the restore reversible before touching anything.
  let safetyBackup = null;
  try {
    safetyBackup = backupNow('pre-restore');
  } catch (error) {
    throw fail('RESTORE_FAILED', 'Backup pengaman gagal dibuat; pemulihan dibatalkan.', String(error && error.message));
  }

  restoring = true;
  try {
    const staged = [];
    for (const entry of entries) {
      if (entry.name.startsWith('data/') || entry.name.startsWith('audio/')) {
        staged.push(entry);
      }
    }

    // STAGING: write everything to tmp first, verify, then swap.
    const stagedPaths = [];
    for (const entry of staged) {
      const dest = entry.name.startsWith('data/')
        ? path.join(dirs.data, path.basename(entry.name))
        : path.join(dirs.audio, path.basename(entry.name));
      if (!isInside(entry.name.startsWith('data/') ? dirs.data : dirs.audio, dest)) {
        throw fail('RESTORE_FAILED', `Entri backup di luar lokasi yang diizinkan: ${entry.name}`);
      }
      const tmpPath = path.join(dirs.tmp, `restore.${path.basename(dest)}.${Date.now()}`);
      const fd = fs.openSync(tmpPath, 'wx', 0o600);
      try {
        fs.writeSync(fd, entry.data, 0, entry.data.length, 0);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      stagedPaths.push({ tmpPath, dest });
    }

    // SWAP with rollback. Renaming straight over the live files can leave a torn
    // store if one rename fails, so the previous bytes are parked first and put
    // back if anything goes wrong.
    const undoDir = path.join(dirs.tmp, `undo.${Date.now()}`);
    const undo = [];
    fs.mkdirSync(undoDir, { recursive: true });

    try {
      for (const { tmpPath, dest } of stagedPaths) {
        let undoPath = null;
        if (fs.existsSync(dest)) {
          undoPath = path.join(undoDir, path.basename(dest));
          fs.renameSync(dest, undoPath);
        }
        undo.push({ dest, undoPath });
        fs.renameSync(tmpPath, dest);
      }
      fsyncDir(dirs.data);
      fsyncDir(dirs.audio);

      // VERIFY + rebuild manifest/revisions from the restored documents.
      for (const aggregate of AGGREGATES) {
        if (!fs.existsSync(dataPath(aggregate))) continue;
        const doc = readAggregate(aggregate);
        if (!isWellFormedAggregate(doc, aggregate)) {
          throw fail('RESTORE_FAILED', `Data yang dipulihkan tidak valid: ${aggregate}`);
        }
        manifest.aggregates[aggregate] = { revision: doc.revision, updatedAt: doc.updatedAt };
      }
      writeManifest();
      refreshAudioIndex(readAggregate('audioMetadata').value);
    } catch (swapError) {
      let rolledBack = 0;
      let rollbackFailures = 0;
      for (const { dest, undoPath } of undo) {
        try {
          if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
          if (undoPath && fs.existsSync(undoPath)) { fs.renameSync(undoPath, dest); rolledBack += 1; }
        } catch (rollbackError) {
          rollbackFailures += 1;
          log('error', 'RESTORE_FAILED', { during: 'rollback', file: path.basename(dest), error: String(rollbackError && rollbackError.message) });
        }
      }
      log('error', 'RESTORE_FAILED', { note: 'restore-rolled-back', rolledBack, rollbackFailures, error: String(swapError && swapError.message) });
      if (swapError instanceof StorageError) throw swapError;
      throw fail('RESTORE_FAILED', 'Pemulihan gagal dan data sebelumnya dikembalikan.', String(swapError && swapError.message));
    } finally {
      fs.rmSync(undoDir, { recursive: true, force: true });
    }

    const missingAudio = [];
    for (const entry of entries) {
      if (!entry.name.startsWith('audio/')) continue;
      const name = path.basename(entry.name);
      if (!fs.existsSync(path.join(dirs.audio, name))) missingAudio.push(name);
    }

    log('info', 'RESTORE_OK', { note: 'restore-completed', file: target, entries: staged.length, missingAudio: missingAudio.length });
    return {
      dryRun: false,
      dataVersion: validated.manifest.dataVersion,
      restored: staged.map((e) => e.name),
      missingAudio,
      safetyBackup: safetyBackup ? safetyBackup.file : null,
    };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw fail('RESTORE_FAILED', 'Pemulihan gagal.', String(error && error.message));
  } finally {
    restoring = false;
    cleanTmp();
  }
}

function exportBackup(destination) {
  if (storageUnavailable) throw storageUnavailable;
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) {
    throw fail('STORAGE_INVALID_INPUT', 'Lokasi tujuan tidak valid.');
  }
  if (isInside(root, destination)) {
    throw fail('STORAGE_INVALID_INPUT', 'Lokasi tujuan tidak boleh di dalam folder penyimpanan.');
  }
  try {
    const archive = createZip(buildPayload());
    atomicWriteExternal(destination, archive);
    log('info', 'BACKUP_OK', { note: 'export', file: path.basename(destination), bytes: archive.length });
    return { path: destination, bytes: archive.length };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw fail('BACKUP_FAILED', 'Gagal mengekspor backup.', String(error && error.message));
  }
}

module.exports = {
  CURRENT_SCHEMA_VERSION,
  AGGREGATES,
  // B5.1: published so main.cjs can hand the authoritative limits to the
  // sandboxed preload, which cannot require a sibling module itself.
  SETTINGS_LIMITS: LIMITS,
  ERROR_CODES,
  StorageError,
  initStore,
  hydrate,
  getAggregate,
  commitAggregate,
  commitSyncState,
  getMigrationStatus,
  retryMigration,
  backupNow,
  listBackups,
  restore,
  exportBackup,
  importAudio,
  readAudio,
  deleteAudio,
  gcAudio,
  drain,
  clearLock,
  isStaleLock,
  // test/introspection helpers
  _internal: { resolveRoot, sealAggregate, isWellFormedAggregate, sniffAudio, validateArchive, LEGACY_KEYS },
};
