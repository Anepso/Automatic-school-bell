/**
 * B7 Stage B-2 — unit tests for the Gemini BYOK credential boundary.
 *
 * These cover the three pieces that can be tested without a running OS key
 * store: the store's own logic (with `electron` mocked, because a unit test must
 * not depend on whether the host has a keyring), the IPC surface's shape, and the
 * backend broker's precedence rules.
 *
 * The security claims that actually matter are NOT all provable here — "safeStorage
 * is DPAPI on Windows" needs a Windows machine, and "no key reaches the renderer"
 * needs a running Electron app. Those are covered by
 * `b7-b2-runtime.test.cjs` and the audit report's runtime evidence section. What
 * this file pins down is everything that could silently regress with an ordinary
 * refactor: validation, atomic replacement, deletion, the sender guard, the
 * status shape, and the rule that the broker outranks `.env`.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');

/**
 * A stand-in for `safeStorage` that behaves the way DPAPI does for the two
 * properties these tests care about: bytes come back in a form that does NOT
 * contain the plaintext, and only the key store can turn them back into it.
 *
 * AES-256-GCM under a random key generated once per fake instance is the closest
 * cheap analogue. An earlier version simply prefixed the plaintext, which made
 * the round-trip test pass while making the "no plaintext on disk" assertion
 * untestable — a mock that cannot model the property is not a mock of it.
 */
