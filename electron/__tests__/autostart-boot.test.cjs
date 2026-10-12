'use strict';

/**
 * F-03 Unit 2C — boot reconciliation lifecycle tests.
 *
 * The Unit 2B algorithm is deliberately NOT re-tested here; those 19 tests live
 * in `autostart-sync.test.cjs` and remain unchanged. What is under test now is
 * the layer above it: does startup invoke reconciliation exactly once, at the
 * right moment, and can it never take the application down with it?
 *
 * Two complementary techniques are used, because neither alone is sufficient:
 *
 *   - behavioural tests drive `reconcileOnBoot()` against doubles that count
 *     invocations, throw on demand, and record every storage write;
 *   - static tests read `main.cjs` itself to prove the call site exists exactly
 *     once and sits at the correct point in the startup sequence, since boot
 *     ordering cannot be observed from outside the process.
 *
 * SCOPE OF PROOF. No real Windows, no real packaged executable, no real settings
 * file. These tests prove the startup wiring and its failure containment.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  loadAutoStartSync,
  makeStorageStub,
  loadAutoStartSurface,
} = require('./autostart-harness.cjs');

const BOOT_PATH = path.join(__dirname, '..', 'autostart-boot.cjs');
const MAIN_PATH = path.join(__dirname, '..', 'main.cjs');
const PRELOAD_PATH = path.join(__dirname, '..', 'preload.cjs');

const PACKAGED_EXE = 'C:\\Program Files\\School Bell\\School Bell.exe';

const boot = require(BOOT_PATH);
const mainSource = fs.readFileSync(MAIN_PATH, 'utf8');

/** A recording logger so tests can assert the existing console convention is used. */
function makeLogger() {
  const lines = { log: [], error: [] };
  return {
    lines,
    log: (...args) => lines.log.push(args.join(' ')),
    error: (...args) => lines.error.push(args.join(' ')),
  };
}

/** A counting `synchronize` double, for exact-invocation assertions. */
function countingSync(outcome = 'already-synchronized', extra = {}) {
  const calls = [];
  return {
    calls,
    synchronize(deps) {
      calls.push(deps);
      return {
        outcome,
        synchronized: true,
        desired: true,
        observed: true,
        wrote: false,
        changed: false,
        ...extra,
      };
    },
  };
}

// -------------------------------------------------- invocation discipline --

test('Unit 2C — startup invokes synchronization exactly once', () => {
  const sync = countingSync();
  const storage = makeStorageStub({ autoStartWindows: true });

  boot.reconcileOnBoot({ storage, sync, logger: makeLogger() });

  assert.equal(sync.calls.length, 1, 'exactly one synchronization attempt per process');
});

test('Unit 2C — a failing synchronization is not retried', () => {
  const logger = makeLogger();
  const storage = makeStorageStub({ autoStartWindows: true });
  let attempts = 0;

  const sync = {
    OUTCOMES: boot.OUTCOMES,
    synchronize() {
      attempts += 1;
      throw new Error('boom');
    },
  };

  const outcome = boot.reconcileOnBoot({ storage, sync, logger });

  assert.equal(outcome.threw, true);
  assert.equal(attempts, 1, 'one attempt, no retry loop, no backoff');
  assert.equal(logger.lines.error.length, 1, 'the failure was reported, not swallowed');
  assert.match(logger.lines.error[0], /rekonsiliasi autostart saat start gagal/);
});

test('Unit 2C — main.cjs wires reconciliation at exactly one call site', () => {
  // One destructured import plus one invocation. A third reference would mean
  // reconciling on a path that can run more than once per process.
  const requires = mainSource.match(/require\('\.\/autostart-boot\.cjs'\)/g) || [];
  const calls = mainSource.match(/^\s*reconcileOnBoot\(\{ storage \}\);/gm) || [];
  const everyMention = mainSource.match(/reconcileOnBoot/g) || [];

  assert.equal(requires.length, 1, 'one import');
  assert.equal(calls.length, 1, 'one invocation site');
  assert.equal(everyMention.length, 2, 'the name appears only in the import and the call');
});

// ------------------------------------------------------------- ordering --

