const { contextBridge, ipcRenderer } = require('electron');

/**
 * B5.1 — the settings limits, handed over by the main process.
 *
 * The window runs with `sandbox: true`, so this preload cannot `require` a
 * sibling file; the main process passes the limits in as an extra command-line
 * argument instead. `electron/settings-schema.cjs` stays the single source of
 * truth and main.cjs serializes it from there.
 */
const LIMITS_PREFIX = '--school-bell-settings-limits=';
const LIMITS = (() => {
  const arg = process.argv.find((value) => typeof value === 'string' && value.startsWith(LIMITS_PREFIX));
  if (!arg) return null;
  try {
    return JSON.parse(decodeURIComponent(arg.slice(LIMITS_PREFIX.length)));
  } catch {
    return null;
  }
})();
const trayActions = new Set(['toggle-pause', 'test-bell', 'open-settings']);
const resumeReasons = new Set(['resume', 'unlock-screen']);

/**
 * F-03 Unit 1 — auto-start.
 *
 * Deliberately narrow: two named verbs and nothing else. No Electron API, no
 * raw `ipcRenderer`, no caller-supplied channel name. The renderer can ask
 * whether auto-start is usable and can request a state; it can never name an
 * OS capability itself. Both calls resolve to the F-03 status union instead of
 * rejecting, so the typed `errorCode` survives a failed round trip.
 */
const autoStartChannel = 'school-bell:autostart';
const autoStartVerbs = new Set(['get-status', 'set-enabled']);

function autoStartFallback(errorCode) {
  return Object.freeze({ supported: false, enabled: null, errorCode });
}

async function invokeAutoStart(verb, payload) {
  if (!autoStartVerbs.has(verb)) {
    return autoStartFallback('AUTOSTART_FORBIDDEN');
  }
  try {
    return await ipcRenderer.invoke(`${autoStartChannel}:${verb}`, payload);
  } catch {
    return autoStartFallback('AUTOSTART_BRIDGE_FAILED');
  }
}
const storageChannel = 'school-bell:storage';
const storageChannels = new Set([
  'hydrate', 'get-aggregate', 'get-migration-status', 'retry-migration',
  'commit-aggregate', 'commit-sync-state', 'drain',
  'audio-import', 'audio-read', 'audio-delete', 'audio-gc',
  'backup-now', 'backup-list', 'backup-restore', 'backup-export',
]);

/**
 * Storage bridge.
 *
 * Only the fixed verb allowlist below can reach the main process, and every call
 * resolves to the result envelope produced by `storage-ipc.cjs` so the renderer
 * can branch on a typed `error.code`. No path or raw filesystem handle is ever
 * accepted from the renderer.
 */
async function invokeStorage(verb, payload) {
  if (!storageChannels.has(verb)) {
    return { ok: false, error: { code: 'STORAGE_FORBIDDEN', message: 'Operasi penyimpanan tidak diizinkan.', details: null } };
  }
  try {
    return await ipcRenderer.invoke(`${storageChannel}:${verb}`, payload);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'STORAGE_BRIDGE_FAILED',
        message: error && error.message ? String(error.message) : 'Jembatan penyimpanan gagal.',
        details: null,
      },
    };
  }
}

contextBridge.exposeInMainWorld('schoolBellStorage', Object.freeze({
  isPersistent: true,
  // B5.1: the limits come from the same module the main process validates
  // against, so the renderer's UX bounds and the authority boundary cannot
  // drift apart. Read-only data, never a decision.
  settingsLimits: LIMITS,
  hydrate: (legacyPayload) => invokeStorage('hydrate', legacyPayload),
  getAggregate: (name) => invokeStorage('get-aggregate', { name }),
  getMigrationStatus: () => invokeStorage('get-migration-status'),
  retryMigration: (legacyPayload) => invokeStorage('retry-migration', legacyPayload),
  commitAggregate: (name, value, expectedRevision) =>
    invokeStorage('commit-aggregate', { name, value, expectedRevision: expectedRevision ?? null }),
  commitSyncState: (payload, expectedRevision) =>
    invokeStorage('commit-sync-state', { ...payload, expectedRevision: expectedRevision ?? null }),
  drain: () => invokeStorage('drain'),
  importAudio: (audio) => invokeStorage('audio-import', audio),
  readAudio: (audioId) => invokeStorage('audio-read', { audioId }),
  deleteAudio: (audioId) => invokeStorage('audio-delete', { audioId }),
  gcAudio: (referenced) => invokeStorage('audio-gc', { referenced }),
  backupNow: (reason) => invokeStorage('backup-now', { reason }),
  listBackups: () => invokeStorage('backup-list'),
  restore: (file, options) => invokeStorage('backup-restore', { file, dryRun: Boolean(options && options.dryRun) }),
  exportBackup: () => invokeStorage('backup-export'),
}));

