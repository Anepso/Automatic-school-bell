'use strict';

/**
 * B8.1 — backend lifecycle supervision tests.
 *
 * Audit contract: docs/B8.1_STAGE_A_BACKEND_SUPERVISION_AUDIT.md, §13
 * (Option A — guarded automatic respawn).
 *
 * These tests load the REAL `electron/main.cjs` against the harness double,
 * then drive the actual child `exit` listeners, restart timer and shutdown
 * guards that the module registers. They assert observable effects only:
 * spawn counts, child state, and the distinguishable lifecycle log lines.
 *
 * Run with: node --test electron/__tests__/b8-1-backend-supervision.test.cjs
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadMainProcess, trayMenuItem } = require('./f04-harness.cjs');

/** > BACKEND_RESTART_DELAY_MS (1000) + readiness poll margins. */
const SETTLE_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function countLogs(logs, needle) {
  return logs.filter((line) => line.includes(needle)).length;
}

async function waitForLog(env, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (env.logs.some((line) => line.includes(needle))) return true;
    await sleep(200);
  }
  return false;
}

test('B8.1 TEST 1 — normal startup: backend starts once, no restart, no supervision noise', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  assert.equal(env.spawnCalls.length, 1, 'exactly one backend spawn at boot');
  assert.equal(env.spawnedChildren.length, 1, 'exactly one child process');
  assert.ok(env.window(), 'the boot window was created — startup remains successful');

  await sleep(SETTLE_MS);

  assert.equal(env.spawnCalls.length, 1, 'no restart occurs while the backend is healthy');
  assert.equal(countLogs(env.logs, 'menjalankan ulang backend'), 0, 'no restart-attempt log');
  assert.equal(countLogs(env.logs, 'berhenti secara tidak terduga'), 0, 'no unexpected-death log');
  assert.deepEqual(env.unhandledRejections, [], 'no unhandled rejection on the healthy path');
});

test('B8.1 TEST 2 — abnormal backend exit is detected and restarted without overlap', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  const firstChild = env.spawnedChildren[0];
  firstChild.kill(); // external kill after boot: isQuitting stays false

  await sleep(SETTLE_MS);

  assert.equal(
    countLogs(env.logs, 'berhenti secara tidak terduga'),
    1,
    'the unexpected death is logged exactly once with code/signal'
  );
  assert.equal(
    countLogs(env.logs, 'menjalankan ulang backend (percobaan 1/3)'),
    1,
    'a bounded restart attempt is scheduled'
  );
  assert.equal(env.spawnCalls.length, 2, 'a new backend was spawned');
  assert.notEqual(firstChild.exitCode, null, 'the previous child had already exited before the respawn');
  assert.equal(
    env.spawnedChildren[1].exitCode,
    null,
    'the new child is alive — no overlapping-dead spawn'
  );
  assert.equal(countLogs(env.logs, 'backend berjalan kembali'), 1, 'readiness after restart is logged');
  assert.deepEqual(env.unhandledRejections, [], 'no unhandled rejection on the restart path');
});

test('B8.1 TEST 3 — shutdown cancels a pending restart; backend exit never respawns during quit', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  // Schedule a restart, then quit before the delay elapses: the before-quit
  // timer cleanup must cancel it (covers the timer path of the shutdown guard).
  env.spawnedChildren[0].kill();
  await sleep(50); // let the exit event deliver and the restart get scheduled
  assert.equal(
    countLogs(env.logs, 'menjalankan ulang backend (percobaan 1/3)'),
    1,
    'the restart was scheduled before quit'
  );

  trayMenuItem(env.tray(), 'Keluar').click();
  await sleep(SETTLE_MS + 200);

  assert.equal(env.app.quitCalls, 1, 'the tray Exit path quit the app');
  assert.equal(env.spawnCalls.length, 1, 'the pending restart timer never spawned a backend after quit');
  assert.equal(
    countLogs(env.logs, 'menjalankan ulang backend (percobaan 2/3)'),
    0,
    'no further attempts were queued during shutdown'
  );
  assert.deepEqual(env.unhandledRejections, [], 'no unhandled rejection on the shutdown path');
});

