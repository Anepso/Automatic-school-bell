'use strict';

/**
 * F-04 regression tests — tray-less close / zombie process prevention.
 *
 * Audit contract: STAGE_A_B5_2_AUTO_START_TRAY_AUDIT.md, §7 and §8.
 *
 * These tests load the REAL `electron/main.cjs` against the Electron double in
 * `f04-harness.cjs`, then fire the actual `close`, `window-all-closed`,
 * `second-instance` and `before-quit` handlers that the module registers. They
 * assert on observable effects (quit calls, window calls, cleanup calls) rather
 * than on the shape of the source.
 *
 * Case C is the regression that the pre-fix code fails: with `tray` non-null but
 * destroyed, the old `close` guard fell through (destroying the window) while
 * the old `window-all-closed` guard `!tray` was false (so it did not quit),
 * leaving the main process, backend, power blocker and single-instance lock
 * alive with no window and no restore path.
 *
 * Run with: node --test electron/__tests__/f04-lifecycle.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadMainProcess, makeCloseEvent, trayMenuItem } = require('./f04-harness.cjs');

/** Let queued microtasks and the restore-path catch handler run. */
async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('F-04 case A — healthy tray: close is intercepted and hidden, app does not quit', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  const win = env.window();
  const tray = env.tray();
  assert.ok(win, 'a main window was created during boot');
  assert.ok(tray && !tray.isDestroyed(), 'a live tray exists during boot');

  const event = makeCloseEvent();
  win.emit('close', event);

  assert.equal(event.wasPrevented(), true, 'close must be prevented (unchanged healthy path)');
  assert.ok(win.calls.includes('hide'), 'the window must be hidden to the tray');
  assert.equal(win.isDestroyed(), false, 'the window must survive');
  assert.equal(env.app.quitCalls, 0, 'the app must not quit while a restore path exists');
  assert.equal(env.spawnCalls.length, 1, 'no additional backend is spawned');

  // Hiding must not destroy the window, so `window-all-closed` never fires.
  env.app.emit('window-all-closed');
  assert.equal(env.app.quitCalls, 0, 'window-all-closed must not quit while the tray is alive');
  assert.equal(env.powerSaveBlockerCalls.stop.length, 0, 'the power blocker stays active');

  // Healthy path is unchanged: no dialog was raised on close.
  assert.deepEqual(env.app.dialogs, [], 'the healthy close path must stay silent');
});

test('F-04 case B — tray creation failure: close proceeds and window-all-closed quits', async (t) => {
  const env = loadMainProcess({ throwOnTrayCreate: true });
  t.after(() => env.cleanup());
  await env.boot();

  assert.equal(env.trays.length, 0, 'no tray was constructed');
  const win = env.window();

  const event = makeCloseEvent();
  win.emit('close', event);

  assert.equal(event.wasPrevented(), false, 'close must not be intercepted without a tray');
  win.destroy();
  env.app.emit('window-all-closed');

  assert.equal(env.app.quitCalls, 1, 'window-all-closed must quit when there is no tray');
  assert.deepEqual(env.powerSaveBlockerCalls.stop.length, 1, 'before-quit must stop the power blocker');
});

test('F-04 case C — destroyed tray: app quits instead of becoming a zombie', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  const win = env.window();
  const tray = env.tray();

  // Reach the state the pre-fix guards disagreed about: the tray object still
  // exists (truthy) but has been destroyed.
  tray.destroyed = true;
  assert.equal(tray.isDestroyed(), true, 'tray object is non-null but destroyed');

  const event = makeCloseEvent();
  win.emit('close', event);

  assert.equal(event.wasPrevented(), false, 'a destroyed tray cannot hide the window');
  win.destroy();
  env.app.emit('window-all-closed');
  await settle();

  // Pre-fix behaviour was: quitCalls === 0, leaving a zombie behind.
  assert.equal(env.app.quitCalls, 1, 'a destroyed tray must still reach app.quit()');
  assert.equal(env.powerSaveBlockerCalls.stop.length, 1, 'powerSaveBlocker must be released');
  assert.equal(env.spawnCalls.length, 1, 'no backend was spawned beyond the original');
  assert.equal(env.spawnCalls[0].options.windowsHide, true, 'backend spawn shape unchanged');
  assert.equal(fsExistsSync(env.storageRoot, 'lock.json'), false, 'lock.json is cleared by before-quit');
});