function createFakeSafeStorage() {
  const key = crypto.randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString: (buffer) => {
      if (buffer.length < 28) throw new Error('not decryptable');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

/**
 * Load `electron/gemini-credential-store.cjs` against a temporary userData root.
 *
 * `Module._load` is patched rather than the module registry poked, because the
 * store does `require('electron')` at module scope and there is no other seam.
 * The patch is restored in a `finally` so a failing assertion cannot leak the
 * mock into another test file in the same process.
 */
function loadStore(options = {}) {
  // Reusing an explicit `userData` is how the restart test works: a second module
  // instance pointed at the same directory is the unit-test analogue of relaunching.
  const userData = options.userData || fs.mkdtempSync(path.join(os.tmpdir(), 'b7-b2-store-'));
  const safeStorage = options.safeStorage || createFakeSafeStorage();

  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return {
        safeStorage,
        app: {
          getPath: (name) => {
            assert.equal(name, 'userData');
            return userData;
          },
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let store;
  try {
    const target = path.join(ROOT, 'electron', 'gemini-credential-store.cjs');
    delete require.cache[require.resolve(target)];
    store = require(target);
  } finally {
    Module._load = originalLoad;
  }

  return { store, userData, safeStorage };
}

function readCredentialFile(userData) {
  return fs.readFileSync(path.join(userData, 'credentials', 'gemini.enc'));
}

// ---------------------------------------------------------------------------
// Store: encryption, persistence, replacement, deletion
// ---------------------------------------------------------------------------

test('B7-B2 store writes an encrypted artifact, never the plaintext', () => {
  const { store, userData } = loadStore();
  const secret = 'AIzaSy-TEST-KEY-DO-NOT-USE-0123456789';

  store.saveKey(secret);

  const onDisk = readCredentialFile(userData);
  assert.ok(!onDisk.includes(Buffer.from(secret, 'utf8')), 'plaintext must not be on disk');
  assert.ok(!onDisk.toString('utf8').includes('AIza'), 'no fragment of the key may be readable');
  assert.deepEqual(store.getStatus(), { configured: true, available: true, readable: true });
});

test('B7-B2 store round-trips the key through safeStorage', () => {
  const { store } = loadStore();
  const secret = 'AIzaSy-TEST-KEY-DO-NOT-USE-0123456789';

  store.saveKey(secret);

  assert.equal(store.loadKey(), secret);
});

test('B7-B2 store keeps a restart working: a fresh load of the module reads the file', () => {
  const first = loadStore();
  first.store.saveKey('AIzaSy-PERSIST-ACROSS-RELOAD-0123456789');

  // A new module instance is the closest unit-test analogue of an app restart:
  // nothing is cached in memory between them, only the encrypted file survives.
  const second = loadStore({ safeStorage: first.safeStorage, userData: first.userData });
  assert.deepEqual(second.store.getStatus(), { configured: true, available: true, readable: true });
  assert.equal(second.store.loadKey(), 'AIzaSy-PERSIST-ACROSS-RELOAD-0123456789');
});

test('B7-B2 store replaces a key in place and leaves no stale temp file', () => {
  const { store, userData } = loadStore();

  store.saveKey('AIzaSy-FIRST-KEY-0000000000000000000000');
  store.saveKey('AIzaSy-SECOND-KEY-111111111111111111111');

  assert.equal(store.loadKey(), 'AIzaSy-SECOND-KEY-111111111111111111111');

  const dir = path.join(userData, 'credentials');
  const leftovers = fs.readdirSync(dir).filter((name) => name.includes('.tmp'));
  assert.deepEqual(leftovers, [], 'atomic write must not leave temp files behind');
});

test('B7-B2 store deletion removes the file and reports not-configured', () => {
  const { store, userData } = loadStore();

  store.saveKey('AIzaSy-TEMP-KEY-000000000000000000000000');
  assert.equal(store.getStatus().configured, true);

  const status = store.deleteKey();

  assert.deepEqual(status, { configured: false, available: true, readable: false });
  assert.equal(fs.existsSync(path.join(userData, 'credentials', 'gemini.enc')), false);
  assert.equal(store.loadKey(), null);
});

test('B7-B2 store deletion is idempotent', () => {
  const { store } = loadStore();

  assert.deepEqual(store.deleteKey(), { configured: false, available: true, readable: false });
  assert.deepEqual(store.deleteKey(), { configured: false, available: true, readable: false });
});

// ---------------------------------------------------------------------------
// Store: validation
// ---------------------------------------------------------------------------

test('B7-B2 store rejects an empty or whitespace-only key without touching disk', () => {
  const { store, userData } = loadStore();

  for (const bad of ['', '   ', '\t\n']) {
    assert.throws(() => store.saveKey(bad), (error) => {
      assert.equal(error.code, 'CREDENTIAL_INVALID_INPUT');
      // The message must describe the failure without echoing the input. Skipped
      // for '' because every string trivially "contains" the empty string.
      // Guarded on the trimmed value, since '\t\n' also trims to ''.
      if (bad.trim().length > 0) assert.ok(!String(error.message).includes(bad.trim()));
      return true;
    });
  }
  assert.equal(store.getStatus().configured, false);
  assert.equal(fs.existsSync(path.join(userData, 'credentials', 'gemini.enc')), false);
});

test('B7-B2 store rejects a non-string input instead of coercing it', () => {
  const { store } = loadStore();

  for (const bad of [null, undefined, 42, {}, [], true, Symbol('x')]) {
    assert.throws(() => store.saveKey(bad), (error) => {
      assert.equal(error.code, 'CREDENTIAL_INVALID_INPUT');
      return true;
    });
  }
});

test('B7-B2 store rejects an over-long key', () => {
  const { store } = loadStore();

  assert.throws(() => store.saveKey('a'.repeat(store.MAX_KEY_LENGTH + 1)), (error) => {
    assert.equal(error.code, 'CREDENTIAL_INVALID_INPUT');
    return true;
  });
});

test('B7-B2 store trims surrounding whitespace before encrypting', () => {
  const { store } = loadStore();

  store.saveKey('  AIzaSy-TRIMMED-0000000000000000000000000  ');

  assert.equal(store.loadKey(), 'AIzaSy-TRIMMED-0000000000000000000000000');
});

// ---------------------------------------------------------------------------
// Store: refusal rather than a weaker fallback
// ---------------------------------------------------------------------------

test('B7-B2 store refuses to write when safeStorage is unavailable', () => {
  const { store, userData } = loadStore({
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error('must never be called while unavailable');
      },
      decryptString: () => {
        throw new Error('must never be called while unavailable');
      },
    },
  });

  assert.throws(() => store.saveKey('AIzaSy-SHOULD-NOT-BE-STORED-0000000'), (error) => {
    assert.equal(error.code, 'CREDENTIAL_STORE_UNAVAILABLE');
    return true;
  });

  assert.deepEqual(store.getStatus(), { configured: false, available: false, readable: false });
  assert.equal(fs.existsSync(path.join(userData, 'credentials', 'gemini.enc')), false);
});

test('B7-B2 store reports unavailable when the key store throws on a probe', () => {
  const { store } = loadStore({
    safeStorage: {
      isEncryptionAvailable: () => {
        throw new Error('keyring locked');
      },
      encryptString: () => Buffer.alloc(0),
      decryptString: () => '',
    },
  });

  assert.deepEqual(store.getStatus(), { configured: false, available: false, readable: false });
});

test('B7-B2 store KEEPS a credential it cannot decrypt and reports it unreadable', () => {
  // Regression guard for a real defect. An earlier version deleted the blob here,
  // on the theory that an undecryptable file is worthless. Booting the real app
  // against a profile written under a different Electron app identity proved that
  // wrong: Electron's Linux safeStorage binds ciphertext to the app identity, so
  // the user's key was destroyed without anyone asking for it.
  const { store, userData } = loadStore();
  const file = path.join(userData, 'credentials', 'gemini.enc');

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, crypto.randomBytes(64));

  assert.equal(store.loadKey(), null);
  assert.deepEqual(
    store.getStatus(),
    // Stored, and this machine can use safeStorage, but it cannot be decrypted.
    { configured: true, available: true, readable: false },
  );
  assert.equal(fs.existsSync(file), true, 'an unreadable blob must never be auto-deleted');
});

test('B7-B2 store reports readable:false when the key store is unavailable', () => {
  const { store, userData } = loadStore();
  const file = path.join(userData, 'credentials', 'gemini.enc');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, crypto.randomBytes(64));

  const offline = loadStore({ userData, safeStorage: { isEncryptionAvailable: () => false } });
  assert.deepEqual(offline.store.getStatus(), { configured: true, available: false, readable: false });
});

