/**
 * B7 Stage B-2 — Gemini BYOK secure credential store (Electron main process).
 *
 * WHY THIS EXISTS
 *
 * B7 Stage A finding F-04 and decision D-1 established that School Bell must
 * never carry a developer or operator Gemini key: a `.env` inside `app.asar`
 * is extractable with an unzip, so every recipient of the installer would hold
 * the operator's key. B7 Stage B-1 therefore made production ignore `.env`
 * entirely and left a seam. This module fills that seam.
 *
 * The user supplies their own key (Bring Your Own Key). It is encrypted with
 * Electron's `safeStorage` — which is DPAPI on Windows, i.e. the OS key store,
 * not an app-owned cipher — and persisted as one opaque file under `userData`.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * No custom cryptography. There is no AES key, no base64 wrapper, no XOR, no
 * obfuscation, and no hashing standing in for encryption. `safeStorage` is the
 * only primitive; if it is unavailable the honest answer is "not configured",
 * never a weaker fallback that would look like it worked.
 *
 * The file is not part of the B4 storage schema. `electron/storage.cjs` and the
 * `schoolBell_*_v2` aggregates are untouched: backup, restore, migration and
 * export must never carry a credential, and keeping this file outside that
 * machinery is what guarantees it.
 *
 * NOTHING HERE LOGS A KEY
 *
 * `saveKey`, `loadKey`, and `deleteKey` never log, throw with, or return the
 * key value. `loadKey` is the only function that returns plaintext, and its
 * result is held in memory by the caller for the lifetime of the process.
 *
 * A STORED CREDENTIAL IS NEVER DELETED AUTOMATICALLY
 *
 * This is a deliberate reversal, forced by evidence rather than by taste. An
 * earlier version removed the file when `decryptString` failed, on the theory
 * that an undecryptable blob is worthless. Booting the real application against
 * a profile written by a differently-named Electron app disproved that: Electron's
 * Linux `safeStorage` (libsecret) binds its ciphertext to the app identity, so
 * the blob was undecryptable and School Bell deleted the user's key without
 * anyone asking. A decryption failure is routinely transient or environmental —
 * a locked keyring, a profile copied between accounts, an Electron major upgrade,
 * a development build versus a packaged one. None of those mean "discard this
 * credential". The blob is now kept and reported as `readable: false` so the UI
 * can ask the user to re-enter it. Only `deleteKey` removes it.
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, safeStorage } = require('electron');

/**
 * Conservative input bounds.
 *
 * The goal is to reject empty or obviously wrong input, not to reimplement
 * Gemini authentication. An upper bound exists so a renderer bug cannot hand
 * this module an unbounded string to encrypt and write.
 */
const MAX_KEY_LENGTH = 512;

/** Deterministic, renderer-readable error codes. */
const CREDENTIAL_ERROR = Object.freeze({
  UNAVAILABLE: 'CREDENTIAL_STORE_UNAVAILABLE',
  INVALID_INPUT: 'CREDENTIAL_INVALID_INPUT',
  WRITE_FAILED: 'CREDENTIAL_WRITE_FAILED',
  READ_FAILED: 'CREDENTIAL_READ_FAILED',
  DECRYPT_FAILED: 'CREDENTIAL_DECRYPT_FAILED',
  DELETE_FAILED: 'CREDENTIAL_DELETE_FAILED',
});

class CredentialError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CredentialError';
    this.code = code;
  }
}

/**
 * Absolute location of the encrypted credential.
 *
 * `app.getPath('userData')` is per-user, writable, and survives reinstall in
 * exactly the way a user's own key should. It is deliberately not the project
 * root, not `app.asar`, and not the installation directory — all of which are
 * either read-only after install or would be wiped by an upgrade.
 */
function credentialFilePath() {
  return path.join(app.getPath('userData'), 'credentials', 'gemini.enc');
}

/**
 * Whether the OS-backed cipher can be used at all.
 *
 * `safeStorage.isEncryptionAvailable()` is false when the OS key store is
 * unreachable (a locked keyring, a missing backend). In that state School Bell
 * refuses to store the key rather than writing something weakly encrypted that
 * a user could mistake for protection.
 */
function isAvailable() {
  try {
    return safeStorage.isEncryptionAvailable() === true;
  } catch {
    return false;
  }
}

/** `true` when an encrypted credential file exists. Says nothing about contents. */
function exists() {
  try {
    return fs.existsSync(credentialFilePath());
  } catch {
    return false;
  }
}

