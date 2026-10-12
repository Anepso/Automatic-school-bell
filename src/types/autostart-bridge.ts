/**
 * Renderer-visible contract of the `schoolBellAutoStart` bridge exposed by
 * `electron/preload.cjs`, and of the F-03 Unit 1 auto-start result type.
 *
 * The discriminated union is deliberate. `supported` is the discriminant, so
 * narrowing on it makes `enabled` a plain `boolean` — there is no way for a
 * caller to read `enabled` without first handling the case where auto-start
 * could not be applied at all. An `enabled?: boolean` field would allow exactly
 * the bug this finding is about: showing "on" while nothing was registered.
 *
 * Like the storage bridge, every call resolves instead of rejecting: an
 * `ipcRenderer.invoke` rejection arrives as an opaque
 * "Error invoking remote method ..." string with the real cause mangled into
 * the message, so the typed `errorCode` has to survive in the resolved value.
 */

export type AutoStartErrorCode =
  /** The platform's boot behaviour is not something this app registers for. */
  | 'AUTOSTART_UNSUPPORTED_PLATFORM'
  /** Running unpackaged; a development binary is never a valid startup target. */
  | 'AUTOSTART_NOT_PACKAGED'
  /** Contract and boundary exist; no OS implementation is wired behind them yet. */
  | 'AUTOSTART_NOT_IMPLEMENTED'
  /** A set request did not reach the OS, or the OS refused it. */
  | 'AUTOSTART_SET_FAILED'
  /** The OS boot state could not be read. */
  | 'AUTOSTART_READ_FAILED'
  /** The requesting window is not the main window. */
  | 'AUTOSTART_FORBIDDEN'
  /** The renderer sent a payload that is not a boolean. */
  | 'AUTOSTART_INVALID_INPUT'
  /** The IPC round trip failed before any OS question was asked. */
  | 'AUTOSTART_BRIDGE_FAILED';

/** Auto-start is usable on this machine and its observed state is known. */
export interface AutoStartSupportedStatus {
  supported: true;
  enabled: boolean;
}

/**
 * Auto-start could not be applied or observed. `enabled` is `null`, never a
 * boolean, so "unknown" is unrepresentable as "off".
 */
export interface AutoStartUnsupportedStatus {
  supported: false;
  enabled: null;
  errorCode: AutoStartErrorCode;
}

/**
 * The complete contract surface. Unit 2 adds Windows behaviour behind this
 * shape; it does not widen or reshape it.
 *
 * This describes observed OS state only. It is deliberately NOT a mirror of the
 * persisted `autoStartWindows` setting, which records what the user asked for.
 */
export type AutoStartStatus = AutoStartSupportedStatus | AutoStartUnsupportedStatus;

export interface AutoStartBridge {
  /** True while the bridge is present, mirroring `schoolBellStorage.isPersistent`. */
  isAutoStartBridge: true;
  /** Read the observed OS boot state. Never mutates anything. */
  getStatus: () => Promise<AutoStartStatus>;
  /** Request a boot state, then report what the OS actually reports. */
  setEnabled: (enabled: boolean) => Promise<AutoStartStatus>;
}

/** Narrows an unknown IPC reply to the contract without trusting it. */
export function isAutoStartStatus(value: unknown): value is AutoStartStatus {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.supported === true) return typeof candidate.enabled === 'boolean';
  if (candidate.supported === false) {
    return candidate.enabled === null && typeof candidate.errorCode === 'string';
  }
  return false;
}

export function getAutoStartBridge(): AutoStartBridge | null {
  const bridge = (window as Window & { schoolBellAutoStart?: AutoStartBridge }).schoolBellAutoStart;
  return bridge && bridge.isAutoStartBridge === true ? bridge : null;
}