test('B8.1 TEST 4 — repeated restart failures are bounded and end in a stable stopped state', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  env.setBackendReady(false); // waitForBackend cannot succeed
  env.setAutoExitRestarts(true); // every spawned restart dies immediately
  env.spawnedChildren[0].kill();

  const sawLimit = await waitForLog(
    env,
    'batas menjalankan ulang backend tercapai',
    15000
  );

  assert.equal(sawLimit, true, 'retry exhaustion is logged');
  assert.equal(
    countLogs(env.logs, 'menjalankan ulang backend (percobaan'),
    3,
    'exactly MAX_BACKEND_RESTARTS (3) attempts were made'
  );
  assert.equal(env.spawnCalls.length, 4, '1 boot spawn + 3 bounded restart spawns, then none');
  assert.equal(
    countLogs(env.logs, 'batas menjalankan ulang backend tercapai'),
    1,
    'the exhaustion message is logged exactly once'
  );

  // Stability: nothing may fire after the limit.
  await sleep(SETTLE_MS);
  assert.equal(env.spawnCalls.length, 4, 'no infinite crash loop — spawn count stays fixed');
  assert.equal(env.app.quitCalls, 0, 'the application keeps running after giving up');
  assert.deepEqual(env.unhandledRejections, [], 'no unhandled rejection during the retry storm');
});

test('B8.1 TEST 5 — the consecutive counter resets after readiness', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  // First death → restart → ready.
  env.spawnedChildren[0].kill();
  await sleep(SETTLE_MS);
  assert.equal(env.spawnCalls.length, 2, 'first restart happened');

  // Second death after a healthy restart must start a FRESH sequence.
  env.spawnedChildren[1].kill();
  await sleep(SETTLE_MS);

  assert.equal(env.spawnCalls.length, 3, 'second restart happened');
  assert.equal(
    countLogs(env.logs, 'menjalankan ulang backend (percobaan 1/3)'),
    2,
    'both post-ready deaths begin at attempt 1/3 (counter was reset)'
  );
  assert.equal(countLogs(env.logs, 'menjalankan ulang backend (percobaan 2/3)'), 0, 'no carried-over count');
  assert.equal(countLogs(env.logs, 'backend berjalan kembali'), 2, 'both restarts reached readiness');
});

test('B8.1 TEST 6 — a stale exit event from a replaced child cannot disturb the new backend', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  env.spawnedChildren[0].kill();
  await sleep(SETTLE_MS);
  assert.equal(env.spawnCalls.length, 2, 'the restart produced a replacement child');

  // The OLD child emits exit a second time (late/duplicate delivery).
  env.spawnedChildren[0].emit('exit', 0, null);
  await sleep(SETTLE_MS);

  assert.equal(env.spawnCalls.length, 2, 'the stale event must not spawn another backend');
  assert.equal(
    countLogs(env.logs, 'menjalankan ulang backend (percobaan 2/3)'),
    0,
    'the stale event must not schedule an attempt'
  );
  assert.equal(env.spawnedChildren[1].exitCode, null, 'the current backend is untouched');
});

test('B8.1 TEST 7 — the credential push path runs on every respawn', async (t) => {
  const env = loadMainProcess();
  t.after(() => env.cleanup());
  await env.boot();

  const firstFrame = env.spawnedChildren[0].stdin.writes;
  assert.equal(firstFrame.length, 1, 'the boot spawn pushes exactly one credential frame');
  assert.equal(JSON.parse(firstFrame[0]).type, 'gemini-credential', 'frame shape is unchanged');
  // No key content is asserted or displayed — only that the transport ran.

  env.spawnedChildren[0].kill();
  await sleep(SETTLE_MS);

  const respawnFrame = env.spawnedChildren[1].stdin.writes;
  assert.equal(respawnFrame.length, 1, 'the respawned child receives a fresh credential push');
  assert.equal(JSON.parse(respawnFrame[0]).type, 'gemini-credential', 'respawn frame shape unchanged');
});
