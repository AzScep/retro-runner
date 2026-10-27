/**
 * ZzFX instrument patches for the ZzFXM songs. Melodic patches are tuned to MELODIC_BASE_HZ
 * (ZzFXM note 12 = C2); drum patches sound at their own pitch.
 */

import { SHAPE, zz } from '../synth.ts';
import { MELODIC_BASE_HZ as F } from './compose.ts';

// Leads --------------------------------------------------------------------------------------

/** SNES-style 25% pulse lead, slightly softened. Long sustain so written note lengths decide. */
export const PULSE_LEAD = zz({
  vol: 0.4,
  freq: F,
  attack: 0.006,
  decay: 0.12,
  sVol: 0.62,
  sustain: 1.3,
  release: 0.1,
  shape: SHAPE.pulse,
  curve: 0.5,
  filter: -3600,
});

/** Plucky 25% pulse with a 16th-note echo (ladder). */
export const PLUCK_LEAD = zz({
  vol: 0.5,
  freq: F,
  attack: 0.003,
  decay: 0.14,
  sVol: 0.25,
  sustain: 0.25,
  release: 0.12,
  shape: SHAPE.pulse,
  curve: 0.5,
  filter: -3000,
  delay: 0.136,
});

/** Genesis-ish brass: filtered saw with a soft attack (champion). */
export const BRASS_LEAD = zz({
  vol: 0.4,
  freq: F,
  attack: 0.018,
  decay: 0.12,
  sVol: 0.72,
  sustain: 2.2,
  release: 0.14,
  shape: SHAPE.saw,
  filter: -2200,
});
export const BRASS_HARMONY = zz({
  vol: 0.3,
  freq: F,
  attack: 0.022,
  decay: 0.12,
  sVol: 0.7,
  sustain: 2.2,
  release: 0.14,
  shape: SHAPE.saw,
  filter: -1700,
});

/** Detuned "alien" pair: saw leads with a sawtooth pitch warble (repeat + slide), 18 cents apart. */
const ALIEN = {
  vol: 0.3,
  attack: 0.004,
  decay: 0.1,
  sVol: 0.7,
  sustain: 1.4,
  release: 0.1,
  shape: SHAPE.saw,
  filter: -2600,
  slide: 0.35,
  trem: 0.12,
} as const;
export const ALIEN_LEAD_A = zz({ ...ALIEN, freq: F, repeat: 0.072 });
export const ALIEN_LEAD_B = zz({ ...ALIEN, freq: F * 2 ** (18 / 1200), repeat: 0.083 });

/** Thin 12.5% pulse harmony under a pulse lead (hurdles). */
export const PULSE_HARMONY = zz({
  vol: 0.24,
  freq: F,
  attack: 0.006,
  decay: 0.1,
  sVol: 0.55,
  sustain: 1.3,
  release: 0.1,
  shape: SHAPE.pulse,
  curve: 0.25,
  filter: -3000,
});

/** Bright 12.5% pulse descant with a short echo: the quarter track's final-100 lead. */
export const DESCANT_LEAD = zz({
  vol: 0.26,
  freq: F,
  attack: 0.01,
  decay: 0.15,
  sVol: 0.7,
  sustain: 1.6,
  release: 0.12,
  shape: SHAPE.pulse,
  curve: 0.25,
  filter: -5200,
  delay: 0.15,
});

// Accompaniment -------------------------------------------------------------------------------

/** 12.5% pulse blip for 16th-note arpeggios. */
export const ARP = zz({
  vol: 0.2,
  freq: F,
  attack: 0.002,
  decay: 0.05,
  sVol: 0.4,
  sustain: 0.05,
  release: 0.04,
  shape: SHAPE.pulse,
  curve: 0.25,
  filter: -5000,
});

/** Softer 25% pulse for broken chords in calm tracks. */
export const SOFT_ARP = zz({
  vol: 0.2,
  freq: F,
  attack: 0.004,
  decay: 0.08,
  sVol: 0.35,
  sustain: 0.12,
  release: 0.08,
  shape: SHAPE.pulse,
  curve: 0.5,
  filter: -2600,
});

/** Filtered saw bass (Genesis FM-ish punch). */
export const SAW_BASS = zz({
  vol: 0.62,
  freq: F,
  attack: 0.003,
  decay: 0.07,
  sVol: 0.55,
  sustain: 0.6,
  release: 0.05,
  shape: SHAPE.saw,
  filter: -900,
});

/** Round triangle bass (NES / SNES). */
export const TRI_BASS = zz({
  vol: 0.8,
  freq: F,
  attack: 0.004,
  decay: 0.08,
  sVol: 0.7,
  sustain: 0.6,
  release: 0.06,
  shape: SHAPE.triangle,
});

// Drums ---------------------------------------------------------------------------------------

/** Sine kick with a parabolic pitch drop 170 -> ~55 Hz. */
export const KICK = zz({
  vol: 0.95,
  freq: 170,
  sustain: 0.02,
  release: 0.09,
  shape: SHAPE.sine,
  curve: 0.8,
  slide: -5.75,
  dslide: 72,
});

/** Noise snare, low-passed to a chunky 16-bit crack. */
export const SNARE = zz({
  vol: 0.5,
  freq: 420,
  decay: 0.03,
  sVol: 0.45,
  release: 0.12,
  shape: SHAPE.noise,
  filter: -2800,
});

/** Closed hat: short high-passed noise. */
export const HAT = zz({ vol: 0.22, freq: 4000, release: 0.035, shape: SHAPE.noise, filter: 4000 });

/** Crash: long high-passed noise. */
export const CRASH = zz({
  vol: 0.24,
  freq: 3000,
  decay: 0.1,
  sVol: 0.5,
  release: 0.9,
  shape: SHAPE.noise,
  filter: 2600,
});
