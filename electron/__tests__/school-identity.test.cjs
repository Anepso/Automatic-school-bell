/**
 * B5 School Identity — automated coverage for the `schoolName` / `schoolLogo`
 * contract (Stage A audit: `STAGE_A_B5_SCHOOL_IDENTITY_AUDIT.md`, verdict
 * `PRODUCT DECISION REQUIRED`, resolved by PD-1..PD-5 in Stage B).
 *
 * Three layers are exercised, all against production code:
 *
 *  1. `electron/settings-schema.cjs` is the authoritative main-process validator.
 *     PD-3 (`schoolName` is 1..200) and the preserved B5.1 logo allowlist are
 *     asserted directly against it.
 *  2. `src/utils/storage.ts` — the renderer's single source of truth for
 *     `DEFAULT_SCHOOL_NAME` / `DEFAULT_SCHOOL_LOGO` and `sanitizeSettingsPatch` —
 *     is transpiled with the project's existing `esbuild` devDependency and loaded.
 *  3. `electron/storage.cjs` persistence is exercised end-to-end against a real
 *     temp `userData` root (electron is stubbed), covering save -> restart ->
 *     hydrate plus backup -> wipe -> restore.
 *
 * These tests deliberately do NOT re-state the validation rules. They assert
 * observable outcomes, so reverting any PD-1..PD-5 change fails them.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_CJS = path.join(ROOT, 'electron', 'settings-schema.cjs');
const STORAGE_TS = path.join(ROOT, 'src', 'utils', 'storage.ts');
const BUNDLED_PNG = path.join(ROOT, 'electron', 'assets', 'school-bell-tray.png');
const schema = require(SCHEMA_CJS);

const DATA_URL_PREFIX = 'data:image/png;base64,';

/**
 * Extracts a `export const NAME =` string declaration from a TS source file by
 * concatenating its quoted chunks. The declaration is terminated by a line ending
 * in `';` — NOT the first `;`, because a data URL contains one inside its MIME
 * type (`image/png;base64`).
 */
function readStringConst(source, name) {
  const lines = source.split('\n');
  const startIdx = lines.findIndex((l) => l.includes(`export const ${name} =`));
  assert.notEqual(startIdx, -1, `${name} not found in source`);
  const decl = [];
  for (let i = startIdx; i < lines.length; i += 1) {
    decl.push(lines[i]);
    if (/'\s*;\s*$/.test(lines[i])) break;
  }
  const parts = [...decl.join('\n').matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(parts.length > 0, `${name} has no string literal chunks`);
  return parts.join('');
}

async function loadRendererStorage() {
  const built = esbuild.buildSync({
    entryPoints: [STORAGE_TS],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  });
  const outFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'b5-school-identity-')),
    'storage.mjs',
  );
  fs.writeFileSync(outFile, built.outputFiles[0].text);
  // The renderer reads the authoritative limits through the preload bridge;
  // absent that (plain Node), `settingsLimits` falls back to its own constants,
  // which is exactly the offline/unavailable path we want to exercise.
  globalThis.window = globalThis.window || {};
  return import(pathToFileURL(outFile).href);
}

/**
 * Loads `electron/storage.cjs` with `electron` stubbed to return a temp
 * `userData` path, so persistence writes to a throwaway directory.
 */
function loadMainStorage(userDataDir) {
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: () => userDataDir,
          getVersion: () => '0.0.0-test',
          isPackaged: false,
          getAppPath: () => ROOT,
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(path.join(ROOT, 'electron', 'storage.cjs'))];
    return require(path.join(ROOT, 'electron', 'storage.cjs'));
  } finally {
    Module._load = originalLoad;
  }
}

function freshUserData(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `b5-school-identity-${label}-`));
}

// ---------------------------------------------------------------------------
// PD-3: schoolName must be 1..200 characters.
// ---------------------------------------------------------------------------

test('PD-3: schema rejects an empty school name', () => {
  const v = schema.validateSettings({ schoolName: '' });
  assert.equal(v.ok, false, 'empty schoolName must be rejected');
  assert.equal(v.field, 'schoolName');
});

test('PD-3: schema rejects an over-long school name and accepts the boundary', () => {
  assert.equal(schema.validateSettings({ schoolName: 'a'.repeat(201) }).ok, false);
  assert.equal(schema.validateSettings({ schoolName: 'a'.repeat(200) }).ok, true);
  assert.equal(schema.validateSettings({ schoolName: 'a' }).ok, true);
});

test('PD-3: schema still rejects a non-string school name', () => {
  for (const bad of [null, undefined, 42, {}, [], true]) {
    assert.equal(
      schema.validateSettings({ schoolName: bad }).ok,
      false,
      `schoolName=${JSON.stringify(bad)} must be rejected`,
    );
  }
});

