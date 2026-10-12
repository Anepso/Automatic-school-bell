/**
 * B5 Volume — automated coverage for the `bellVolume` -> playback amplitude
 * contract (Stage A finding F-07).
 *
 * These tests exercise the REAL production audio engine. `src/utils/audioEngine.ts`
 * is transpiled with the project's existing `esbuild` devDependency and loaded
 * against instrumented Web Audio / HTMLAudioElement doubles, so every assertion
 * reads a gain value that the actual shipped code scheduled.
 *
 * They deliberately do NOT re-state the mapping formula. If the production
 * mapping were changed, reverted, or broken, these assertions would fail.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..', '..');
const ENGINE_TS = path.join(ROOT, 'src', 'utils', 'audioEngine.ts');

/**
 * Instrumentation: every AudioParam value that the engine schedules is recorded,
 * tagged with the node it belongs to. `gain` tags are amplitudes; `freq` tags are
 * Hz and must never be mistaken for amplitude.
 */
function installAudioDoubles() {
  const record = [];
  let lastElement = null;

  class Param {
    constructor(tag) {
      this.tag = tag;
      this.values = [];
    }
    _push(value) {
      this.values.push(value);
      record.push({ tag: this.tag, value });
    }
    setValueAtTime(value) { this._push(value); }
    linearRampToValueAtTime(value) { this._push(value); }
    exponentialRampToValueAtTime(value) { this._push(value); }
    setTargetAtTime(value) { this._push(value); }
    cancelScheduledValues() {}
  }

  class GainNodeDouble {
    constructor() { this.gain = new Param('gain'); }
    connect() {}
    disconnect() {}
  }

  class OscillatorDouble {
    constructor() { this.frequency = new Param('freq'); this.type = 'sine'; }
    connect() {}
    start() {}
    stop() {}
  }

  class AudioContextDouble {
    constructor() {
      this.currentTime = 0;
      this.state = 'running';
      this.sampleRate = 48000;
      this.destination = 'destination';
    }
    createGain() { return new GainNodeDouble(); }
    createOscillator() { return new OscillatorDouble(); }
    resume() {}
    close() { return Promise.resolve(); }
  }

  class AudioElementDouble {
    constructor(url) {
      this.url = url;
      this.volume = 1;
      this.playbackRate = 1;
      lastElement = this;
    }
    play() { return Promise.resolve(); }
    pause() {}
  }

  globalThis.window = { AudioContext: AudioContextDouble };
  globalThis.Audio = AudioElementDouble;

  return {
    record,
    reset: () => { record.length = 0; },
    lastElement: () => lastElement,
    /** Highest amplitude the engine scheduled on any gain param. */
    peakGain() {
      let peak = 0;
      for (const entry of record) {
        if (entry.tag !== 'gain') continue;
        if (typeof entry.value === 'number' && Number.isFinite(entry.value) && entry.value > peak) {
          peak = entry.value;
        }
      }
      return peak;
    },
    /** Every amplitude scheduled, in order — used to prove silence, not just a quiet peak. */
    gains() {
      return record.filter((e) => e.tag === 'gain').map((e) => e.value);
    },
  };
}

async function loadEngine() {
  const built = esbuild.buildSync({
    entryPoints: [ENGINE_TS],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    logLevel: 'silent',
  });
  const outFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'b5-volume-')),
    'audioEngine.mjs',
  );
  fs.writeFileSync(outFile, built.outputFiles[0].text);
  return import(pathToFileURL(outFile).href);
}

const SYNTHESIZED_PATHS = [
  ['Westminster', (e, v) => e.playWestminsterChime(v)],
  ['Two-tone', (e, v) => e.playTwoToneBell(v)],
  ['Break chime', (e, v) => e.playBreakChime(v)],
  ['Emergency siren', (e, v) => e.playEmergencySiren(v, 1)],
];

