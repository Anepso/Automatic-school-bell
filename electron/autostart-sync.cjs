/**
 * F-03 Unit 2B — desired preference ↔ observed OS state synchronization.
 *
 * Audit contract: STAGE_B5_SETTINGS_WINDOWS_STAGE_A_AUDIT.md §4.1 / F-03,
 * Unit 2B (synchronization layer).
 *
 * WHAT THIS MODULE IS FOR
 *
 * Unit 1 defined the contract, Unit 2A implemented the Windows OS boundary. Both
 * deliberately stop short of the question the user actually cares about: the app
 * remembers that auto-start should be on, the OS says something else, and nobody
 * fixes the disagreement. This module is that missing step — and only that step.
 *
 * It sits directly above `autostart-ipc.cjs`:
 *
 *     storage (desired)  ──┐
 *                          ├──>  autostart-sync.cjs  ──>  autostart-ipc.cjs
 *     Windows OS state   ──┘      this module              (OS capability)
 *
 * THE ONE RULE THAT SHAPES EVERYTHING HERE
 *
 * `autoStartWindows` and the observed OS state are different quantities. The user
 * asked for something; Windows independently says what it will do. This module
 * never collapses the two, and in particular it never lets one stand in for the
 * other:
 *
 *   - an unreadable OS state is `observed: null`, never coerced to `false`
 *   - a failed reconciliation never rewrites the user's stored preference
 *   - a write is only ever called "successful" after the OS confirms it
 *
 * A user who requested auto-start on a machine that cannot honour it must keep
 * seeing "on" in their settings. Silently flipping their preference to `false`
 * would erase the fact that they wanted it, and hide a real failure behind a
 * tidy-looking success.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 * There is no retry loop, no backoff, and no persistence write-back. It is a pure
 * "make one attempt, then report honestly" function. Deciding *when* to run it —
 * in particular reconciling at boot — belongs to Unit 2C, and no startup path
 * calls this yet.
 *
 * The renderer cannot reach any of this: synchronization is main-process
 * ownership, so the renderer is never the authority for reconciliation.
 */

'use strict';

// Internal, main-process-only discriminants. These are NOT renderer-visible
// strings and are deliberately distinct from the Unit 1 `AUTOSTART_*` contract,
// which is unchanged by this unit.
const OUTCOMES = Object.freeze({
  /** Observed state already matched the preference; no OS write was issued. */
  ALREADY_SYNCHRONIZED: 'already-synchronized',
  /** A write was issued and the OS confirmed the preference took effect. */
  CHANGED_AND_VERIFIED: 'changed-and-verified',
  /** This host cannot be observed at all: wrong platform, or unpackaged. */
  UNSUPPORTED: 'unsupported',
  /** The OS state could not be read; no write was attempted. */
  UNABLE_TO_OBSERVE: 'unable-to-observe',
  /** A write was attempted but the desired state could not be confirmed. */
  OS_UPDATE_FAILED: 'os-update-failed',
  /** The stored preference could not be read; the OS was never contacted. */
  STORAGE_UNAVAILABLE: 'storage-unavailable',
});

/**
 * Storage failures reuse B4's own error vocabulary rather than inventing a
 * second one. `AUTOSTART_*` codes come from the Unit 1 contract, `STORAGE_*`
 * codes from `storage.cjs`.
 */
const STORAGE_READ_FAILED = 'STORAGE_READ_FAILED';

/**
 * Build the result object with every field always present.
 *
 * `desired` and `observed` are tri-state on purpose. `null` means "not known",
 * which is a materially different statement from `false`, and collapsing the two
 * is the specific bug this whole unit exists to prevent.
 */
function makeResult(fields) {
  return {
    outcome: fields.outcome,
    synchronized: fields.synchronized === true,
    desired: fields.desired === undefined ? null : fields.desired,
    observed: fields.observed === undefined ? null : fields.observed,
    // `wrote` = an OS write was actually issued by this call.
    wrote: fields.wrote === true,
    // `changed` = the OS was *verified* to have adopted the preference.
    changed: fields.changed === true,
    errorCode: fields.errorCode,
  };
}

/**
 * Read the user's persisted preference.
 *
 * Read-only by design: this module never receives a commit function, so
 * "rewrite the preference on failure" is not merely avoided, it is structurally
 * impossible. That is the strongest guarantee available for §10 of the unit
 * contract, and it is why no storage mutation test is needed.
 *
 * An absent or non-boolean `autoStartWindows` is treated as a read failure
 * rather than defaulted. `sanitizeSettings()` in B5.1 drops an unusable key
 * instead of repairing it, so "missing" here can mean "corrupt on disk" — and
 * guessing a default there would quietly invent a preference the user never
 * expressed.
 *
 * @returns {{ ok: true, value: boolean } | { ok: false, errorCode: string }}
 */
function readDesiredState(storage) {
  let doc;
  try {
    doc = storage.getAggregate('settings');
  } catch (error) {
    // `StorageError` carries a curated `.code`; anything else is unexpected and
    // is reported as a read failure rather than leaking a raw message upward.
    const code = error && typeof error.code === 'string' ? error.code : STORAGE_READ_FAILED;
    return { ok: false, errorCode: code };
  }

  const settings = doc && doc.value;
  if (!settings || typeof settings !== 'object') {
    return { ok: false, errorCode: STORAGE_READ_FAILED };
  }
  if (typeof settings.autoStartWindows !== 'boolean') {
    return { ok: false, errorCode: STORAGE_READ_FAILED };
  }
  return { ok: true, value: settings.autoStartWindows };
}

