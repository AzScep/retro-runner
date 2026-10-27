/**
 * Tiny composition layer that compiles readable song specs (chords per bar, a written lead line,
 * named bass / arpeggio / drum styles) into plain ZzFXM song data: [instruments, patterns, sequence, bpm].
 *
 * Grid: one ZzFXM row = one 16th note, one pattern = one bar (16 rows).
 * Melodic instruments are tuned so ZzFXM note 12 = C2 (MIDI 36), i.e. note = MIDI - 24.
 */

import type { ZzfxParams } from '../vendor/zzfx.ts';
import type { ZzfxmChannel, ZzfxmPattern } from '../vendor/zzfxm.ts';
import { midi, midiHz } from '../synth.ts';

export const STEPS_PER_BAR = 16;
/** Frequency of ZzFXM note 12 for every melodic instrument. */
export const MELODIC_BASE_HZ = midiHz(36);

export interface Song {
  readonly bpm: number;
  /**
   * Channels 0..baseChannels-1 form the base mix; any channels after them are the "final" layer
   * (added lead and drums), so the final render is exactly base + extra.
   */
  readonly baseChannels: number;
  readonly instruments: readonly ZzfxParams[];
  readonly patterns: readonly ZzfxmPattern[];
  readonly sequence: readonly number[];
}

/** A grid step: a MIDI note (with optional attenuation 0-0.9), HOLD (keep sounding) or OFF (cut). */
type Step = { readonly midi: number; readonly att: number } | typeof HOLD | typeof OFF;
const HOLD = 0;
const OFF = -1;

// ---------------------------------------------------------------------------------------------
// Chords

const QUALITIES: Record<string, readonly number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
  '5': [0, 7],
};

export interface Chord {
  /** Pitch class 0-11. */
  readonly root: number;
  readonly intervals: readonly number[];
}