test('PD-3: renderer sanitizer drops an empty name and keeps the previous value', async () => {
  const mod = await loadRendererStorage();
  const result = mod.sanitizeSettingsPatch(
    { schoolName: 'SMA Lama' },
    { schoolName: '' },
  );
  assert.ok(result.messages.length > 0, 'an empty name must produce a message');
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.patch, 'schoolName'),
    false,
    'empty name must not appear in the patch that reaches storage',
  );
  assert.ok(
    result.messages.some((m) => /kosong/i.test(m)),
    `expected an "empty" message, got ${JSON.stringify(result.messages)}`,
  );
});

test('PD-3: renderer sanitizer still accepts a valid name', async () => {
  const mod = await loadRendererStorage();
  const result = mod.sanitizeSettingsPatch({ schoolName: 'SMA Lama' }, { schoolName: 'SMA Baru' });
  assert.deepEqual(result.messages, []);
  assert.equal(result.patch.schoolName, 'SMA Baru');
});

// ---------------------------------------------------------------------------
// PD-1: the default logo is bundled, offline, and schema-valid.
// ---------------------------------------------------------------------------

test('PD-1: DEFAULT_SCHOOL_LOGO is a bundled data URL, not a remote URL', () => {
  const logo = readStringConst(fs.readFileSync(STORAGE_TS, 'utf8'), 'DEFAULT_SCHOOL_LOGO');
  assert.ok(logo.startsWith(DATA_URL_PREFIX), 'default logo must be an inline data URL');
  assert.ok(!/^https?:\/\//i.test(logo), 'default logo must not be an http(s) URL');
  assert.ok(!logo.includes('googleusercontent'), 'default logo must not reference a CDN');
  assert.equal(schema.validateLogo(logo).ok, true, 'bundled default must satisfy the B5.1 contract');
});

test('PD-1: the bundled default logo is byte-identical to the shipped asset', () => {
  const logo = readStringConst(fs.readFileSync(STORAGE_TS, 'utf8'), 'DEFAULT_SCHOOL_LOGO');
  const decoded = Buffer.from(logo.slice(DATA_URL_PREFIX.length), 'base64');
  assert.deepEqual(decoded, fs.readFileSync(BUNDLED_PNG));
  assert.equal(
    decoded.subarray(0, 8).toString('hex'),
    '89504e470d0a1a0a',
    'decoded default must still carry PNG magic bytes',
  );
});

test('PD-1: the repository contains no remote school-logo URL in shipped code', () => {
  const shipped = [
    'src/utils/storage.ts',
    'src/App.tsx',
    'src/components/Sidebar.tsx',
    'src/components/TitleBar.tsx',
    'src/components/DashboardView.tsx',
    'src/components/PengaturanView.tsx',
  ];
  for (const rel of shipped) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(
      !text.includes('googleusercontent'),
      `${rel} still references the remote school-logo CDN`,
    );
  }
});

test('PD-1: the default school name has exactly one definition in src/', () => {
  const app = fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8');
  assert.ok(!app.includes("'SMA Kusuma Bangsa'"), 'App.tsx must not re-declare the default name');
  assert.ok(app.includes('DEFAULT_SCHOOL_NAME'), 'App.tsx must seed from the shared constant');
  assert.equal(
    readStringConst(fs.readFileSync(STORAGE_TS, 'utf8'), 'DEFAULT_SCHOOL_NAME'),
    'SMA Kusuma Bangsa',
  );
});

// ---------------------------------------------------------------------------
// PD-2: a deleted logo persists as the empty string and is not resurrected.
// ---------------------------------------------------------------------------

test('PD-2: schema accepts an empty logo and never manufactures a remote default', () => {
  assert.equal(schema.validateLogo('').ok, true);
  const renderer = fs.readFileSync(path.join(ROOT, 'src', 'components', 'PengaturanView.tsx'), 'utf8');
  const reset = renderer.slice(renderer.indexOf('const handleResetLogo'));
  assert.ok(
    reset.includes("schoolLogo: ''"),
    'Hapus Logo must persist an empty schoolLogo',
  );
  assert.ok(
    !/googleusercontent/.test(reset.slice(0, reset.indexOf('};'))),
    'Hapus Logo must not write a remote URL back',
  );
});

test('PD-2: an empty persisted logo round-trips as empty after restart', async () => {
  const userData = freshUserData('clearlogo');
  const store = loadMainStorage(userData);
  store.initStore();
  store.hydrate();
  await store.commitAggregate('settings', { schoolName: 'SMA Tes', schoolLogo: '' });

  // Simulate a restart: brand new module instance over the same userData.
  const restarted = loadMainStorage(userData);
  restarted.initStore();
  restarted.hydrate();
  const settings = restarted.getAggregate('settings').value;
  assert.equal(settings.schoolLogo, '', 'cleared logo must stay empty, not fall back to a default');
  assert.equal(settings.schoolName, 'SMA Tes');
});

// ---------------------------------------------------------------------------
// Persistence: identity survives save/restart and backup/wipe/restore.
// ---------------------------------------------------------------------------

