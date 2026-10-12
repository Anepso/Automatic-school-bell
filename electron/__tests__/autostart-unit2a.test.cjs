'use strict';

/**
 * F-03 Unit 2A — Windows OS read/write behind the auto-start seam.
 *
 * Audit contract: STAGE_B5_SETTINGS_WINDOWS_STAGE_A_AUDIT.md §4.1 / F-03,
 * Unit 2A (implement the boundary).
 *
 * SCOPE OF PROOF. Every test here runs against a stubbed Electron. That proves
 * the module uses `app.getLoginItemSettings` / `app.setLoginItemSettings`
 * correctly and reports honest observations. It proves nothing about whether
 * Windows actually launches the app at boot, because no Windows machine and no
 * packaged executable were involved. That limitation is repeated in the
 * implementation report rather than papered over here.
 *
 * The Unit 1 contract is deliberately assumed, not re-litigated: the same
 * channels, the same discriminated status union, and the same error codes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAutoStartSurface, looksLikeAutoStartStatus } = require('./autostart-harness.cjs');

const PACKAGED_EXE = 'C:\\Program Files\\School Bell\\School Bell.exe';

/** Every key a status reply is allowed to carry. */
const ALLOWED_STATUS_KEYS = new Set(['supported', 'enabled', 'errorCode']);

/**
 * Assert the reply is the public union and nothing else.
 *
 * The extra check matters: Electron returns a rich `LoginItemSettings` object,
 * so a careless implementation could forward `path`,
 * `executableWillLaunchAtLogin` or a raw stack trace to the renderer.
 */
function assertPublicStatus(status, expected) {
  assert.ok(looksLikeAutoStartStatus(status), 'matches the Unit 1 status union');
  for (const key of Object.keys(status)) {
    assert.ok(ALLOWED_STATUS_KEYS.has(key), `unexpected key ${key} leaked to the renderer`);
  }
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(status[key], value, `${key}`);
  }
}

/** A packaged Windows surface with a controllable login-item double. */
function packaged(options = {}) {
  return loadAutoStartSurface({
    platform: 'win32',
    isPackaged: true,
    execPath: PACKAGED_EXE,
    ...options,
  });
}

// ------------------------------------------------------------- the gates --

test('Unit 2A — a non-Windows host never reaches the OS API, in either direction', async (t) => {
  const env = packaged({ platform: 'darwin' });
  t.after(() => env.cleanup());

  assertPublicStatus(await env.exposed.schoolBellAutoStart.getStatus(), {
    supported: false,
    enabled: null,
    errorCode: 'AUTOSTART_UNSUPPORTED_PLATFORM',
  });
  assertPublicStatus(await env.exposed.schoolBellAutoStart.setEnabled(true), {
    supported: false,
    enabled: null,
    errorCode: 'AUTOSTART_UNSUPPORTED_PLATFORM',
  });

  assert.equal(env.loginItem.calls.get.length, 0, 'gate must be checked before any OS read');
  assert.equal(env.loginItem.calls.set.length, 0, 'gate must be checked before any OS write');
});

test('Unit 2A — an unpackaged Windows build is refused and never registers the dev binary', async (t) => {
  const env = packaged({ isPackaged: false, execPath: '/tmp/electron/dist/electron' });
  t.after(() => env.cleanup());

  assertPublicStatus(await env.exposed.schoolBellAutoStart.getStatus(), {
    supported: false,
    enabled: null,
    errorCode: 'AUTOSTART_NOT_PACKAGED',
  });
  assertPublicStatus(await env.exposed.schoolBellAutoStart.setEnabled(true), {
    supported: false,
    enabled: null,
    errorCode: 'AUTOSTART_NOT_PACKAGED',
  });

  assert.equal(env.loginItem.calls.get.length, 0);
  assert.equal(env.loginItem.calls.set.length, 0, 'the development Electron binary must never be written');
});

test('Unit 2A — a non-boolean request is rejected before the OS is touched', async (t) => {
  const env = packaged();
  t.after(() => env.cleanup());

  for (const bad of ['true', 1, null, undefined, {}, []]) {
    assertPublicStatus(await env.autostart.setEnabled(bad), {
      supported: false,
      enabled: null,
      errorCode: 'AUTOSTART_INVALID_INPUT',
    });
  }
  assert.equal(env.loginItem.calls.set.length, 0);
});

