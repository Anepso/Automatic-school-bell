/**
 * F-03 Unit 2D — pure presentation decision for the Settings auto-start row.
 *
 * This module exists because it can be *executed*. `src/utils/autostart.ts` and
 * `src/types/autostart-bridge.ts` both use extensionless imports, which Vite
 * resolves but Node's native ESM loader refuses (`ERR_MODULE_NOT_FOUND`), so
 * neither can be imported by a `node --test` file. This module deliberately has
 * **no imports at all**, which lets `electron/__tests__/*.test.cjs` load it with
 * a plain dynamic `import()` and run the nine auto-start states as real tests
 * without adding a test framework.
 *
 * Constraints this module honours:
 *
 * - No imports, no React, no Electron, no browser globals. Pure data in, pure
 *   data out. Everything it needs is passed to it.
 * - The persisted `autoStartWindows` preference (DESIRED) and the observed
 *   `AutoStartStatus` (REALITY) are kept as two separate facts. The switch is
 *   driven by DESIRED only. An observation never rewrites the preference, and
 *   the preference is never presented as proof that Windows agrees.
 * - The error-code → wording mapping is *injected* as `statusMessage`, because
 *   `describeAutoStartStatus()` already owns that mapping for all eight codes.
 *   Duplicating it here would create two places to keep in sync. The strings
 *   this module owns are only the ones no error code describes: not-yet-read,
 *   in-flight, and desired/observed disagreement.
 */

/** Visual weight of the status line. Drives colour only, never semantics. */
export type AutoStartUiTone =
  /** No observation has been made yet. */
  | 'waiting'
  /** A request is in flight to the OS. */
  | 'pending'
  /** Usable, and the OS reports the state the user asked for. */
  | 'active'
  /** Usable, and the OS confirms the state the user does not want. */
  | 'inactive'
  /** Usable, but the OS reports the opposite of the user's preference. */
  | 'mismatch'
  /** Auto-start cannot be applied or observed on this machine. */
  | 'unavailable';

/**
 * Structural mirror of `AutoStartStatus` from `src/types/autostart-bridge.ts`.
 *
 * Declared structurally rather than imported so this file stays import-free.
 * `AutoStartStatus` is assignable to `AutoStartUiStatus`, so the F-03 contract
 * is neither duplicated nor reshaped: `enabled: null` is preserved verbatim and
 * is never collapsed to `false`.
 */
export type AutoStartUiStatus =
  | { supported: true; enabled: boolean }
  | { supported: false; enabled: null; errorCode: string };

export interface AutoStartUiInput {
  /** Persisted user intent. Drives the switch. */
  desired: boolean;
  /** Observed OS state, or `null` while it has not been read yet. */
  status: AutoStartUiStatus | null;
  /** A `setEnabled` round trip is in flight. */
  pending: boolean;
  /** Storage hydration has resolved; the preference is trustworthy. */
  storageReady: boolean;
  /**
   * Output of `describeAutoStartStatus(status)`, injected by the caller.
   * Required whenever `status` is non-null.
   */
  statusMessage: string | null;
}

export interface AutoStartUiState {
  /** `aria-checked`. Desired state, never observed state. */
  checked: boolean;
  /** True when the control must not accept a click. */
  disabled: boolean;
  /** True while a request is in flight. */
  ariaBusy: boolean;
  /** True only when the OS can apply *and* report auto-start. */
  usable: boolean;
  /** Observed state, or `null` when unknown. Never coerced to `false`. */
  observed: boolean | null;
  /** Whether observed matches desired. `null` while not comparable. */
  aligned: boolean | null;
  /** Convenience inverse of `aligned`; `false` when not comparable. */
  mismatch: boolean;
  tone: AutoStartUiTone;
  /** User-facing Indonesian status text. */
  message: string;
}

/**
 * Wording this module owns. Every other message comes from
 * `describeAutoStartStatus()` via `statusMessage`.
 */
export const AUTO_START_UI_MESSAGES = {
  /** Nothing has been asked of the OS yet. */
  waiting: 'Memeriksa status run otomatis di Windows…',
  /** A request is on the wire. */
  pending: 'Menerapkan perubahan ke Windows…',
  /**
   * Desired and observed disagree. Boot reconciliation remains the safety net
   * for external drift, so the status points there instead of claiming either
   * value is wrong. Neither value is silently adopted.
   */
  mismatch:
    'Pilihan ini berbeda dari status di Windows. Status akan disesuaikan saat aplikasi dibuka lagi.',
} as const;

/**
 * Resolves everything the auto-start row renders.
 *
 * Order matters and encodes the fixed Unit 2D decisions:
 *
 * 1. Not hydrated → unavailable. The preference on screen is still the renderer
 *    default, so acting on it would mean acting on a value that may never have
 *    been the user's. Never write before `storageReady`.
 * 2. No observation yet → unavailable, with an explicit "checking" message
 *    instead of implying the feature is broken.
 * 3. Unsupported → unavailable, wording supplied by `describeAutoStartStatus`.
 * 4. Pending → busy, but stay `usable` so the row keeps its colour semantics.
 * 5. Otherwise compare desired against observed. A disagreement is surfaced as
 *    `mismatch`; it never rewrites `checked`.
 */
export function resolveAutoStartUiState(input: AutoStartUiInput): AutoStartUiState {
  const { desired, status, pending, storageReady, statusMessage } = input;

  const base = {
    // Decision A: the switch is the user's intent, always. Never `observed`.
    checked: desired,
    usable: false,
    observed: null,
    aligned: null,
    mismatch: false,
    tone: 'waiting' as AutoStartUiTone,
  };

  if (!storageReady) {
    return {
      ...base,
      disabled: true,
      ariaBusy: false,
      message: AUTO_START_UI_MESSAGES.waiting,
    };
  }

  if (status === null) {
    return {
      ...base,
      disabled: true,
      ariaBusy: false,
      message: AUTO_START_UI_MESSAGES.waiting,
    };
  }

  if (!status.supported) {
    return {
      ...base,
      disabled: true,
      ariaBusy: false,
      tone: 'unavailable',
      message: statusMessage ?? AUTO_START_UI_MESSAGES.waiting,
    };
  }

  const observed = status.enabled;
  const aligned = observed === desired;

  return {
    checked: desired,
    disabled: pending,
    ariaBusy: pending,
    usable: true,
    observed,
    aligned,
    mismatch: !aligned,
    tone: pending ? 'pending' : aligned ? (observed ? 'active' : 'inactive') : 'mismatch',
    message: pending
      ? AUTO_START_UI_MESSAGES.pending
      : aligned
        ? (statusMessage ?? AUTO_START_UI_MESSAGES.waiting)
        : AUTO_START_UI_MESSAGES.mismatch,
  };
}

/**
 * Whether a toggle click should be accepted.
 *
 * Mirrors the `disabled` the view renders, so the guard cannot drift from the
 * affordance shown to the user: blocked while hydrating, while the observed
 * state is unknown, while auto-start is unusable, and while a request is
 * already in flight (the guard that stops rapid double-toggling).
 */
export function canRequestAutoStartChange(input: AutoStartUiInput): boolean {
  const { pending, storageReady, status } = input;
  if (pending) return false;
  if (!storageReady) return false;
  return status !== null && status.supported === true;
}

/**
 * The value a click asks Windows for: the inverse of what the user currently
 * has switched on.
 *
 * Derived from DESIRED only, never from the observation — a request is an
 * intent, so an observed disagreement changes what the user wants next, not
 * what this click means.
 */
export function nextAutoStartRequest(desired: boolean): boolean {
  return !desired;
}