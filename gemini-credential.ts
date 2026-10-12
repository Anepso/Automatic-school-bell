/**
 * B7 Stage B-2 — Gemini credential boundary.
 *
 * WHY THIS MODULE EXISTS
 *
 * B7 Stage A finding F-04 and decision D-1 established that School Bell's Gemini
 * access was structurally unable to ship: `server.ts` called `dotenv.config()`
 * and read `process.env.GEMINI_API_KEY`, so the only way a packaged app could
 * have had a key was a `.env` file inside `app.asar` — which is extractable
 * with an unzip. That would hand every recipient of the installer the operator's
 * key. The alternative, shipping without `.env`, left the feature dead for every
 * user. Both outcomes are unacceptable, so the owner settled D-1:
 *
 *     BYOK — Bring Your Own Gemini API Key.
 *
 * School Bell never carries a developer or operator key. The user supplies
 * their own. This module is the single place in the backend that is allowed to
 * decide which credential that is, so D-1 is enforced by the code rather than by
 * someone's `.gitignore`.
 *
 * THE THREE CHANNELS
 *
 * 1. `user-supplied` — the key the user typed into Settings. Electron main
 *    decrypts it from `safeStorage` (DPAPI on Windows) and pushes it down the
 *    backend child's **stdin pipe**. This is the only channel that exists in
 *    production.
 *
 * 2. `development-env` — `.env` / an exported shell variable. Honoured only when
 *    the broker is inactive *and* `NODE_ENV !== 'production'`. This keeps
 *    `npm run dev` working exactly as it did before any of this existed.
 *
 * 3. `absent` — no key. The AI endpoint reports `AI_NOT_CONFIGURED` and the rest
 *    of School Bell runs normally.
 *
 * WHY STDIN AND NOT AN ENVIRONMENT VARIABLE
 *
 * B7 Stage B-1 passed the key as `SCHOOL_BELL_GEMINI_API_KEY`. That worked for
 * a smoke test but it is not a secure transport: on Linux any process of the
 * same user can read `/proc/<pid>/environ`, the value is fixed at spawn time so
 * it could not reflect a key the user saved later without a restart, and it
 * would have had to appear in every child process's environment. A pipe to a
 * child we ourselves spawned is readable by neither other users nor other
 * processes, is not in `ps` output, is not on disk, and can be written again at
 * any moment. It is the smallest change that is actually secure.
 *
 * The trade-off, stated plainly: the plaintext exists in main-process memory and
 * in the backend's memory while the app runs. That is unavoidable for any design
 * in which a process that is not Electron performs the API call. It is never in a
 * file, never in argv, never in the environment, and never reachable from the
 * renderer.
 *
 * SECURITY NOTES
 *
 * - Nothing here logs, serialises, or returns a key in any response body.
 *   `describeGeminiCredential()` reports only which channel answered, because a
 *   configured / not-configured signal is needed at startup and a fingerprint is
 *   not.
 * - The backend is a child process of Electron, not the renderer, so a key
 *   resolved here is never reachable from page JavaScript and never crosses the
 *   `preload.cjs` IPC surface.
 * - When the broker is active it is **authoritative**: `.env` and
 *   `GEMINI_API_KEY` are not consulted at all, even in development. Otherwise a
 *   developer's exported shell variable would silently become the credential of
 *   an app they launched from that shell.
 */

export type GeminiCredentialSource =
  /** The user's own key, decrypted by Electron main from `safeStorage`. */
  | 'user-supplied'
  /** `.env` or an exported shell variable. Development convenience only. */
  | 'development-env'
  /** No key available. The AI feature reports NOT_CONFIGURED and the app runs. */
  | 'absent';

export interface GeminiCredential {
  /** The key, or null when absent. Treat as write-once; never log it. */
  apiKey: string | null;
  source: GeminiCredentialSource;
}

/**
 * Set by `electron/main.cjs` on the backend child only.
 *
 * The broker reader attaches *only* when this is `'1'`. That gate is not
 * cosmetic: `npm run dev` runs this same file with the developer's terminal on
 * stdin, and an unconditional reader would swallow their keystrokes.
 */
export const BROKER_ENV = 'SCHOOL_BELL_CREDENTIAL_BROKER';

/**
 * Transport for the user-supplied key.
 *
 * Named to be unmistakable in a process listing and in `.env`, so that a key
 * appearing here is always intentional rather than an inherited
 * `GEMINI_API_KEY` that leaked in from the developer's shell. B7 Stage B-2 keeps
 * this name working for a diagnostic single-process run, but the packaged app
 * never relies on it.
 */
export const USER_SUPPLIED_ENV = 'SCHOOL_BELL_GEMINI_API_KEY';

/**
 * The historical variable, read from `.env` in development only.
 *
 * It is deliberately NOT honoured when `NODE_ENV === 'production'`. That is what
 * makes D-1 enforceable rather than aspirational: a packaged app cannot silently
 * adopt a key that happens to be sitting in the machine's environment, so
 * "no developer key in production" is a property of the code.
 */