// -------------------------------------------------------------- the read --

test('Unit 2A — a packaged Windows read reports the OS state, on and off', async (t) => {
  const on = packaged({ loginItem: { openAtLogin: true } });
  const off = packaged({ loginItem: { openAtLogin: false } });
  t.after(on.cleanup);
  t.after(off.cleanup);

  assertPublicStatus(await on.exposed.schoolBellAutoStart.getStatus(), {
    supported: true,
    enabled: true,
  });
  assertPublicStatus(await off.exposed.schoolBellAutoStart.getStatus(), {
    supported: true,
    enabled: false,
  });

  assert.equal(on.loginItem.calls.get.length, 1, 'one read, no probing loop');
  assert.deepEqual(on.loginItem.calls.get[0].options, { path: PACKAGED_EXE });
});

test('Unit 2A — a failing or malformed read reports READ_FAILED rather than guessing', async (t) => {
  const throwing = packaged({ loginItem: { throwOnGet: new Error('regopen failed') } });
  t.after(throwing.cleanup);

  assertPublicStatus(await throwing.exposed.schoolBellAutoStart.getStatus(), {
    supported: false,
    enabled: null,
    errorCode: 'AUTOSTART_READ_FAILED',
  });
  const status = await throwing.exposed.schoolBellAutoStart.getStatus();
  assert.ok(
    !JSON.stringify(status).includes('regopen'),
    'the OS error message must not leak to the renderer',
  );

  for (const malformed of [null, undefined, {}, { openAtLogin: 'yes' }, { openAtLogin: 1 }, 'nonsense', 42]) {
    const env = packaged({ loginItem: { malformedGet: malformed } });
    try {
      assertPublicStatus(await env.exposed.schoolBellAutoStart.getStatus(), {
        supported: false,
        enabled: null,
        errorCode: 'AUTOSTART_READ_FAILED',
      });
    } finally {
      env.cleanup();
    }
  }
});

test('Unit 2A — a missing login-item API degrades to READ_FAILED instead of crashing the IPC handler', async (t) => {
  const env = packaged({ loginItem: { noApi: true } });
  t.after(() => env.cleanup());

  assertPublicStatus(await env.exposed.schoolBellAutoStart.getStatus(), {
    supported: false,
    enabled: null,
    errorCode: 'AUTOSTART_READ_FAILED',
  });
});

// ------------------------------------------------------------- the write --

test('Unit 2A — a write registers the packaged executable itself', async (t) => {
  const env = packaged();
  t.after(() => env.cleanup());

  assertPublicStatus(await env.exposed.schoolBellAutoStart.setEnabled(true), {
    supported: true,
    enabled: true,
  });

  assert.equal(env.loginItem.calls.set.length, 1);
  assert.deepEqual(env.loginItem.calls.set[0], {
    openAtLogin: true,
    path: PACKAGED_EXE,
  });
});

test('Unit 2A — turning it off is a real write, not an assumed state', async (t) => {
  const env = packaged({ loginItem: { openAtLogin: true } });
  t.after(() => env.cleanup());

  assertPublicStatus(await env.exposed.schoolBellAutoStart.setEnabled(false), {
    supported: true,
    enabled: false,
  });
  assert.deepEqual(env.loginItem.calls.set[0], { openAtLogin: false, path: PACKAGED_EXE });
});

test('Unit 2A — read and write use one identical target, as Electron requires', async (t) => {
  const env = packaged();
  t.after(() => env.cleanup());

  await env.exposed.schoolBellAutoStart.setEnabled(true);
  await env.exposed.schoolBellAutoStart.getStatus();

  const written = env.loginItem.calls.set[0];
  const read = env.loginItem.calls.get.at(-1);
  assert.equal(written.path, read.options.path, 'same path on both calls');
  assert.deepEqual(
    read.options.args ?? [],
    written.args ?? [],
    'same args on both calls',
  );
});