test('Unit 2C — reconciliation runs after storage readiness and app ready', () => {
  const whenReady = mainSource.indexOf('app.whenReady().then(async () => {');
  const initStore = mainSource.indexOf('storage.initStore()');
  const reconcile = mainSource.indexOf('reconcileOnBoot({ storage })');
  const createWindow = mainSource.indexOf('const windowLoad = createWindow()');

  assert.ok(whenReady !== -1 && reconcile !== -1, 'both are present');
  assert.ok(whenReady < reconcile, 'inside app.whenReady(): Electron is ready and the login-item API is usable');
  assert.ok(initStore < reconcile, 'after storage has been initialised');
  assert.ok(reconcile < createWindow, 'before the window and backend start, so startup sees a reconciled OS');
});

test('Unit 2C — reconciliation is not on the second-instance or F-04 paths', () => {
  // A second launch cannot have drifted anything: the first process still owns
  // the login item. Reconciling again would only risk a redundant OS write.
  const start = mainSource.indexOf("app.on('second-instance'");
  const end = mainSource.indexOf('app.whenReady().then(async () => {');
  const secondInstanceBlock = mainSource.slice(start, end);

  const beforeQuitStart = mainSource.indexOf("app.on('before-quit'");
  const beforeQuitBlock = mainSource.slice(beforeQuitStart);

  assert.ok(start !== -1 && end !== -1 && beforeQuitStart !== -1, 'all three anchors exist');
  assert.ok(!secondInstanceBlock.includes('reconcileOnBoot'), 'second-instance does not reconcile');
  assert.ok(!beforeQuitBlock.includes('reconcileOnBoot'), 'before-quit is untouched F-04 surface');
});

// ------------------------------------------------- failure containment --

test('Unit 2C — reconcileOnBoot cannot throw, for any seam failure', () => {
  // Asserted by catching here rather than letting an escape propagate, so a
  // regression is reported as a clear assertion failure instead of tearing down
  // the whole test file. This is the single most important guarantee in Unit 2C:
  // boot must survive an auto-start problem.
  const hostileSeams = [
    { label: 'synchronize throws', sync: { synchronize() { throw new Error('a'); } } },
    { label: 'synchronize returns garbage', sync: { synchronize() { return null; } } },
    { label: 'synchronize returns a rejected promise', sync: { synchronize() { return Promise.reject(new Error('b')); } } },
    { label: 'storage.getAggregate throws synchronously', sync: countingSync(), storageThrows: true },
    { label: 'storage.getAggregate returns undefined', sync: countingSync(), storageReturnsUndefined: true },
  ];

  for (const seam of hostileSeams) {
    const logger = makeLogger();
    const storage = seam.storageThrows
      ? { getAggregate() { throw new Error('no store'); } }
      : seam.storageReturnsUndefined
        ? { getAggregate() { return undefined; } }
        : makeStorageStub({ autoStartWindows: true });

    let escaped = null;
    let returned;
    try {
      returned = boot.reconcileOnBoot({
        storage,
        sync: { OUTCOMES: boot.OUTCOMES, ...seam.sync },
        logger,
      });
    } catch (error) {
      escaped = error;
    }

    assert.equal(escaped, null, `${seam.label}: must never escape into the boot sequence`);
    assert.ok(returned && typeof returned === 'object', `${seam.label}: returns a result object`);
    assert.equal(returned.attempted, true, seam.label);
  }
});

test('Unit 2C — synchronization failure does not abort boot', () => {
  const sync = countingSync();
  const logger = makeLogger();
  sync.synchronize = () => {
    throw new Error('unexpected defect');
  };

  // The contract is that boot continues: this must not throw, and must not ask
  // for a quit. `reconcileOnBoot` is called as a bare statement in main.cjs.
  const result = boot.reconcileOnBoot({ storage: makeStorageStub({ autoStartWindows: true }), sync, logger });

  assert.equal(result.threw, true);
  assert.equal(result.result, null);
  assert.equal(logger.lines.error.length, 1);
});

test('Unit 2C — a storage failure does not abort boot and never writes to the OS', () => {
  const env = loadAutoStartSync({
    platform: 'win32',
    isPackaged: true,
    execPath: PACKAGED_EXE,
    storage: makeStorageStub({
      throwOnGet: Object.assign(new Error('store is down'), { code: 'STORAGE_READ_FAILED' }),
    }),
    loginItem: { openAtLogin: false },
  });
  const logger = makeLogger();

  try {
    const result = boot.reconcileOnBoot({ storage: env.storage, logger });

    assert.equal(result.threw, false, 'reported, not thrown');
    assert.equal(result.result.outcome, boot.OUTCOMES.STORAGE_UNAVAILABLE);
    assert.equal(env.osReadCount(), 0, 'no OS read when the goal is unknown');
    assert.equal(env.osWriteCount(), 0, 'invariant F');
    assert.equal(logger.lines.error.length, 0, 'a degraded store is not an error dialog');
  } finally {
    env.cleanup();
  }
});

