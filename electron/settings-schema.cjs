'use strict';

/**
 * School Bell settings schema — the authoritative validation layer (Stage B5.1).
 *
 * Contract: STAGE_B5_SETTINGS_WINDOWS_STAGE_A_AUDIT.md, F-01 and F-02.
 *
 *  - This module is the ONLY place that decides whether an `AppSettings`
 *    aggregate is well-formed. `electron/storage.cjs` calls it on every write,
 *    so a malformed value can never reach disk no matter what the renderer
 *    sends over the bridge.
 *  - It is deliberately dependency-free and side-effect-free so it can also be
 *    required from the preload bridge to publish the limits for renderer UX.
 *  - It does NOT decide what a *missing or already-invalid* stored value means.
 *    `sanitizeSettings` drops unusable known keys instead of inventing values;
 *    the renderer merges its own defaults over the result
 *    (`src/utils/storage.ts`), so a repaired install converges on the first
 *    ordinary write. Nothing is rewritten on disk by reading.
 *
 * Non-goals for B5.1 (deliberately out of scope): auto-start wiring, speaker
 * routing, notifications, window geometry.
 */

const MAX_SCHOOL_NAME_LENGTH = 200;
const MAX_SPEAKER_NAME_LENGTH = 120;
const MIN_BELL_VOLUME = 0;
const MAX_BELL_VOLUME = 100;

/** 2 MB of image, the limit the settings screen has always advertised. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
/** Base64 inflates by 4/3; the slack covers the `data:` prefix and padding. */
const MAX_LOGO_DATA_URL_CHARS = Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 1024;
/** Remote logos (including the shipped default) are plain short URLs. */
const MAX_LOGO_URL_LENGTH = 4096;

const LOGO_DATA_URL_RE = /^data:(image\/(?:png|jpeg|jpg|gif|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;
const LOGO_REMOTE_URL_RE = /^https?:\/\/[^\s]+$/;

/** Byte signatures that let us reject a non-image that was renamed to `.png`. */
const IMAGE_SIGNATURES = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
];

const LIMITS = Object.freeze({
  maxSchoolNameLength: MAX_SCHOOL_NAME_LENGTH,
  maxSpeakerNameLength: MAX_SPEAKER_NAME_LENGTH,
  minBellVolume: MIN_BELL_VOLUME,
  maxBellVolume: MAX_BELL_VOLUME,
  maxLogoBytes: MAX_LOGO_BYTES,
  logoMimeAllowlist: Object.freeze(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml']),
});

const KNOWN_KEYS = new Set([
  'schoolName', 'schoolLogo', 'autoStartWindows', 'autoBellActive',
  'selectedSpeaker', 'bellVolume', 'systemPaused', 'outputSpeakerName',
]);

function rejected(field, message) {
  return { ok: false, field, message };
}

function accepted() {
  return { ok: true, field: null, message: null };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value, max) {
  return typeof value === 'string' && value.length <= max;
}

function isStrictBoolean(value) {
  return typeof value === 'boolean';
}

function isValidBellVolume(value) {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_BELL_VOLUME && value <= MAX_BELL_VOLUME;
}

function startsWithBytes(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[i] !== bytes[i]) return false;
  }
  return true;
}

function detectImageMime(buffer) {
  for (const signature of IMAGE_SIGNATURES) {
    if (startsWithBytes(buffer, signature.bytes)) return signature.mime;
  }
  // WEBP: "RIFF" .... "WEBP"
  if (buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  // SVG is text: accept only markup that actually declares an <svg> root.
  const head = buffer.toString('utf8', 0, Math.min(buffer.length, 1024)).trimStart();
  if (head.startsWith('<?xml') || head.startsWith('<!DOCTYPE') || head.startsWith('<!--')) {
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 8192));
    if (/<svg[\s>]/i.test(text)) return 'image/svg+xml';
  } else if (head.startsWith('<svg')) {
    return 'image/svg+xml';
  }
  return null;
}

