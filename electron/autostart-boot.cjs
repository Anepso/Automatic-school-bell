/**
 * F-03 Unit 2C — boot-time reconciliation wiring.
 *
 * Audit contract: STAGE_B5_SETTINGS_WINDOWS_STAGE_A_AUDIT.md §4.1 / F-03,
 * Unit 2C (startup reconciliation lifecycle).
 *
 * Units 1 and 2A built the contract and the OS boundary; Unit 2B built the
 * reconciliation algorithm. None of them ever *ran* it. This module is the thin
 * layer that decides to run it exactly once at startup, and — just as
 * importantly — that guarantees the attempt cannot interfere with booting.
 *
 * THE CONTRACT WITH THE BOOT SEQUENCE
 *
 * Boot is not allowed to fail because auto-start could not be reconciled. A user
 * whose Run entry is locked by policy must still get their bell app, so this
 * module never throws, never retries, and never quits. Every failure ends as a
 * log line and a returned result. `main.cjs` calls it as a statement, not as a
 * promise it must handle, because there is nothing it *can* handle.
 *
 * WHY A SEPARATE MODULE RATHER THAN A FEW LINES IN main.cjs
 *
 * Three reasons, in order of weight:
 *
 *   1. Testability. Invoking this exactly once, at the right moment, with a
 *      double that throws, is straightforward here and would require surgery on
 *      `app.whenReady()` inside `main.cjs` if inlined. `main.cjs` gets a single
 *      call; the behaviour gets a whole test suite.
 *   2. Isolation of risk. The boot path is F-04-verified protected surface. A
 *      self-contained module that cannot throw keeps the blast radius of this
 *      unit to a single statement.
 *   3. Ownership. The reconciliation *decision* stays in `autostart-sync.cjs`
 *      (Unit 2B, untouched). This module only decides *when* to ask and how to
 *      report. It contains no reconciliation logic of its own.
 *
 * FIRST-RUN SEMANTICS — audited, not assumed
 *
 * B4/B5.1 storage deliberately does NOT seed a default for `autoStartWindows`:
 * `emptyAggregate('settings')` returns `value: null`, and `storage.cjs` has no
 * settings-defaults table at all. The application's actual default lives in the
 * renderer, where `DEFAULT_SETTINGS` (`src/utils/storage.ts`) declares
 * `autoStartWindows: true` and hydration applies it as
 * `{ ...DEFAULT_SETTINGS, ...(payload.settings ?? {}) }` (`src/App.tsx`).
 *
 * So the three states are genuinely distinguishable:
 *
 *   value: null, or key absent  → "never recorded"; effective intent is the
 *                                  existing renderer default, `true`
 *   autoStartWindows: false     → an explicit user choice to keep it off
 *   autoStartWindows: true      → an explicit user choice to have it on
 *
 * The distinction that matters is *absent* versus *explicitly false*. Treating an
 * absent key as `false` would silently switch auto-start off on a fresh install
 * and contradict what the settings screen shows the user. Treating it as `true`
 * merely honours the default the project already ships.
 *
 * This resolves the Unit 2B open question (§16.4) using existing architecture as
 * evidence, and invents no new default. The value is surfaced as an exported
 * constant so it is auditable and overridable rather than buried.
 *
 * Note this is a *read-side* adaptation only: the adapter supplies an effective
 * desired value for reconciliation and writes nothing. A first-run install will
 * therefore have auto-start registered without `autoStartWindows` ever being
 * persisted. That is intentional — persisting it would mean writing the
 * preference, which is exactly what Unit 2B established must never happen
 * based on observed OS state. See the report's decision-point section.
 */

'use strict';

const { synchronize, OUTCOMES } = require('./autostart-sync.cjs');

/**
 * The project's existing default for `autoStartWindows`.
 *
 * Sourced from `DEFAULT_SETTINGS` in `src/utils/storage.ts`, which declares
 * `autoStartWindows: true`. Unit 2C preserves that existing semantics; it does
 * not introduce a new default of its own.
 */
const DEFAULT_AUTO_START_WINDOWS = true;

