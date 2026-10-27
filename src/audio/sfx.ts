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
  hz,
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

  // ---- v2 (design 20.1) ----------------------------------------------------------------------

  // Short rising pulse sweep: 25% pulse 330 -> ~800 Hz with a soft triangle shadow an octave down.
  // Rival takeoffs play it at half volume; the limit is per volume so they never mask the player.
  jump: {
    length: 0.12,
    layers: [
      layer({
        vol: 0.18,
        freq: 330,
        attack: 0.004,
        sustain: 0.05,
        release: 0.062,
        shape: SHAPE.pulse,
        curve: 0.5,
        slide: 8,
        filter: -4500,
      }),
      layer({
        vol: 0.14,
        freq: 165,
        attack: 0.004,
        sustain: 0.03,
        release: 0.06,
        shape: SHAPE.triangle,
        slide: 4,
      }),
    ],
    jitter: 0.02,
    minInterval: 0.06,
  },

  // Soft low tick: sinking triangle thump plus a muffled noise scuff.
  land: {
    length: 0.04,
    layers: [
      layer({ vol: 0.38, freq: 140, attack: 0.001, release: 0.036, shape: SHAPE.triangle, slide: -3 }),
      layer({ vol: 0.16, freq: 700, release: 0.025, shape: SHAPE.sine, noise: 4, filter: -1200 }),
    ],
    jitter: 0.03,
    minInterval: 0.06,
  },

  // Wooden clack: two hollow knocks (crushed triangle + band of pitched noise), the bar tipping over.
  hurdle_clip: {
    length: 0.08,
    layers: [
      layer({
        vol: 0.42,
        freq: 620,
        attack: 0.001,
        release: 0.03,
        shape: SHAPE.triangle,
        slide: -8,
        crush: 0.05,
      }),
      layer({ vol: 0.24, freq: 1400, release: 0.02, shape: SHAPE.sine, noise: 2, filter: -3000 }),
      layer({ vol: 0.3, freq: 480, attack: 0.001, release: 0.03, shape: SHAPE.triangle, slide: -6 }, 0.042),
    ],
    jitter: 0.03,
    minInterval: 0.05,
  },

  // Crash with metal clatter: body thud, low-passed noise crash, then bouncing metallic pings.
  hurdle_hit: {
    length: 0.3,
    layers: [
      layer({ vol: 0.55, freq: 110, attack: 0.001, release: 0.12, shape: SHAPE.sine, slide: -3, curve: 0.8 }),
      layer({
        vol: 0.4,
        freq: 600,
        attack: 0.002,
        decay: 0.04,
        sVol: 0.5,
        release: 0.2,
        shape: SHAPE.noise,
        filter: -3500,
      }),
      ...(
        [
          [0.03, 1870, 0.13],
          [0.09, 2490, 0.1],
          [0.15, 2120, 0.08],
          [0.2, 2780, 0.06],
        ] as const
      ).map(([at, f, vol]) =>
        layer(
          {
            vol,
            freq: f,
            attack: 0.001,
            release: 0.07,
            shape: SHAPE.pulse,
            curve: 0.25,
            mod: 37,
            filter: -6000,
          },
          at,
        ),
      ),
    ],
    jitter: 0.03,
    minInterval: 0.12,
    normalize: 0.85,
  },

  // Square double blip: two 50% pulse A5 hits, the second a fourth higher (D6).
  split: {
    length: 0.15,
    layers: [
      layer({
        vol: 0.22,
        freq: 880,
        attack: 0.002,
        sustain: 0.035,
        release: 0.02,
        shape: SHAPE.pulse,
        filter: -5000,
      }),
      layer(
        {
          vol: 0.22,
          freq: 1174.7,
          attack: 0.002,
          sustain: 0.045,
          release: 0.03,
          shape: SHAPE.pulse,
          filter: -5000,
        },
        0.07,
      ),
    ],
    jitter: 0,
    minInterval: 0.3,
  },

  // Bright lap bell, two strikes: a chip "bell" from a 12.5% pulse strike plus inharmonic sine
  // partials (x2.0, x2.76, x5.4 of E6) with linear decay; the second strike rings out.
  bell: {
    length: 0.6,
    layers: [0, 0.22].flatMap((at, k) => {
      const ring = k ? 0.36 : 0.2;
      const base = 1318.5;
      return [
        layer({ vol: 0.12, freq: base, attack: 0.001, release: 0.04, shape: SHAPE.pulse, curve: 0.25 }, at),
        layer({ vol: 0.22, freq: base, attack: 0.002, release: ring }, at),
        layer({ vol: 0.12, freq: base * 2, attack: 0.002, release: ring * 0.7 }, at),
        layer({ vol: 0.08, freq: base * 2.76, attack: 0.002, release: ring * 0.5 }, at),
        layer({ vol: 0.05, freq: base * 5.4, attack: 0.001, release: ring * 0.25 }, at),
      ];
    }),
    jitter: 0,
    minInterval: 0.5,
  },

  // Heartbeat "lub-dub": two low-passed noise thumps over sinking sine kicks.
  stamina_low: {
    length: 0.12,
    layers: [
      [0, 0.24],
      [0.055, 0.17],
    ].flatMap(([at, v]) => [
      layer({ vol: v! * 1.8, freq: 75, attack: 0.002, release: 0.05, shape: SHAPE.sine, slide: -1.5 }, at),
      layer({ vol: v!, freq: 300, attack: 0.002, release: 0.04, shape: SHAPE.noise, filter: -260 }, at),
    ]),
    jitter: 0,
    minInterval: 0.3,
  },

  // Breathy wheeze: band of high-passed noise that swells in and sags, with a fluttering throat rasp.
  stamina_empty: {
    length: 0.4,
    layers: [
      layer({
        vol: 0.3,
        freq: 1600,
        attack: 0.1,
        sustain: 0.12,
        release: 0.17,
        shape: SHAPE.noise,
        filter: 1400,
        slide: -1,
        repeat: 0.06,
        trem: 0.35,
      }),
      layer({
        vol: 0.1,
        freq: 240,
        attack: 0.08,
        sustain: 0.1,
        release: 0.18,
        shape: SHAPE.saw,
        crush: 0.2,
        filter: -900,
        slide: -0.6,
      }),
    ],
    jitter: 0.03,
    minInterval: 2.5,
  },

  // ---- v3 (design 36.1) ----------------------------------------------------------------------

  // Starter's pistol, layered over beep_go: a bright crushed noise crack, a low-passed noise
  // tail (the report rolling off the stands) and a sinking sine thump for the chest hit.
  pistol: {
    length: 0.25,
    layers: [
      layer({
        vol: 0.6,
        freq: 3200,
        attack: 0.001,
        release: 0.025,
        shape: SHAPE.noise,
        filter: 1500,
        crush: 0.02,
      }),
      layer({
        vol: 0.5,
        freq: 900,
        attack: 0.002,
        decay: 0.03,
        sVol: 0.35,
        release: 0.21,
        shape: SHAPE.noise,
        filter: -2400,
      }),
      layer({ vol: 0.42, freq: 150, attack: 0.001, release: 0.07, shape: SHAPE.sine, slide: -4, curve: 0.8 }),
    ],
    jitter: 0.03,
    minInterval: 0.1,
    normalize: 0.9,
  },

  // Body hitting the track: a deep sinking sine thump, a smaller bounce, and a short scuff of
  // muffled fluttering noise as Rio slides.
  trip_thud: {
    length: 0.3,
    layers: [
      layer({
        vol: 0.75,
        freq: 95,
        attack: 0.002,
        release: 0.17,
        shape: SHAPE.sine,
        slide: -1.6,
        curve: 0.8,
      }),
      layer({ vol: 0.3, freq: 62, attack: 0.002, release: 0.12, shape: SHAPE.triangle, slide: -0.6 }),
      layer({ vol: 0.32, freq: 82, attack: 0.002, release: 0.07, shape: SHAPE.sine, slide: -1.2 }, 0.115),
      layer(
        {
          vol: 0.3,
          freq: 900,
          attack: 0.02,
          sustain: 0.06,
          release: 0.1,
          shape: SHAPE.noise,
          filter: -1700,
          repeat: 0.03,
          trem: 0.4,
        },
        0.04,
      ),
    ],
    jitter: 0.02,
    minInterval: 0.3,
    normalize: 0.85,
  },

  // Reveal step 3, power-down: a saw and a pulse an octave below glide 440 -> ~35 Hz like a tape
  // stopping (slide decelerated by dslide so the pitch flattens out at the bottom), the crush
  // rising as it dies, over a relay "clunk" at the cut.
  reveal_sting_1: {
    length: 0.6,
    layers: [
      layer({
        vol: 0.32,
        freq: 440,
        attack: 0.004,
        sustain: 0.44,
        release: 0.15,
        shape: SHAPE.saw,
        slide: -2.95,
        dslide: 5.36,
        crush: 0.04,
        filter: -2600,
      }),
      layer({
        vol: 0.24,
        freq: 220,
        attack: 0.004,
        sustain: 0.44,
        release: 0.15,
        shape: SHAPE.pulse,
        curve: 0.5,
        slide: -1.475,
        dslide: 2.68,
        filter: -1800,
      }),
      layer({ vol: 0.3, freq: 110, attack: 0.004, sustain: 0.3, release: 0.25, slide: -0.74, dslide: 1.34 }),
      layer({ vol: 0.45, freq: 500, attack: 0.001, release: 0.05, shape: SHAPE.noise, filter: -900 }),
      layer({ vol: 0.4, freq: 120, attack: 0.001, release: 0.08, shape: SHAPE.sine, slide: -3 }),
    ],
    jitter: 0,
    normalize: 0.8,
  },

  // Reveal step 9, the alien chord: C minor (C4 Eb4 G4 C5, the boss key) on pairs of saws 15
  // cents apart with a slow sawtooth pitch warble, swelling in over 0.7 s; a triangle C2 root and a
  // trembling 12.5% pulse G5 shimmer join on the swell. Leads into the boss intro.
  reveal_sting_2: {
    length: 1.5,
    layers: [
      ...['C4', 'Eb4', 'G4', 'C5'].flatMap((n, i) =>
        [-7.5, 7.5].map((cents, k) =>
          layer({
            vol: 0.16,
            freq: hz(n) * 2 ** (cents / 1200),
            attack: 0.7,
            sustain: 0.38,
            release: 0.4,
            shape: SHAPE.saw,
            filter: -2200,
            slide: 0.1,
            repeat: k ? 0.083 : 0.072 + i * 0.004,
            trem: 0.1,
          }),
        ),
      ),
      layer({ vol: 0.4, freq: hz('C2'), attack: 0.5, sustain: 0.55, release: 0.43, shape: SHAPE.triangle }),
      layer(
        {
          vol: 0.1,
          freq: hz('G5'),
          attack: 0.35,
          sustain: 0.3,
          release: 0.4,
          shape: SHAPE.pulse,
          curve: 0.25,
          repeat: 0.06,
          trem: 0.6,
          filter: -5000,
        },
        0.4,
      ),
    ],
    jitter: 0,
    normalize: 0.8,
  },

  // Dry shutter: a bright noise click as the blade opens, a duller one as it closes, each with a
  // tiny pulse tick for the mechanism.
  photo_click: {
    length: 0.12,
    layers: [
      layer({ vol: 0.55, freq: 3000, attack: 0.001, release: 0.012, shape: SHAPE.noise, filter: 2000 }),
      layer({ vol: 0.2, freq: 1800, attack: 0.001, release: 0.012, shape: SHAPE.pulse, curve: 0.25 }),
      layer({ vol: 0.45, freq: 2200, attack: 0.001, release: 0.018, shape: SHAPE.noise, filter: 900 }, 0.055),
      layer({ vol: 0.25, freq: 700, attack: 0.001, release: 0.02, shape: SHAPE.triangle, slide: -4 }, 0.055),
    ],
    jitter: 0.04,
    minInterval: 0.05,
  },

  // Speech bubble pop: a soft two-note triangle blip G5 -> C6, quieter than menu_move.
  bubble: {
    length: 0.06,
    layers: [
      layer({ vol: 0.2, freq: hz('G5'), attack: 0.002, release: 0.026, shape: SHAPE.triangle }),
      layer({ vol: 0.2, freq: hz('C6'), attack: 0.002, release: 0.028, shape: SHAPE.triangle }, 0.03),
    ],
    jitter: 0,
    minInterval: 0.05,
  },

  // Gauntlet clear: a longer major fanfare in D than win_jingle. Three rising calls (D, G, A)
  // with brass thirds, triangle bass and drum hits, a snare roll into a held F#6 over D with a
  // trill and a sparkle arpeggio, and a crash to finish.
  gauntlet_clear: {
    length: 3.0,
    layers: [
      ...notes(BRASS, [
        ['D5', 0, 0.12],
        ['F#5', 0.13, 0.12],
        ['A5', 0.26, 0.12],
        ['D6', 0.39, 0.4],
        ['B5', 0.82, 0.12],
        ['D6', 0.95, 0.12],
        ['G6', 1.08, 0.4],
        ['A5', 1.5, 0.12],
        ['C#6', 1.63, 0.12],
        ['E6', 1.76, 0.12],
      ]),
      note({ ...BRASS, release: 0.25, repeat: 0.09, trem: 0.15 }, 'F#6', 1.89, 1.05),
      ...notes(BRASS_LOW, [
        ['A4', 0, 0.12],
        ['D5', 0.13, 0.12],
        ['F#5', 0.26, 0.12],
        ['A5', 0.39, 0.4],
        ['G5', 0.82, 0.12],
        ['B5', 0.95, 0.12],
        ['D6', 1.08, 0.4],
        ['E5', 1.5, 0.12],
        ['A5', 1.63, 0.12],
        ['C#6', 1.76, 0.12],
        ['D6', 1.89, 1.05],
      ]),
      ...notes(BASS, [
        ['D3', 0, 0.36],
        ['D3', 0.39, 0.4],
        ['G2', 0.82, 0.24],
        ['G2', 1.08, 0.4],
        ['A2', 1.5, 0.38],
        ['D2', 1.89, 1.05],
      ]),
      ...['D6', 'F#6', 'A6', 'D7', 'F#7', 'A7'].map((n, i) =>
        note({ ...SPARKLE, vol: 0.12 }, n, 2.05 + i * 0.06, i === 5 ? 0.4 : 0.12),
      ),
      ...[0.39, 1.08, 1.89].flatMap((at) => [layer(KICK, at), layer(SNARE, at)]),
      ...[0, 1, 2, 3, 4, 5].map((i) =>
        layer({ ...SNARE, vol: 0.12 + i * 0.03, release: 0.06 }, 1.5 + i * 0.063),
      ),
      layer({ ...SNARE, vol: 0.18, release: 1.0, filter: 3000 }, 1.89),
    ],
    jitter: 0,
    normalize: 0.85,
  },
};

/**
 * SFX first needed in a race, the reveal or the Gauntlet, never on the Title or menus (the v3 set,
 * ~130 ms of synthesis, mostly the two long stings). preloadAudio renders them after the title
 * song so they never delay the first screen's music.
 */
export const LATE_SFX: ReadonlySet<SfxId> = new Set<SfxId>([
  'pistol',
  'trip_thud',
  'reveal_sting_1',
  'reveal_sting_2',
  'photo_click',
  'bubble',
  'gauntlet_clear',
]);

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
