/**
 * B7 Stage B-2 — Gemini BYOK IPC surface.
 *
 * Three verbs, mirroring the shape of `storage-ipc.cjs` and
 * `autostart-ipc.cjs`: a fixed channel, a fixed verb allowlist, a main-window
 * sender check on every handler, and a `{ ok, value | error }` envelope so the
 * renderer branches on a typed code instead of parsing a mangled IPC string.
 *
 * WHAT THE RENDERER CAN AND CANNOT DO
 *
 * It can ask whether a credential exists and it can hand one in. It can never
 * read one back: no verb returns the key, and no verb accepts a channel name or
 * a path. `get-status` returns `{ configured, available }` — a shape with no
 * field that could hold a secret. This is enforced by the response type, not by
 * remembering not to add a field.
 *
 * There is no raw `ipcRenderer`, no `safeStorage`, and no filesystem handle on
 * the preload surface. `contextIsolation`, `nodeIntegration: false` and
 * `sandbox: true` all remain as they were.
 */

const { ipcMain } = require('electron');

const store = require('./gemini-credential-store.cjs');

const CHANNEL = 'school-bell:credentials';
const VERBS = Object.freeze(['get-gemini-status', 'set-gemini-key', 'delete-gemini-key']);

/** Wrap a store call in the project's result envelope. */
function toEnvelope(run) {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: (error && error.code) || 'CREDENTIAL_UNKNOWN',
        // Sanitized by construction: store messages are fixed strings that name
        // the failure, never the input, the plaintext, or the file path.
        message: (error && error.message) || 'Kredensial gagal diproses.',
        details: null,
      },
    };
  }
}

/**
 * Register the credential handlers.
 *
 * `onCredentialChanged` is invoked after a successful save or delete so the main
 * process can push the new value to the backend. It receives the decrypted key
 * (or null) and is the only place in the main process that holds plaintext
 * outside of `saveKey`'s own lifetime.
 */
function registerGeminiCredentialIpc(isTrustedSender, onCredentialChanged) {
  /**
   * `mutating` decides whether a successful call re-pushes the credential to the
   * backend. Only save and delete do: a status read has not changed anything, so
   * making it decrypt the blob and write to the backend's stdin would be work
   * whose only effect is to widen the window in which plaintext is in flight.
   */
  const handle = (verb, run, { mutating = false } = {}) => {
    ipcMain.handle(`${CHANNEL}:${verb}`, async (event, payload) => {
      if (!isTrustedSender(event)) {
        return {
          ok: false,
          error: { code: 'CREDENTIAL_FORBIDDEN', message: 'Sumber tidak diizinkan.', details: null },
        };
      }
      const envelope = toEnvelope(() => run(payload));
      if (envelope.ok && mutating && onCredentialChanged) {
        // Never let a push failure turn a successful save into an error: the
        // credential is already persisted and the backend is re-pushed at spawn.
        try { onCredentialChanged(); } catch { /* reported at backend start */ }
      }
      return envelope;
    });
  };

  handle('get-gemini-status', () => store.getStatus());

  // Input validation and rejection live inside the store; the renderer only ever
  // sends `{ apiKey }` and receives a status.
  handle('set-gemini-key', (payload) => {
    const apiKey = payload && typeof payload === 'object' ? payload.apiKey : undefined;
    return store.saveKey(apiKey);
  }, { mutating: true });

  handle('delete-gemini-key', () => store.deleteKey(), { mutating: true });
}

/** Remove the handlers so a reload does not double-register. */
function unregisterGeminiCredentialIpc() {
  for (const verb of VERBS) ipcMain.removeHandler(`${CHANNEL}:${verb}`);
}

module.exports = Object.freeze({
  CHANNEL,
  VERBS,
  registerGeminiCredentialIpc,
  unregisterGeminiCredentialIpc,
});