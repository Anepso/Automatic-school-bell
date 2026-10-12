const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  powerMonitor,
  powerSaveBlocker,
  Tray,
} = require('electron');
const path = require("path");

// B7 B-3: identity & legacy userData pin (no migration)
if (typeof app.setPath === "function") {
  try { app.setPath("userData", path.join(app.getPath("appData"), "react-example")); } catch (e) {}
}
if (typeof app.setAppUserModelId === "function") {
  try { app.setAppUserModelId("com.anepso.schoolbell"); } catch (e) {}
}

const { spawn } = require('node:child_process');
const storage = require('./storage.cjs');
const { registerStorageIpc, unregisterStorageIpc } = require('./storage-ipc.cjs');
// F-03: main.cjs only wires the auto-start contract onto its own channels. The
// OS read/write itself lives in `electron/autostart-ipc.cjs`, which Unit 2A
// filled in using Electron's supported login-item API.
const { registerAutoStartIpc } = require('./autostart-ipc.cjs');
// F-03 Unit 2C: boot reconciliation only. The decision logic lives in
// `autostart-sync.cjs`; this runs it once, after storage readiness and inside
// `app.whenReady()`, and cannot abort boot.
const { reconcileOnBoot } = require('./autostart-boot.cjs');
// B7 Stage B-2 (D-1 BYOK): the renderer can hand in a Gemini key and ask whether
// one exists, and nothing else. `safeStorage` and the credential file are reached
// only from here in the main process.
const geminiCredentialStore = require('./gemini-credential-store.cjs');
const {
  registerGeminiCredentialIpc,
  unregisterGeminiCredentialIpc,
} = require('./gemini-credential-ipc.cjs');

const backendHost = '127.0.0.1';
// Port stays 3100 by default; the override exists for isolated verification
// runs and deployments that must avoid a specific port.
const backendPort = Number(process.env.SCHOOL_BELL_BACKEND_PORT) || 3100;
const backendUrl = `http://${backendHost}:${backendPort}`;
const isProduction = app.isPackaged || process.argv.includes('--production');
const projectRoot = app.getAppPath();

// B7 Stage B-1 (F-01/F-02/F-03) — production runtime foundation.
//
// The backend used to be started as `node.exe node_modules/tsx/dist/cli.mjs
// server.ts`. That made a packaged Windows install require a system Node on
// PATH and a `devDependency` inside the shipped tree, and it transitively
// required `esbuild`'s platform-specific binary (`@esbuild/linux-x64`) — none
// of which can exist on a user's Windows machine.
//
// The backend is now pre-bundled to `dist-electron/backend.cjs` and run by
// Electron's own runtime: `process.execPath` is the packaged `School Bell.exe`
// itself, and `ELECTRON_RUN_AS_NODE=1` makes that binary behave as plain Node
// with no extra software installed. Same process-isolation guarantees as before
// — the backend still dies independently, so `waitForBackend()` and
// `stopBackend()` keep their meaning.
const backendEntry = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'backend.cjs')
  : path.join(projectRoot, 'dist-electron', 'backend.cjs');

const MAX_RENDERER_RECOVERIES = 3;
const resumeReasons = new Set(['resume', 'unlock-screen']);

// B8.1 — bounded backend supervision after a successful first start.
//
// The counter tracks CONSECUTIVE restart attempts: it resets only when a
// restarted backend actually reaches readiness (see restartBackend), so a
// backend that boots and later dies always begins a fresh sequence, while a
// backend that dies before ever becoming healthy exhausts the limit and stops.
const MAX_BACKEND_RESTARTS = 3;
const BACKEND_RESTART_DELAY_MS = 1000;

let mainWindow = null;
let backendProcess = null;
// The child stopBackend() is about to kill outside of application shutdown —
// only the restart-failure path does that, so its later `exit` event must not
// be logged (or scheduled) as an unexpected death.
let intentionallyStoppedBackend = null;
let backendRestartCount = 0;
let backendRestartTimer = null;
let backendRestartInFlight = false;
let backendRestartLimitLogged = false;
let tray = null;
let isQuitting = false;
let trayStatus = { paused: false, nextBellTime: null };
let powerBlockerId = null;
let rendererRecoveryCount = 0;
let storageReady = false;
let storageInitError = null;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForBackend() {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    if (backendProcess.exitCode !== null) {
      throw new Error(`Backend stopped before becoming ready (exit ${backendProcess.exitCode}).`);
    }

    try {
      const response = await fetch(backendUrl);
      if (response.ok) return;
    } catch {
      // The local Express/Vite server is still starting.
    }

    await delay(250);
  }

  throw new Error('Timed out waiting for the local School Bell server.');
}

