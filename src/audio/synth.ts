/**
 * Pure helpers around the vendored ZzFX synth: readable parameter builder, note names, layer mixing
 * and level metering. No Web Audio here, so everything runs in Node (tests, tools/audio/render.ts).
 */

import { zzfxBuildSamples, ZZFX_SAMPLE_RATE, type ZzfxParams } from './vendor/zzfx.ts';

export const SAMPLE_RATE = ZZFX_SAMPLE_RATE;

/** ZzFX wave shapes. `pulse` uses `curve` as duty cycle x2 (1 = 50%, 0.5 = 25%, 0.25 = 12.5%). */
export const SHAPE = { sine: 0, triangle: 1, saw: 2, tan: 3, noise: 4, pulse: 5 } as const;

/** Named ZzFX parameters (seconds, Hz). Unset fields use the ZzFX defaults, except randomness = 0. */
export interface Voice {
  vol?: number;
  freq: number;
  attack?: number;
  sustain?: number;
  release?: number;
  shape?: number;
  curve?: number;
  /** Hz per second / 500 (ZzFX units). */
  slide?: number;
  /** Hz per second squared / 500 (ZzFX units). */
  dslide?: number;
  /** Hz added once after `jumpTime`. */
  jump?: number;
  jumpTime?: number;
  /** Seconds; resets pitch and drives tremolo. */
  repeat?: number;
  noise?: number;
  mod?: number;
  crush?: number;
  /** Echo time in seconds (50% wet). */
  delay?: number;
  sVol?: number;
  decay?: number;
  trem?: number;
  /** Biquad cutoff: positive = high-pass, negative = low-pass (ZzFX convention). */
  filter?: number;
}

/** Voice -> ZzFX parameter array in upstream order. */
export function zz(v: Voice): number[] {
  return [
    v.vol ?? 1,
    0,
    v.freq,
    v.attack ?? 0,
    v.sustain ?? 0,
    v.release ?? 0.1,
    v.shape ?? 0,
    v.curve ?? 1,
    v.slide ?? 0,
    v.dslide ?? 0,
    v.jump ?? 0,
    v.jumpTime ?? 0,
    v.repeat ?? 0,
    v.noise ?? 0,
    v.mod ?? 0,
    v.crush ?? 0,
    v.delay ?? 0,
    v.sVol ?? 1,
    v.decay ?? 0,
    v.trem ?? 0,
    v.filter ?? 0,
  ];
}

/** Envelope length of a voice in seconds (what ZzFX will render). */
export function voiceLength(v: Voice): number {
  return (v.attack ?? 0) + (v.decay ?? 0) + (v.sustain ?? 0) + (v.release ?? 0.1) + (v.delay ?? 0);
}

/**
 * Pitch-shift a voice by `semitones`, scaling every frequency-like field (frequency, slides, pitch
 * jump, filter cutoff) so the timbre is identical, only higher.
 */
export function transposeVoice(v: Voice, semitones: number): Voice {
  const r = 2 ** (semitones / 12);
  const out: Voice = { ...v, freq: v.freq * r };
  if (v.slide !== undefined) out.slide = v.slide * r;
  if (v.dslide !== undefined) out.dslide = v.dslide * r;
  if (v.jump !== undefined) out.jump = v.jump * r;
  if (v.filter !== undefined) out.filter = v.filter * r;
  return out;
}

const NOTE_INDEX: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C4" -> 60, "F#3" -> 54, "Bb2" -> 46 (MIDI numbers, A4 = 69). */
export function midi(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note name: ${name}`);
  const base = NOTE_INDEX[m[1]!]!;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + base + acc;
}

export function midiHz(n: number): number {
  return 440 * 2 ** ((n - 69) / 12);
}

/** Note name -> Hz. */
export function hz(name: string): number {
  return midiHz(midi(name));
}

/** One ZzFX sound placed at `at` seconds, scaled by `gain`. */
export interface Layer {
  readonly at: number;
  readonly params: ZzfxParams;
  readonly gain?: number;
}

export function layer(v: Voice, at = 0, gain = 1): Layer {
  return { at, params: zz(v), gain };
}

/**
 * A pitched note of a given total duration on `voice`: sustain is stretched so that
 * attack + decay + sustain + release === dur.
 */
export function note(voice: Omit<Voice, 'freq'>, name: string, at: number, dur: number, gain = 1): Layer {
  const fixed = (voice.attack ?? 0) + (voice.decay ?? 0) + (voice.release ?? 0.1);
  return layer({ ...voice, freq: hz(name), sustain: Math.max(0, dur - fixed) }, at, gain);
}

/** Samples of a fade applied to the last part of every mixed sound so truncation never clicks. */
const END_FADE = 96;

/**
 * Mix layers into a mono buffer of exactly `length` seconds. Layers past the end are cut with a
 * short fade. Deterministic: frequency randomness is disabled.
 */
export function mixLayers(layers: readonly Layer[], length: number, sampleRate = SAMPLE_RATE): Float32Array {
  const out = new Float32Array(Math.round(length * sampleRate));
  for (const l of layers) {
    const src = zzfxBuildSamples(l.params, sampleRate, () => 0.5);
    const start = Math.round(l.at * sampleRate);
    const g = l.gain ?? 1;
    const n = Math.min(src.length, out.length - start);
    for (let i = 0; i < n; i++) out[start + i]! += src[i]! * g;
  }
  const fade = Math.min(END_FADE, out.length);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i]! *= i / fade;
  return out;
}

export interface Levels {
  readonly peak: number;
  readonly rms: number;
}

export function levels(channels: readonly Float32Array[]): Levels {
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i]!;
      const a = Math.abs(s);
      if (a > peak) peak = a;
      sum += s * s;
    }
    n += ch.length;
  }
  return { peak, rms: n ? Math.sqrt(sum / n) : 0 };
}
