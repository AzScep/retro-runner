/**
 * Sound effects (design 7.2). Each SfxId is a small stack of ZzFX layers mixed into one mono buffer
 * of the exact design length. Pure data + rendering; playback lives in engine.ts.
 *
 * Palette: 16-bit console chip voices. Pulse waves at 12.5/25/50% duty for blips and brass,
 * triangle for bass and soft UI, pitched noise (ZzFX `noise` on a sine) for ticks, sin(t^3) noise
 * with the biquad for crowd, sizzle and snares, bit-crush for buzzers.
 */

import type { SfxId } from './types.ts';
import {
  layer,
  levels,
  mixLayers,
  note,
  SAMPLE_RATE,
  SHAPE,
  transposeVoice,
  type Layer,
  type Voice,
} from './synth.ts';

export interface SfxDef {
  /** Exact rendered length in seconds (design 7.2). */
  readonly length: number;
  readonly layers: readonly Layer[];
  /** Random playback-rate spread per play (+-fraction), the ZzFX "randomness" idea applied at playback. */
  readonly jitter: number;
  /** Minimum seconds between two plays of this sound (or its group). */
  readonly minInterval?: number;
  /** Sounds sharing a group share the rate limit (step_l / step_r). */
  readonly group?: string;
  /** Scale the finished mix to this peak (dense multi-voice jingles). */
  readonly normalize?: number;
}

// ---------------------------------------------------------------------------------------------
// Footsteps: a pitched-noise "tsk" over a tiny triangle thump. step_r = step_l + 2 semitones.

const STEP_TICK: Voice = { vol: 0.2, freq: 1050, release: 0.028, shape: SHAPE.sine, noise: 3, filter: 600 };
const STEP_THUMP: Voice = {
  vol: 0.24,
  freq: 190,
  attack: 0.001,
  release: 0.03,
  shape: SHAPE.triangle,
  slide: -6,
};

function step(semitones: number): SfxDef {
  return {
    length: 0.04,
    layers: [layer(transposeVoice(STEP_TICK, semitones)), layer(transposeVoice(STEP_THUMP, semitones))],
    jitter: 0.015,
    minInterval: 0.04,
    group: 'step',
  };
}

// ---------------------------------------------------------------------------------------------
// Jingle voices

const BRASS: Omit<Voice, 'freq'> = {
  vol: 0.3,
  attack: 0.008,
  decay: 0.06,
  sVol: 0.7,
  release: 0.08,
  shape: SHAPE.pulse,
  curve: 0.5,
  filter: -3200,
};
const BRASS_LOW: Omit<Voice, 'freq'> = { ...BRASS, vol: 0.2, curve: 1 };
const BASS: Omit<Voice, 'freq'> = {
  vol: 0.45,
  attack: 0.004,
  decay: 0.05,
  sVol: 0.8,
  release: 0.06,
  shape: SHAPE.triangle,
};
const SNARE: Voice = {
  vol: 0.35,
  freq: 900,
  release: 0.14,
  shape: SHAPE.noise,
  filter: -5000,
  decay: 0.02,
  sVol: 0.6,
};
const KICK: Voice = {
  vol: 0.55,
  freq: 160,
  release: 0.1,
  shape: SHAPE.sine,
  curve: 0.8,
  slide: -5.5,
  dslide: 70,
};
const SPARKLE: Omit<Voice, 'freq'> = {
  vol: 0.17,
  attack: 0.002,
  release: 0.12,
  shape: SHAPE.pulse,
  curve: 0.25,
  delay: 0.07,
};

function notes(voice: Omit<Voice, 'freq'>, seq: readonly [string, number, number][], gain = 1): Layer[] {
  return seq.map(([n, at, dur]) => note(voice, n, at, dur, gain));
}

// ---------------------------------------------------------------------------------------------

