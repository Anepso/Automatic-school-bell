/**
 * F-03 auto-start contract and IPC bridge (Unit 1 contract, Unit 2A behaviour).
 *
 * This module owns the *application-level* auto-start contract. The renderer
 * never sees an Electron API; it asks "is auto-start supported here, and is it
 * on?" and the main process answers.
 *
 * Unit 2A fills in the Windows OS read/write behind `readOsAutoStartState()` and
 * `writeOsAutoStartState()` using Electron's supported login-item API. No
 * registry editing, no startup-folder shortcut, no scheduled task, and no shell
 * command is involved.
 *
 * Two ideas are kept strictly apart:
 *
 *   requested setting  `autoStartWindows` (a persisted B5.1 boolean)
 *        !=
 *   observed OS state  whatever this module reports
 *
 * Nothing here reads, writes, migrates, or validates the persisted setting. That
 * stays entirely in the B4/B5.1 storage path, and this unit leaves it untouched.
 * The two are allowed to disagree: a user can request auto-start on a machine
 * where it cannot be granted, and the contract must be able to say so rather
 * than echo the stored boolean back as if the OS had agreed. Boot-time
 * reconciliation between the two is deliberately NOT done here — that is a later
 * unit, because it would mean the main process reading settings at startup.
 *
 * The renderer types, the preload surface, the channel names, and the error
 * codes are unchanged from Unit 1: the Windows implementation did not require a
 * single line of contract change.
 */

const { ipcMain, app } = require('electron');

const CHANNEL = 'school-bell:autostart';
const VERBS = Object.freeze(['get-status', 'set-enabled']);

/**
 * Deterministic error codes. The `AUTOSTART_*` prefix follows the existing
 * `STORAGE_*` / `AUDIO_*` convention already used across this codebase.
 *
 * All of these are renderer-visible, which is why they were reserved before any
 * of them could occur. The Windows implementation in Unit 2A did not have to
 * invent a single new code to report real failures.
 */
const ERROR_CODES = Object.freeze({
  /** Not a platform whose boot behaviour this application can register for. */
  UNSUPPORTED_PLATFORM: 'AUTOSTART_UNSUPPORTED_PLATFORM',
  /**
   * Running from an unpackaged development binary. Registering that binary as a
   * startup target would point the machine at a throwaway build, so the
   * development case is refused rather than silently accepted.
   */
  NOT_PACKAGED: 'AUTOSTART_NOT_PACKAGED',
  /**
   * The seam marker used by Unit 1 while no OS behaviour existed behind it.
   * Retained so the published union stays stable, but no longer emitted: a
   * packaged Windows build is now read from the OS like any other.
   */
  NOT_IMPLEMENTED: 'AUTOSTART_NOT_IMPLEMENTED',
  /** A set request did not reach the OS, or the OS refused it. */
  SET_FAILED: 'AUTOSTART_SET_FAILED',
  /** The OS boot state could not be read, or the read-back failed. */
  READ_FAILED: 'AUTOSTART_READ_FAILED',
  /** The caller was not the main window. */
  FORBIDDEN: 'AUTOSTART_FORBIDDEN',
  /** The renderer sent a payload that is not a boolean. */
  INVALID_INPUT: 'AUTOSTART_INVALID_INPUT',
  /** The IPC round trip itself failed, before any OS question was asked. */
  BRIDGE_FAILED: 'AUTOSTART_BRIDGE_FAILED',
});

/** The contract's negative arm: cannot be used here, and here is why. */
function unsupported(errorCode) {
  return Object.freeze({ supported: false, enabled: null, errorCode });
}

/** The contract's positive arm: usable, with a definite boolean state. */
function supportedStatus(enabled) {
  return Object.freeze({ supported: true, enabled: enabled === true });
}

/**
 * Coerce whatever crossed the IPC boundary into a valid contract value.
 *
 * The main process does not trust the payload shape it is about to return, and
 * the renderer never receives `undefined` or a half-built object. A malformed
 * response degrades to a negative status rather than throwing inside a handler.
 */
function sanitizeStatus(value) {
  if (!value || typeof value !== 'object') {
    return unsupported(ERROR_CODES.READ_FAILED);
  }
  const candidate = value;
  if (candidate.supported === true) {
    return supportedStatus(candidate.enabled === true);
  }
  const code = typeof candidate.errorCode === 'string' ? candidate.errorCode : ERROR_CODES.READ_FAILED;
  const known = Object.freeze(Object.values(ERROR_CODES)).includes(code);
  return unsupported(known ? code : ERROR_CODES.READ_FAILED);
}

/**
 * ---------------------------------------------------------------------------
 * Implementation boundary — everything above is the contract, everything below
 * is the part that talks to the OS. Unit 2A filled this in behind the seam
 * Unit 1 left open, without altering anything above it.
 * ---------------------------------------------------------------------------
 */

/**
 * Ask the platform whether this build could register for boot at all.
 *
 * Deliberately reports the *reason* rather than a boolean, because "off on this
 * machine" and "cannot be configured on this machine" are different answers and
 * the settings UI will need to tell them apart.
 */