/**
 * Status for the renderer.
 *
 * This is the *only* shape the renderer ever sees about the credential. It has
 * no field that could carry the key, by construction rather than by convention.
 *
 * Three booleans, each answering a question the UI really has to ask:
 *
 * - `configured` — is a credential stored on this machine?
 * - `available`  — can this machine store one at all (OS key store reachable)?
 * - `readable`   — can the stored credential actually be decrypted here?
 *
 * `configured && !readable` is a real, reachable state (see the header), and
 * collapsing it into either extreme produces a lie: "not configured" hides a
 * stored key, while "configured" promises a working AI feature that cannot work.
 */
function getStatus() {
  const configured = exists();
  return {
    configured,
    available: isAvailable(),
    readable: configured ? loadKey() !== null : false,
  };
}

/**
 * Validate renderer input without ever logging or echoing it.
 * Returns the trimmed key, or throws a typed error.
 */
function normalizeKey(input) {
  if (typeof input !== 'string') {
    throw new CredentialError(CREDENTIAL_ERROR.INVALID_INPUT, 'API key harus berupa teks.');
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new CredentialError(CREDENTIAL_ERROR.INVALID_INPUT, 'API key tidak boleh kosong.');
  }
  if (trimmed.length > MAX_KEY_LENGTH) {
    throw new CredentialError(CREDENTIAL_ERROR.INVALID_INPUT, 'API key terlalu panjang.');
  }
  return trimmed;
}

/**
 * Encrypt and persist the key, replacing any previous credential.
 *
 * Write is atomic (temp file + rename) so an interrupted save cannot leave a
 * truncated blob that would be undecryptable on next boot. The file mode is
 * best-effort owner-only; on Windows the real protection is DPAPI and the mode
 * is irrelevant, but it costs nothing and it is correct on Linux/macOS.
 */
function saveKey(input) {
  if (!isAvailable()) {
    throw new CredentialError(
      CREDENTIAL_ERROR.UNAVAILABLE,
      'Penyimpanan kredensial aman tidak tersedia di perangkat ini.'
    );
  }
  const key = normalizeKey(input);
  const target = credentialFilePath();
  let encrypted;
  try {
    // The only crypto call in the project. Returns a Buffer owned by the OS
    // key store; we write its bytes and drop the reference.
    encrypted = safeStorage.encryptString(key);
  } catch {
    // Deliberately does not include the underlying error message: an OS error
    // string can contain paths or key-store internals.
    throw new CredentialError(CREDENTIAL_ERROR.WRITE_FAILED, 'Kredensial tidak dapat disimpan.');
  }

  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temp, encrypted, { mode: 0o600 });
    fs.renameSync(temp, target);
  } catch {
    try { fs.unlinkSync(temp); } catch { /* nothing useful to do */ }
    throw new CredentialError(CREDENTIAL_ERROR.WRITE_FAILED, 'Kredensial tidak dapat disimpan.');
  } finally {
    // Drop the plaintext reference as soon as the encrypted bytes exist.
    encrypted = null;
  }
  return getStatus();
}

/**
 * Decrypt and return the stored key, or `null` when there is none, or when it
 * cannot be decrypted on this machine.
 *
 * The file is left in place on failure. See the header: an undecryptable blob is
 * not evidence that the user wants the credential gone.
 */
function loadKey() {
  if (!isAvailable()) return null;
  const target = credentialFilePath();
  let encrypted;
  try {
    if (!fs.existsSync(target)) return null;
    encrypted = fs.readFileSync(target);
  } catch {
    return null;
  }
  try {
    const plaintext = safeStorage.decryptString(encrypted);
    return typeof plaintext === 'string' && plaintext.length > 0 ? plaintext : null;
  } catch {
    return null;
  }
}

/** Remove the credential. Reports the resulting status. */
function deleteKey() {
  const target = credentialFilePath();
  try {
    fs.rmSync(target, { force: true });
  } catch {
    throw new CredentialError(CREDENTIAL_ERROR.DELETE_FAILED, 'Kredensial tidak dapat dihapus.');
  }
  return getStatus();
}

module.exports = Object.freeze({
  CREDENTIAL_ERROR,
  CredentialError,
  MAX_KEY_LENGTH,
  credentialFilePath,
  isAvailable,
  exists,
  getStatus,
  saveKey,
  loadKey,
  deleteKey,
});