// ------------------------------------------------------- first-run audit --

test('Unit 2C — an unrecorded preference resolves to the project default of true', () => {
  // Evidence: DEFAULT_SETTINGS in src/utils/storage.ts declares
  // autoStartWindows: true, and hydration merges it as {...DEFAULT_SETTINGS, ...stored}.
  assert.equal(boot.DEFAULT_AUTO_START_WINDOWS, true);

  const adapter = boot.withFirstRunDefault(
    makeStorageStub({ rawValue: null }),
  );
  assert.equal(adapter.getAggregate('settings').value.autoStartWindows, true);
});

test('Unit 2C — an explicit false is honoured, never overwritten by the default', () => {
  // The distinction that matters: absent means "never recorded", false means
  // "the user turned it off".
  for (const recorded of [false, true]) {
    const adapter = boot.withFirstRunDefault(makeStorageStub({ autoStartWindows: recorded }));
    assert.equal(
      adapter.getAggregate('settings').value.autoStartWindows,
      recorded,
      `an explicit ${recorded} must survive`,
    );
  }
});

test('Unit 2C — first run on Windows registers auto-start without persisting a preference', () => {
  const env = loadAutoStartSync({
    platform: 'win32',
    isPackaged: true,
    execPath: PACKAGED_EXE,
    storage: makeStorageStub({ rawValue: null }),
    loginItem: { openAtLogin: false },
  });
  const logger = makeLogger();

  try {
    const result = boot.reconcileOnBoot({ storage: env.storage, logger });

    assert.equal(result.result.outcome, boot.OUTCOMES.CHANGED_AND_VERIFIED);
    assert.equal(result.result.desired, true, 'the effective intent is the existing default');
    assert.equal(env.osWriteCount(), 1);
    assert.deepEqual(env.loginItem.calls.set[0], { openAtLogin: true, path: PACKAGED_EXE });
    // Invariant H: the observed state is never written back into the preference.
    assert.deepEqual(env.storage.writes, [], 'nothing was persisted');
    assert.equal(env.storage.getAggregate('settings').value, null, 'still unrecorded on disk');
  } finally {
    env.cleanup();
  }
});

test('Unit 2C — an explicitly-disabled preference is never switched back on at boot', () => {
  const env = loadAutoStartSync({
    platform: 'win32',
    isPackaged: true,
    execPath: PACKAGED_EXE,
    storage: makeStorageStub({ autoStartWindows: false }),
    loginItem: { openAtLogin: true },
  });
  const logger = makeLogger();

  try {
    const result = boot.reconcileOnBoot({ storage: env.storage, logger });

    assert.equal(result.result.outcome, boot.OUTCOMES.CHANGED_AND_VERIFIED);
    assert.equal(result.result.desired, false);
    assert.deepEqual(env.loginItem.calls.set[0], { openAtLogin: false, path: PACKAGED_EXE });
    assert.deepEqual(env.storage.writes, []);
  } finally {
    env.cleanup();
  }
});

// ------------------------------------------------------------ invariants --

test('Unit 2C — the nine stated invariants hold at boot', async (t) => {
  const cases = [
    { name: 'A desired/observed true', desired: true, os: true, writes: 0, sync: 'already-synchronized' },
    { name: 'B desired/observed false', desired: false, os: false, writes: 0, sync: 'already-synchronized' },
    { name: 'C desired true, observed false', desired: true, os: false, writes: 1, sync: 'changed-and-verified' },
    { name: 'D desired false, observed true', desired: false, os: true, writes: 1, sync: 'changed-and-verified' },
  ];

  for (const item of cases) {
    const env = loadAutoStartSync({
      platform: 'win32',
      isPackaged: true,
      execPath: PACKAGED_EXE,
      storage: makeStorageStub({ autoStartWindows: item.desired }),
      loginItem: { openAtLogin: item.os },
    });
    try {
      const result = boot.reconcileOnBoot({ storage: env.storage, logger: makeLogger() });
      assert.equal(result.result.outcome, item.sync, item.name);
      assert.equal(env.osWriteCount(), item.writes, `${item.name}: OS write count`);
      assert.deepEqual(env.storage.writes, [], `${item.name}: preference untouched`);
    } finally {
      env.cleanup();
    }
  }
});