test('B7-B2 store writes the encrypted file owner-only where the OS supports it', () => {
  if (process.platform === 'win32') {
    // DPAPI provides the protection on Windows; POSIX modes are irrelevant there.
    return;
  }
  const { store, userData } = loadStore();
  store.saveKey('AIzaSy-PERM-CHECK-0000000000000000000000000');

  const mode = fs.statSync(path.join(userData, 'credentials', 'gemini.enc')).mode & 0o777;
  assert.equal(mode, 0o600, `expected 0600, got 0${mode.toString(8)}`);
});

// ---------------------------------------------------------------------------
// IPC surface
// ---------------------------------------------------------------------------

test('B7-B2 IPC exposes exactly three verbs on one channel', () => {
  delete require.cache[require.resolve(path.join(ROOT, 'electron', 'gemini-credential-ipc.cjs'))];
  const ipc = require(path.join(ROOT, 'electron', 'gemini-credential-ipc.cjs'));

  assert.equal(ipc.CHANNEL, 'school-bell:credentials');
  assert.deepEqual([...ipc.VERBS].sort(), [
    'delete-gemini-key',
    'get-gemini-status',
    'set-gemini-key',
  ]);

  const source = fs.readFileSync(path.join(ROOT, 'electron', 'gemini-credential-ipc.cjs'), 'utf8');
  assert.ok(
    !/get-?gemini-?key|read-?key|reveal/i.test(source),
    'no verb may read a key back',
  );
});

test('B7-B2 IPC rejects an untrusted sender on every verb', () => {
  const handlers = new Map();
  let pushed = 0;

  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: {
          handle: (channel, handler) => handlers.set(channel, handler),
          removeHandler: (channel) => handlers.delete(channel),
        },
      };
    }
    if (request === './gemini-credential-store.cjs') {
      return loadStore().store;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let ipc;
  try {
    const target = path.join(ROOT, 'electron', 'gemini-credential-ipc.cjs');
    delete require.cache[require.resolve(target)];
    ipc = require(target);
    ipc.registerGeminiCredentialIpc(() => false, () => { pushed += 1; });
  } finally {
    Module._load = originalLoad;
  }

  assert.equal(handlers.size, 3, 'all three verbs must be registered');

  return Promise.all(
    [...handlers.values()].map(async (handler) => {
      const reply = await handler({ sender: { id: 999 } }, {});
      assert.equal(reply.ok, false);
      assert.equal(reply.error.code, 'CREDENTIAL_FORBIDDEN');
      assert.equal(reply.error.details, null);
    }),
  ).then(() => {
    assert.equal(pushed, 0, 'a refused sender must not trigger a broker push');
    ipc.unregisterGeminiCredentialIpc();
    assert.equal(handlers.size, 0);
  });
});

test('B7-B2 IPC answers a trusted sender with a status and no key material', async () => {
  const handlers = new Map();
  let pushed = 0;
  const store = loadStore().store;

  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: {
          handle: (channel, handler) => handlers.set(channel, handler),
          removeHandler: (channel) => handlers.delete(channel),
        },
      };
    }
    if (request === './gemini-credential-store.cjs') return store;
    return originalLoad.call(this, request, parent, isMain);
  };

  let ipc;
  try {
    const target = path.join(ROOT, 'electron', 'gemini-credential-ipc.cjs');
    delete require.cache[require.resolve(target)];
    ipc = require(target);
    ipc.registerGeminiCredentialIpc(() => true, () => { pushed += 1; });
  } finally {
    Module._load = originalLoad;
  }

  const set = handlers.get('school-bell:credentials:set-gemini-key');
  const status = handlers.get('school-bell:credentials:get-gemini-status');
  const del = handlers.get('school-bell:credentials:delete-gemini-key');

  const saved = await set({}, { apiKey: 'AIzaSy-IPC-KEY-000000000000000000000000' });
  assert.equal(saved.ok, true);
  assert.deepEqual(saved.value, { configured: true, available: true, readable: true });
  assert.equal(pushed, 1, 'a successful save must re-push to the backend');

  const read = await status({}, {});
  assert.deepEqual(Object.keys(read.value).sort(), ['available', 'configured', 'readable']);
  assert.ok(!JSON.stringify(read).includes('AIza'), 'the reply must not echo the key');

  const removed = await del({}, {});
  assert.deepEqual(removed.value, { configured: false, available: true, readable: false });
  assert.equal(pushed, 2, 'a successful delete must re-push to the backend');

  ipc.unregisterGeminiCredentialIpc();
});

