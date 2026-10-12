'use strict';

/**
 * Electron stub harness for the F-04 lifecycle regression tests.
 *
 * `electron/main.cjs` is a CommonJS module that reaches straight into the
 * Electron runtime at require time and immediately registers its app/window
 * lifecycle handlers, so it cannot be loaded in a plain Node process without a
 * stand-in for `electron` and `node:child_process`. This module builds that
 * stand-in and loads the REAL main process against it, so the tests exercise the
 * shipped handlers rather than a copy of their logic.
 *
 * Everything is faked: no window is opened, no tray is added to a real desktop,
 * no backend is spawned, and no real storage root is touched unless the caller
 * asks for a throwaway one.
 *
 * Scope: F-04 only (tray restore path, close handling, `window-all-closed`,
 * `second-instance`, `before-quit` cleanup).
 *
 * B8.1: the spawn stub returns EventEmitter-based child handles (with a stdin
 * recorder and switchable fetch readiness) and the harness captures lifecycle
 * logs, so backend-supervision tests can drive the real `exit` listeners in
 * `b8-1-backend-supervision.test.cjs`.
 */

const Module = require('node:module');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const MAIN_PATH = path.join(PROJECT_ROOT, 'electron', 'main.cjs');

/** Minimal BrowserWindow double: records handler registrations and calls. */
class FakeBrowserWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.webContents = Object.assign(new EventEmitter(), {
      send: () => {},
      setWindowOpenHandler: () => {},
      isDestroyed: () => false,
    });
    this.destroyed = false;
    this.visible = options.show !== false;
    this.calls = [];
    FakeBrowserWindow.instances.push(this);
  }

  /** Records a call so tests can assert show/hide/focus/minimize happened. */
  #record(name) {
    this.calls.push(name);
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized === true; }
  isMaximized() { return false; }
  show() { this.#record('show'); this.visible = true; }
  hide() { this.#record('hide'); this.visible = false; }
  focus() { this.#record('focus'); }
  minimize() { this.#record('minimize'); this.minimized = true; }
  restore() { this.#record('restore'); this.minimized = false; }

  destroy() {
    this.#record('destroy');
    if (this.destroyed) return;
    this.destroyed = true;
    this.visible = false;
    // Electron emits `closed` synchronously from destroy() and does NOT emit
    // `close`. Mirroring that is what makes the stale-`closed`-event ordering
    // in `recoverRenderer` and `second-instance` observable here.
    this.emit('closed');
  }

  loadURL(url) {
    this.#record('loadURL');
    if (FakeBrowserWindow.rejectLoad) return Promise.reject(FakeBrowserWindow.rejectLoad);
    return Promise.resolve();
  }
}

/** Minimal Tray double; `destroyed` is flipped by tests to reach case C. */
class FakeTray extends EventEmitter {
  static instances = [];

  constructor(iconPath) {
    super();
    this.iconPath = iconPath;
    this.destroyed = false;
    this.tooltip = null;
    this.contextMenuTemplate = null;
    FakeTray.instances.push(this);
  }

  isDestroyed() { return this.destroyed; }
  setToolTip(value) { this.tooltip = value; }
  setContextMenu(menu) { this.contextMenuTemplate = menu.template; }
  setImage() {}
  destroy() { this.destroyed = true; }
}

/**
 * Build a fresh stub environment and load `electron/main.cjs` against it.
 *
 * `options.throwOnTrayCreate` forces the tray-construction failure branch.
 * `options.rejectLoadURL` makes `loadURL` reject, to prove the restore path
 * reports the failure instead of leaving an unhandled rejection.
 */
function loadMainProcess(options = {}) {
  FakeBrowserWindow.instances = [];
  FakeBrowserWindow.rejectLoad = options.rejectLoadURL || null;
  FakeTray.instances = [];

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-bell-f04-'));
  const documentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-bell-f04-docs-'));

  const app = new EventEmitter();
  Object.assign(app, {
    isPackaged: false,
    quitCalls: 0,
    dialogs: [],
    _quitResolve: null,
    quit() {
      app.quitCalls += 1;
      // Model Electron: `quit()` fires `before-quit` on the way out.
      app.emit('before-quit');
    },
    exit() {},
    getAppPath: () => PROJECT_ROOT,
    getVersion: () => '0.0.0-f04-test',
    getPath: (name) => {
      if (name === 'userData') return userDataDir;
      if (name === 'documents') return documentsDir;
      return os.tmpdir();
    },
    requestSingleInstanceLock: () => true,
    whenReady: () => readyPromise.promise,
  });

  let resolveReady;
  const readyPromise = {
    promise: new Promise((resolve) => { resolveReady = resolve; }),
  };
  app._resolveReady = () => resolveReady();

  const dialog = {
    showErrorBox: (title, content) => { app.dialogs.push({ title, content }); },
  };

  const ipcHandlers = new Map();
  const ipcMain = {
    on: (channel, handler) => { ipcHandlers.set(channel, handler); },
    handle: (channel, handler) => { ipcHandlers.set(channel, handler); },
    removeHandler: (channel) => { ipcHandlers.delete(channel); },
  };

  const powerMonitor = new EventEmitter();
  const powerSaveBlockerCalls = { start: [], stop: [] };
  let nextBlockerId = 1;
  const powerSaveBlocker = {
    start: (type) => { const id = nextBlockerId; nextBlockerId += 1; powerSaveBlockerCalls.start.push(type); return id; },
    stop: (id) => { powerSaveBlockerCalls.stop.push(id); },
    isStarted: () => true,
  };

  class StubTray extends FakeTray {
    constructor(iconPath) {
      if (options.throwOnTrayCreate) throw new Error('F-04 stub: tray host unavailable');
      super(iconPath);
    }
  }

  const electronStub = {
    app, BrowserWindow: FakeBrowserWindow, dialog, ipcMain,
    Menu: { buildFromTemplate: (template) => ({ template }) },
    powerMonitor, powerSaveBlocker, Tray: StubTray,
  };

  const spawnCalls = [];
  // B8.1: the child handles themselves (EventEmitter-based), so supervision
  // tests can observe/emit `exit` on the real listeners main.cjs attaches.
  const spawnedChildren = [];
  const spawnControls = {
    // When true, every spawn after the first dies on the next event-loop turn —
    // the bounded-retry test's "restart never becomes healthy" simulator.
    autoExitRestarts: false,
    // Mirrors waitForBackend's fetch result.
    backendReady: true,
  };
  const childProcessStub = {
    spawn: (command, args, spawnOptions) => {
      spawnCalls.push({ command, args, options: spawnOptions });
      const child = new EventEmitter();
      child.pid = spawnCalls.length;
      child.exitCode = null;
      child.killed = false;
      child.stdin = {
        destroyed: false,
        writes: [],
        on() {},
        write(data) { child.stdin.writes.push(String(data)); },
      };
      child.kill = function () {
        if (this.exitCode !== null) return;
        this.killed = true;
        this.exitCode = 0;
        // Real children emit `exit` asynchronously after kill(); modeling that
        // keeps the isQuitting guard ordering observable.
        queueMicrotask(() => this.emit('exit', 0, null));
      };
      spawnedChildren.push(child);
      if (spawnControls.autoExitRestarts && spawnedChildren.length > 1) {
        setImmediate(() => {
          if (child.exitCode === null) {
            child.exitCode = 1;
            child.emit('exit', 1, null);
          }
        });
      }
      return child;
    },
  };

  const realLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (request === 'node:child_process') return childProcessStub;
    return realLoad.apply(this, arguments);
  };

  // `waitForBackend()` polls with fetch; answering "ready" keeps the boot chain
  // deterministic and instant instead of waiting out its 30s deadline. The stub
  // must stay installed until cleanup() — restoring it right after require()
  // would leave the boot chain retrying a real connection to 127.0.0.1:3100.
  // B8.1: readiness is switchable so a restart can be driven to failure.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    if (!spawnControls.backendReady) throw new Error('f04-harness: backend not ready');
    return { ok: true };
  };

  // B8.1: capture lifecycle logging so supervision tests can assert on the
  // distinguishable states (unexpected death / restart attempt / exhaustion)
  // without depending on stdout formatting.
  const logs = [];
  const realConsoleLog = console.log;
  const realConsoleError = console.error;
  const wrappedLog = (...args) => { logs.push(args.map(String).join(' ')); };
  const wrappedError = (...args) => { logs.push(args.map(String).join(' ')); };
  console.log = wrappedLog;
  console.error = wrappedError;

  const realStorage = require.cache[require.resolve('../storage.cjs')];
  const realStorageIpc = require.cache[require.resolve('../storage-ipc.cjs')];

  try {
    delete require.cache[require.resolve(MAIN_PATH)];
    delete require.cache[require.resolve('../storage.cjs')];
    delete require.cache[require.resolve('../storage-ipc.cjs')];
    require(MAIN_PATH);
  } finally {
    Module._load = realLoad;
  }

  const storageModule = require.cache[require.resolve('../storage.cjs')];
  const storageExports = storageModule ? storageModule.exports : null;

  /** Unhandled rejections observed from here on. */
  const unhandledRejections = [];
  const onUnhandled = (reason) => { unhandledRejections.push(reason); };
  process.on('unhandledRejection', onUnhandled);

  async function boot() {
    app._resolveReady();
    // Two microtask/macrotask turns: whenReady -> storage init -> spawn ->
    // waitForBackend -> createWindow -> createTray -> await window load.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  function cleanup() {
    process.off('unhandledRejection', onUnhandled);
    globalThis.fetch = realFetch;
    // Restore only our own wrappers so a nested/concurrent env cannot clobber
    // someone else's capture.
    if (console.log === wrappedLog) console.log = realConsoleLog;
    if (console.error === wrappedError) console.error = realConsoleError;
    delete require.cache[require.resolve(MAIN_PATH)];
    delete require.cache[require.resolve('../storage.cjs')];
    delete require.cache[require.resolve('../storage-ipc.cjs')];
    if (realStorage) require.cache[require.resolve('../storage.cjs')] = realStorage;
    if (realStorageIpc) require.cache[require.resolve('../storage-ipc.cjs')] = realStorageIpc;
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(documentsDir, { recursive: true, force: true });
  }

  return {
    app, storageExports, spawnCalls, powerSaveBlockerCalls, unhandledRejections,
    ipcHandlers,
    windows: FakeBrowserWindow.instances,
    trays: FakeTray.instances,
    window: () => FakeBrowserWindow.instances[FakeBrowserWindow.instances.length - 1],
    tray: () => FakeTray.instances[FakeTray.instances.length - 1] || null,
    /** Make subsequent `loadURL` calls succeed or reject. */
    setLoadRejection(error) { FakeBrowserWindow.rejectLoad = error; },
    // B8.1 supervision-test surface.
    spawnedChildren,
    logs,
    setBackendReady(value) { spawnControls.backendReady = value; },
    setAutoExitRestarts(value) { spawnControls.autoExitRestarts = value; },
    boot, cleanup,
    storageRoot: userDataDir,
  };
}

/** Build a fake `close` event and report whether the default was prevented. */
function makeCloseEvent() {
  let prevented = false;
  return {
    preventDefault() { prevented = true; },
    wasPrevented: () => prevented,
  };
}

/** Find a tray context-menu item by label. */
function trayMenuItem(tray, label) {
  if (!tray || !tray.contextMenuTemplate) return null;
  return tray.contextMenuTemplate.find((item) => item && item.label === label) || null;
}

module.exports = {
  FakeBrowserWindow,
  FakeTray,
  PROJECT_ROOT,
  MAIN_PATH,
  loadMainProcess,
  makeCloseEvent,
  trayMenuItem,
};