test('Persistence: school identity survives save -> restart -> hydrate', async () => {
  const userData = freshUserData('roundtrip');
  const store = loadMainStorage(userData);
  store.initStore();
  store.hydrate();

  const logo = readStringConst(fs.readFileSync(STORAGE_TS, 'utf8'), 'DEFAULT_SCHOOL_LOGO');
  await store.commitAggregate('settings', {
    schoolName: 'SMP Negeri 7',
    schoolLogo: logo,
  });

  const restarted = loadMainStorage(userData);
  restarted.initStore();
  restarted.hydrate();
  const settings = restarted.getAggregate('settings').value;
  assert.equal(settings.schoolName, 'SMP Negeri 7');
  assert.equal(settings.schoolLogo, logo);
});

test('Persistence: identity survives backup -> wipe -> restore', async () => {
  const userData = freshUserData('backup');
  const store = loadMainStorage(userData);
  store.initStore();
  store.hydrate();
  await store.commitAggregate('settings', { schoolName: 'SMA Backup', schoolLogo: '' });

  const backup = store.backupNow('school-identity-test');
  await store.commitAggregate('settings', {
    schoolName: 'SMA Pasca Restore',
    schoolLogo: 'https://example.test/x.png',
  });
  assert.equal(
    store.getAggregate('settings').value.schoolName,
    'SMA Pasca Restore',
    'precondition: identity really changed before restore',
  );

  // `restore` takes the archive basename, not the descriptor object.
  store.restore(backup.file);
  const restored = store.getAggregate('settings').value;
  assert.equal(restored.schoolName, 'SMA Backup');
  assert.equal(restored.schoolLogo, '');
});

// ---------------------------------------------------------------------------
// PD-4: the B5.1 logo allowlist is unchanged.
// ---------------------------------------------------------------------------

test('PD-4: the logo allowlist and size cap are unchanged', () => {
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16)]);
  const jpg = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(16)]);
  const gif = Buffer.from('474946383961', 'hex');
  const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');

  const asDataUrl = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;

  assert.equal(schema.validateLogo(asDataUrl(png, 'image/png')).ok, true, 'PNG allowed');
  assert.equal(schema.validateLogo(asDataUrl(jpg, 'image/jpeg')).ok, true, 'JPEG allowed');
  assert.equal(schema.validateLogo(asDataUrl(gif, 'image/gif')).ok, true, 'GIF allowed');
  assert.equal(schema.validateLogo(asDataUrl(webp, 'image/webp')).ok, true, 'WEBP allowed');
  assert.equal(schema.validateLogo(asDataUrl(svg, 'image/svg+xml')).ok, true, 'SVG allowed');

  // Rejected: wrong magic bytes, unsupported type, oversized payload.
  assert.equal(schema.validateLogo(asDataUrl(Buffer.from('not-an-image'), 'image/png')).ok, false);
  assert.equal(schema.validateLogo(asDataUrl(png, 'image/bmp')).ok, false);
  const oversized = `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024).toString('base64')}`;
  assert.equal(schema.validateLogo(oversized).ok, false, 'oversized logo must be rejected');
});

// ---------------------------------------------------------------------------
// B5-SI-07: display surfaces stay consistent with the stored identity.
// ---------------------------------------------------------------------------

test('B5-SI-07: every logo surface uses the shared default constant', () => {
  for (const rel of [
    'src/components/Sidebar.tsx',
    'src/components/TitleBar.tsx',
    'src/components/DashboardView.tsx',
    'src/components/PengaturanView.tsx',
  ]) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(
      text.includes("from '../utils/storage'"),
      `${rel} must import from the shared storage module`,
    );
    assert.ok(
      text.includes('settings.schoolLogo || DEFAULT_SCHOOL_LOGO'),
      `${rel} must fall back to the bundled logo when schoolLogo is empty`,
    );
  }
});

test('B5-SI-07: native tray and document title are not hard-coded to one school', () => {
  const tray = fs.readFileSync(path.join(ROOT, 'src', 'components', 'SystemTray.tsx'), 'utf8');
  assert.ok(!tray.includes('SMA Kusuma Bangsa'), 'SystemTray must not hard-code a school name');
  assert.ok(tray.includes('{settings.schoolName}'), 'SystemTray must display settings.schoolName');

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(!html.includes('SMA Kusuma Bangsa'), 'index.html must not hard-code a school name');
});

test('B5-SI-08: the supported-format copy matches the validator allowlist', () => {
  const view = fs.readFileSync(path.join(ROOT, 'src', 'components', 'PengaturanView.tsx'), 'utf8');
  const copy = view.slice(view.indexOf('Format didukung'));
  const line = copy.slice(0, copy.indexOf('</p>'));
  for (const fmt of ['PNG', 'JPG', 'GIF', 'WEBP', 'SVG']) {
    assert.ok(line.includes(fmt), `format copy must mention ${fmt}`);
  }
  assert.ok(/2\s*MB/i.test(line), 'format copy must state the 2MB cap');
});