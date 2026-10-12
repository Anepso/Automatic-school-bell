'use strict';

/**
 * B5.2 F-03 Unit 2D — behavioural tests for the auto-start presentation logic.
 *
 * Why this file exists in this shape
 * ----------------------------------
 * The repo has no renderer test framework (no vitest/jest/testing-library/
 * jsdom) and Unit 2D must not add one. `src/utils/autostart.ts` and
 * `src/types/autostart-bridge.ts` both use extensionless imports, which Node's
 * native ESM loader rejects, so they cannot be imported here at all.
 *
 * `src/utils/autostart-ui-state.ts` is written to be import-free precisely so
 * this file can load it with a dynamic `import()` and exercise the real
 * decisions instead of a hand-written model of them. The filename matches the
 * existing `autostart-*.test.cjs` glob, so `npm run test:f03` picks it up with
 * no `package.json` change and no possibility of a silently-skipped test.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

let resolveAutoStartUiState;
let canRequestAutoStartChange;
let nextAutoStartRequest;
let AUTO_START_UI_MESSAGES;

test('autostart-ui-state.ts loads and exports its decision surface', async () => {
  const mod = await import('../../src/utils/autostart-ui-state.ts');
  resolveAutoStartUiState = mod.resolveAutoStartUiState;
  canRequestAutoStartChange = mod.canRequestAutoStartChange;
  nextAutoStartRequest = mod.nextAutoStartRequest;
  AUTO_START_UI_MESSAGES = mod.AUTO_START_UI_MESSAGES;

  assert.equal(typeof resolveAutoStartUiState, 'function');
  assert.equal(typeof canRequestAutoStartChange, 'function');
  assert.equal(typeof nextAutoStartRequest, 'function');
  assert.equal(typeof AUTO_START_UI_MESSAGES, 'object');
});

/** Wording injected by the caller, standing in for `describeAutoStartStatus`. */
const DESCRIBE_ACTIVE = 'Aplikasi dijalankan otomatis saat komputer dinyalakan.';
const DESCRIBE_INACTIVE = 'Aplikasi tidak dijalankan otomatis saat komputer dinyalakan.';
const describeFor = (status) =>
  status.supported
    ? status.enabled
      ? DESCRIBE_ACTIVE
      : DESCRIBE_INACTIVE
    : `tersebut:${status.errorCode}`;

const on = (enabled) => ({ supported: true, enabled });
const unsupported = (errorCode) => ({ supported: false, enabled: null, errorCode });

