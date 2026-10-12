/**
 * Storage IPC surface (Stage A §11).
 *
 * Every handler is guarded by the main-window sender check, runs inside the
 * storage module's serial write queue, and returns a plain result envelope
 * (`{ ok: true, value }` / `{ ok: false, error }`) so the renderer can read a
 * typed error code instead of parsing a mangled "Error invoking remote method"
 * string.
 *
 * The renderer never receives an arbitrary filesystem path and cannot pass one
 * in: export destinations come from a main-process save dialog, and restore
 * accepts only a bare backup filename that the storage module re-validates.
 */
const { ipcMain, dialog, app } = require('electron');
const path = require('node:path');

const storage = require('./storage.cjs');

const CHANNEL = 'school-bell:storage';

function toEnvelope(run) {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: (error && error.code) || 'STORAGE_UNKNOWN',
        message: (error && error.message) || 'Penyimpanan gagal.',
        details: (error && error.details) || null,
      },
    };
  }
}

function toEnvelopeAsync(run) {
  return Promise.resolve()
    .then(run)
    .then((value) => ({ ok: true, value }))
    .catch((error) => toEnvelope(() => { throw error; }));
}

/** Normalises a renderer payload into a Buffer without trusting its type. */
function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input));
  if (ArrayBuffer.isView(input)) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  return null;
}

function registerStorageIpc(isTrustedSender) {
  const handle = (suffix, run, options = {}) => {
    ipcMain.handle(`${CHANNEL}:${suffix}`, async (event, payload) => {
      if (!isTrustedSender(event)) {
        return { ok: false, error: { code: 'STORAGE_FORBIDDEN', message: 'Sumber tidak diizinkan.', details: null } };
      }
      return toEnvelopeAsync(() => run(payload, options));
    });
  };

  // ---- lifecycle / read -------------------------------------------------
  handle('hydrate', (payload) => {
    const legacy = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    return storage.hydrate(legacy);
  });

  handle('get-aggregate', (payload) => storage.getAggregate(payload && payload.name));

  handle('get-migration-status', () => storage.getMigrationStatus());

  handle('retry-migration', (payload) => {
    const legacy = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    return storage.retryMigration(legacy);
  });

  // ---- write ------------------------------------------------------------
  handle('commit-aggregate', (payload) => storage.commitAggregate(
    payload && payload.name,
    payload ? payload.value : undefined,
    payload ? payload.expectedRevision ?? null : null,
  ));

  handle('commit-sync-state', (payload) => {
    const body = payload && typeof payload === 'object' ? payload : {};
    return storage.commitSyncState(body, body.expectedRevision ?? null);
  });

  handle('drain', () => storage.drain());

  // ---- audio ------------------------------------------------------------
  handle('audio-import', (payload) => {
    const body = payload && typeof payload === 'object' ? payload : {};
    return storage.importAudio({
      audioId: body.audioId,
      bytes: toBuffer(body.bytes),
      mime: typeof body.mime === 'string' ? body.mime : '',
      ext: typeof body.ext === 'string' ? body.ext : '',
    });
  });

  handle('audio-read', (payload) => storage.readAudio(payload && payload.audioId));

  handle('audio-delete', (payload) => storage.deleteAudio(payload && payload.audioId));

  handle('audio-gc', (payload) => {
    const referenced = payload && Array.isArray(payload.referenced) ? payload.referenced : [];
    return storage.gcAudio(referenced);
  });

  // ---- backup / restore -------------------------------------------------
  handle('backup-now', (payload) => {
    const reason = payload && typeof payload.reason === 'string' ? payload.reason.slice(0, 40) : 'manual';
    return storage.backupNow(reason);
  });

  handle('backup-list', () => storage.listBackups());

  handle('backup-restore', (payload) => {
    if (!payload || typeof payload.file !== 'string') throw new Error('invalid backup file');
    return storage.restore(path.basename(payload.file), { dryRun: payload.dryRun === true });
  });

  handle('backup-export', async () => {
    // The renderer cannot supply a path: main owns the file chooser.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const result = await dialog.showSaveDialog({
      title: 'Ekspor Backup School Bell',
      defaultPath: path.join(app.getPath('documents'), `school-bell-backup-${stamp}.zip`),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return { canceled: false, ...storage.exportBackup(result.filePath) };
  });
}

function unregisterStorageIpc() {
  for (const suffix of [
    'hydrate', 'get-aggregate', 'get-migration-status', 'retry-migration',
    'commit-aggregate', 'commit-sync-state', 'drain',
    'audio-import', 'audio-read', 'audio-delete', 'audio-gc',
    'backup-now', 'backup-list', 'backup-restore', 'backup-export',
  ]) {
    ipcMain.removeHandler(`${CHANNEL}:${suffix}`);
  }
}

module.exports = { registerStorageIpc, unregisterStorageIpc, CHANNEL };
