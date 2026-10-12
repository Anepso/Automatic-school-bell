'use strict';

/**
 * F-03 Unit 2B — desired preference ↔ observed OS state synchronization tests.
 *
 * The OS seam in every test here is the *real* `autostart-ipc.cjs` running
 * against the login-item double, so write counts are counted at the Electron
 * API boundary rather than asserted against a hand-written fake. That means these
 * tests fail if the reconciliation logic bypasses the F-03 write path — which is
 * the whole point of §4/§5 of the unit contract.
 *
 * SCOPE OF PROOF. No real Windows, no real packaged executable, and no real
 * settings file are involved. These tests prove the synchronization *decision
 * logic* and its honesty properties, not that Windows boots the app.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadAutoStartSync, makeStorageStub } = require('./autostart-harness.cjs');

const PACKAGED_EXE = 'C:\\Program Files\\School Bell\\School Bell.exe';
const { OUTCOMES } = require('../autostart-sync.cjs');

/** A packaged Windows host, the only configuration where writes are legal. */
function packaged(options = {}) {
  return loadAutoStartSync({ platform: 'win32', isPackaged: true, execPath: PACKAGED_EXE, ...options });
}

/** Assert the result's full shape, so no field is silently dropped. */
function assertResultShape(result) {
  for (const key of ['outcome', 'synchronized', 'desired', 'observed', 'wrote', 'changed']) {
    assert.ok(key in result, `result carries ${key}`);
  }
  assert.ok(Object.values(OUTCOMES).includes(result.outcome), `known outcome: ${result.outcome}`);
  // synchronized must be derivable, never an independent optimistic claim.
  assert.equal(
    result.synchronized,
    result.desired !== null && result.observed !== null && result.desired === result.observed,
    'synchronized is always just desired === observed',
  );
}

// -------------------------------------------------- already synchronized --

test('Unit 2B — desired true / observed true needs no OS write', async (t) => {
  const env = packaged({ autoStartWindows: true, loginItem: { openAtLogin: true } });
  t.after(() => env.cleanup());

  const result = env.run();

  assertResultShape(result);
  assert.equal(result.outcome, OUTCOMES.ALREADY_SYNCHRONIZED);
  assert.equal(result.synchronized, true);
  assert.equal(result.desired, true);
  assert.equal(result.observed, true);
  assert.equal(result.changed, false);
  assert.equal(result.wrote, false);
  assert.equal(env.osWriteCount(), 0, 'idempotence: no write when already equal');
});

test('Unit 2B — desired false / observed false needs no OS write', async (t) => {
  const env = packaged({ autoStartWindows: false, loginItem: { openAtLogin: false } });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.outcome, OUTCOMES.ALREADY_SYNCHRONIZED);
  assert.equal(result.synchronized, true);
  assert.equal(result.observed, false);
  assert.equal(env.osWriteCount(), 0);
});

test('Unit 2B — repeated synchronization stays at zero writes in both directions', async (t) => {
  const on = packaged({ autoStartWindows: true, loginItem: { openAtLogin: true } });
  const off = packaged({ autoStartWindows: false, loginItem: { openAtLogin: false } });
  t.after(on.cleanup);
  t.after(off.cleanup);

  for (let i = 0; i < 5; i += 1) {
    assert.equal(on.run().outcome, OUTCOMES.ALREADY_SYNCHRONIZED);
    assert.equal(off.run().outcome, OUTCOMES.ALREADY_SYNCHRONIZED);
  }

  assert.equal(on.osWriteCount(), 0, 'sync(true) x5 while on writes nothing');
  assert.equal(off.osWriteCount(), 0, 'sync(false) x2 while off writes nothing');
});

// ---------------------------------------------------------- mismatches --