contextBridge.exposeInMainWorld('schoolBellDesktop', Object.freeze({
  isDesktop: true,
  minimize: () => ipcRenderer.send('school-bell:window:minimize'),
  toggleMaximize: () => ipcRenderer.send('school-bell:window:toggle-maximize'),
  close: () => ipcRenderer.send('school-bell:window:close'),
  updateTrayStatus: (status) => {
    if (!status || typeof status.paused !== 'boolean') return;
    if (status.nextBellTime !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(status.nextBellTime)) return;
    ipcRenderer.send('school-bell:tray:update-status', {
      paused: status.paused,
      nextBellTime: status.nextBellTime,
    });
  },
  onTrayAction: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, action) => {
      if (trayActions.has(action)) listener(action);
    };
    ipcRenderer.on('school-bell:tray:action', handler);
    return () => ipcRenderer.removeListener('school-bell:tray:action', handler);
  },
  onAppResumed: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => {
      const reason = payload && typeof payload.reason === 'string' ? payload.reason : null;
      if (!reason || !resumeReasons.has(reason)) return;
      listener({ reason });
    };
    ipcRenderer.on('school-bell:app:resumed', handler);
    return () => ipcRenderer.removeListener('school-bell:app:resumed', handler);
  },
}));

/**
 * F-03 auto-start bridge.
 *
 * Separate from `schoolBellDesktop` and from storage: auto-start is an OS-level
 * capability, not a window control and not persisted data, and keeping it on
 * its own surface means Unit 2 can widen the main-process implementation
 * without this object ever growing a new capability.
 *
 * Note what is absent: no login-item accessor, no Electron `app`, no Node API,
 * and no way to pass a channel name. `setEnabled` forwards a boolean and
 * nothing else.
 */
contextBridge.exposeInMainWorld('schoolBellAutoStart', Object.freeze({
  isAutoStartBridge: true,
  getStatus: () => invokeAutoStart('get-status'),
  setEnabled: (enabled) => invokeAutoStart('set-enabled', { enabled: enabled === true }),
}));

/**
 * B7 Stage B-2 — Gemini BYOK credential bridge (D-1).
 *
 * Separate from storage and from auto-start because a credential is neither
 * application data nor an OS capability: it is a secret that this surface can
 * only ever *write*, never read back.
 *
 * Note what is absent, and why it matters:
 *
 * - no verb returns a key. `getStatus()` resolves to `{ configured, available }`,
 *   a shape with no field that could hold one. Masking a retrieved key with
 *   dots would still have shipped the plaintext to the renderer, so the key is
 *   never sent there at all.
 * - no raw `ipcRenderer`, no channel name from the caller, no `safeStorage`, no
 *   filesystem handle, no `fs`, and no path.
 * - the input string exists only as the argument to `setKey`; nothing keeps a
 *   copy on this side of the bridge.
 *
 * `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true` are
 * unchanged.
 */
const credentialChannel = 'school-bell:credentials';
const credentialVerbs = new Set(['get-gemini-status', 'set-gemini-key', 'delete-gemini-key']);

async function invokeCredential(verb, payload) {
  if (!credentialVerbs.has(verb)) {
    return {
      ok: false,
      error: {
        code: 'CREDENTIAL_FORBIDDEN',
        message: 'Operasi kredensial tidak diizinkan.',
        details: null,
      },
    };
  }
  try {
    return await ipcRenderer.invoke(`${credentialChannel}:${verb}`, payload);
  } catch {
    return {
      ok: false,
      error: {
        code: 'CREDENTIAL_BRIDGE_FAILED',
        message: 'Jembatan kredensial gagal.',
        details: null,
      },
    };
  }
}

contextBridge.exposeInMainWorld('schoolBellGemini', Object.freeze({
  isGeminiCredentialBridge: true,
  getStatus: () => invokeCredential('get-gemini-status'),
  setKey: (apiKey) => invokeCredential('set-gemini-key', { apiKey }),
  deleteKey: () => invokeCredential('delete-gemini-key'),
}));