// ---------------------------------------------------------------------------
// Preload surface
// ---------------------------------------------------------------------------

test('B7-B2 preload exposes a write-only credential bridge', () => {
  const source = fs.readFileSync(path.join(ROOT, 'electron', 'preload.cjs'), 'utf8');

  const block = source.slice(source.indexOf('schoolBellGemini'));
  assert.ok(!/getKey|readKey|revealKey|decrypt/i.test(block), 'no read-back method may exist');

  // The bridge must not hand the renderer any Electron primitive.
  const bridgeBlock = source.slice(source.indexOf('const credentialChannel'));
  assert.ok(
    !/exposeInMainWorld\([^)]*ipcRenderer|require\('electron'\)/.test(bridgeBlock),
    'the credential bridge must not re-expose ipcRenderer or require electron',
  );
});

// ---------------------------------------------------------------------------
// Backend broker precedence
// ---------------------------------------------------------------------------

test('B7-B2 broker: production ignores .env and an exported GEMINI_API_KEY', () => {
  const mod = loadBrokerModule();
  const credential = mod.resolveGeminiCredential({
    NODE_ENV: 'production',
    GEMINI_API_KEY: 'AIzaSy-SHOULD-BE-IGNORED-000000000000',
    SCHOOL_BELL_GEMINI_API_KEY: 'AIzaSy-ALSO-IGNORED-IN-PROD-000000000',
  });

  assert.equal(credential.apiKey, null);
  assert.equal(credential.source, 'absent');
});

test('B7-B2 broker: development still honours .env (unchanged dev behaviour)', () => {
  const mod = loadBrokerModule();
  const credential = mod.resolveGeminiCredential({
    NODE_ENV: 'development',
    GEMINI_API_KEY: 'AIzaSy-DEV-ENV-KEY-000000000000000000000',
  });

  assert.equal(credential.source, 'development-env');
  assert.equal(credential.apiKey, 'AIzaSy-DEV-ENV-KEY-000000000000000000000');
});

test('B7-B2 broker: no key anywhere reports absent, and the description hides it', () => {
  const mod = loadBrokerModule();
  const credential = mod.resolveGeminiCredential({ NODE_ENV: 'production' });

  assert.deepEqual(credential, { apiKey: null, source: 'absent' });
  assert.equal(mod.describeGeminiCredential(credential), 'NOT CONFIGURED');
});

test('B7-B2 broker: description reports the channel, never the key', () => {
  const mod = loadBrokerModule();
  const secret = 'AIzaSy-DESCRIPTION-CHECK-000000000000000000000';

  for (const source of ['user-supplied', 'development-env']) {
    const described = mod.describeGeminiCredential({ apiKey: secret, source });
    assert.ok(!described.includes(secret), 'a key must never reach a log line');
    assert.ok(!described.includes('AIza'), 'no fragment of the key may reach a log line');
    assert.ok(described.startsWith('CONFIGURED'));
  }
});

test('B7-B2 broker: a stdin frame installs the key, and a null frame forgets it', () => {
  const mod = loadBrokerModule();
  const secret = 'AIzaSy-BROKER-KEY-000000000000000000000000';

  // Simulate the exact frames `main.cjs` writes.
  mod.applyBrokerMessage(JSON.stringify({ type: 'gemini-credential', apiKey: secret }));
  assert.equal(mod.resolveGeminiCredential({ NODE_ENV: 'production' }).apiKey, secret);

  // Deletion is a real instruction, not "no update".
  mod.applyBrokerMessage(JSON.stringify({ type: 'gemini-credential', apiKey: null }));
  assert.equal(mod.resolveGeminiCredential({ NODE_ENV: 'production' }).apiKey, null);
});