function startBackend() {
  // `process.execPath`, not `node.exe`: a packaged Windows app must never depend
  // on Node being installed. `ELECTRON_RUN_AS_NODE` switches the Electron binary
  // into plain-Node mode. In development `process.execPath` is the Electron
  // binary too, so there is one code path for both environments.
  backendProcess = spawn(process.execPath, [backendEntry], {
    cwd: app.isPackaged ? process.resourcesPath : projectRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ...(app.isPackaged
        ? {
            NODE_PATH: path.join(
              process.resourcesPath,
              'app.asar.unpacked',
              'node_modules'
            ),
          }
        : {}),
      HOST: backendHost,
      NODE_ENV: isProduction ? 'production' : 'development',
      PORT: String(backendPort),
      // The backend resolves `dist/` from this rather than from its own file
      // location, which differs between `dist-electron/` (production bundle)
      // and the project root (`npm run dev`).
      SCHOOL_BELL_APP_ROOT: projectRoot,
      // B7 Stage B-2: opt this child into the stdin credential broker. Only
      // this process gets the flag, which is what stops a standalone
      // `npm run dev` from reading the developer's terminal on stdin.
      SCHOOL_BELL_CREDENTIAL_BROKER: '1',
    },
    // stdin becomes the pipe the main process pushes the decrypted user key
    // down. stdout/stderr stay inherited so backend logs keep reaching the
    // terminal exactly as before. This replaces Stage B-1's environment-variable
    // transport, which was readable via /proc/<pid>/environ and frozen at spawn.
    stdio: ['pipe', 'inherit', 'inherit'],
    windowsHide: true,
  });
  // B8.1: supervision is attached immediately after spawn so an early death
  // cannot slip through unobserved. The identity check makes the listener
  // belong to THIS child only: a late `exit` from a replaced backend can never
  // schedule a restart of the healthy one that succeeded it.
  const spawnedChild = backendProcess;
  intentionallyStoppedBackend = null;
  if (typeof spawnedChild.on === 'function') {
    spawnedChild.on('exit', (code, signal) => {
      if (backendProcess !== spawnedChild) return; // stale child; ignore
      if (isQuitting) return; // intentional application shutdown
      if (spawnedChild === intentionallyStoppedBackend) {
        // The restart-failure path is already scheduling the next attempt.
        intentionallyStoppedBackend = null;
        return;
      }
      console.error(
        `School Bell: backend berhenti secara tidak terduga (code=${code}, signal=${signal}).`
      );
      scheduleBackendRestart();
    });
  }
  // Guarded: a child handle is not guaranteed to carry a stdin pipe (a failed
  // spawn, or a test double). Touching `.stdin.on` unguarded would throw here and
  // abort boot, which is exactly what F-04 case A detects.
  if (backendProcess.stdin && typeof backendProcess.stdin.on === 'function') {
    backendProcess.stdin.on('error', () => {
      /* the child exited; pushCredentialToBackend() handles the next attempt */
    });
  }
  pushCredentialToBackend();
}

/**
 * B7 Stage B-2 — hand the backend the user's Gemini key.
 *
 * The main process is the only holder of `safeStorage`, so it decrypts and the
 * backend merely holds the value in memory. One newline-delimited JSON frame per
 * change, so it can be called again at any moment; the backend keeps only the
 * most recent frame, and a `null` key is a real instruction to forget the old
 * one rather than "no update".
 *
 * Called once at spawn and again after every save or delete. Never logged, and
 * never written anywhere.
 */
function pushCredentialToBackend() {
  if (!backendProcess || backendProcess.exitCode !== null) return;
  if (!backendProcess.stdin || backendProcess.stdin.destroyed) return;
  try {
    const apiKey = geminiCredentialStore.loadKey();
    backendProcess.stdin.write(`${JSON.stringify({ type: 'gemini-credential', apiKey })}\n`);
  } catch {
    // A failed push is not fatal. The credential is still on disk, the user
    // still sees `configured: true`, and the next spawn pushes it again — the
    // backend then reports NOT_CONFIGURED, which is honest rather than wrong.
  }
}

function stopBackend() {
  if (backendProcess && backendProcess.exitCode === null) backendProcess.kill();
}

function clearBackendRestartTimer() {
  if (backendRestartTimer !== null) {
    clearTimeout(backendRestartTimer);
    backendRestartTimer = null;
  }
}