test('F-04 case D — explicit quit: close is not intercepted and before-quit cleanup runs', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  const win = env.window();
  const quitItem = trayMenuItem(env.tray(), 'Keluar');
  assert.ok(quitItem, 'the tray menu still exposes "Keluar"');

  quitItem.click();

  assert.equal(env.app.quitCalls, 1, 'the tray quit item calls app.quit()');
  assert.equal(env.powerSaveBlockerCalls.stop.length, 1, 'before-quit releases the power blocker');
  assert.equal(env.spawnCalls.length, 1, 'exactly one backend was ever spawned');
  assert.equal(env.spawnCalls[0].killed === undefined, true, 'spawn record is a plain object');

  // After the quit, close must no longer be intercepted even though the tray
  // object is still alive.
  const event = makeCloseEvent();
  win.emit('close', event);
  assert.equal(event.wasPrevented(), false, 'close must not be intercepted while quitting');
  assert.equal(win.calls.includes('hide'), false, 'the window must not be hidden while quitting');
});

test('F-04 case E — second instance while a main window exists: unchanged focus behaviour', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  const win = env.window();
  const windowCountBefore = env.windows.length;
  const spawnCountBefore = env.spawnCalls.length;

  env.app.emit('second-instance');

  assert.equal(env.windows.length, windowCountBefore, 'no extra window is created');
  assert.ok(win.calls.includes('show'), 'the existing window is shown');
  assert.ok(win.calls.includes('focus'), 'the existing window is focused');
  assert.equal(env.spawnCalls.length, spawnCountBefore, 'no second backend is spawned');
  assert.equal(env.app.quitCalls, 0, 'the owning process does not quit');
});

test('F-04 case F — second instance while mainWindow is null: window recovery, no second backend', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  const firstWindow = env.window();
  // Reproduce the exact module state a zombie or a crashed renderer leaves:
  // `mainWindow` is null while the process is alive.
  firstWindow.emit('closed');

  const windowCountBefore = env.windows.length;
  const spawnCountBefore = env.spawnCalls.length;

  env.app.emit('second-instance');
  await settle();

  assert.equal(env.windows.length, windowCountBefore + 1, 'a window is recovered rather than ignored');
  const recovered = env.window();
  assert.equal(env.spawnCalls.length, spawnCountBefore, 'no second backend is spawned');
  assert.equal(recovered.isDestroyed(), false, 'the recovered window is alive');
  assert.equal(recovered.calls.includes('show'), false, 'a new window is created hidden, as on boot');
  assert.equal(env.app.quitCalls, 0, 'the owning process does not quit');
  assert.deepEqual(env.unhandledRejections, [], 'no unhandled rejection on the recovery path');

  // It becomes visible on ready-to-show, exactly like the boot window.
  recovered.emit('ready-to-show');
  assert.ok(recovered.calls.includes('show'), 'the recovered window is shown once ready');

  // The recovered window is usable: the healthy close path still applies.
  const event = makeCloseEvent();
  recovered.emit('close', event);
  assert.equal(event.wasPrevented(), true, 'close-to-tray works on the recovered window');
});

test('F-04 — a failed window recovery is reported, not swallowed as an unhandled rejection', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  env.window().emit('closed');

  // Only the recovery attempt fails; the boot window loaded normally.
  env.setLoadRejection(new Error('F-04 stub: load refused'));
  env.app.emit('second-instance');
  await settle();

  assert.equal(env.app.dialogs.length, 1, 'the failed recovery surfaces a dialog');
  assert.match(env.app.dialogs[0].content, /load refused/);
  assert.deepEqual(env.unhandledRejections, [], 'the rejection is handled, not unhandled');
});

test('F-04 — before-quit cleanup stays complete and reachable on every exit path', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  assert.equal(fsExistsSync(env.storageRoot, 'lock.json'), true, 'the store lock is written at boot');
  assert.equal(env.powerSaveBlockerCalls.start.length, 1, 'one power blocker is started');

  trayMenuItem(env.tray(), 'Keluar').click();
  await settle();

  assert.equal(env.powerSaveBlockerCalls.stop.length, 1, 'stopPowerSaveBlocker() ran');
  assert.equal(env.tray().isDestroyed(), true, 'the tray was destroyed');
  assert.equal(env.spawnCalls.length, 1, 'exactly one backend, never restarted');
  assert.equal(env.storageExports !== null, true, 'the storage module was loaded and used');
  assert.equal(fsExistsSync(env.storageRoot, 'lock.json'), false, 'clearLock() ran after drain()');
});

function fsExistsSync(root, name) {
  return require('node:fs').existsSync(require('node:path').join(root, name));
}
