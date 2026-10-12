import {
  getAutoStartBridge,
  isAutoStartStatus,
  type AutoStartStatus,
} from '../types/autostart-bridge';

/**
 * Renderer-side auto-start facade (F-03 Unit 1).
 *
 * Mirrors the `src/utils/storage.ts` pattern: a thin, typed layer over the
 * preload bridge that the UI can call without knowing about IPC, and that
 * returns a valid contract value on every path — including when the bridge is
 * absent or the round trip fails. No Electron API is reachable from here.
 *
 * These functions report *observed OS state*. They deliberately do not read or
 * write the persisted `autoStartWindows` setting, which is the user's request.
 * The settings screen owns that field and keeps using the existing B4/B5.1
 * commit path; the two values are allowed to differ, and a caller that wants
 * "what did the user ask for" must ask the settings store, not this module.
 */

/** Fallback used when the preload bridge is missing entirely (web/dev host). */
export function autoStartUnavailableStatus(): AutoStartStatus {
  return {
    supported: false,
    enabled: null,
    errorCode: 'AUTOSTART_BRIDGE_FAILED',
  };
}

/**
 * Coerce an IPC reply into the contract.
 *
 * A reply that does not match the union is never passed through: a malformed or
 * hostile reply degrades to an explicit failure so no caller can read an
 * `enabled` value that the main process never actually asserted.
 */
function toStatus(value: unknown): AutoStartStatus {
  return isAutoStartStatus(value) ? value : autoStartUnavailableStatus();
}

/** Read the observed OS boot state. Changes nothing. */
export async function getAutoStartStatus(): Promise<AutoStartStatus> {
  const bridge = getAutoStartBridge();
  if (!bridge) return autoStartUnavailableStatus();
  try {
    return toStatus(await bridge.getStatus());
  } catch {
    return autoStartUnavailableStatus();
  }
}

/**
 * Request a boot state and report what the OS then reports.
 *
 * `requested` is an intent handed to the main process. The returned status
 * describes the observed outcome, which may legitimately contradict the request
 * — callers must not assume success from a resolved promise.
 */
export async function setAutoStartEnabled(requested: boolean): Promise<AutoStartStatus> {
  const bridge = getAutoStartBridge();
  if (!bridge) return autoStartUnavailableStatus();
  if (typeof requested !== 'boolean') {
    return { supported: false, enabled: null, errorCode: 'AUTOSTART_INVALID_INPUT' };
  }
  try {
    return toStatus(await bridge.setEnabled(requested));
  } catch {
    return autoStartUnavailableStatus();
  }
}

/** True only when auto-start is usable *and* its observed state is known. */
export function isAutoStartUsable(status: AutoStartStatus): status is {
  supported: true;
  enabled: boolean;
} {
  return status.supported === true;
}

/**
 * Short Indonesian explanation for a status, so the settings screen does not
 * have to branch on codes itself and Unit 2 does not have to touch the UI to
 * add wording.
 */
export function describeAutoStartStatus(status: AutoStartStatus): string {
  if (status.supported) {
    return status.enabled
      ? 'Aplikasi dijalankan otomatis saat komputer dinyalakan.'
      : 'Aplikasi tidak dijalankan otomatis saat komputer dinyalakan.';
  }
  switch (status.errorCode) {
    case 'AUTOSTART_UNSUPPORTED_PLATFORM':
      return 'Run otomatis hanya tersedia di Windows.';
    case 'AUTOSTART_NOT_PACKAGED':
      return 'Run otomatis hanya tersedia pada aplikasi yang sudah dipaketkan (bukan mode pengembangan).';
    case 'AUTOSTART_NOT_IMPLEMENTED':
      return 'Run otomatis belum diaktifkan pada versi ini.';
    case 'AUTOSTART_INVALID_INPUT':
      return 'Permintaan run otomatis tidak valid.';
    case 'AUTOSTART_FORBIDDEN':
      return 'Permintaan run otomatis ditolak.';
    case 'AUTOSTART_READ_FAILED':
      return 'Status run otomatis tidak dapat dibaca.';
    case 'AUTOSTART_SET_FAILED':
      return 'Run otomatis gagal diaktifkan.';
    case 'AUTOSTART_BRIDGE_FAILED':
    default:
      return 'Status run otomatis tidak tersedia.';
  }
}