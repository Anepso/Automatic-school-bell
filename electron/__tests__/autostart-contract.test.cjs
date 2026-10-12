'use strict';

/**
 * F-03 Unit 1 — contract and IPC bridge tests.
 *
 * Audit contract: STAGE_B5_SETTINGS_WINDOWS_STAGE_A_AUDIT.md §4.1 / F-03.
 *
 * Unit 1 built the contract and the bridge. Unit 2A then filled the OS seam
 * behind them, so a few expectations here legitimately changed: a packaged
 * Windows build is now read from the OS instead of answering
 * NOT_IMPLEMENTED, and the Electron login-item API is now expected to appear in
 * exactly one production file.
 *
 * Everything here still asserts the Unit 1 invariants that Unit 2A must not
 * weaken — the discriminated union, the fixed channels, the untouched preload,
 * and the separation between the persisted setting and the observed state.
 * Behavioural coverage of the Windows read/write lives in
 * autostart-unit2a.test.cjs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CHANNEL,
  loadAutoStartSurface,
  loadSettingsSchema,
  looksLikeAutoStartStatus,
} = require('./autostart-harness.cjs');

// ---------------------------------------------------------------- contract --

test('F-03 contract — get-status on a non-Windows host reports unsupported, never a boolean state', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux', isPackaged: true });
  t.after(() => env.cleanup());

  const status = await env.exposed.schoolBellAutoStart.getStatus();

  assert.equal(status.supported, false, 'Linux cannot be a supported auto-start platform');
  assert.equal(status.enabled, null, 'unknown must be null, never false-as-a-claim');
  assert.equal(status.errorCode, 'AUTOSTART_UNSUPPORTED_PLATFORM');
  assert.ok(looksLikeAutoStartStatus(status), 'the reply matches the status union');
});

test('F-03 contract — an unpackaged Windows build reports NOT_PACKAGED, refusing the dev binary', async (t) => {
  const env = loadAutoStartSurface({ platform: 'win32', isPackaged: false });
  t.after(() => env.cleanup());

  const status = await env.exposed.schoolBellAutoStart.getStatus();

  assert.equal(status.supported, false);
  assert.equal(status.errorCode, 'AUTOSTART_NOT_PACKAGED', 'a development binary is never a startup target');
  assert.equal(status.enabled, null);
});

test('F-03 contract — a packaged Windows build is now read from the OS (Unit 2A)', async (t) => {
  const env = loadAutoStartSurface({
    platform: 'win32',
    isPackaged: true,
    loginItem: { openAtLogin: true },
  });
  t.after(() => env.cleanup());

  const status = await env.exposed.schoolBellAutoStart.getStatus();

  // Unit 1 answered NOT_IMPLEMENTED here because no OS read existed. Unit 2A
  // fills the seam, so a packaged Windows build now reports a real observation.
  // It is still never allowed to answer from the persisted setting.
  assert.equal(status.supported, true);
  assert.equal(status.enabled, true);
  assert.equal(status.errorCode, undefined, 'a successful observation carries no error code');
});

test('F-03 contract — error codes are deterministic and stable across repeated calls', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux', isPackaged: true });
  t.after(() => env.cleanup());

  const first = await env.exposed.schoolBellAutoStart.getStatus();
  const second = await env.exposed.schoolBellAutoStart.getStatus();
  const third = await env.exposed.schoolBellAutoStart.setEnabled(true);

  assert.deepEqual(first, second, 'repeated reads are identical');
  assert.deepEqual(first, third, 'on an unsupported platform set and get still agree');
  assert.equal(first.errorCode, 'AUTOSTART_UNSUPPORTED_PLATFORM');
});

test('F-03 contract — the four Unit 2 error codes are reserved and exported', (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  const codes = Object.values(env.autostart.ERROR_CODES);
  for (const reserved of [
    'AUTOSTART_UNSUPPORTED_PLATFORM',
    'AUTOSTART_SET_FAILED',
    'AUTOSTART_READ_FAILED',
    'AUTOSTART_NOT_PACKAGED',
  ]) {
    assert.ok(codes.includes(reserved), `${reserved} is part of the published contract`);
  }
});

test('F-03 contract — setEnabled reports the observed state, never the request', async (t) => {
  const env = loadAutoStartSurface({ platform: 'win32', isPackaged: true });
  t.after(() => env.cleanup());

  const off = await env.exposed.schoolBellAutoStart.setEnabled(false);
  const on = await env.exposed.schoolBellAutoStart.setEnabled(true);

  // Each answer is the state observed after the write, so they legitimately
  // differ. What must never happen is a status whose `enabled` merely mirrors
  // what was asked for without an observation behind it — covered by the
  // read-back tests in autostart-unit2a.test.cjs.
  assert.equal(off.supported, true);
  assert.equal(off.enabled, false);
  assert.equal(on.supported, true);
  assert.equal(on.enabled, true);
});

test('F-03 contract — a non-boolean request is rejected deterministically', async (t) => {
  const env = loadAutoStartSurface({ platform: 'win32', isPackaged: true });
  t.after(() => env.cleanup());

  const status = await env.autostart.setEnabled('yes');
  assert.equal(status.supported, false);
  assert.equal(status.errorCode, 'AUTOSTART_INVALID_INPUT');
});

test('F-03 contract — the main process sanitizes a malformed status rather than passing it on', (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  assert.equal(env.autostart.sanitizeStatus(undefined).errorCode, 'AUTOSTART_READ_FAILED');
  assert.equal(env.autostart.sanitizeStatus(null).errorCode, 'AUTOSTART_READ_FAILED');
  assert.equal(env.autostart.sanitizeStatus('nope').errorCode, 'AUTOSTART_READ_FAILED');
  assert.equal(env.autostart.sanitizeStatus({ supported: 'yes' }).errorCode, 'AUTOSTART_READ_FAILED');
  assert.equal(
    env.autostart.sanitizeStatus({ supported: false, enabled: null, errorCode: 'MADE_UP_CODE' }).errorCode,
    'AUTOSTART_READ_FAILED',
    'an unknown code is not forwarded to the renderer',
  );

  const coerced = env.autostart.sanitizeStatus({ supported: true, enabled: 'truthy' });
  assert.equal(coerced.supported, true);
  assert.equal(coerced.enabled, false, 'a non-boolean enabled is coerced, never trusted');
});

// --------------------------------------------------------------------- IPC --

test('F-03 IPC — the renderer request reaches the dedicated auto-start channel', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  await env.exposed.schoolBellAutoStart.getStatus();

  assert.equal(env.invokeLog.length, 1);
  assert.equal(env.invokeLog[0].channel, `${CHANNEL}:get-status`, 'get uses the get-status channel');
});

test('F-03 IPC — set uses its own channel and forwards only a boolean', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  await env.exposed.schoolBellAutoStart.setEnabled(true);

  assert.equal(env.invokeLog[0].channel, `${CHANNEL}:set-enabled`);
  assert.deepEqual(env.invokeLog[0].payload, { enabled: true });
});

test('F-03 IPC — no unrelated channel is used, and only two verbs exist', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  await env.exposed.schoolBellAutoStart.getStatus();
  await env.exposed.schoolBellAutoStart.setEnabled(false);

  const channels = env.invokeLog.map((entry) => entry.channel);
  assert.deepEqual(channels, [`${CHANNEL}:get-status`, `${CHANNEL}:set-enabled`]);
  for (const entry of env.invokeLog) {
    assert.ok(entry.channel.startsWith(`${CHANNEL}:`), 'no settings or desktop channel is reused');
  }
  assert.deepEqual([...env.autostart.VERBS], ['get-status', 'set-enabled']);
});

test('F-03 IPC — the storage and desktop channels are untouched by F-03', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  const storageChannels = [...env.handlers.keys()].filter((c) => c.startsWith('school-bell:storage'));
  assert.deepEqual(storageChannels, [], 'F-03 registers nothing on the storage surface');
});

test('F-03 IPC — an untrusted sender is refused with AUTOSTART_FORBIDDEN', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux', trusted: false });
  t.after(() => env.cleanup());

  const status = await env.exposed.schoolBellAutoStart.getStatus();

  assert.equal(status.supported, false);
  assert.equal(status.errorCode, 'AUTOSTART_FORBIDDEN');
});

// ----------------------------------------------------------------- preload --

test('F-03 preload — the bridge exposes exactly three members', (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  const bridge = env.exposed.schoolBellAutoStart;
  assert.deepEqual(Object.keys(bridge).sort(), ['getStatus', 'isAutoStartBridge', 'setEnabled']);
});

test('F-03 preload — the bridge is frozen', (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  const bridge = env.exposed.schoolBellAutoStart;
  assert.ok(Object.isFrozen(bridge), 'the renderer cannot add or replace members');
  assert.throws(() => { 'use strict'; bridge.getStatus = () => 'hijacked'; }, TypeError);
  assert.equal(typeof bridge.getStatus, 'function', 'the original survived the attempt');
});

test('F-03 preload — no raw Electron IPC or OS capability is reachable', (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  const bridge = env.exposed.schoolBellAutoStart;
  const forbidden = [
    'ipcRenderer', 'invoke', 'send', 'on', 'emit', 'app', 'require', 'process',
    'setLoginItemSettings', 'getLoginItemSettings', 'openAtLogin',
  ];
  for (const key of forbidden) {
    assert.equal(bridge[key], undefined, `${key} must not be exposed`);
  }
  for (const key of Object.keys(bridge)) {
    assert.ok(
      ['isAutoStartBridge', 'getStatus', 'setEnabled'].includes(key),
      `unexpected bridge member: ${key}`,
    );
  }
});

test('F-03 preload — the renderer cannot choose a channel name', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  await env.exposed.schoolBellAutoStart.getStatus('school-bell:storage:hydrate');

  // The extra argument is ignored; the channel came from the closed allowlist.
  assert.equal(env.invokeLog[0].channel, `${CHANNEL}:get-status`);
  assert.deepEqual(env.invokeLog[0].payload, undefined);
});

test('F-03 preload — a rejected round trip resolves to a typed status instead of throwing', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  // Drop every handler so the bridge's invoke genuinely rejects.
  env.handlers.clear();

  const status = await env.exposed.schoolBellAutoStart.getStatus();
  assert.equal(status.supported, false);
  assert.equal(status.errorCode, 'AUTOSTART_BRIDGE_FAILED');
  assert.ok(looksLikeAutoStartStatus(status), 'the fallback still matches the union');
});

test('F-03 preload — the existing storage and desktop bridges are unchanged', (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  assert.equal(env.exposed.schoolBellStorage.isPersistent, true);
  assert.equal(typeof env.exposed.schoolBellStorage.commitAggregate, 'function');
  assert.equal(env.exposed.schoolBellDesktop.isDesktop, true);
  assert.equal(typeof env.exposed.schoolBellDesktop.onTrayAction, 'function');
  assert.ok(Object.isFrozen(env.exposed.schoolBellStorage), 'storage bridge stays frozen');
  assert.ok(Object.isFrozen(env.exposed.schoolBellDesktop), 'desktop bridge stays frozen');
});

// ------------------------------------------------- backward compatibility --

test('F-03 backward compatibility — the persisted autoStartWindows key is still a strict boolean', (t) => {
  const { validateSettings, KNOWN_KEYS } = loadSettingsSchema();

  // KNOWN_KEYS is a Set, not an array.
  assert.ok(KNOWN_KEYS.has('autoStartWindows'), 'the key name is unchanged');
  assert.equal(validateSettings({ autoStartWindows: true }).ok, true);
  assert.equal(validateSettings({ autoStartWindows: false }).ok, true);

  for (const bogus of ['true', 1, 0, null, {}, []]) {
    assert.equal(
      validateSettings({ autoStartWindows: bogus }).ok,
      false,
      `B5.1 must still reject ${JSON.stringify(bogus)}`,
    );
  }
});

test('F-03 backward compatibility — the auto-start contract never touches settings storage', async (t) => {
  const env = loadAutoStartSurface({ platform: 'linux' });
  t.after(() => env.cleanup());

  await env.exposed.schoolBellAutoStart.getStatus();
  await env.exposed.schoolBellAutoStart.setEnabled(true);

  // The auto-start module must not have pulled the storage module into its own
  // dependency graph: the contract is an OS concern, not a persisted-data one.
  const raw = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'autostart-ipc.cjs'),
    'utf8',
  );
  assert.ok(
    !raw.includes("require('./storage.cjs')"),
    'autostart-ipc.cjs must not depend on the storage module',
  );

  // Comments are allowed to *name* the persisted setting to explain why the two
  // concepts stay apart, so strip them and assert on executable code only.
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.ok(
    !code.includes('autoStartWindows'),
    'the contract must not read or write the persisted setting in code',
  );
});

test('F-03 — the unsupported-mechanism guard still holds, and the Electron API is used only where intended', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const electronDir = path.join(__dirname, '..');

// Unit 2A legitimately introduces Electron's login-item API. What must never
  // appear is a hand-rolled mechanism instead of it: no registry editing, no
  // startup-folder shortcut, no scheduled task, no shell command.
  //
  // These are forbidden everywhere under electron/, because no part of the app
  // has a legitimate reason to register a boot entry by hand.
  const forbiddenMechanisms = [
    'CurrentVersion\\\\Run',
    'RunOnce',
    'StartupFolder',
    'Startup Folder',
    'schtasks',
    'reg add',
    'reg.exe',
  ];

  // Shell execution is a different question. main.cjs legitimately spawns the
  // backend (pre-existing, see its line 11 and the F-04 baseline), so banning
  // `child_process` app-wide would be wrong. What matters is that the auto-start
  // path never reaches a shell — that check belongs to the module under test.
  const forbiddenInAutoStartModule = ['child_process', 'execSync', 'exec(', 'spawn'];

  // Electron's own API is permitted in exactly one production file.
  const allowedElectronApi = new Set(['autostart-ipc.cjs']);

  for (const file of fs.readdirSync(electronDir)) {
    if (!file.endsWith('.cjs')) continue;
    const source = fs.readFileSync(path.join(electronDir, file), 'utf8');

    for (const needle of forbiddenMechanisms) {
      assert.ok(
        !source.includes(needle),
        `${file} must not reference ${needle}`,
      );
    }

    if (file === 'autostart-ipc.cjs') {
      for (const needle of forbiddenInAutoStartModule) {
        assert.ok(
          !source.includes(needle),
          `the auto-start module must not shell out via ${needle}`,
        );
      }
    }

    const usesElectronApi =
      source.includes('setLoginItemSettings') || source.includes('getLoginItemSettings');
    if (usesElectronApi) {
      assert.ok(
        allowedElectronApi.has(file),
        `${file} must not touch the Electron login-item API; only autostart-ipc.cjs may`,
      );
    }
  }
});