test('Unit 2B — desired true / observed false writes true and verifies it', async (t) => {
  const env = packaged({ autoStartWindows: true, loginItem: { openAtLogin: false } });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.outcome, OUTCOMES.CHANGED_AND_VERIFIED);
  assert.equal(result.synchronized, true);
  assert.equal(result.changed, true);
  assert.equal(result.wrote, true);
  assert.equal(result.observed, true);
  assert.equal(env.osWriteCount(), 1, 'exactly one OS write');
  assert.deepEqual(env.loginItem.calls.set[0], { openAtLogin: true, path: PACKAGED_EXE });
});

test('Unit 2B — desired false / observed true writes false and verifies it', async (t) => {
  const env = packaged({ autoStartWindows: false, loginItem: { openAtLogin: true } });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.outcome, OUTCOMES.CHANGED_AND_VERIFIED);
  assert.equal(result.synchronized, true);
  assert.equal(result.observed, false);
  assert.deepEqual(env.loginItem.calls.set[0], { openAtLogin: false, path: PACKAGED_EXE });
});

test('Unit 2B — both mismatch directions resolve to zero further writes on the next pass', async (t) => {
  const env = packaged({ autoStartWindows: true, loginItem: { openAtLogin: false } });
  t.after(() => env.cleanup());

  assert.equal(env.run().outcome, OUTCOMES.CHANGED_AND_VERIFIED);
  assert.equal(env.run().outcome, OUTCOMES.ALREADY_SYNCHRONIZED);
  assert.equal(env.run().outcome, OUTCOMES.ALREADY_SYNCHRONIZED);
  assert.equal(env.osWriteCount(), 1, 'the fix-up converges after a single write');
});

// ------------------------------------------------------------- honesty --

test('Unit 2B — a write the OS silently ignores is not reported as success', async (t) => {
  // The write is accepted but changes nothing: the case that separates a real
  // reconciliation from one that trusts "nothing threw".
  const env = packaged({
    autoStartWindows: true,
    loginItem: { openAtLogin: false, ignoreWrites: true },
  });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.synchronized, false, 'the desired state was not reached');
  assert.equal(result.outcome, OUTCOMES.OS_UPDATE_FAILED);
  assert.equal(result.wrote, true, 'a write really was attempted');
  assert.equal(result.changed, false, 'but no change was verified');
  assert.equal(result.observed, false, 'the OS still reports off');
  assert.equal(result.errorCode, 'AUTOSTART_SET_FAILED');
  assert.equal(env.osWriteCount(), 1);
});

test('Unit 2B — a rejected write reports failure and leaves the preference alone', async (t) => {
  const env = packaged({
    autoStartWindows: true,
    loginItem: { openAtLogin: false, throwOnSet: new Error('access is denied') },
  });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.synchronized, false);
  assert.equal(result.outcome, OUTCOMES.OS_UPDATE_FAILED);
  assert.equal(result.observed, null, 'unknown, never assumed false');
  assert.equal(result.errorCode, 'AUTOSTART_SET_FAILED');
  assert.deepEqual(env.storage.writes, [], 'the stored preference was not rewritten');
  assert.equal(env.storage.getAggregate('settings').value.autoStartWindows, true);
});

test('Unit 2B — a read that fails after the write is not treated as success', async (t) => {
  const env = packaged({
    autoStartWindows: true,
    loginItem: { openAtLogin: false, throwOnGet: new Error('gone') },
  });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.synchronized, false);
  assert.equal(result.outcome, OUTCOMES.UNABLE_TO_OBSERVE);
  assert.equal(result.observed, null);
  assert.equal(result.errorCode, 'AUTOSTART_READ_FAILED');
  assert.equal(env.osWriteCount(), 0, 'an unobservable OS is never written to');
});