export const SFX: Record<SfxId, SfxDef> = {
  step_l: step(0),
  step_r: step(2),

  // Low dull thud: sinking triangle + muffled crushed noise.
  fumble: {
    length: 0.06,
    layers: [
      layer({ vol: 0.7, freq: 96, attack: 0.002, release: 0.056, shape: SHAPE.triangle, slide: -2 }),
      layer({ vol: 0.35, freq: 260, release: 0.04, shape: SHAPE.sine, noise: 6, filter: -380, crush: 0.15 }),
    ],
    jitter: 0.03,
  },

  // Square 440 Hz, Game Boy style slight decay.
  beep_count: {
    length: 0.15,
    layers: [
      layer({
        vol: 0.34,
        freq: 440,
        attack: 0.003,
        decay: 0.03,
        sVol: 0.8,
        sustain: 0.09,
        release: 0.027,
        shape: SHAPE.pulse,
        curve: 1,
        filter: -3000,
      }),
    ],
    jitter: 0,
  },

  // Square 880 Hz with a 25% pulse an octave below for horn weight.
  beep_go: {
    length: 0.4,
    layers: [
      layer({
        vol: 0.3,
        freq: 880,
        attack: 0.003,
        decay: 0.05,
        sVol: 0.8,
        sustain: 0.267,
        release: 0.08,
        shape: SHAPE.pulse,
        curve: 1,
        filter: -4000,
      }),
      layer({
        vol: 0.2,
        freq: 440,
        attack: 0.003,
        decay: 0.05,
        sVol: 0.8,
        sustain: 0.267,
        release: 0.08,
        shape: SHAPE.pulse,
        curve: 0.5,
        filter: -4000,
      }),
    ],
    jitter: 0,
  },

  // Descending two-tone buzzer Eb4 -> Bb3: crushed saw + detuned pulse with a fast flutter.
  false_start: {
    length: 0.5,
    layers: [0, 1].flatMap((k) => {
      const at = k * 0.25;
      const f = k ? 233.08 : 311.13;
      const common = { attack: 0.004, sustain: 0.2, release: 0.026, repeat: 0.025, trem: 0.3, crush: 0.2 };
      return [
        layer({ ...common, vol: 0.28, freq: f, shape: SHAPE.saw }, at),
        layer({ ...common, vol: 0.18, freq: f * 1.0035, shape: SHAPE.pulse, curve: 0.5 }, at),
      ];
    }),
    jitter: 0,
  },

  // Pea whistle (trilled sine) plus a crowd roar burst.
  finish: {
    length: 0.8,
    layers: [
      layer({
        vol: 0.28,
        freq: 2300,
        attack: 0.01,
        sustain: 0.3,
        release: 0.08,
        repeat: 0.03,
        slide: 20,
        trem: 0.25,
      }),
      layer(
        {
          vol: 0.42,
          freq: 500,
          attack: 0.06,
          decay: 0.2,
          sVol: 0.6,
          sustain: 0.2,
          release: 0.3,
          shape: SHAPE.noise,
          filter: -1500,
          repeat: 0.07,
          trem: 0.3,
        },
        0.04,
      ),
    ],
    jitter: 0,
  },

  // Major fanfare in C: "da-da-da DAAA, da-da DAAAA" with brass thirds, triangle bass, drum hits.
  win_jingle: {
    length: 2.5,
    layers: [
      ...notes(BRASS, [
        ['C5', 0, 0.12],
        ['E5', 0.13, 0.12],
        ['G5', 0.26, 0.12],
        ['C6', 0.39, 0.46],
        ['G5', 0.91, 0.12],
        ['C6', 1.04, 0.12],
        ['E6', 1.17, 1.25],
      ]),
      ...notes(BRASS_LOW, [
        ['E4', 0, 0.12],
        ['G4', 0.13, 0.12],
        ['C5', 0.26, 0.12],
        ['E5', 0.39, 0.46],
        ['E5', 0.91, 0.12],
        ['G5', 1.04, 0.12],
        ['C6', 1.17, 1.25],
      ]),
      ...notes(BASS, [
        ['C3', 0, 0.36],
        ['C3', 0.39, 0.46],
        ['G2', 0.91, 0.24],
        ['C3', 1.17, 1.25],
      ]),
      layer(KICK, 0.39),
      layer(SNARE, 0.39),
      layer(KICK, 1.17),
      layer(SNARE, 1.17),
      layer({ ...SNARE, vol: 0.15, release: 0.9, filter: 3000 }, 1.17),
    ],
    jitter: 0,
    normalize: 0.85,
  },

  // Descending minor phrase G-F-Eb-D-C over Cm - Ab - G - C, sagging vibrato on the last note.
  lose_jingle: {
    length: 2.0,
    layers: [
      ...notes({ ...BRASS, vol: 0.28, curve: 1, filter: -2200 }, [
        ['G4', 0, 0.28],
        ['F4', 0.3, 0.28],
        ['Eb4', 0.6, 0.28],
        ['D4', 0.9, 0.28],
      ]),
      note(
        { ...BRASS, vol: 0.28, curve: 1, filter: -2200, release: 0.3, repeat: 0.11, slide: -0.6 },
        'C4',
        1.2,
        0.78,
      ),
      ...notes({ ...BRASS_LOW, filter: -1800 }, [
        ['Eb4', 0, 0.58],
        ['C4', 0.6, 0.28],
        ['B3', 0.9, 0.28],
        ['G3', 1.2, 0.78],
      ]),
      ...notes(BASS, [
        ['C3', 0, 0.56],
        ['Ab2', 0.6, 0.28],
        ['G2', 0.9, 0.28],
        ['C2', 1.2, 0.78],
      ]),
    ],
    jitter: 0,
    normalize: 0.8,
  },

  // Sparkle: fast 12.5% pulse arpeggio up two octaves with echo, triangle shadow an octave down.
  new_pb: {
    length: 0.6,
    layers: ['C6', 'E6', 'G6', 'C7', 'E7', 'G7'].flatMap((n, i) => [
      note(SPARKLE, n, i * 0.05, i === 5 ? 0.25 : 0.12),
      note(
        { ...SPARKLE, vol: 0.1, shape: SHAPE.triangle, curve: 1, delay: 0 },
        n.replace(/\d/, (d) => `${+d - 1}`),
        i * 0.05,
        0.1,
      ),
    ]),
    jitter: 0,
  },

  // Rising arpeggio G4-C5-E5-G5-C6 into a shimmering E6, over a held C.
  unlock: {
    length: 0.8,
    layers: [
      ...['G4', 'C5', 'E5', 'G5', 'C6'].map((n, i) =>
        note(
          {
            vol: 0.22,
            attack: 0.003,
            decay: 0.04,
            sVol: 0.6,
            release: 0.1,
            shape: SHAPE.pulse,
            curve: 0.5,
            delay: 0.09,
          },
          n,
          i * 0.08,
          0.18,
        ),
      ),
      note(
        {
          vol: 0.22,
          attack: 0.003,
          decay: 0.04,
          sVol: 0.7,
          release: 0.12,
          shape: SHAPE.pulse,
          curve: 0.5,
          repeat: 0.05,
          trem: 0.4,
        },
        'E6',
        0.4,
        0.4,
      ),
      note({ ...BASS, vol: 0.25, release: 0.15 }, 'C4', 0, 0.78),
    ],
    jitter: 0,
  },

  // Soft blip: triangle C6 with a little droop.
  menu_move: {
    length: 0.05,
    layers: [
      layer({ vol: 0.26, freq: 1046.5, attack: 0.002, release: 0.045, shape: SHAPE.triangle, slide: -2 }),
    ],
    jitter: 0.01,
    minInterval: 0.03,
  },

  // Bright blip: 12.5% pulse C6 jumping a fifth up.
  menu_select: {
    length: 0.12,
    layers: [
      layer({
        vol: 0.22,
        freq: 1046.5,
        attack: 0.001,
        sustain: 0.04,
        release: 0.075,
        shape: SHAPE.pulse,
        curve: 0.25,
        jump: 521.5,
        jumpTime: 0.04,
        filter: -5000,
      }),
    ],
    jitter: 0,
  },

  // Lower blip: 25% pulse G5 dropping to C5.
  menu_back: {
    length: 0.1,
    layers: [
      layer({
        vol: 0.24,
        freq: 784,
        attack: 0.001,
        sustain: 0.03,
        release: 0.065,
        shape: SHAPE.pulse,
        curve: 0.5,
        jump: -260.7,
        jumpTime: 0.035,
        filter: -4000,
      }),
    ],
    jitter: 0,
  },

  // Pitch-swept zap: pulse sweeps 300 -> 2400 -> 300 Hz (parabolic slide) over crushed noise swish.
  warp: {
    length: 0.3,
    layers: [
      layer({
        vol: 0.2,
        freq: 300,
        attack: 0.005,
        sustain: 0.22,
        release: 0.075,
        shape: SHAPE.pulse,
        curve: 0.5,
        slide: 56,
        dslide: -373,
        crush: 0.05,
      }),
      layer({
        vol: 0.14,
        freq: 600,
        attack: 0.1,
        release: 0.2,
        shape: SHAPE.noise,
        filter: 1500,
      }),
    ],
    jitter: 0.02,
  },

  // Sizzle (fluttering high-passed noise) with spark chirps and a crushed electrical buzz.
  overheat: {
    length: 0.6,
    layers: [
      layer({
        vol: 0.24,
        freq: 2000,
        attack: 0.02,
        sustain: 0.45,
        release: 0.13,
        shape: SHAPE.noise,
        filter: 2500,
        repeat: 0.045,
        trem: 0.45,
      }),
      layer({
        vol: 0.12,
        freq: 110,
        attack: 0.01,
        sustain: 0.2,
        release: 0.35,
        shape: SHAPE.saw,
        crush: 0.3,
      }),
      ...(
        [
          [0.03, 4200],
          [0.11, 3600],
          [0.17, 5000],
          [0.29, 3900],
          [0.36, 4600],
          [0.47, 3400],
        ] as const
      ).map(([at, f]) =>
        layer({ vol: 0.13, freq: f, release: 0.03, shape: SHAPE.pulse, curve: 0.25, slide: -60 }, at),
      ),
    ],
    jitter: 0.04,
  },

  // Distant flashbulb: noise pop, then the rising capacitor whine.
  flashbulb: {
    length: 0.25,
    layers: [
      layer({ vol: 0.4, freq: 800, release: 0.015, shape: SHAPE.noise }),
      layer({ vol: 0.07, freq: 3800, attack: 0.02, sustain: 0.1, release: 0.11, slide: 8 }, 0.01),
    ],
    jitter: 0.05,
  },
};

/** Render one effect to mono samples. */
export function renderSfx(id: SfxId, sampleRate = SAMPLE_RATE): Float32Array {
  const def = SFX[id];
  const out = mixLayers(def.layers, def.length, sampleRate);
  if (def.normalize) {
    const { peak } = levels([out]);
    if (peak > 0) for (let i = 0; i < out.length; i++) out[i]! *= def.normalize / peak;
  }
  return out;
}
