'use strict';

/**
 * F-03 Unit 1 test harness.
 *
 * Loads the REAL `electron/preload.cjs` and the REAL
 * `electron/autostart-ipc.cjs` against a minimal Electron stand-in, then wires
 * `ipcRenderer.invoke` straight through to the `ipcMain` handlers the main
 * process registered. That makes the whole renderer → preload → IPC →
 * main-process path testable in plain Node, so the assertions can be about the
 * actual channel names and payload shapes rather than about a reimplementation.
 *
 * Scope: the F-03 contract and bridge only. Nothing here starts a window, adds
 * a tray, spawns a backend, or touches a real settings store.
 *
 * No login-item / OS boot API is invoked or stubbed anywhere in this harness —
 * Unit 1 does not implement one, and the tests must not imply otherwise.
 */

const Module = require('node:module');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PRELOAD_PATH = path.join(PROJECT_ROOT, 'electron', 'preload.cjs');
const AUTOSTART_PATH = path.join(PROJECT_ROOT, 'electron', 'autostart-ipc.cjs');
const SCHEMA_PATH = path.join(PROJECT_ROOT, 'electron', 'settings-schema.cjs');
const SYNC_PATH = path.join(PROJECT_ROOT, 'electron', 'autostart-sync.cjs');

const REAL_PLATFORM = process.platform;
const REAL_EXEC_PATH = process.execPath;

/**
 * Build a Windows login-item double backed by a registry-shaped store.
 *
 * Models the real semantics that matter for these tests: one entry keyed by
 * executable path plus arguments (the Windows Run entry), so a repeated write
 * with identical options updates that single entry instead of accumulating
 * more. It does NOT model Windows itself and proves nothing about boot
 * behaviour — it exists so the module's *use* of the Electron API can be
 * observed.
 *
 * @param {object} config
 * @param {boolean} [config.openAtLogin] initial observed OS state
 * @param {Error}   [config.throwOnGet] make the read API throw
 * @param {Error}   [config.throwOnSet] make the write API throw
 * @param {unknown} [config.malformedGet] return this instead of a valid reply
 * @param {boolean} [config.ignoreWrites] accept writes without changing state
 * @param {number}  [config.throwOnGetAfterCall] succeed for the first N reads,
 *   then throw — models a write that lands but cannot be read back
 * @param {boolean} [config.noApi] omit the login-item methods entirely
 */
function makeLoginItemStub(config = {}) {
  const entries = new Map();
  const calls = { get: [], set: [] };
  const initialOpenAtLogin = config.openAtLogin === true;
  // Named distinctly from the per-call argument the API receives, so stub
  // behaviour is never shadowed by the settings object under test.
  const keyFor = (settings) =>
    `${(settings && settings.path) || ''}|${((settings && settings.args) || []).join(' ')}`;

  if (!config.noApi) {
    const api = {
      getLoginItemSettings(options) {
        calls.get.push({ options: options === undefined ? null : { ...options } });
        if (config.throwOnGet) throw config.throwOnGet;
        if (
          typeof config.throwOnGetAfterCall === 'number' &&
          calls.get.length > config.throwOnGetAfterCall
        ) {
          throw new Error('verification read failed');
        }
        if ('malformedGet' in config) return config.malformedGet;
        const found = entries.get(keyFor(options));
        const openAtLogin = found === undefined ? initialOpenAtLogin : found;
        return {
          openAtLogin,
          executableWillLaunchAtLogin: openAtLogin,
          wasOpenedAtLogin: false,
          launchItems: [],
        };
      },
      setLoginItemSettings(settings) {
        calls.set.push({ ...settings });
        if (config.throwOnSet) throw config.throwOnSet;
        if (config.ignoreWrites) return;
        // A Run entry with openAtLogin:false removes the launch registration.
        entries.set(keyFor(settings), settings.openAtLogin === true);
      },
    };
    return {
      ...api,
      calls,
      entries,
      state: { get openAtLogin() { return initialOpenAtLogin; } },
    };
  }

  return { calls, entries, state: { get openAtLogin() { return initialOpenAtLogin; } } };
}

/**
 * Load the preload + auto-start IPC against a stub Electron.
 *
 * @param {object} options
 * @param {string} [options.platform] value to report as `process.platform`
 * @param {boolean} [options.isPackaged] value for `app.isPackaged`
 * @param {boolean} [options.trusted] whether the sender guard accepts the caller
 * @param {string} [options.execPath] value for `process.execPath`
 * @param {object} [options.loginItem] passed to `makeLoginItemStub`
 */