test('Unit 2B — a failed read-back after a write reports the read failure', async (t) => {
  // The initial observation succeeds, the write lands, then the verification
  // read throws. This is the exact shape of §12: success cannot be inferred
  // from `setLoginItemSettings` not throwing.
  const env = packaged({
    autoStartWindows: true,
    loginItem: { openAtLogin: false, throwOnGetAfterCall: 1 },
  });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.synchronized, false);
  assert.equal(result.outcome, OUTCOMES.OS_UPDATE_FAILED);
  assert.equal(result.observed, null, 'unknown, never inferred from the accepted write');
  assert.equal(result.wrote, true, 'the write was issued');
  assert.equal(result.changed, false, 'an unverifiable change is not a change');
  assert.equal(result.errorCode, 'AUTOSTART_READ_FAILED', 'not SET_FAILED: the write was accepted');
  assert.equal(env.osWriteCount(), 1, 'the write really did happen');
  assert.equal(env.osReadCount(), 2, 'one observation plus one verification');
});

// --------------------------------------------------- unsupported hosts --

test('Unit 2B — a non-Windows host reports unsupported and changes nothing', async (t) => {
  const env = packaged({ platform: 'linux', autoStartWindows: true, loginItem: { openAtLogin: false } });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.outcome, OUTCOMES.UNSUPPORTED);
  assert.equal(result.synchronized, false);
  assert.equal(result.desired, true, 'the preference survives the refusal');
  assert.equal(result.observed, null);
  assert.equal(result.errorCode, 'AUTOSTART_UNSUPPORTED_PLATFORM');
  assert.equal(env.osWriteCount(), 0);
  assert.equal(env.osReadCount(), 0, 'a Linux host is never asked about Windows state');
  assert.deepEqual(env.storage.writes, [], 'a Linux host must not switch the setting off');
});

test('Unit 2B — an unpackaged Windows host reports NOT_PACKAGED and changes nothing', async (t) => {
  const env = packaged({
    isPackaged: false,
    execPath: '/tmp/electron/dist/electron',
    autoStartWindows: true,
    loginItem: { openAtLogin: false },
  });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.outcome, OUTCOMES.UNSUPPORTED);
  assert.equal(result.errorCode, 'AUTOSTART_NOT_PACKAGED');
  assert.equal(result.desired, true, 'a dev environment must not rewrite the user preference');
  assert.equal(result.observed, null);
  assert.equal(env.osWriteCount(), 0);
  assert.equal(env.osReadCount(), 0);
  assert.deepEqual(env.storage.writes, []);
});

// ------------------------------------------------------ storage failure --

test('Unit 2B — an unreadable store means no OS contact and no default', async (t) => {
  const env = packaged({
    autoStartWindows: true,
    loginItem: { openAtLogin: false },
    storage: makeStorageStub({ throwOnGet: Object.assign(new Error('disk gone'), { code: 'STORAGE_READ_FAILED' }) }),
  });
  t.after(() => env.cleanup());

  const result = env.run();

  assert.equal(result.outcome, OUTCOMES.STORAGE_UNAVAILABLE);
  assert.equal(result.synchronized, false);
  assert.equal(result.desired, null, 'unknown, never defaulted');
  assert.equal(result.observed, null);
  assert.equal(result.errorCode, 'STORAGE_READ_FAILED', 'the storage error code is preserved');
  assert.equal(env.osReadCount(), 0, 'the OS is not consulted when the goal is unknown');
  assert.equal(env.osWriteCount(), 0);
});

test('Unit 2B — a storage error code is preserved verbatim', async (t) => {
  const env = packaged({
    storage: makeStorageStub({
      throwOnGet: Object.assign(new Error('locked'), { code: 'STORAGE_CONFLICT' }),
    }),
  });
  t.after(() => env.cleanup());

  assert.equal(env.run().errorCode, 'STORAGE_CONFLICT');
});