/**
 * B8.1 — schedule exactly one bounded backend restart.
 *
 * Guards, in order:
 *   - application is quitting            → never restart
 *   - a timer or an in-flight restart    → never two concurrent attempts
 *   - consecutive limit reached         → log once, then stay stopped
 *
 * The attempt counter increments here, so every scheduled restart is counted
 * exactly once regardless of which path requested it (exit handler or the
 * failure branch of restartBackend itself).
 */
function scheduleBackendRestart() {
  if (isQuitting) return;
  if (backendRestartTimer !== null || backendRestartInFlight) return;
  if (backendRestartCount >= MAX_BACKEND_RESTARTS) {
    if (!backendRestartLimitLogged) {
      backendRestartLimitLogged = true;
      console.error('School Bell: batas menjalankan ulang backend tercapai; pemulihan otomatis dihentikan.');
    }
    return;
  }
  backendRestartCount += 1;
  const attempt = backendRestartCount;
  console.error(`School Bell: menjalankan ulang backend (percobaan ${attempt}/${MAX_BACKEND_RESTARTS}).`);
  backendRestartTimer = setTimeout(() => {
    backendRestartTimer = null;
    void restartBackend();
  }, BACKEND_RESTART_DELAY_MS);
}

/**
 * B8.1 — one restart attempt: spawn, wait for readiness, then either reset the
 * consecutive counter (ready) or make sure nothing is left running and queue
 * the next bounded attempt (failed).
 *
 * startBackend() re-pushes the Gemini credential on every spawn, so the
 * credential broker path is reused untouched.
 */
async function restartBackend() {
  if (isQuitting) return;
  backendRestartInFlight = true;
  try {
    startBackend();
    await waitForBackend();
    backendRestartCount = 0;
    backendRestartLimitLogged = false;
    backendRestartInFlight = false;
    console.log('School Bell: backend berjalan kembali.');
  } catch (error) {
    // A failed attempt must never leave a half-alive child behind: the child
    // may have exited (waitForBackend saw exitCode) or still be listening but
    // unhealthy (timeout) — either way, stop it before queueing the next try.
    intentionallyStoppedBackend = backendProcess;
    stopBackend();
    console.error(
      `School Bell: backend gagal dijalankan ulang (${error instanceof Error ? error.message : String(error)}).`
    );
    backendRestartInFlight = false;
    scheduleBackendRestart();
  }
}

function isMainWindowSender(event) {
  return Boolean(mainWindow && event.sender === mainWindow.webContents);
}

function sendTrayAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('school-bell:tray:action', action);
  }
}

function sendResumeEvent(reason) {
  if (!resumeReasons.has(reason)) return;
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('school-bell:app:resumed', { reason });
}

