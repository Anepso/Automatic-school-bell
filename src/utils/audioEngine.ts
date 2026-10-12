// Web Audio API engine for realistic school bell synthesis and audio playback

let audioCtx: AudioContext | null = null;
let currentPlayingSource: AudioNode | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function stopAudio() {
  if (currentPlayingSource) {
    try {
      if ('stop' in currentPlayingSource && typeof (currentPlayingSource as AudioScheduledSourceNode).stop === 'function') {
        (currentPlayingSource as AudioScheduledSourceNode).stop();
      }
    } catch {
      // ignore
    }
    currentPlayingSource = null;
  }
}

// Creates/resumes the shared AudioContext from a user gesture so an automatic
// bell is not silently dropped by the autoplay policy on a fully unattended PC.
export function warmAudioContext() {
  try {
    getAudioContext();
  } catch {
    // ignore; the next bell attempt will surface any remaining audio failure
  }
}

/**
 * B5 Volume (Model A) — the ONE authoritative `bellVolume` -> playback amplitude
 * mapping. Every playback path resolves its amplitude through this function, so a
 * synthesized bell and a custom uploaded recording share identical volume semantics.
 *
 * Contract, enforced here rather than at each call site:
 *   - `bellVolume = 0`   -> 0 (true silence)
 *   - `bellVolume = 100` -> APPLICATION_VOLUME_CEILING
 *   - the response is linear; there is deliberately no perceptual/log curve
 *   - there is no low-end floor and no per-sound multiplier, so every slider
 *     position from 0 to 100 produces a distinct, proportional amplitude
 *   - non-finite input resolves to 0 rather than propagating into Web Audio
 *
 * The ceiling is 0.7 because that is the loudest amplitude this engine already
 * produced (the emergency siren). Keeping the ceiling at that value means no
 * playback path becomes louder than the application's previous maximum, while
 * retaining headroom below unity gain so overlapping bells cannot clip.
 */
export const APPLICATION_VOLUME_CEILING = 0.7;

export function resolvePlaybackGain(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  const normalized = Math.min(1, Math.max(0, volume / 100));
  return normalized * APPLICATION_VOLUME_CEILING;
}

/**
 * Releases a gain param toward its floor.
 *
 * `exponentialRampToValueAtTime` keeps the existing bell decay shape for audible
 * notes, but its non-zero target would still emit a floor-level blip after
 * `bellVolume = 0`. A fully silent note therefore ramps linearly to exact 0 at the
 * SAME end time, so the envelope timing is identical in both cases and
 * `bellVolume = 0` is genuinely silent rather than merely very quiet.
 */
function rampRelease(param: AudioParam, peak: number, floor: number, endTime: number) {
  if (peak > 0) {
    param.exponentialRampToValueAtTime(floor, endTime);
  } else {
    param.linearRampToValueAtTime(0, endTime);
  }
}

// Synthesizes a bell chime note using FM-like metallic overtone synthesis
function playBellNote(ctx: AudioContext, freq: number, startTime: number, duration: number, gainVal: number) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  // Secondary harmonic for tubular bell metallic warmth
  const overtoneOsc = ctx.createOscillator();
  const overtoneGain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);

  overtoneOsc.type = 'triangle';
  overtoneOsc.frequency.setValueAtTime(freq * 2.76, startTime); // Bell characteristic partial

  // Envelopes
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gainVal, startTime + 0.015);
  rampRelease(gainNode.gain, gainVal, 0.0001, startTime + duration);

  overtoneGain.gain.setValueAtTime(0, startTime);
  overtoneGain.gain.linearRampToValueAtTime(gainVal * 0.35, startTime + 0.01);
  rampRelease(overtoneGain.gain, gainVal * 0.35, 0.0001, startTime + duration * 0.6);

  osc.connect(gainNode);
  overtoneOsc.connect(overtoneGain);
  gainNode.connect(ctx.destination);
  overtoneGain.connect(ctx.destination);

  osc.start(startTime);
  overtoneOsc.start(startTime);

  osc.stop(startTime + duration + 0.05);
  overtoneOsc.stop(startTime + duration + 0.05);
}