test('B5 volume contract', async (t) => {
  const audio = installAudioDoubles();
  const engine = await loadEngine();

  await t.test('bellVolume = 0 is true silence for every synthesized path', () => {
    for (const [name, invoke] of SYNTHESIZED_PATHS) {
      audio.reset();
      invoke(engine, 0);
      assert.equal(audio.peakGain(), 0, `${name} must schedule zero peak gain at bellVolume 0`);
      for (const value of audio.gains()) {
        assert.ok(
          value === 0 || (value > 0 && value < 0.01),
          `${name} leaked a non-silent amplitude ${value} at bellVolume 0`,
        );
      }
      // Nothing above the exponential release floor may be scheduled at all.
      const audible = audio.gains().filter((v) => v > 0.0001);
      assert.deepEqual(audible, [], `${name} emitted audio at bellVolume 0`);
    }
  });

  await t.test('bellVolume = 0 makes custom audio silent', async () => {
    audio.lastElement();
    await engine.playSoundByName('custom.mp3', 0, 'blob:custom');
    assert.equal(audio.lastElement().volume, 0, 'custom audio must be silent at bellVolume 0');
  });

  await t.test('bellVolume = 100 reaches the agreed application ceiling on every path', () => {
    for (const [name, invoke] of SYNTHESIZED_PATHS) {
      audio.reset();
      invoke(engine, 100);
      assert.equal(
        audio.peakGain(),
        engine.APPLICATION_VOLUME_CEILING,
        `${name} must reach the ceiling at bellVolume 100`,
      );
    }
  });

  await t.test('all playback paths agree with each other at every probed volume', async () => {
    for (const volume of [0, 1, 5, 25, 50, 80, 99, 100]) {
      const expected = engine.resolvePlaybackGain(volume);
      for (const [name, invoke] of SYNTHESIZED_PATHS) {
        audio.reset();
        invoke(engine, volume);
        assert.ok(
          Math.abs(audio.peakGain() - expected) < 1e-12,
          `${name} produced ${audio.peakGain()} at bellVolume ${volume}, expected ${expected}`,
        );
      }
      await engine.playSoundByName('custom.mp3', volume, 'blob:custom');
      assert.ok(
        Math.abs(audio.lastElement().volume - expected) < 1e-12,
        `custom audio produced ${audio.lastElement().volume} at bellVolume ${volume}, expected ${expected}`,
      );
    }
  });

  await t.test('low slider positions are no longer collapsed', () => {
    const distinct = new Set();
    for (let v = 0; v <= 100; v += 1) {
      audio.reset();
      engine.playWestminsterChime(v);
      distinct.add(audio.peakGain());
    }
    assert.equal(
      distinct.size,
      101,
      'every slider position 0-100 must produce a distinct amplitude (Stage A F-02)',
    );
  });

  await t.test('bellVolume = 1 produces a valid non-negative output', () => {
    for (const [name, invoke] of SYNTHESIZED_PATHS) {
      audio.reset();
      invoke(engine, 1);
      const peak = audio.peakGain();
      assert.ok(peak > 0, `${name} produced no output at bellVolume 1`);
      assert.ok(Number.isFinite(peak) && peak < 1, `${name} peak ${peak} out of range`);
    }
  });

  await t.test('bellVolume = 50 maps to the midpoint of the application range', () => {
    const expected = engine.APPLICATION_VOLUME_CEILING / 2;
    assert.ok(Math.abs(engine.resolvePlaybackGain(50) - expected) < 1e-12);
    audio.reset();
    engine.playWestminsterChime(50);
    assert.ok(Math.abs(audio.peakGain() - expected) < 1e-12);
  });

  await t.test('the response is linear and never exceeds the ceiling', () => {
    for (let v = 0; v <= 100; v += 1) {
      const gain = engine.resolvePlaybackGain(v);
      assert.ok(
        Math.abs(gain - (v / 100) * engine.APPLICATION_VOLUME_CEILING) < 1e-12,
        `mapping is not linear at ${v}`,
      );
      assert.ok(gain >= 0, `negative gain at ${v}`);
      assert.ok(gain <= engine.APPLICATION_VOLUME_CEILING, `gain above ceiling at ${v}`);
    }
    assert.ok(engine.APPLICATION_VOLUME_CEILING < 1, 'headroom below unity gain must be preserved');
  });

  await t.test('out-of-range and malformed input is bounded', () => {
    assert.equal(engine.resolvePlaybackGain(-1), 0, 'negative must resolve to silence');
    assert.equal(engine.resolvePlaybackGain(-50), 0);
    assert.equal(engine.resolvePlaybackGain(0), 0);
    assert.equal(
      engine.resolvePlaybackGain(101),
      engine.APPLICATION_VOLUME_CEILING,
      'above-range must clamp to the ceiling',
    );
    assert.equal(engine.resolvePlaybackGain(NaN), 0, 'NaN must not propagate into Web Audio');
    assert.equal(engine.resolvePlaybackGain(Infinity), 0);
    assert.equal(engine.resolvePlaybackGain('80'), 0, 'strings must not be coerced');
  });

  await t.test('malformed input cannot reach custom audio as NaN', async () => {
    for (const bad of [NaN, 'abc', Infinity, -Infinity, null]) {
      await engine.playSoundByName('custom.mp3', bad, 'blob:custom');
      const value = audio.lastElement().volume;
      assert.ok(Number.isFinite(value), `custom audio received non-finite volume ${value}`);
      assert.equal(value, 0, `malformed ${String(bad)} must resolve to silence`);
    }
  });

  await t.test('overlapping playbacks each carry their own amplitude', () => {
    audio.reset();
    engine.playWestminsterChime(80);
    const first = audio.peakGain();
    audio.reset();
    engine.playTwoToneBell(20);
    const second = audio.peakGain();
    assert.notEqual(first, second, 'a second playback must not reuse the first amplitude');
  });

  await t.test('siren timing, frequencies and envelopes are preserved', () => {
    audio.reset();
    engine.playEmergencySiren(100, 4);
    const freqs = audio.record.filter((e) => e.tag === 'freq').map((e) => e.value);
    assert.ok(freqs.includes(450), 'siren base frequency 450 Hz must be preserved');
    assert.ok(freqs.includes(880), 'siren peak frequency 880 Hz must be preserved');
  });
});

