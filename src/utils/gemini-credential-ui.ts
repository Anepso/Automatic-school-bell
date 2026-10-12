/**
 * Presentation state for the Settings Gemini credential row (B7 Stage B-2).
 *
 * WHY A SEPARATE MODULE
 *
 * `autostart-ui-state.ts` exists because F-03's failure was a UI that could
 * display "on" while nothing had been registered — the wording and the
 * enabled/disabled decision had to be derived in one tested place rather than
 * assembled inline in a component. The same class of bug exists here, and it is
 * worse in one direction: a row that says "configured" when it is not invites a
 * user to believe AI works when every request will return NOT_CONFIGURED.
 *
 * So the wording, the tone, and which actions are offered are all decided here
 * from a two-field status, and `PengaturanView` renders whatever it is told.
 *
 * NOTHING DERIVED HERE TOUCHES A KEY
 *
 * `GeminiCredentialStatus` cannot carry a key, so there is no branch in this file
 * that could echo one. A "key is set" answer is reported as a sentence about
 * configuration, never as the value, a length, or a fingerprint.
 *
 * `unavailable` is a first-class state rather than an error. If the OS key store
 * is unreachable, the honest thing is to say the feature cannot be used on this
 * machine and disable the input — not to accept a key and then fail silently at
 * save time, and certainly not to fall back to weaker encryption so the row can
 * look green.
 */

import type { GeminiCredentialStatus } from '../types/gemini-bridge';

export type GeminiCredentialUiState =
  /** Still asking the main process whether a credential exists. */
  | { kind: 'checking'; tone: 'waiting'; message: string; busy: true; canSubmit: false }
  /** No credential exists; the input is offered. */
  | { kind: 'absent'; tone: 'inactive'; message: string; busy: false; canSubmit: true }
  /** A credential exists and the backend will use it. */
  | { kind: 'configured'; tone: 'active'; message: string; busy: false; canSubmit: true }
  /**
   * A credential file exists but cannot be decrypted on this machine.
   *
   * Shown rather than hidden, and worded as an action rather than an apology,
   * because the only thing the user can do is re-enter the key. The stored blob is
   * deliberately left on disk by the store — this state is reachable on a locked
   * keyring, after a profile copy, or between a development and a packaged build
   * — and the user decides whether to replace or remove it.
   */
  | { kind: 'unreadable'; tone: 'warning'; message: string; busy: false; canSubmit: true }
  /** A credential exists but the OS key store is unreachable, so it cannot be used. */
  | { kind: 'unavailable'; tone: 'warning'; message: string; busy: false; canSubmit: false };

export type GeminiCredentialUiTone = GeminiCredentialUiState['tone'];

export function resolveGeminiCredentialUi(
  status: GeminiCredentialStatus | null
): GeminiCredentialUiState {
  if (status === null) {
    return {
      kind: 'checking',
      tone: 'waiting',
      message: 'Memeriksa status kredensial AI...',
      busy: true,
      canSubmit: false,
    };
  }

  if (!status.available) {
    return {
      kind: 'unavailable',
      tone: 'warning',
      message: 'Penyimpanan kredensial aman tidak tersedia di perangkat ini, sehingga API key tidak dapat disimpan.',
      busy: false,
      canSubmit: false,
    };
  }

  if (status.configured && !status.readable) {
    return {
      kind: 'unreadable',
      tone: 'warning',
      message: 'Kredensial tersimpan tidak dapat dibaca di perangkat ini. Masukkan ulang API key untuk menggantinya.',
      busy: false,
      canSubmit: true,
    };
  }

  if (status.configured) {
    return {
      kind: 'configured',
      tone: 'active',
      message: 'API key tersimpan dan dipakai untuk fitur assisted.',
      busy: false,
      canSubmit: true,
    };
  }

  return {
    kind: 'absent',
    tone: 'inactive',
    message: 'Belum ada API key. Fitur assisted akan menjawab bahwa AI belum dikonfigurasi.',
    busy: false,
    canSubmit: true,
  };
}