test('B7-B2 broker: malformed and foreign frames are ignored, not fatal', () => {
  const mod = loadBrokerModule();

  assert.doesNotThrow(() => mod.applyBrokerMessage('not json at all'));
  assert.doesNotThrow(() => mod.applyBrokerMessage(JSON.stringify({ type: 'something-else', apiKey: 'x' })));
  assert.doesNotThrow(() => mod.applyBrokerMessage(JSON.stringify([1, 2, 3])));
  assert.doesNotThrow(() => mod.applyBrokerMessage(JSON.stringify({ type: 'gemini-credential', apiKey: { nested: 'x' } })));

  assert.equal(mod.resolveGeminiCredential({ NODE_ENV: 'production' }).apiKey, null);
});

// ---------------------------------------------------------------------------
// The B6 resolver, against a credential that can change underneath it
// ---------------------------------------------------------------------------

test('B7-B2 resolver rebuilds the SDK client when the credential changes', async () => {
  const { createGeminiResolver } = loadEndpointModule();

  let current = 'AIzaSy-KEY-A-0000000000000000000000000000';
  const constructed = [];
  const sdk = {
    GoogleGenAI: class {
      constructor(options) { constructed.push(options.apiKey); }
      async generateContent() { return { text: () => 'ok' }; }
    },
  };

  const resolveClient = createGeminiResolver({
    readApiKey: () => current,
    loadSdk: async () => sdk,
  });

  // One client per credential, not one per request: the hot path must not
  // rebuild the SDK.
  await resolveClient();
  await resolveClient();
  assert.deepEqual(constructed, ['AIzaSy-KEY-A-0000000000000000000000000000']);

  // Replace: the new credential must be built, or the user's "Ganti" is a lie.
  current = 'AIzaSy-KEY-B-1111111111111111111111111111';
  await resolveClient();
  assert.deepEqual(constructed[1], 'AIzaSy-KEY-B-1111111111111111111111111111');

  // Delete: the resolver must report NOT_CONFIGURED rather than keep serving the
  // client it already built.
  current = undefined;
  await assert.rejects(
    () => resolveClient(),
    (error) => { assert.equal(error.code, 'AI_NOT_CONFIGURED'); return true; },
  );
});

test('B7-B2 resolver drops a revoked client so the key is not retained', async () => {
  const { createGeminiResolver } = loadEndpointModule();

  let current = 'AIzaSy-REVOKE-00000000000000000000000000000';
  const constructed = [];
  const sdk = {
    GoogleGenAI: class {
      constructor(options) { constructed.push(options.apiKey); }
      async generateContent() { return { text: () => 'ok' }; }
    },
  };

  const resolveClient = createGeminiResolver({
    readApiKey: () => current,
    loadSdk: async () => sdk,
  });

  await resolveClient();
  current = undefined;
  await assert.rejects(() => resolveClient(), /AI_NOT_CONFIGURED|not set/);

  // Restoring the same key rebuilds it, which proves the old client was dropped
  // rather than quietly reused.
  current = 'AIzaSy-REVOKE-00000000000000000000000000000';
  await resolveClient();
  assert.equal(constructed.length, 2, 'a revoked client must not be resurrected');
});

test('B7-B2 resolver still reports NOT_CONFIGURED for a whitespace-only key', async () => {
  const { createGeminiResolver } = loadEndpointModule();
  const resolveClient = createGeminiResolver({
    readApiKey: () => '   ',
    loadSdk: async () => { throw new Error('sdk must not load without a credential'); },
  });

  await assert.rejects(
    () => resolveClient(),
    (error) => { assert.equal(error.code, 'AI_NOT_CONFIGURED'); return true; },
  );
});

/**
 * Load the TypeScript broker through esbuild so the tests exercise the same
 * transform `build:backend` applies, rather than a hand-rolled mock of it.
 */
function loadBrokerModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const outfile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'b7-b2-broker-')),
    'broker.cjs',
  );
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'gemini-credential.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
  });

  delete require.cache[require.resolve(outfile)];
  const compiled = require(outfile);
  return {
    resolveGeminiCredential: compiled.resolveGeminiCredential,
    describeGeminiCredential: compiled.describeGeminiCredential,
    isCredentialBrokerActive: compiled.isCredentialBrokerActive,
    applyBrokerMessage: compiled.applyBrokerMessage,
  };
}

/** Same esbuild-through-the-real-source approach, for the B6 endpoint module. */
function loadEndpointModule() {
  const esbuild = require(path.join(ROOT, 'node_modules', 'esbuild'));
  const outfile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'b7-b2-endpoint-')),
    'endpoint.cjs',
  );
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'ai-assistant-endpoint.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile,
    logLevel: 'silent',
  });
  delete require.cache[require.resolve(outfile)];
  return require(outfile);
}