export const DEVELOPMENT_ENV = 'GEMINI_API_KEY';

/** Wire format for the broker: one JSON object per line on stdin. */
interface BrokerMessage {
  type: string;
  apiKey?: unknown;
}

const BROKER_MESSAGE_TYPE = 'gemini-credential';

/**
 * Latest value pushed by the main process.
 *
 * `null` is a meaningful value, not "no update": main pushes `null` when the
 * user deletes the key, and the backend must forget the previous one. So the
 * flag is tracked separately from the value.
 */
let brokered: GeminiCredential | null = null;
let brokerActive = false;
let announcedFirstFrame = false;

function readKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Apply one broker frame.
 *
 * Accepts either a raw line or an already-parsed object, so it is the single seam
 * for "one thing arrived on the pipe" and is directly testable without a pipe.
 * Anything unparseable is ignored: the backend's job is to serve the scheduler,
 * and it must not die because a write was malformed. Main re-pushes on every
 * change, so a dropped frame cannot leave a stale credential behind.
 */
export function applyBrokerMessage(raw: unknown): void {
  let candidate = raw;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return;
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
  const message = candidate as BrokerMessage;
  if (message.type !== BROKER_MESSAGE_TYPE) return;
  // Receiving a well-formed frame is itself proof that the main process is
  // feeding this process, so the broker becomes authoritative here. Marking it
  // here rather than only in `startCredentialBroker` means there is no window in
  // which a frame has been honoured but a later request could still fall through
  // to `.env`.
  brokerActive = true;
  brokered = { apiKey: readKey(message.apiKey), source: 'user-supplied' };

  // Announce the first credential exactly once. Without this the backend's boot
  // line is systematically wrong: main pushes the frame after spawn, which is
  // almost always after `listen`, so a packaged app with a perfectly good stored
  // key logged "NOT CONFIGURED" at startup on every single launch. That is a
  // support trap — it looks like a broken install. Reports the channel only.
  if (!announcedFirstFrame) {
    announcedFirstFrame = true;
    console.log(`School Bell Gemini credential: ${describeGeminiCredential(brokered)}`);
  }
}

/**
 * Attach the stdin reader.
 *
 * Only called when the broker env var is set. Uses newline-delimited JSON, which
 * is what `child_process` gives us for free: a whole line is written in one
 * `write()`, and a key cannot contain a newline because it is trimmed and
 * whitespace-free by the store's validation.
 */
export function startCredentialBroker(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[BROKER_ENV] !== '1') return false;

  // No listener means the parent's stdin is inherited by the developer running
  // `npm run dev`, and reading it would eat their keystrokes.
  if (!process.stdin || process.stdin.isTTY) return false;

  brokerActive = true;
  brokered = { apiKey: null, source: 'absent' };

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line.length > 0) applyBrokerMessage(line);
      index = buffer.indexOf('\n');
    }
  });
  process.stdin.on('error', () => {
    /* parent went away; keep serving */
  });
  return true;
}

/**
 * Resolve the Gemini credential for this process.
 *
 * Precedence is deliberate:
 *   1. the broker, when active — authoritative in every environment;
 *   2. `.env`, only when the broker is inactive and this is not production.
 */
export function resolveGeminiCredential(
  env: NodeJS.ProcessEnv = process.env
): GeminiCredential {
  if (brokerActive) {
    // `brokered` is initialised by startCredentialBroker, so this is never null
    // once the flag is set.
    return brokered ?? { apiKey: null, source: 'absent' };
  }

  // Production reads no channel except the broker. Stage B-1 briefly allowed
  // `SCHOOL_BELL_GEMINI_API_KEY` here because it *was* the transport; now that
  // the transport is the stdin pipe, honouring it in production would mean a
  // packaged app could take its credential from the environment instead of from
  // `safeStorage` — which is the exact property D-1 rules out, and would let a
  // key sitting in the machine's environment become an app credential without
  // the user ever typing it into Settings. The variable still works for a
  // non-production diagnostic run, where it is merely convenient.
  if (env.NODE_ENV === 'production') {
    return { apiKey: null, source: 'absent' };
  }

  const injected = readKey(env[USER_SUPPLIED_ENV]);
  if (injected) {
    return { apiKey: injected, source: 'user-supplied' };
  }

  const development = readKey(env[DEVELOPMENT_ENV]);
  if (development) {
    return { apiKey: development, source: 'development-env' };
  }

  return { apiKey: null, source: 'absent' };
}

/**
 * A loggable status string. Reports the channel only, never the key, never a
 * length, and never a fingerprint.
 */
export function describeGeminiCredential(credential: GeminiCredential): string {
  switch (credential.source) {
    case 'user-supplied':
      return 'CONFIGURED (user-supplied)';
    case 'development-env':
      return 'CONFIGURED (development .env)';
    default:
      return 'NOT CONFIGURED';
  }
}

/** Whether the broker is authoritative for this process. */
export function isCredentialBrokerActive(): boolean {
  return brokerActive;
}