/**
 * Wrap the storage seam so an unrecorded preference reads as the app's default.
 *
 * Read-only by construction: this adapter exposes `getAggregate` only, so the
 * persistence guard in `autostart-sync.cjs` still cannot be reached, and no
 * value is ever written back.
 *
 * @param {object} storage the real or stubbed B4 storage module
 */
function withFirstRunDefault(storage) {
  return {
    getAggregate(name) {
      const doc = storage.getAggregate(name);
      if (name !== 'settings') return doc;

      const value = doc && doc.value;
      const recorded = value && typeof value === 'object' ? value : {};
      // An explicit boolean — including `false` — is the user's own decision and
      // is passed through untouched. Only a genuinely unrecorded value is filled.
      if (typeof recorded.autoStartWindows === 'boolean') return doc;

      return { ...doc, value: { ...recorded, autoStartWindows: DEFAULT_AUTO_START_WINDOWS } };
    },
  };
}

/**
 * Human-readable Indonesian line for each outcome, matching the `console`
 * convention already used throughout `main.cjs`.
 */
function describeOutcome(result) {
  switch (result.outcome) {
    case OUTCOMES.ALREADY_SYNCHRONIZED:
      return 'sesuai, tanpa perubahan.';
    case OUTCOMES.CHANGED_AND_VERIFIED:
      return `berhasil diterapkan (${result.observed ? 'aktif' : 'nonaktif'}).`;
    case OUTCOMES.UNSUPPORTED:
      return `tidak dapat diamati pada host ini (${result.errorCode}).`;
    case OUTCOMES.UNABLE_TO_OBSERVE:
      return `status sistem tidak dapat dibaca (${result.errorCode}).`;
    case OUTCOMES.OS_UPDATE_FAILED:
      return `pembaruan sistem gagal (${result.errorCode}).`;
    case OUTCOMES.STORAGE_UNAVAILABLE:
      return `preferensi tersimpan tidak dapat dibaca (${result.errorCode}).`;
    default:
      return 'hasil tidak dikenal.';
  }
}

/**
 * Run boot reconciliation exactly once, swallowing every failure.
 *
 * This function is the whole Unit 2C contract with `main.cjs`. It:
 *
 *   - calls `synchronize()` from Unit 2B — no reconciliation logic is duplicated
 *   - never throws, so a boot sequence awaiting it can never be aborted
 *   - never retries, and never writes the persisted preference
 *   - registers no IPC, so the renderer gains no new capability
 *
 * @param {object} deps
 * @param {object} deps.storage B4 storage module
 * @param {object} [deps.sync]   the Unit 2B module; injectable for tests
 * @param {object} [deps.logger] `{ log, error }`; defaults to `console`
 * @returns {{ attempted: boolean, threw: boolean, result: object|null }}
 */
function reconcileOnBoot(deps) {
  const { storage } = deps;
  const sync = deps.sync || { synchronize, OUTCOMES };
  const logger = deps.logger || console;

  try {
    const result = sync.synchronize({ storage: withFirstRunDefault(storage) });

    // Unit 2B's `synchronize()` is synchronous and returns a plain result, which
    // is asserted by its own tests. This guard costs nothing and closes the one
    // remaining way this call could hurt the process: if that seam ever became
    // async, an unhandled rejection would escape into the main process and could
    // surface as a crash. A rejection is absorbed and reported like any other
    // failure, and boot continues.
    if (result && typeof result.then === 'function') {
      result.then(
        () => {},
        (error) => {
          logger.error('School Bell: rekonsiliasi autostart saat start gagal.', error);
        },
      );
      return { attempted: true, threw: true, result: null };
    }

    logger.log(`School Bell: autostart ${describeOutcome(result)}`);
    return { attempted: true, threw: false, result };
  } catch (error) {
    // `synchronize()` is written not to throw, so reaching this means a defect
    // rather than an ordinary OS refusal. Boot must still continue.
    logger.error('School Bell: rekonsiliasi autostart saat start gagal.', error);
    return { attempted: true, threw: true, result: null };
  }
}

module.exports = {
  DEFAULT_AUTO_START_WINDOWS,
  OUTCOMES,
  withFirstRunDefault,
  describeOutcome,
  reconcileOnBoot,
};