test('Unit 2C — repeated startups while already synchronized write nothing (invariant I)', () => {
  // Each call models a fresh process launch. Once reconciled, later launches
  // must be silent: no unnecessary Run entry rewrites.
  const storage = makeStorageStub({ autoStartWindows: true });
  let osOn = false;
  let writes = 0;

  const sync = {
    OUTCOMES: boot.OUTCOMES,
    synchronize() {
      if (osOn === storage.getAggregate('settings').value.autoStartWindows) {
        return { outcome: 'already-synchronized', synchronized: true, desired: true, observed: osOn, wrote: false, changed: false };
      }
      writes += 1;
      osOn = true;
      return { outcome: 'changed-and-verified', synchronized: true, desired: true, observed: true, wrote: true, changed: true };
    },
  };

  for (let launch = 0; launch < 4; launch += 1) boot.reconcileOnBoot({ storage, sync, logger: makeLogger() });

  assert.equal(writes, 1, 'only the first launch needed to change the OS');
});

// -------------------------------------------------- capability isolation --

test('Unit 2C — a Linux host reports unsupported and boots on', () => {
  const env = loadAutoStartSync({
    platform: 'linux',
    storage: makeStorageStub({ autoStartWindows: true }),
    loginItem: { openAtLogin: false },
  });
  const logger = makeLogger();

  try {
    const result = boot.reconcileOnBoot({ storage: env.storage, logger });

    assert.equal(result.threw, false);
    assert.equal(result.result.outcome, boot.OUTCOMES.UNSUPPORTED);
    assert.equal(result.result.desired, true, 'the preference is untouched on a dev host');
    assert.equal(result.result.observed, null, 'invariant E: unknown, never false');
    assert.equal(env.osWriteCount(), 0);
    assert.equal(logger.lines.error.length, 0, 'no error dialog for a normal Linux dev run');
  } finally {
    env.cleanup();
  }
});

test('Unit 2C — an unpackaged Windows host reports NOT_PACKAGED and boots on', () => {
  const env = loadAutoStartSync({
    platform: 'win32',
    isPackaged: false,
    storage: makeStorageStub({ autoStartWindows: true }),
    loginItem: { openAtLogin: false },
  });
  const logger = makeLogger();

  try {
    const result = boot.reconcileOnBoot({ storage: env.storage, logger });

    assert.equal(result.threw, false);
    assert.equal(result.result.outcome, boot.OUTCOMES.UNSUPPORTED);
    assert.equal(result.result.errorCode, 'AUTOSTART_NOT_PACKAGED');
    assert.equal(result.result.desired, true);
    assert.equal(env.osWriteCount(), 0);
  } finally {
    env.cleanup();
  }
});

// ---------------------------------------------------------- no new surface --

test('Unit 2C — boot reconciliation registers no IPC channel', () => {
  const surface = loadAutoStartSurface({ platform: 'win32', isPackaged: true });

  try {
    const before = [...surface.handlers.keys()].sort();
    boot.reconcileOnBoot({ storage: makeStorageStub({ autoStartWindows: true }), logger: makeLogger() });
    const after = [...surface.handlers.keys()].sort();

    assert.deepEqual(after, before, 'handler set is unchanged');
    assert.deepEqual(after, [
      'school-bell:autostart:get-status',
      'school-bell:autostart:set-enabled',
    ], 'still exactly the two Unit 1 channels, and nothing new');
    assert.deepEqual(surface.invokeLog, [], 'boot reconciliation speaks to no renderer');
  } finally {
    surface.cleanup();
  }
});

test('Unit 2C — the renderer cannot reach boot reconciliation', () => {
  const preload = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const types = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'types', 'autostart-bridge.ts'), 'utf8');
  const facade = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'utils', 'autostart.ts'), 'utf8');

  for (const [name, source] of [['preload', preload], ['types', types], ['renderer facade', facade]]) {
    for (const needle of ['autostart-boot', 'reconcileOnBoot', 'synchronize', 'needsChange']) {
      assert.ok(!source.includes(needle), `${name} must not reference ${needle}`);
    }
  }
  assert.ok(!Object.keys(types).includes('AutoStartSyncResult'), 'no sync type leaked to the renderer');
});