const input = (overrides = {}) => ({
  desired: false,
  status: on(false),
  pending: false,
  storageReady: true,
  statusMessage: DESCRIBE_INACTIVE,
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1–9. State rendering
// ---------------------------------------------------------------------------

test('1. desired true / observed true renders ON and an active status', () => {
  const s = resolveAutoStartUiState(input({ desired: true, status: on(true), statusMessage: DESCRIBE_ACTIVE }));
  assert.equal(s.checked, true);
  assert.equal(s.observed, true);
  assert.equal(s.aligned, true);
  assert.equal(s.mismatch, false);
  assert.equal(s.tone, 'active');
  assert.equal(s.message, DESCRIBE_ACTIVE);
  assert.equal(s.disabled, false);
});

test('2. desired false / observed false renders OFF and an inactive status', () => {
  const s = resolveAutoStartUiState(input({ desired: false, status: on(false) }));
  assert.equal(s.checked, false);
  assert.equal(s.observed, false);
  assert.equal(s.aligned, true);
  assert.equal(s.mismatch, false);
  assert.equal(s.tone, 'inactive');
  assert.equal(s.message, DESCRIBE_INACTIVE);
  assert.equal(s.disabled, false);
});

test('3. desired true / observed false keeps the switch ON and reports mismatch', () => {
  const s = resolveAutoStartUiState(input({ desired: true, status: on(false) }));
  // Decision A: the switch is intent and must not follow the observation.
  assert.equal(s.checked, true);
  assert.equal(s.observed, false);
  assert.equal(s.aligned, false);
  assert.equal(s.mismatch, true);
  assert.equal(s.tone, 'mismatch');
  assert.equal(s.message, AUTO_START_UI_MESSAGES.mismatch);
  assert.notEqual(s.message, DESCRIBE_INACTIVE);
  assert.equal(s.disabled, false, 'a mismatch is still user-actionable');
});

test('4. desired false / observed true keeps the switch OFF and reports mismatch', () => {
  const s = resolveAutoStartUiState(input({ desired: false, status: on(true), statusMessage: DESCRIBE_ACTIVE }));
  assert.equal(s.checked, false);
  assert.equal(s.observed, true);
  assert.equal(s.aligned, false);
  assert.equal(s.mismatch, true);
  assert.equal(s.tone, 'mismatch');
  assert.equal(s.message, AUTO_START_UI_MESSAGES.mismatch);
});

test('5. an unobserved state is unknown, never false', () => {
  const s = resolveAutoStartUiState(input({ status: null, statusMessage: null }));
  assert.equal(s.observed, null, 'null must survive; it is not coerced to false');
  assert.notEqual(s.observed, false);
  assert.equal(s.usable, false);
  assert.equal(s.disabled, true);
  assert.equal(s.tone, 'waiting');
  assert.equal(s.message, AUTO_START_UI_MESSAGES.waiting);
  assert.equal(s.aligned, null);
  assert.equal(s.mismatch, false);
});

test('6–9. every unsupported code disables the control and reuses the injected wording', () => {
  const codes = [
    'AUTOSTART_UNSUPPORTED_PLATFORM',
    'AUTOSTART_NOT_PACKAGED',
    'AUTOSTART_SET_FAILED',
    'AUTOSTART_READ_FAILED',
    'AUTOSTART_FORBIDDEN',
    'AUTOSTART_BRIDGE_FAILED',
    'AUTOSTART_INVALID_INPUT',
    'AUTOSTART_NOT_IMPLEMENTED',
  ];

  for (const errorCode of codes) {
    const status = unsupported(errorCode);
    const s = resolveAutoStartUiState(input({ status, statusMessage: describeFor(status) }));

    assert.equal(s.disabled, true, `${errorCode} must disable`);
    assert.equal(s.usable, false, `${errorCode} is not usable`);
    assert.equal(s.tone, 'unavailable', `${errorCode} is unavailable`);
    assert.equal(s.observed, null, `${errorCode} observes nothing`);
    // Wording is the injected `describeAutoStartStatus` output, so the
    // error-code mapping is never duplicated in this module.
    assert.equal(s.message, describeFor(status), `${errorCode} reuses injected copy`);
  }
});

test('unsupported state never reports enabled as a boolean', () => {
  const s = resolveAutoStartUiState(input({ status: unsupported('AUTOSTART_READ_FAILED'), statusMessage: 'x' }));
  assert.equal(s.checked, false, 'checked reflects desired, which is still a real boolean');
  assert.equal(s.observed, null);
  assert.notEqual(s.observed, false);
});

// ---------------------------------------------------------------------------
// 10–16. Interaction
// ---------------------------------------------------------------------------

test('10. pending disables the control and exposes a busy state', () => {
  const s = resolveAutoStartUiState(input({ desired: true, status: on(false), pending: true }));
  assert.equal(s.disabled, true);
  assert.equal(s.ariaBusy, true);
  assert.equal(s.tone, 'pending');
  assert.equal(s.message, AUTO_START_UI_MESSAGES.pending);
  assert.equal(s.usable, true, 'still usable, so only the request is blocked');
  assert.equal(s.checked, true);
});

test('11. unsupported disables the control', () => {
  const status = unsupported('AUTOSTART_UNSUPPORTED_PLATFORM');
  const s = resolveAutoStartUiState(input({ status, statusMessage: 'Run otomatis hanya tersedia di Windows.' }));
  assert.equal(s.disabled, true);
  assert.equal(s.ariaBusy, false);
});

test('12. a click while OFF requests true', () => {
  assert.equal(nextAutoStartRequest(false), true);
});

test('13. a click while ON requests false', () => {
  assert.equal(nextAutoStartRequest(true), false);
});

test('14. a failed OS operation leaves the desired preference untouched', () => {
  const status = unsupported('AUTOSTART_SET_FAILED');
  const s = resolveAutoStartUiState(input({ desired: false, status, statusMessage: 'Run otomatis gagal diaktifkan.' }));
  assert.equal(s.checked, false, 'desired survives a refused write');
  assert.equal(s.mismatch, false);
  assert.equal(s.tone, 'unavailable');
  assert.equal(s.message, 'Run otomatis gagal diaktifkan.');
});

test('15. a concurrent click is refused while pending', () => {
  const base = input({ desired: true, status: on(true), statusMessage: DESCRIBE_ACTIVE });
  assert.equal(canRequestAutoStartChange(base), true);
  assert.equal(
    canRequestAutoStartChange({ ...base, pending: true }),
    false,
    'no second write while one is in flight',
  );
});

test('16. interaction is blocked before hydration', () => {
  const base = input({ desired: true, status: on(true), statusMessage: DESCRIBE_ACTIVE });
  assert.equal(
    canRequestAutoStartChange({ ...base, storageReady: false }),
    false,
    'never act on a renderer default',
  );
  const s = resolveAutoStartUiState({ ...base, storageReady: false });
  assert.equal(s.disabled, true);
  assert.equal(s.usable, false);
});

test('a click is refused while the observed state is still unknown', () => {
  assert.equal(
    canRequestAutoStartChange(input({ status: null, statusMessage: null })),
    false,
  );
});

test('canRequestAutoStartChange agrees with the rendered disabled state', () => {
  const statuses = [
    { status: null, statusMessage: null },
    { status: on(true), statusMessage: DESCRIBE_ACTIVE },
    { status: on(false), statusMessage: DESCRIBE_INACTIVE },
    { status: unsupported('AUTOSTART_NOT_PACKAGED'), statusMessage: 'x' },
  ];
  for (const extra of statuses) {
    for (const storageReady of [true, false]) {
      for (const pending of [false, true]) {
        for (const desired of [true, false]) {
          const i = input({ ...extra, storageReady, pending, desired });
          const rendered = resolveAutoStartUiState(i);
          const accepted = canRequestAutoStartChange(i);
          // An unusable row is always disabled, so disabled ⇒ not clickable.
          // The converse (enabled ⇒ clickable) must also hold, otherwise the
          // user could click a live-looking control that silently does nothing.
          assert.equal(
            rendered.disabled && accepted,
            false,
            `disabled control must never accept a click (${JSON.stringify(extra)}, ready=${storageReady}, pending=${pending})`,
          );
          if (rendered.usable && storageReady && !pending) {
            assert.equal(accepted, true);
          }
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Desired/observed separation invariants
// ---------------------------------------------------------------------------

test('the switch value is derived from desired alone, in every reachable state', () => {
  const all = [
    { status: null, statusMessage: null },
    { status: on(true), statusMessage: DESCRIBE_ACTIVE },
    { status: on(false), statusMessage: DESCRIBE_INACTIVE },
    { status: unsupported('AUTOSTART_SET_FAILED'), statusMessage: 'x' },
  ];
  for (const extra of all) {
    for (const desired of [true, false]) {
      for (const pending of [false, true]) {
        for (const storageReady of [true, false]) {
          const s = resolveAutoStartUiState(input({ ...extra, desired, pending, storageReady }));
          assert.equal(s.checked, desired, 'checked must always equal desired');
        }
      }
    }
  }
});

test('a mismatch never resolves by adopting the observed value', () => {
  const up = resolveAutoStartUiState(input({ desired: true, status: on(false) }));
  const down = resolveAutoStartUiState(input({ desired: false, status: on(true) }));
  assert.equal(up.checked, true);
  assert.equal(down.checked, false);
  assert.notEqual(up.checked, up.observed);
  assert.notEqual(down.checked, down.observed);
});

test('no polling affordance is expressed by the decision layer', () => {
  const first = resolveAutoStartUiState(input({ status: on(true), statusMessage: DESCRIBE_ACTIVE }));
  const second = resolveAutoStartUiState(input({ status: on(true), statusMessage: DESCRIBE_ACTIVE }));
  assert.deepEqual(first, second, 'the decision is a pure function of its input');
});