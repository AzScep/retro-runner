/**
 * Crowd loop (design 7.2 crowd_loop): a seamless few-second bed of stadium murmur. Pure; the engine
 * plays it looped through a low-pass whose cutoff and gain follow setCrowd(intensity).
 *
 * Recipe: pink noise (Paul Kellet's economy filter) for the wash, plus noise through a ~650 Hz
 * resonator for the "aah" vowel colour, amplitude-modulated by slow swells whose periods divide the
 * loop length exactly, then the tail is cross-faded into the head so the wrap is seamless.
 */

import { SAMPLE_RATE } from './synth.ts';

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CROWD_SECONDS = 4;
const XFADE_SECONDS = 0.25;
const TARGET_RMS = 0.2;

export function renderCrowdLoop(sampleRate = SAMPLE_RATE, seconds = CROWD_SECONDS, seed = 7): Float32Array {
  const n = Math.round(seconds * sampleRate);
  const x = Math.round(XFADE_SECONDS * sampleRate);
  const raw = new Float32Array(n + x);
  const rand = rng(seed);

  // pink noise state
  let b0 = 0,
    b1 = 0,
    b2 = 0;
  // two-pole resonator around 650 Hz for the vowel colour
  const f0 = 650,
    r = 0.985;
  const c1 = 2 * r * Math.cos((2 * Math.PI * f0) / sampleRate),
    c2 = -r * r;
  let y1 = 0,
    y2 = 0;

  for (let i = 0; i < n + x; i++) {
    const white = rand() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    const pink = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    const y = c1 * y1 + c2 * y2 + (rand() * 2 - 1) * 0.04;
    y2 = y1;
    y1 = y;
    // Swells: integer cycles per loop so the modulation itself wraps cleanly.
    const p = (i % n) / n;
    const swell =
      0.75 +
      0.12 * Math.sin(2 * Math.PI * 3 * p) +
      0.08 * Math.sin(2 * Math.PI * 7 * p + 1.3) +
      0.05 * Math.sin(2 * Math.PI * 13 * p + 2.1);
    raw[i] = (pink * 0.7 + y * 0.6) * swell;
  }

  // Cross-fade the overflow tail into the head (equal power) for a seamless loop.
  const out = raw.slice(0, n);
  for (let i = 0; i < x; i++) {
    const t = i / x;
    out[i] = raw[i]! * Math.sin((Math.PI / 2) * t) + raw[n + i]! * Math.cos((Math.PI / 2) * t);
  }

  let sum = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    sum += out[i]! * out[i]!;
    peak = Math.max(peak, Math.abs(out[i]!));
  }
  const gain = Math.min(TARGET_RMS / Math.sqrt(sum / n), 0.89 / peak);
  for (let i = 0; i < n; i++) out[i]! *= gain;
  return out;
}