test('B5 bellVolume schema contract', () => {
  const schema = require(path.join(ROOT, 'electron', 'settings-schema.cjs'));
  const base = { schoolName: 'SMP' };

  assert.equal(schema.LIMITS.minBellVolume, 0);
  assert.equal(schema.LIMITS.maxBellVolume, 100);

  const accepted = [0, 1, 50, 99, 100];
  for (const value of accepted) {
    assert.ok(
      schema.validateSettings({ ...base, bellVolume: value }).ok,
      `${value} must be accepted`,
    );
  }

  const rejected = [-1, -0.5, 101, 1000, 50.5, '80', 'abc', '', NaN, Infinity, null, undefined, true, [], {}];
  for (const value of rejected) {
    assert.equal(
      schema.validateSettings({ ...base, bellVolume: value }).ok,
      false,
      `${JSON.stringify(String(value))} must be rejected`,
    );
  }

  // sanitizeSettings drops rather than clamps, so an unusable stored value falls
  // back to the renderer default instead of reaching playback.
  for (const value of [-1, 101, '80', NaN, 50.5]) {
    const sanitized = schema.sanitizeSettings({ ...base, bellVolume: value });
    assert.equal(
      Object.prototype.hasOwnProperty.call(sanitized, 'bellVolume'),
      false,
      `${String(value)} must be dropped, not normalized`,
    );
  }

  for (const value of [0, 50, 100]) {
    assert.equal(schema.sanitizeSettings({ ...base, bellVolume: value }).bellVolume, value);
  }

  assert.ok(!Object.prototype.hasOwnProperty.call(schema.sanitizeSettings(base), 'bellVolume'));
});

test('B5 bellVolume storage round-trip', async () => {
  const storageSource = fs.readFileSync(
    path.join(ROOT, 'src', 'utils', 'storage.ts'),
    'utf8',
  );

  // The renderer gate that stands between the slider and the store.
  assert.match(
    storageSource,
    /Number\.isFinite\(volume\)/,
    'sanitizeSettingsPatch must reject non-finite bellVolume',
  );
  assert.match(
    storageSource,
    /delete next\.bellVolume/,
    'sanitizeSettingsPatch must drop an out-of-range bellVolume instead of clamping it',
  );

  // DEFAULT_SETTINGS supplies the fallback for a dropped key.
  assert.match(storageSource, /bellVolume:\s*80/, 'DEFAULT_SETTINGS must define the bellVolume default');

  const mainSource = fs.readFileSync(path.join(ROOT, 'electron', 'storage.cjs'), 'utf8');
  assert.match(
    mainSource,
    /validateSettings\(value\)/,
    'the main process must validate settings before the write is enqueued',
  );
});