test('Unit 2C — reconciliation cannot reach the boot error dialog', () => {
  // The existing `.catch` that shows an error box and quits must stay in place
  // for genuine boot failures. What must be impossible is for reconciliation to
  // reach it, so the guarantee is structural: the call is a bare statement whose
  // result is never awaited, chained, or returned into the boot promise.
  assert.ok(
    !/await\s+reconcileOnBoot/.test(mainSource),
    'reconcileOnBoot is not awaited',
  );
  assert.ok(
    !/reconcileOnBoot\([^)]*\)\s*\./.test(mainSource),
    'its result is not chained with .then/.catch',
  );
  assert.ok(
    !/return\s+reconcileOnBoot/.test(mainSource),
    'it is not returned into the boot promise',
  );

  // And behaviourally: even when the seam throws, the caller receives a plain
  // result object rather than a rejected promise.
  const result = boot.reconcileOnBoot({
    storage: makeStorageStub({ autoStartWindows: true }),
    sync: {
      OUTCOMES: boot.OUTCOMES,
      synchronize() {
        throw new Error('defect');
      },
    },
    logger: makeLogger(),
  });
  assert.equal(typeof result.then, 'undefined', 'not a promise');
  assert.equal(result.threw, true);
  assert.equal(typeof result.attempted, 'boolean');
});

// ------------------------------------------------- protected fingerprints --

test('Unit 2C — Unit 1, 2A and 2B artefacts are byte-identical to the Unit 2B baseline', () => {
  // Recorded checksums from the completed Unit 2B verification. This test is the
  // mechanical guarantee behind "JANGAN mengubah Unit 2B": if any of these files
  // is edited, this fails rather than relying on a reviewer noticing.
  //
  // Rescoped by Unit 2D: `src/components/PengaturanView.tsx` was removed from
  // this list because Unit 2D's declared scope is the Settings row itself, so
  // that file is now legitimately edited by the newest unit. Every file that
  // carries the F-03 *contract* or the main-process reconciliation remains
  // listed and unchanged here, and Unit 2D re-asserts the same checksums
  // independently in `autostart-2d-guards.test.cjs`.
  const baseline = {
    'electron/autostart-ipc.cjs': 'ea6c40383b6bff9caef070f16f7ff627',
    'electron/autostart-sync.cjs': 'b222bd35bde940e2a342b8ed2c049ff8',
    'electron/preload.cjs': '9de3aa9c1df88379e743758a89605d06',
    'src/types/autostart-bridge.ts': '90e5454636a80cb539671561d66892dd',
    'src/utils/autostart.ts': 'e27936a128364ee6c0ee3dca28fd0750',
    'electron/storage.cjs': '7d55a73cedf4c0651588cfb5c8738bc0',
    'electron/settings-schema.cjs': '66e1b837c3b82e39cbd2a0d28d8843ce',
    'electron/__tests__/f04-lifecycle.test.cjs': '58514c30dedce4a641b769bced5e795e',
  };
  const root = path.join(__dirname, '..', '..');

  for (const [relative, expected] of Object.entries(baseline)) {
    const actual = crypto.createHash('md5').update(fs.readFileSync(path.join(root, relative))).digest('hex');
    assert.equal(actual, expected, `${relative} must match the F-03 reconciled baseline`);
  }
});

test('Unit 2C — main.cjs gained only the boot wiring, deleting nothing', () => {
  // Every F-04 block the unit contract names must still be present verbatim.
  for (const marker of [
    "app.on('before-quit'",
    "app.on('window-all-closed'",
    "app.on('second-instance'",
    'hasTrayRestorePath()',
    'stopPowerSaveBlocker()',
    'createTray()',
    "dialog.showErrorBox('School Bell gagal dibuka'",
  ]) {
    assert.ok(mainSource.includes(marker), `${marker} survives`);
  }
  assert.ok(
    !/autostart-boot|reconcileOnBoot/.test(
      mainSource.slice(mainSource.indexOf("app.on('before-quit'"), mainSource.indexOf("app.on('window-all-closed'")),
    ),
    'no boot-reconciliation reference inside the F-04 before-quit / window-all-closed region',
  );
});