function loadAutoStartSurface(options = {}) {
  const platform = options.platform || REAL_PLATFORM;
  const isPackaged = options.isPackaged === true;
  const execPath = options.execPath || REAL_EXEC_PATH;
  const loginItem = makeLoginItemStub(options.loginItem || {});

  /** Globals the preload tried to expose, keyed by name. */
  const exposed = Object.create(null);
  /** channel -> handler, mirroring ipcMain.handle registration. */
  const handlers = new Map();
  /** Every invoke the renderer bridge attempted, in order. */
  const invokeLog = [];

  const contextBridge = {
    exposeInMainWorld(name, api) {
      exposed[name] = api;
    },
  };

  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    on() {},
  };

  const app = { isPackaged };
  // Present only when the double provides them, so `noApi` can model an
  // Electron build without the login-item API at all.
  if (loginItem.getLoginItemSettings) app.getLoginItemSettings = loginItem.getLoginItemSettings;
  if (loginItem.setLoginItemSettings) app.setLoginItemSettings = loginItem.setLoginItemSettings;

  const electronStub = { contextBridge, ipcMain, app };

  const ipcRenderer = {
    send() {},
    on() {},
    removeListener() {},
    /**
     * Dispatch straight into the registered main-process handler, so the
     * assertion sees the real channel string and the real returned value.
     */
    async invoke(channel, payload) {
      invokeLog.push({ channel, payload });
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler registered for ${channel}`);
      return handler({ sender: 'test-sender' }, payload);
    },
  };
  electronStub.ipcRenderer = ipcRenderer;

  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return electronStub;
    return realLoad.apply(this, arguments);
  };

  const restoreGlobals = () => {
    Module._load = realLoad;
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true });
    Object.defineProperty(process, 'execPath', { value: REAL_EXEC_PATH, configurable: true });
  };
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  Object.defineProperty(process, 'execPath', { value: execPath, configurable: true });

  try {
    delete require.cache[require.resolve(PRELOAD_PATH)];
    delete require.cache[require.resolve(AUTOSTART_PATH)];
    require(PRELOAD_PATH);
    const autostart = require(AUTOSTART_PATH);
    // Register exactly as main.cjs does, with the same sender-guard shape.
    autostart.registerAutoStartIpc(() => options.trusted !== false);
    return {
      exposed,
      handlers,
      invokeLog,
      autostart,
      ipcRenderer,
      contextBridge,
      loginItem,
      platform,
      isPackaged,
      execPath,
      cleanup() {
        restoreGlobals();
        delete require.cache[require.resolve(PRELOAD_PATH)];
        delete require.cache[require.resolve(AUTOSTART_PATH)];
      },
    };
  } catch (error) {
    restoreGlobals();
    throw error;
  }
}

/** The B5.1 settings validator, loaded outside any Electron stub. */
function loadSettingsSchema() {
  return require(SCHEMA_PATH);
}

/** Shape guard mirroring the renderer's `isAutoStartStatus`. */
function looksLikeAutoStartStatus(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.supported === true) return typeof value.enabled === 'boolean';
  if (value.supported === false) {
    return value.enabled === null && typeof value.errorCode === 'string';
  }
  return false;
}

/**
 * A storage double for the Unit 2B synchronization seam.
 *
 * `commitAggregate` is deliberately present even though the real
 * `getAggregate` return value carries no write function: the sync module is
 * expected to receive this whole object, so a tripwire here proves the sync code
 * *chooses* never to write — which is a stronger claim than the function simply
 * not being wired up.
 *
 * @param {object} [options]
 * @param {boolean} [options.autoStartWindows] the persisted preference
 * @param {Error}   [options.throwOnGet] make the read fail like a broken store
 * @param {*}       [options.rawValue] override the aggregate `value` verbatim
 */
function makeStorageStub(options = {}) {
  const writes = [];
  const value = 'rawValue' in options ? options.rawValue : { autoStartWindows: options.autoStartWindows };

  return {
    writes,
    getAggregate(name) {
      if (name !== 'settings') throw new Error(`unexpected aggregate ${name}`);
      if (options.throwOnGet) throw options.throwOnGet;
      return { schemaVersion: 1, revision: 7, updatedAt: null, checksum: null, value };
    },
    // Tripwire. Any call here is a §10 violation.
    commitAggregate(name, next) {
      writes.push({ name, next });
      return { revision: 8 };
    },
  };
}

/**
 * Load `autostart-sync.cjs` wired to a stubbed Electron and a stubbed store.
 *
 * The OS seam is the *real* `autostart-ipc.cjs` module running against the
 * login-item double, so these tests exercise the genuine F-03 write path and can
 * count real OS calls rather than stubbing the count itself.
 */
function loadAutoStartSync(options = {}) {
  const surface = loadAutoStartSurface(options);
  const storage = options.storage || makeStorageStub(options);
  delete require.cache[require.resolve(SYNC_PATH)];
  const sync = require(SYNC_PATH);

  return {
    ...surface,
    storage,
    sync,
    /** Run one synchronization pass against these seams. */
    run(overrides) {
      return sync.synchronize({ storage, autostart: surface.autostart, ...(overrides || {}) });
    },
    /** Total OS writes issued through the real F-03 write path. */
    osWriteCount() {
      return surface.loginItem.calls.set.length;
    },
    /** Total OS reads issued through the real F-03 read path. */
    osReadCount() {
      return surface.loginItem.calls.get.length;
    },
  };
}

module.exports = {
  PROJECT_ROOT,
  CHANNEL: 'school-bell:autostart',
  loadAutoStartSurface,
  loadAutoStartSync,
  makeLoginItemStub,
  makeStorageStub,
  loadSettingsSchema,
  looksLikeAutoStartStatus,
};