/**
 * Reduce an F-03 status to "a trustworthy observation, or a reason we have none".
 *
 * The strictness matters: `supported: true` with a non-boolean `enabled` is a
 * contract violation, and treating it as `false` would be the exact confident
 * guess this module refuses to make.
 */
function readObservation(autostart) {
  const status = autostart.getStatus();
  if (!status || status.supported !== true) {
    return { ok: false, errorCode: (status && status.errorCode) || 'AUTOSTART_READ_FAILED' };
  }
  if (typeof status.enabled !== 'boolean') {
    return { ok: false, errorCode: 'AUTOSTART_READ_FAILED' };
  }
  return { ok: true, enabled: status.enabled };
}

/**
 * Make the persisted preference match the observed OS state, exactly once.
 *
 * `synchronize()` is synchronous because both seams are: `getAggregate` reads
 * from an already-hydrated in-memory store, and the Electron login-item API is
 * synchronous. There is no awaiting, no queueing, and no retry.
 *
 * @param {object} [deps]
 * @param {object} [deps.storage]   storage seam; defaults to `storage.cjs`
 * @param {object} [deps.autostart] OS seam; defaults to `autostart-ipc.cjs`
 * @returns {object} an `AutoStartSyncResult`
 */
function synchronize(deps = {}) {
  // Required lazily so a caller can inject either seam without the module
  // pulling in the real store or the real Electron API at load time.
  const storage = deps.storage || require('./storage.cjs');
  const autostart = deps.autostart || require('./autostart-ipc.cjs');

  // 1. Desired state. If the preference is unreadable the OS is never touched:
  //    reconciling toward a goal we do not know would be pure invention.
  const desired = readDesiredState(storage);
  if (!desired.ok) {
    return makeResult({
      outcome: OUTCOMES.STORAGE_UNAVAILABLE,
      synchronized: false,
      errorCode: desired.errorCode,
    });
  }

  // 2. Observed state, before any change.
  const before = readObservation(autostart);
  if (!before.ok) {
    // An unobservable host is not an unsynchronized one. We report the platform
    // or packaging code and leave the preference exactly as the user set it,
    // because a Linux development box says nothing about the user's intent.
    const outcome =
      before.errorCode === 'AUTOSTART_UNSUPPORTED_PLATFORM' || before.errorCode === 'AUTOSTART_NOT_PACKAGED'
        ? OUTCOMES.UNSUPPORTED
        : OUTCOMES.UNABLE_TO_OBSERVE;
    return makeResult({
      outcome,
      synchronized: false,
      desired: desired.value,
      observed: null,
      errorCode: before.errorCode,
    });
  }

  // 3. Already equal — the idempotence short-circuit. No OS write is issued.
  //    This is what makes repeated calls free instead of repeatedly rewriting
  //    the same `Run` entry.
  if (before.enabled === desired.value) {
    return makeResult({
      outcome: OUTCOMES.ALREADY_SYNCHRONIZED,
      synchronized: true,
      desired: desired.value,
      observed: before.enabled,
    });
  }

  // 4. Genuine disagreement — ask the existing F-03 write path to fix it, then
  //    trust only what it reports back.
  const after = autostart.setEnabled(desired.value);

  if (!after || after.supported !== true) {
    // The write did not land, or the read-back after it failed. We did issue a
    // write, so this is an update failure rather than an observation failure.
    return makeResult({
      outcome: OUTCOMES.OS_UPDATE_FAILED,
      synchronized: false,
      desired: desired.value,
      observed: null,
      wrote: true,
      errorCode: (after && after.errorCode) || 'AUTOSTART_SET_FAILED',
    });
  }

  if (after.enabled !== desired.value) {
    // The write was accepted but the OS did not adopt it. This is the case a
    // naive implementation reports as success just because nothing threw.
    return makeResult({
      outcome: OUTCOMES.OS_UPDATE_FAILED,
      synchronized: false,
      desired: desired.value,
      observed: after.enabled,
      wrote: true,
      errorCode: 'AUTOSTART_SET_FAILED',
    });
  }

  return makeResult({
    outcome: OUTCOMES.CHANGED_AND_VERIFIED,
    synchronized: true,
    desired: desired.value,
    observed: after.enabled,
    wrote: true,
    changed: true,
  });
}

/**
 * Read-only reconciliation check: would a call change anything?
 *
 * Useful for a caller deciding whether work is needed, without performing it.
 * Shares the exact same observation path as `synchronize`, so the two can never
 * disagree about whether the OS is already in the requested state.
 */
function needsChange(deps = {}) {
  const storage = deps.storage || require('./storage.cjs');
  const autostart = deps.autostart || require('./autostart-ipc.cjs');

  const desired = readDesiredState(storage);
  if (!desired.ok) return { known: false, reason: desired.errorCode };
  const before = readObservation(autostart);
  if (!before.ok) return { known: false, reason: before.errorCode };
  return { known: true, desired: desired.value, observed: before.enabled, needed: before.enabled !== desired.value };
}

module.exports = {
  OUTCOMES,
  STORAGE_READ_FAILED,
  synchronize,
  needsChange,
  // Exposed for focused unit tests of the tri-state reduction helpers.
  _internal: { readDesiredState, readObservation, makeResult },
};