function startPowerSaveBlocker() {
  if (powerBlockerId !== null) return;
  try {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (error) {
    powerBlockerId = null;
    console.error('School Bell: powerSaveBlocker tidak aktif.', error);
  }
}

function stopPowerSaveBlocker() {
  if (powerBlockerId === null) return;
  const blockerId = powerBlockerId;
  powerBlockerId = null;
  try {
    let isActive = true;
    if (typeof powerSaveBlocker.isStarted === 'function') {
      try {
        // Electron >= 28 requires the blocker id; older builds take no argument.
        isActive = powerSaveBlocker.isStarted(blockerId);
      } catch {
        isActive = true;
      }
    }
    if (isActive) powerSaveBlocker.stop(blockerId);
  } catch (error) {
    console.error('School Bell: powerSaveBlocker gagal dihentikan.', error);
  }
}

function registerPowerMonitor() {
  powerMonitor.on('suspend', () => {
    console.log('School Bell: sistem masuk mode suspend.');
  });
  powerMonitor.on('resume', () => {
    console.log('School Bell: sistem resume, penjadwal memeriksa menit saat ini.');
    sendResumeEvent('resume');
  });
  powerMonitor.on('lock-screen', () => {
    console.log('School Bell: layar dikunci.');
  });
  powerMonitor.on('unlock-screen', () => {
    console.log('School Bell: layar dibuka kunci, penjadwal memeriksa menit saat ini.');
    sendResumeEvent('unlock-screen');
  });
}

function recoverRenderer(reason) {
  if (isQuitting) return;

  rendererRecoveryCount += 1;
  if (rendererRecoveryCount > MAX_RENDERER_RECOVERIES) {
    dialog.showErrorBox(
      'School Bell berhenti',
      `Proses tampilan gagal berulang (${reason}). Aplikasi akan ditutup agar jadwal dapat diperiksa.`
    );
    app.quit();
    return;
  }

  const previousWindow = mainWindow;
  mainWindow = null;
  if (previousWindow && !previousWindow.isDestroyed()) previousWindow.destroy();

  void createWindow().catch((error) => {
    dialog.showErrorBox(
      'School Bell gagal dimuat ulang',
      error instanceof Error ? error.message : String(error)
    );
  });
}

/**
 * F-04 — the single authoritative "can the user get back to a window?" test.
 *
 * Both the `close` handler and `window-all-closed` MUST consult this, and they
 * must consult the SAME question. They previously did not: `close` required a
 * non-destroyed tray while `window-all-closed` only required `tray` to be
 * non-null, so the state "tray object exists but is destroyed" destroyed the
 * window without quitting. That left the main process, the backend, the power
 * blocker and the single-instance lock alive with no window and no tray, and a
 * second launch vanished because `second-instance` returned on a null window.
 *
 * The predicate is deliberately conservative: any doubt counts as tray-less,
 * because a missing tray icon costs the user one icon, whereas a false "we have
 * a restore path" costs them an unstoppable background process.
 */
function hasTrayRestorePath() {
  return Boolean(tray) && !tray.isDestroyed();
}

function restoreWindow() {
  if (!mainWindow) {
    // F-04: this is a recovery path, so a failed reload must not surface as an
    // unhandled rejection. Reported exactly like the renderer-recovery failure.
    void createWindow().catch((error) => {
      dialog.showErrorBox(
        'School Bell gagal dibuka kembali',
        error instanceof Error ? error.message : String(error)
      );
    });
    return;
  }

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function getTrayStatusLabel() {
  if (trayStatus.paused) return '● Sistem Dijeda';
  if (!trayStatus.nextBellTime) return '○ Belum Ada Jadwal';
  return '● Sistem Aktif';
}

function updateTrayPresentation() {
  if (!tray || tray.isDestroyed()) return;

  const tooltip = trayStatus.paused
    ? 'School Bell — Sistem Dijeda'
    : trayStatus.nextBellTime
      ? `School Bell — Bel berikutnya: ${trayStatus.nextBellTime}`
      : 'School Bell — Sistem Aktif';

  tray.setToolTip(tooltip);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'School Bell', enabled: false },
    { label: getTrayStatusLabel(), enabled: false },
    { type: 'separator' },
    { label: 'Buka School Bell', click: restoreWindow },
    { label: 'Tes Bel', click: () => sendTrayAction('test-bell') },
    {
      label: trayStatus.paused ? 'Lanjutkan Bel' : 'Jeda Bel',
      click: () => sendTrayAction('toggle-pause'),
    },
    { type: 'separator' },
    {
      label: 'Pengaturan',
      click: () => {
        restoreWindow();
        sendTrayAction('open-settings');
      },
    },
    { type: 'separator' },
    {
      label: 'Keluar',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTray() {
  try {
    const iconFile = process.platform === 'win32' ? 'school-bell-tray.ico' : 'school-bell-tray.png';
    tray = new Tray(path.join(projectRoot, 'electron', 'assets', iconFile));
    tray.setToolTip('School Bell — Sistem Aktif');
    tray.on('click', restoreWindow);
    updateTrayPresentation();
  } catch (error) {
    tray = null;
    console.error(
      'School Bell: system tray tidak dapat dibuat. Jendela utama tetap dapat digunakan, dan menutup jendela akan menutup aplikasi.',
      error
    );
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#F7F8FC',
    title: 'School Bell',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // B5.1: `sandbox: true` means the preload cannot require a sibling module,
      // so the authoritative settings limits are passed in as a command-line
      // argument. The renderer uses them for UX only; main remains the authority.
      additionalArguments: [
        `--school-bell-settings-limits=${encodeURIComponent(JSON.stringify(storage.SETTINGS_LIMITS))}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    try {
      if (new URL(targetUrl).origin !== backendUrl) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('School Bell: proses tampilan berhenti.', details && details.reason);
    recoverRenderer(details && details.reason ? details.reason : 'unknown');
  });
  mainWindow.webContents.on('unresponsive', () => {
    console.error('School Bell: proses tampilan tidak merespons.');
  });
  mainWindow.on('close', (event) => {
    // F-04: the healthy close-to-tray path is unchanged and stays the fast path
    // — no quit, no dialog, no IPC. Without a usable restore path we let the
    // close through so `window-all-closed` can quit cleanly.
    if (!isQuitting && hasTrayRestorePath()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.once('ready-to-show', () => {
    rendererRecoveryCount = 0;
    mainWindow?.show();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow.loadURL(backendUrl);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // F-04: this handler used to `return` on a null main window, so a second
    // launch vanished without a trace while the first process stayed invisible
    // and unstoppable. Recover through the same path the tray menu uses, in the
    // same order `recoverRenderer` uses (drop the reference, dispose the old
    // window, then create) so a late `closed` event cannot orphan the new one.
    // The second process has already released itself via `app.quit()` above, so
    // no second backend is spawned and the store is not reinitialised here.
    if (!mainWindow || mainWindow.isDestroyed()) {
      const previousWindow = mainWindow;
      mainWindow = null;
      if (previousWindow && !previousWindow.isDestroyed()) previousWindow.destroy();
      restoreWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  ipcMain.on('school-bell:window:minimize', (event) => {
    if (isMainWindowSender(event)) mainWindow?.minimize();
  });
  ipcMain.on('school-bell:window:toggle-maximize', (event) => {
    if (!isMainWindowSender(event)) return;
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('school-bell:window:close', (event) => {
    if (isMainWindowSender(event)) mainWindow?.close();
  });
  ipcMain.on('school-bell:tray:update-status', (event, status) => {
    if (!isMainWindowSender(event) || !status || typeof status.paused !== 'boolean') return;
    if (status.nextBellTime !== null && (
      typeof status.nextBellTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(status.nextBellTime)
    )) return;

    trayStatus = { paused: status.paused, nextBellTime: status.nextBellTime };
    updateTrayPresentation();
  });

  registerStorageIpc(isMainWindowSender);
  // F-03: registered alongside storage on its own channels, guarded by the
  // same main-window sender check. Deliberately not unregistered in
  // `before-quit`, because that block is F-04-verified protected surface and
  // process teardown discards the handlers regardless.
  registerAutoStartIpc(isMainWindowSender);
  // B7 Stage B-2: three credential verbs, and a callback that re-pushes the
  // decrypted key to the backend so a save takes effect without a restart.
  registerGeminiCredentialIpc(isMainWindowSender, pushCredentialToBackend);

  app.whenReady().then(async () => {
    // Storage comes up before any window: a store we cannot open is a
    // degraded state the renderer must be told about, not a silent fallback.
    try {
      const info = storage.initStore();
      storageReady = true;
      console.log(`School Bell: penyimpanan siap (${info.dataVersion}) di ${info.root}`);
    } catch (error) {
      storageInitError = error;
      storageReady = false;
      console.error('School Bell: penyimpanan tidak dapat disiapkan.', error);
    }

    // F-03 Unit 2C: reconcile the persisted preference against the OS here.
    // Placement matters — storage has been attempted, Electron is ready, and the
    // window and backend have not started yet. It returns a result rather than
    // throwing, so it cannot reach the `.catch` below and cannot fail boot. It
    // runs exactly once per process; the `second-instance` path deliberately
    // does not repeat it, because nothing can have drifted in that window.
    reconcileOnBoot({ storage });

    startPowerSaveBlocker();
    registerPowerMonitor();
    startBackend();
    await waitForBackend();
    const windowLoad = createWindow();
    createTray();
    await windowLoad;
  }).catch((error) => {
    dialog.showErrorBox('School Bell gagal dibuka', error instanceof Error ? error.message : String(error));
    app.quit();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    // B8.1: cancel any pending restart so a queued timer can never spawn a
    // backend after shutdown has begun (the exit handler's isQuitting guard
    // covers the event path; this covers the timer path).
    clearBackendRestartTimer();
    stopPowerSaveBlocker();
    tray?.destroy();
    tray = null;
    stopBackend();
    if (storageReady) {
      // Flush the serial write queue and drop the lock so the next launch does
      // not have to reclaim a stale one.
      try {
        void storage.drain().then(() => {
          storage.clearLock();
        });
      } catch {
        try { storage.clearLock(); } catch { /* best effort */ }
      }
    }
    unregisterStorageIpc();
    unregisterGeminiCredentialIpc();
  });
  app.on('window-all-closed', () => {
    // F-04: shares the close handler's predicate, so "window destroyed" and
    // "stays alive" can no longer both be true while no restore path exists.
    if (!hasTrayRestorePath() && !isQuitting) app.quit();
  });
}