// Play Westminster School Chime
export function playWestminsterChime(volume: number = 80): Promise<void> {
  stopAudio();
  const ctx = getAudioContext();
  const baseVol = resolvePlaybackGain(volume);
  const now = ctx.currentTime + 0.05;

  // Notes: G#4 (415.30), F#4 (369.99), E4 (329.63), B3 (246.94)
  const notes = [
    { freq: 329.63, time: 0.0, dur: 1.2 }, // E4
    { freq: 415.30, time: 0.8, dur: 1.2 }, // G#4
    { freq: 369.99, time: 1.6, dur: 1.2 }, // F#4
    { freq: 246.94, time: 2.4, dur: 2.4 }, // B3
  ];

  notes.forEach((n) => {
    playBellNote(ctx, n.freq, now + n.time, n.dur, baseVol);
  });

  return new Promise((resolve) => {
    setTimeout(resolve, 5000);
  });
}

// Play Standard 2-tone School Bell (Ding-Dong)
export function playTwoToneBell(volume: number = 80): Promise<void> {
  stopAudio();
  const ctx = getAudioContext();
  const baseVol = resolvePlaybackGain(volume);
  const now = ctx.currentTime + 0.05;

  // Ding (High) - Dong (Low) repeated twice
  const pattern = [
    { freq: 659.25, time: 0.0, dur: 1.3 }, // E5
    { freq: 523.25, time: 0.7, dur: 1.6 }, // C5
    { freq: 659.25, time: 1.9, dur: 1.3 }, // E5
    { freq: 523.25, time: 2.6, dur: 2.2 }, // C5
  ];

  pattern.forEach((n) => {
    playBellNote(ctx, n.freq, now + n.time, n.dur, baseVol);
  });

  return new Promise((resolve) => {
    setTimeout(resolve, 5000);
  });
}

// Play Cheerful Break Chime (Istirahat)
export function playBreakChime(volume: number = 80): Promise<void> {
  stopAudio();
  const ctx = getAudioContext();
  const baseVol = resolvePlaybackGain(volume);
  const now = ctx.currentTime + 0.05;

  // Bright arpeggio chime: C5, E5, G5, C6
  const pattern = [
    { freq: 523.25, time: 0.0, dur: 0.9 }, // C5
    { freq: 659.25, time: 0.35, dur: 0.9 }, // E5
    { freq: 783.99, time: 0.7, dur: 0.9 }, // G5
    { freq: 1046.50, time: 1.05, dur: 2.2 }, // C6
  ];

  pattern.forEach((n) => {
    playBellNote(ctx, n.freq, now + n.time, n.dur, baseVol);
  });

  return new Promise((resolve) => {
    setTimeout(resolve, 3500);
  });
}

// Play Emergency Siren
export function playEmergencySiren(volume: number = 80, durationSeconds: number = 4): Promise<void> {
  stopAudio();
  const ctx = getAudioContext();
  const baseVol = resolvePlaybackGain(volume);
  const now = ctx.currentTime + 0.05;

  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(450, now);

  // Modulation: siren frequency sweeps
  const cycles = Math.floor(durationSeconds / 1.2);
  for (let i = 0; i < cycles; i++) {
    const t = now + i * 1.2;
    osc.frequency.linearRampToValueAtTime(880, t + 0.6);
    osc.frequency.linearRampToValueAtTime(450, t + 1.2);
  }

  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(baseVol, now + 0.1);
  gainNode.gain.setValueAtTime(baseVol, now + durationSeconds - 0.2);
  rampRelease(gainNode.gain, baseVol, 0.001, now + durationSeconds);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + durationSeconds + 0.1);
  currentPlayingSource = osc;

  return new Promise((resolve) => {
    setTimeout(resolve, durationSeconds * 1000);
  });
}

// Play Sound By Audio File Name or ID
export async function playSoundByName(fileName: string, volume: number = 80, customUrl?: string): Promise<void> {
  if (customUrl) {
    try {
      const audio = new Audio(customUrl);
      audio.volume = resolvePlaybackGain(volume);
      await audio.play();
      return;
    } catch {
      // fallback to synthesized
    }
  }

  const lower = (fileName || '').toLowerCase();
  if (lower.includes('masuk') || lower.includes('apel') || lower.includes('westminster')) {
    return playWestminsterChime(volume);
  } else if (lower.includes('istirahat')) {
    return playBreakChime(volume);
  } else if (lower.includes('siren') || lower.includes('darurat') || lower.includes('evakuasi')) {
    return playEmergencySiren(volume, 3);
  } else {
    return playTwoToneBell(volume);
  }
}