export function parseChord(name: string): Chord {
  const m = /^([A-G](?:#|b)?)(.*)$/.exec(name);
  const q = m ? QUALITIES[m[2]!] : undefined;
  if (!m || !q) throw new Error(`Bad chord: ${name}`);
  return { root: midi(`${m[1]!}4`) % 12, intervals: q };
}

function pitchClasses(c: Chord): Set<number> {
  return new Set(c.intervals.map((i) => (c.root + i) % 12));
}

// ---------------------------------------------------------------------------------------------
// Written lines: "D5_6 r_2 A4_2 C#5_4~" (note or r, underscore, length in 16ths, ~ = softer)

export function parseLine(text: string): Step[] {
  const steps: Step[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (tok === '|') continue;
    const m = /^([A-G](?:#|b)?-?\d|r)_(\d+)(~?)$/.exec(tok);
    if (!m) throw new Error(`Bad token: ${tok}`);
    const len = Number(m[2]);
    steps.push(m[1] === 'r' ? OFF : { midi: midi(m[1]!), att: m[3] ? 0.4 : 0 });
    for (let i = 1; i < len; i++) steps.push(HOLD);
  }
  return steps;
}

/** Auto second voice: highest chord tone 3-9 semitones under each lead note. */
function harmonize(lead: readonly Step[], chords: readonly Chord[]): Step[] {
  return lead.map((s, i) => {
    if (s === HOLD || s === OFF) return s;
    const pcs = pitchClasses(chords[Math.floor(i / STEPS_PER_BAR)]!);
    for (let d = 3; d <= 9; d++)
      if (pcs.has((s.midi - d + 120) % 12)) return { midi: s.midi - d, att: s.att };
    return { midi: s.midi - 5, att: s.att };
  });
}

// ---------------------------------------------------------------------------------------------
// Bass and arpeggio styles (one bar each)

export type BassStyle =
  'none' | 'hold' | 'root8' | 'octave8' | 'gallop' | 'pulse16' | 'walk4' | 'march' | 'synco';
export type ArpStyle = 'none' | 'up16' | 'updown16' | 'broken8' | 'offbeat8';

function n(m: number, att = 0): Step {
  return { midi: m, att };
}

function bassBar(style: BassStyle, c: Chord): Step[] {
  let r = 36 + c.root;
  if (r > 44) r -= 12; // keep the root in A1..G#2
  const fifth = r + (c.intervals.includes(6) ? 6 : 7);
  const o = r + 12;
  const H = HOLD;
  switch (style) {
    case 'none':
      return Array<Step>(STEPS_PER_BAR).fill(H);
    case 'hold':
      return [n(r), ...Array<Step>(STEPS_PER_BAR - 1).fill(H)];
    case 'root8':
      return [n(r), H, n(r, 0.4), H, n(r), H, n(r, 0.4), H, n(r), H, n(r, 0.4), H, n(r), H, n(r, 0.4), OFF];
    case 'octave8':
      return [n(r), H, n(o), H, n(r), H, n(o), H, n(r), H, n(o), H, n(r), H, n(o), H];
    case 'gallop':
      return [
        n(r),
        H,
        n(r, 0.3),
        n(o),
        n(r),
        H,
        n(r, 0.3),
        n(o),
        n(r),
        H,
        n(r, 0.3),
        n(o),
        n(r),
        H,
        n(fifth),
        n(o),
      ];
    case 'pulse16':
      return [0, 1, 2, 3].flatMap(() => [n(r), n(r, 0.5), n(o, 0.2), n(r, 0.5)]);
    case 'walk4':
      return [n(r), H, H, OFF, n(fifth), H, H, OFF, n(o), H, H, OFF, n(fifth), H, H, OFF];
    case 'march':
      return [n(r), H, H, n(r, 0.4), n(fifth), H, H, OFF, n(r), H, H, n(r, 0.4), n(fifth), H, n(o, 0.3), OFF];
    case 'synco':
      // 3+3+2 | 3+3+2: the hurdler's stride pattern, octave pop on each group's last 8th.
      return [n(r), H, OFF, n(r), H, OFF, n(o), OFF, n(r), H, OFF, n(fifth), H, OFF, n(o), n(r, 0.4)];
  }
}

function arpBar(style: ArpStyle, c: Chord): Step[] {
  const r = 60 + c.root;
  const tones = [...c.intervals.slice(0, 3), 12].map((i) => r + i);
  const pick = (k: number) => tones[k % tones.length]!;
  const ud = [0, 1, 2, 3, 2, 1];
  switch (style) {
    case 'none':
      return Array<Step>(STEPS_PER_BAR).fill(HOLD);
    case 'up16':
      return Array.from({ length: STEPS_PER_BAR }, (_, i) => n(pick(i), i % 4 ? 0.3 : 0));
    case 'updown16':
      return Array.from({ length: STEPS_PER_BAR }, (_, i) => n(pick(ud[i % ud.length]!), i % 4 ? 0.3 : 0));
    case 'broken8':
      return Array.from({ length: STEPS_PER_BAR }, (_, i) =>
        i % 2 ? HOLD : n(pick([0, 2, 1, 2][(i / 2) % 4]!)),
      );
    case 'offbeat8':
      return Array.from({ length: STEPS_PER_BAR }, (_, i) =>
        i % 4 === 2 ? n(pick(1)) : i % 4 === 3 ? OFF : HOLD,
      );
  }
}

// ---------------------------------------------------------------------------------------------
// Drums: x = hit, o = ghost hit, . = nothing

export type DrumStyle =
  'none' | 'hats' | 'rock' | 'light' | 'drive' | 'boss' | 'march' | 'halftime' | 'build' | 'hurdle' | 'push';

interface Kit {
  readonly k: string;
  readonly s: string;
  readonly h: string;
}

const DRUMS: Record<DrumStyle, Kit> = {
  none: { k: '................', s: '................', h: '................' },
  hats: { k: '................', s: '................', h: 'x.o.x.o.x.o.x.o.' },
  rock: { k: 'x.......x.x.....', s: '....x.......x...', h: 'x.o.x.o.x.o.x.o.' },
  light: { k: 'x.......x.......', s: '....o.......o...', h: '..x...x...x...x.' },
  drive: { k: 'x...x...x...x...', s: '....x.......x...', h: 'ooxoooxoooxoooxo' },
  boss: { k: 'x..x..x...x..x..', s: '....x.......x...', h: 'xoxoxoxoxoxoxoxo' },
  march: { k: 'x.......x.......', s: '....x..o....x.oo', h: 'x.x.x.x.x.x.x.x.' },
  halftime: { k: 'x.........x.....', s: '........x.......', h: 'x.x.x.x.x.x.x.x.' },
  build: { k: 'x...x...x...x...', s: '................', h: 'x.x.x.x.x.x.x.x.' },
  /** Syncopated 3+3+2 kick under a straight backbeat. */
  hurdle: { k: 'x..x..x...x..x..', s: '....x.......x..o', h: 'x.xox.xox.xox.xo' },
  /** Overlay only (final-100 layer): offbeat kick pushes, ghost snares and 16th hats. */
  push: { k: '......x.......x.', s: '.......o.o.....o', h: 'ooxoooxoooxoooxo' },
};

const FILLS: Record<DrumStyle, Kit> = {
  none: DRUMS.none,
  hats: { k: '................', s: '............xoxx', h: 'x.o.x.o.x.o.....' },
  rock: { k: 'x.......x.......', s: '....x...x.xox.xx', h: 'x.o.x.o.........' },
  light: { k: 'x.......x.......', s: '....o.......o.oo', h: '..x...x...x.x.x.' },
  drive: { k: 'x...x...x...x...', s: '....x...xx.xxxxx', h: 'ooxoooxo........' },
  boss: { k: 'x..x..x...x.x.x.', s: '....x..x.xxxxxxx', h: 'xoxoxoxo........' },
  march: { k: 'x.......x...x...', s: 'x.oox.oox.oox.xx', h: 'x.x.x.x.........' },
  halftime: { k: 'x.........x.....', s: '........x...xoxx', h: 'x.x.x.x.x.x.....' },
  build: { k: 'x...x...x...x...', s: 'x.x.x.x.xxxxxxxx', h: '................' },
  hurdle: { k: 'x..x..x...x.....', s: '....x..o..x.xxxx', h: 'x.xox.xox.......' },
  push: { k: '......x.......x.', s: '.......o.ooooooo', h: 'ooxoooxo........' },
};

function drumSteps(grid: string): Step[] {
  if (grid.length !== STEPS_PER_BAR) throw new Error(`Drum grid must be 16 steps: ${grid}`);
  // Drums use the instrument's own pitch: ZzFXM note 12 == MIDI 36 in our mapping.
  return [...grid].map((c) => (c === 'x' ? n(36) : c === 'o' ? n(36, 0.55) : HOLD));
}

// ---------------------------------------------------------------------------------------------
// Song spec

export interface Section {
  readonly chords: readonly string[];
  /** Written lead line; omitted = lead rests. */
  readonly lead?: string;
  readonly bass: BassStyle;
  readonly arp: ArpStyle;
  readonly drums: DrumStyle;
  /** Drum fill on the last bar of the section. */
  readonly fill?: boolean;
  /** Crash cymbal on the first beat of the section. */
  readonly crash?: boolean;
  /** Soft crash accent on the downbeat of every bar (hurdles). */
  readonly accent?: boolean;
  /** Final-100 layer: a written descant line on Instruments.finalLead. */
  readonly finalLead?: string;
  /** Final-100 layer: extra drums played on top of `drums`. */
  readonly finalDrums?: DrumStyle;
}

export interface Instruments {
  readonly lead: ZzfxParams;
  readonly bass: ZzfxParams;
  readonly arp: ZzfxParams;
  readonly kick: ZzfxParams;
  readonly snare: ZzfxParams;
  readonly hat: ZzfxParams;
  readonly crash: ZzfxParams;
  /** Auto-harmony voice under the lead. */
  readonly harmony?: ZzfxParams;
  /** Detuned double of the lead, panned opposite (boss "alien" lead). */
  readonly lead2?: ZzfxParams;
  /** Voice of Section.finalLead (only in the final render). */
  readonly finalLead?: ZzfxParams;
}

export interface SongSpec {
  readonly bpm: number;
  readonly instruments: Instruments;
  readonly sections: readonly Section[];
}

interface Track {
  readonly instrument: number;
  readonly pan: number;
  readonly steps: readonly Step[];
  readonly melodic: boolean;
}

/** Number of bars in a spec. */
export function specBars(spec: SongSpec): number {
  return spec.sections.reduce((a, s) => a + s.chords.length, 0);
}

/** True if the spec has a final-100 layer (Section.finalLead / finalDrums). */
export function hasFinalLayer(spec: SongSpec): boolean {
  return spec.sections.some((s) => s.finalLead !== undefined || s.finalDrums !== undefined);
}

function sectionLine(text: string | undefined, bars: number, what: string): Step[] {
  const line: Step[] = text ? parseLine(text) : [OFF, ...Array<Step>(bars * STEPS_PER_BAR - 1).fill(HOLD)];
  if (line.length !== bars * STEPS_PER_BAR) {
    throw new Error(`${what} is ${line.length} steps, expected ${bars * STEPS_PER_BAR}`);
  }
  return line;
}

/**
 * Compile a spec to ZzFXM song data, transposing melodic parts by `transpose` semitones.
 * With `final`, the final-100 layer (descant lead and extra drums) is appended after the base
 * channels; the base channels are identical to the plain build.
 */
export function buildSong(spec: SongSpec, transpose = 0, final = false): Song {
  const inst = spec.instruments;
  const instruments: ZzfxParams[] = [];
  const add = (p: ZzfxParams) => instruments.push(p) - 1;

  const chords: Chord[] = [];
  const lead: Step[] = [];
  const bass: Step[] = [];
  const arp: Step[] = [];
  const kick: Step[] = [];
  const snare: Step[] = [];
  const hat: Step[] = [];
  const crash: Step[] = [];
  const fLead: Step[] = [];
  const fKick: Step[] = [];
  const fSnare: Step[] = [];
  const fHat: Step[] = [];

  spec.sections.forEach((sec, si) => {
    const bars = sec.chords.length;
    lead.push(...sectionLine(sec.lead, bars, `Section ${si}: lead`));
    fLead.push(...sectionLine(sec.finalLead, bars, `Section ${si}: finalLead`));
    sec.chords.forEach((name, b) => {
      const c = parseChord(name);
      chords.push(c);
      bass.push(...bassBar(sec.bass, c));
      arp.push(...arpBar(sec.arp, c));
      const kit = sec.fill && b === bars - 1 ? FILLS[sec.drums] : DRUMS[sec.drums];
      kick.push(...drumSteps(kit.k));
      snare.push(...drumSteps(kit.s));
      hat.push(...drumSteps(kit.h));
      const fd = sec.finalDrums ?? 'none';
      const fkit = sec.fill && b === bars - 1 ? FILLS[fd] : DRUMS[fd];
      fKick.push(...drumSteps(fkit.k));
      fSnare.push(...drumSteps(fkit.s));
      fHat.push(...drumSteps(fkit.h));
      const hit = sec.crash && b === 0 ? 'x' : sec.accent ? 'o' : '.';
      crash.push(...drumSteps(`${hit}...............`));
    });
  });

  const tracks: Track[] = [
    { instrument: add(inst.lead), pan: inst.lead2 ? -0.35 : 0, steps: lead, melodic: true },
  ];
  if (inst.lead2) tracks.push({ instrument: add(inst.lead2), pan: 0.35, steps: lead, melodic: true });
  if (inst.harmony) {
    tracks.push({ instrument: add(inst.harmony), pan: 0.3, steps: harmonize(lead, chords), melodic: true });
  }
  tracks.push(
    { instrument: add(inst.arp), pan: -0.4, steps: arp, melodic: true },
    { instrument: add(inst.bass), pan: 0, steps: bass, melodic: true },
    { instrument: add(inst.kick), pan: 0, steps: kick, melodic: false },
    { instrument: add(inst.snare), pan: 0.1, steps: snare, melodic: false },
    { instrument: add(inst.hat), pan: 0.3, steps: hat, melodic: false },
    { instrument: add(inst.crash), pan: -0.25, steps: crash, melodic: false },
  );
  const baseChannels = tracks.length;
  if (final && hasFinalLayer(spec)) {
    if (inst.finalLead) {
      tracks.push({ instrument: add(inst.finalLead), pan: 0.4, steps: fLead, melodic: true });
    }
    tracks.push(
      { instrument: add(inst.kick), pan: 0, steps: fKick, melodic: false },
      { instrument: add(inst.snare), pan: -0.1, steps: fSnare, melodic: false },
      { instrument: add(inst.hat), pan: -0.3, steps: fHat, melodic: false },
    );
  }

  const toValue = (s: Step, melodic: boolean): number => {
    if (s === HOLD || s === OFF) return s;
    const note = s.midi + (melodic ? transpose : 0) - 24;
    if (note < 1) throw new Error(`Note below ZzFXM range: MIDI ${s.midi}`);
    return note + s.att;
  };

  const patterns: ZzfxmPattern[] = [];
  const sequence: number[] = [];
  const index = new Map<string, number>();
  for (let bar = 0; bar < chords.length; bar++) {
    const pattern: ZzfxmChannel[] = tracks.map((t) => [
      t.instrument,
      t.pan,
      ...t.steps.slice(bar * STEPS_PER_BAR, (bar + 1) * STEPS_PER_BAR).map((s) => toValue(s, t.melodic)),
    ]);
    const key = JSON.stringify(pattern);
    let p = index.get(key);
    if (p === undefined) {
      p = patterns.push(pattern) - 1;
      index.set(key, p);
    }
    sequence.push(p);
  }
  return { bpm: spec.bpm, baseChannels, instruments, patterns, sequence };
}