function decodedBase64Bytes(base64) {
  // Cheap arithmetic bound so an oversized payload is rejected before we
  // materialise it in memory.
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Validate a `schoolLogo` value.
 *
 * Accepted: an empty string (no logo), an http(s) URL (the shipped default is
 * one), or a base64 `data:` URL whose decoded bytes really are an image of an
 * allowlisted type and no larger than MAX_LOGO_BYTES.
 */
function validateLogo(value) {
  if (typeof value !== 'string') return rejected('schoolLogo', 'Logo sekolah harus berupa teks.');
  if (value === '') return accepted();

  if (LOGO_REMOTE_URL_RE.test(value)) {
    if (value.length > MAX_LOGO_URL_LENGTH) {
      return rejected('schoolLogo', 'Alamat logo terlalu panjang.');
    }
    return accepted();
  }

  const match = LOGO_DATA_URL_RE.exec(value);
  if (!match) {
    return rejected('schoolLogo', 'Format logo tidak didukung. Gunakan PNG, JPG, GIF, WEBP, atau SVG.');
  }

  const [, declaredMime, base64] = match;
  if (!LIMITS.logoMimeAllowlist.includes(declaredMime)) {
    return rejected('schoolLogo', 'Format logo tidak didukung.');
  }
  if (base64.length === 0) return rejected('schoolLogo', 'Logo kosong.');
  if (value.length > MAX_LOGO_DATA_URL_CHARS) {
    return rejected('schoolLogo', 'Ukuran logo melebihi 2MB.');
  }
  if (decodedBase64Bytes(base64) > MAX_LOGO_BYTES) {
    return rejected('schoolLogo', 'Ukuran logo melebihi 2MB.');
  }

  // Verify the bytes really are an image, so a text or executable file renamed
  // to `.png` cannot be stored and later handed to an <img src>.
  let buffer;
  try {
    buffer = Buffer.from(base64.slice(0, 256), 'base64');
  } catch {
    return rejected('schoolLogo', 'Data logo tidak dapat dibaca.');
  }
  const detected = detectImageMime(buffer);
  if (!detected) return rejected('schoolLogo', 'Berkas yang dipilih bukan gambar yang valid.');
  if (!LIMITS.logoMimeAllowlist.includes(detected)) {
    return rejected('schoolLogo', 'Format logo tidak didukung.');
  }
  if (detected !== 'image/svg+xml' && detected !== declaredMime
    && !(declaredMime === 'image/jpg' && detected === 'image/jpeg')) {
    return rejected('schoolLogo', 'Isi berkas tidak sesuai format gambarnya.');
  }

  return accepted();
}

function checkField(key, value) {
  switch (key) {
case 'schoolName':
        // B5 School Identity, PD-3: a zero-length name is not an identity. Only
        // the empty case is new here — the upper bound, the type check and every
        // other field's behaviour are untouched (STAGE_B5_SCHOOL_IDENTITY_IMPLEMENTATION.md).
        if (!isBoundedString(value, MAX_SCHOOL_NAME_LENGTH) || value.length === 0) {
          return rejected('schoolName', `Nama sekolah harus berupa teks 1-${MAX_SCHOOL_NAME_LENGTH} karakter.`);
        }
        return accepted();
    case 'schoolLogo':
      return validateLogo(value);
    case 'autoStartWindows':
    case 'autoBellActive':
    case 'systemPaused':
      if (!isStrictBoolean(value)) {
        return rejected(key, 'Nilai harus true atau false.');
      }
      return accepted();
    case 'selectedSpeaker':
    case 'outputSpeakerName':
      if (!isBoundedString(value, MAX_SPEAKER_NAME_LENGTH)) {
        return rejected(key, `Nilai harus berupa teks maksimal ${MAX_SPEAKER_NAME_LENGTH} karakter.`);
      }
      return accepted();
    case 'bellVolume':
      if (!isValidBellVolume(value)) {
        return rejected('bellVolume', `Volume bel harus bilangan bulat ${MIN_BELL_VOLUME}-${MAX_BELL_VOLUME}.`);
      }
      return accepted();
    default:
      // Unknown keys are preserved untouched so a document written by a newer
      // version is never truncated by an older one.
      return accepted();
  }
}

/**
 * Validate a whole `settings` aggregate.
 * Returns `{ ok: true }` or the first offending `{ field, message }`.
 */
function validateSettings(value) {
  if (!isPlainObject(value)) return rejected('settings', 'Data pengaturan tidak valid.');
  for (const key of Object.keys(value)) {
    const result = checkField(key, value[key]);
    if (!result.ok) return result;
  }
  return accepted();
}

/**
 * Repair view of an already-stored aggregate.
 *
 * Known keys that are present but unusable are DROPPED (not replaced): the
 * renderer spreads its defaults over whatever it receives, so a dropped key
 * simply resolves to the default. Unknown keys are kept. This never writes.
 */
function sanitizeSettings(value) {
  if (!isPlainObject(value)) return null;
  const out = { ...value };
  for (const key of KNOWN_KEYS) {
    if (!(key in out)) continue;
    if (!checkField(key, out[key]).ok) delete out[key];
  }
  return out;
}

module.exports = {
  LIMITS,
  MAX_SCHOOL_NAME_LENGTH,
  MAX_SPEAKER_NAME_LENGTH,
  MIN_BELL_VOLUME,
  MAX_BELL_VOLUME,
  MAX_LOGO_BYTES,
  KNOWN_KEYS,
  validateSettings,
  validateLogo,
  sanitizeSettings,
};