test('Unit 2A — repeated writes update a single startup entry instead of accumulating', async (t) => {
  const env = packaged();
  t.after(() => env.cleanup());

  for (const value of [true, true, false, false, true]) {
    const status = await env.exposed.schoolBellAutoStart.setEnabled(value);
    assertPublicStatus(status, { supported: true, enabled: value });
  }

  assert.equal(
    env.loginItem.entries.size,
    1,
    'one executable means one login-item entry, however many writes arrive',
  );
});

test('Unit 2A — a rejected write reports SET_FAILED and never claims the requested state', async (t) => {
  const env = packaged({ loginItem: { throwOnSet: new Error('access is denied') } });
  t.after(() => env.cleanup());

  const status = await env.exposed.schoolBellAutoStart.setEnabled(true);
  assertPublicStatus(status, {
    supported: false,
    enabled: null,
    errorCode: 'AUTOSTART_SET_FAILED',
  });
  assert.equal(env.loginItem.calls.get.length, 0, 'no read-back after a write that never landed');
});

test('Unit 2A — the reported state is the observation, never the request', async (t) => {
  // The write is accepted but has no effect, so the read-back still says "off".
  // This is the case that separates a real implementation from an echo.
  const env = packaged({ loginItem: { openAtLogin: false, ignoreWrites: true } });
  t.after(() => env.cleanup());

  const status = await env.exposed.schoolBellAutoStart.setEnabled(true);

  assert.equal(env.loginItem.calls.set.length, 1, 'the write really was attempted');
  assert.equal(
    status.enabled,
    false,
    'requested true but observed false — the observation wins',
  );
});

test('Unit 2A — a failed read-back reports READ_FAILED, not the requested state', async (t) => {
  const env = packaged({
    loginItem: { openAtLogin: false, ignoreWrites: true, throwOnGet: new Error('gone') },
  });
  t.after(() => env.cleanup());

  assertPublicStatus(await env.exposed.schoolBellAutoStart.setEnabled(true), {
    supported: false,
    enabled: null,
    errorCode: 'AUTOSTART_READ_FAILED',
  });
});

// ------------------------------------------------------------- the seam --

test('Unit 2A — NOT_IMPLEMENTED is retired but still exported, so the union stays stable', (t) => {
  const env = packaged();
  t.after(() => env.cleanup());

  assert.equal(env.autostart.ERROR_CODES.NOT_IMPLEMENTED, 'AUTOSTART_NOT_IMPLEMENTED');

  return Promise.all([
    env.exposed.schoolBellAutoStart.getStatus(),
    env.exposed.schoolBellAutoStart.setEnabled(true),
  ]).then(([status, written]) => {
    for (const reply of [status, written]) {
      assert.notEqual(reply.errorCode, 'AUTOSTART_NOT_IMPLEMENTED');
    }
  });
});

/**
 * Remove comments so the check below is about code, not prose.
 *
 * The module's own documentation legitimately names `autoStartWindows` when
 * explaining why it deliberately does not touch it, so a raw substring search
 * over the file would report a false positive.
 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('Unit 2A — the auto-start module never reads or writes the persisted setting', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const code = codeOnly(fs.readFileSync(path.join(__dirname, '..', 'autostart-ipc.cjs'), 'utf8'));

  assert.ok(!code.includes('autoStartWindows'), 'the requested setting stays in B5.1 storage');
  assert.ok(!code.includes('settings.json'), 'this module does not open the settings file');
  assert.ok(!/\bgetSettings\b/.test(code), 'no storage read during a status query');
  assert.ok(!/\bsetSettings\b/.test(code), 'no storage write from the auto-start path');
  t.diagnostic('reconciliation of the two is a later unit, by design');
});

test('Unit 2A — the bridge sends exactly one IPC call per user action', async (t) => {
  const env = packaged();
  t.after(() => env.cleanup());

  await env.exposed.schoolBellAutoStart.getStatus();
  await env.exposed.schoolBellAutoStart.setEnabled(true);

  assert.deepEqual(
    env.invokeLog.map((entry) => entry.channel),
    ['school-bell:autostart:get-status', 'school-bell:autostart:set-enabled'],
  );
  assert.deepEqual(env.invokeLog[1].payload, { enabled: true });
});