function autoStartCapability() {
  if (process.platform !== 'win32') {
    return unsupported(ERROR_CODES.UNSUPPORTED_PLATFORM);
  }
  // Never treat a development Electron binary as a startup target.
  if (app.isPackaged !== true) {
    return unsupported(ERROR_CODES.NOT_PACKAGED);
  }
  return null;
}

/**
 * The single startup target used by BOTH the read and the write.
 *
 * Electron documents that if you pass `path`/`args` to `setLoginItemSettings`,
 * you must pass the same values to `getLoginItemSettings` or `openAtLogin` will
 * not reflect what you registered. Deriving both from one function is what
 * guarantees that instead of leaving it to two independent literals to stay in
 * agreement.
 *
 * `process.execPath` is used because that is exactly what Electron defaults to
 * on both calls, so passing it explicitly changes no behaviour while making the
 * registered target auditable. In a packaged Windows build it is the shipped
 * executable; the `autoStartCapability()` gate above guarantees the development
 * Electron binary can never reach this line.
 */
function loginItemTarget() {
  return { path: process.execPath };
}

/**
 * Observed OS boot state.
 *
 * Reports only what the OS says. The persisted `autoStartWindows` setting is
 * never consulted: a request and an observation are different facts, and using
 * the stored value here would reintroduce the exact lie this contract exists to
 * remove.
 */
function readOsAutoStartState() {
  const blocked = autoStartCapability();
  if (blocked) return blocked;

  let raw;
  try {
    raw = app.getLoginItemSettings(loginItemTarget());
  } catch {
    // A throwing or absent Electron API is "unknown", never "off".
    return unsupported(ERROR_CODES.READ_FAILED);
  }

  // `openAtLogin` must be a real boolean. Coercing a missing/undefined field
  // with Boolean() would turn an unusable reply into a confident "off", so an
  // unusable reply is reported as a read failure instead.
  if (!raw || typeof raw !== 'object' || typeof raw.openAtLogin !== 'boolean') {
    return unsupported(ERROR_CODES.READ_FAILED);
  }

  return supportedStatus(raw.openAtLogin);
}

/**
 * Apply a requested boot state, then report what the OS actually did.
 *
 * The requested value is never returned as the result. On success this performs
 * the registration and immediately reads it back, so the caller learns the
 * observed state — which may legitimately differ from the request (a policy
 * refusal, a startup entry disabled in Task Manager, a partially applied
 * change). When the read-back fails, the answer is `AUTOSTART_READ_FAILED`:
 * unknown beats a false success.
 *
 * Idempotence is Electron's to provide. On Windows the login item is a single
 * registry-backed entry keyed by executable path and arguments, so repeating
 * this call with identical options updates that one entry rather than adding
 * another. No duplicate bookkeeping is kept here on purpose.
 */
function writeOsAutoStartState(requestedEnabled) {
  if (typeof requestedEnabled !== 'boolean') {
    return unsupported(ERROR_CODES.INVALID_INPUT);
  }
  const blocked = autoStartCapability();
  if (blocked) return blocked;

  try {
    app.setLoginItemSettings({ openAtLogin: requestedEnabled, ...loginItemTarget() });
  } catch {
    return unsupported(ERROR_CODES.SET_FAILED);
  }

  // Write then read back: the caller gets the observed state, never the request.
  return readOsAutoStartState();
}

/**
 * ---------------------------------------------------------------------------
 * End of implementation boundary.
 * ---------------------------------------------------------------------------
 */

/** Status of the OS boot registration, without changing anything. */
function getStatus() {
  return sanitizeStatus(readOsAutoStartState());
}

/**
 * Apply the requested state and report the resulting observed state.
 *
 * `requestedEnabled` is a preference handed to the OS layer; it is never echoed
 * back as `enabled`, because the two are only equal when the OS agreed.
 */
function setEnabled(requestedEnabled) {
  return sanitizeStatus(writeOsAutoStartState(requestedEnabled));
}

function registerAutoStartIpc(isTrustedSender) {
  const handle = (verb, run) => {
    ipcMain.handle(`${CHANNEL}:${verb}`, async (event, payload) => {
      if (typeof isTrustedSender === 'function' && !isTrustedSender(event)) {
        return unsupported(ERROR_CODES.FORBIDDEN);
      }
      return run(payload);
    });
  };

  handle('get-status', () => getStatus());
  handle('set-enabled', (payload) => setEnabled(payload && payload.enabled));
}

/**
 * Provided for symmetry with the storage surface. Unit 1 deliberately does not
 * call this from `before-quit`: that block is F-04-verified protected surface,
 * and process teardown discards `ipcMain` handlers anyway, so adding a line
 * there would reopen a reviewed area for no behavioural gain.
 */
function unregisterAutoStartIpc() {
  for (const verb of VERBS) {
    ipcMain.removeHandler(`${CHANNEL}:${verb}`);
  }
}

module.exports = {
  registerAutoStartIpc,
  unregisterAutoStartIpc,
  CHANNEL,
  VERBS,
  ERROR_CODES,
  getStatus,
  setEnabled,
  sanitizeStatus,
};