test('Unit 2B — an absent or corrupt preference is a read failure, not a default', async (t) => {
  for (const rawValue of [null, {}, { autoStartWindows: 'yes' }, { autoStartWindows: 1 }, { autoStartWindows: null }]) {
    const env = packaged({
      storage: makeStorageStub({ rawValue }),
      loginItem: { openAtLogin: false },
    });
    try {
      const result = env.run();
      assert.equal(result.outcome, OUTCOMES.STORAGE_UNAVAILABLE, `for ${JSON.stringify(rawValue)}`);
      assert.equal(result.desired, null);
      assert.equal(result.errorCode, 'STORAGE_READ_FAILED');
      assert.equal(env.osWriteCount(), 0, 'never reconcile toward an invented preference');
    } finally {
      env.cleanup();
    }
  }
});

// ------------------------------------------------------- no write-back --

test('Unit 2B — reconciliation never rewrites the preference, on any outcome', async (t) => {
  const scenarios = [
    { autoStartWindows: true, loginItem: { openAtLogin: true } },
    { autoStartWindows: true, loginItem: { openAtLogin: false } },
    { autoStartWindows: true, loginItem: { openAtLogin: false, ignoreWrites: true } },
    { autoStartWindows: true, loginItem: { openAtLogin: false, throwOnSet: new Error('no') } },
    { autoStartWindows: true, loginItem: { openAtLogin: false, throwOnGet: new Error('no') } },
    { autoStartWindows: false, loginItem: { openAtLogin: true } },
  ];

  for (const scenario of scenarios) {
    const env = packaged(scenario);
    try {
      env.run();
      assert.deepEqual(env.storage.writes, [], `storage untouched for ${JSON.stringify(scenario.loginItem)}`);
    } finally {
      env.cleanup();
    }
  }
});

// --------------------------------------------------------- the contract --

test('Unit 2B — the F-03 public contract is untouched by this module', async (t) => {
  const env = packaged({ autoStartWindows: true, loginItem: { openAtLogin: false } });
  t.after(() => env.cleanup());

  env.run();

  // The same seam Unit 1 and 2A defined, still answering on its own terms.
  const status = env.autostart.getStatus();
  assert.equal(status.supported, true);
  assert.equal(typeof status.enabled, 'boolean');
  assert.equal(env.autostart.CHANNEL, 'school-bell:autostart');
  assert.deepEqual(env.autostart.VERBS, ['get-status', 'set-enabled']);
  assert.equal(env.handlers.has('school-bell:autostart:get-status'), true);
  assert.equal(env.handlers.has('school-bell:autostart:set-enabled'), true);
});

test('Unit 2B — needsChange answers without performing a write', async (t) => {
  const matching = packaged({ autoStartWindows: true, loginItem: { openAtLogin: true } });
  const differing = packaged({ autoStartWindows: true, loginItem: { openAtLogin: false } });
  t.after(matching.cleanup);
  t.after(differing.cleanup);

  assert.deepEqual(matching.sync.needsChange({ storage: matching.storage, autostart: matching.autostart }), {
    known: true,
    desired: true,
    observed: true,
    needed: false,
  });
  assert.equal(
    differing.sync.needsChange({ storage: differing.storage, autostart: differing.autostart }).needed,
    true,
  );
  assert.equal(differing.osWriteCount(), 0, 'asking is not doing');
});

test('Unit 2B — main.cjs never inlines the reconciliation algorithm', async (t) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');

  // Unit 2B left this unwired on purpose. Unit 2C then wired it — but only
  // through `autostart-boot.cjs`, so the invariant that actually matters is that
  // the *decision logic* stays in the sync module rather than being copied into
  // the boot path. That is what this test now protects.
  assert.ok(
    !/require\('\.\/autostart-sync\.cjs'\)/.test(main),
    'main.cjs must not depend on the sync module directly',
  );
  assert.ok(!/\bsynchronize\(/.test(main), 'main.cjs must not call synchronize() itself');
  assert.ok(!/\bneedsChange\(/.test(main), 'main.cjs must not probe for pending changes');
  t.diagnostic('Unit 2C wires it via autostart-boot.cjs; boot lifecycle stays owned by that module');
});