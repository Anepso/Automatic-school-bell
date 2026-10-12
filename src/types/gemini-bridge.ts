/**
 * Renderer-visible contract of the `schoolBellGemini` credential bridge exposed
 * by `electron/preload.cjs` (B7 Stage B-2, decision D-1 BYOK).
 *
 * THE SHAPE IS THE SECURITY PROPERTY
 *
 * `GeminiCredentialStatus` has exactly two fields, and neither can hold a key.
 * That is why `getStatus()` is safe to call from page code at any time: there is
 * nothing to leak, so there is no rule to remember and no future field to
 * accidentally widen. A design that masked a returned key with dots would still
 * have shipped the plaintext across the bridge, so no verb returns one.
 *
 * `setKey` takes the secret in and `deleteKey` takes nothing out. The input is a
 * plain `string` on purpose: a `Password` or `MaskedValue` wrapper type would
 * suggest the key had been protected in transit through IPC, which is not a claim
 * this app makes. What protects it at rest is `safeStorage` in the main process;
 * what keeps it off the disk and out of the environment is the stdin broker.
 *
 * Every call resolves instead of rejecting, for the same reason as the storage
 * and auto-start bridges: an `ipcRenderer.invoke` rejection arrives as an opaque
 * "Error invoking remote method ..." string with the real cause mangled into the
 * message, so the typed `code` has to survive in the resolved value.
 */

/**
 * The only things the renderer is ever told about the credential.
 *
 * Three booleans, no field that could hold a key. `configured && !readable` is a
 * real state — the blob exists but this machine cannot decrypt it — and it has to
 * be representable, because collapsing it would either hide a stored key or
 * promise a working feature that cannot work.
 */
export interface GeminiCredentialStatus {
  /** A credential is stored on this machine. */
  configured: boolean;
  /** `safeStorage` is usable here, so storing a key can succeed. */
  available: boolean;
  /** The stored credential can actually be decrypted on this machine. */
  readable: boolean;
}

export type GeminiCredentialErrorCode =
  /** The OS key store is unreachable, so nothing may be stored. */
  | 'CREDENTIAL_STORE_UNAVAILABLE'
  /** The submitted value was not a usable non-empty string. */
  | 'CREDENTIAL_INVALID_INPUT'
  /** The encrypted file could not be written. */
  | 'CREDENTIAL_WRITE_FAILED'
  /** The encrypted file could not be read. */
  | 'CREDENTIAL_READ_FAILED'
  /** The stored bytes could not be decrypted and were discarded. */
  | 'CREDENTIAL_DECRYPT_FAILED'
  /** The credential file could not be removed. */
  | 'CREDENTIAL_DELETE_FAILED'
  /** The requesting window is not the main window. */
  | 'CREDENTIAL_FORBIDDEN'
  /** The IPC round trip failed before the main process answered. */
  | 'CREDENTIAL_BRIDGE_FAILED'
  /** A failure the main process did not classify. */
  | 'CREDENTIAL_UNKNOWN';

export interface GeminiCredentialEnvelope {
  ok: boolean;
  value?: GeminiCredentialStatus;
  error?: { code: GeminiCredentialErrorCode; message: string; details: null };
}

export interface GeminiCredentialBridge {
  isGeminiCredentialBridge: true;
  getStatus: () => Promise<GeminiCredentialEnvelope>;
  setKey: (apiKey: string) => Promise<GeminiCredentialEnvelope>;
  deleteKey: () => Promise<GeminiCredentialEnvelope>;
}

/**
 * Narrows an unknown status without trusting it, so a bridge stub in a test or a
 * corrupted reply cannot be mistaken for a real answer.
 */
export function isGeminiCredentialStatus(value: unknown): value is GeminiCredentialStatus {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.configured === 'boolean'
    && typeof candidate.available === 'boolean'
    && typeof candidate.readable === 'boolean'
  );
}

export function getGeminiCredentialBridge(): GeminiCredentialBridge | null {
  const bridge = (window as Window & { schoolBellGemini?: GeminiCredentialBridge }).schoolBellGemini;
  return bridge && bridge.isGeminiCredentialBridge === true ? bridge : null;
}