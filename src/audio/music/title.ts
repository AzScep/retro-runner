/**
 * Title theme - D major, 140 BPM, 32 bars (54.9 s loop). Heroic.
 * Intro (bVI-bVII fanfare) | A | B (to the relative minor and back via Bb-C) | A' | tag ending on C,
 * which resolves into the intro's D when the loop wraps.
 */

import type { SongSpec } from './compose.ts';
import { ARP, CRASH, HAT, KICK, PULSE_LEAD, SAW_BASS, SNARE } from './instruments.ts';

const A_HEAD = `
  D5_6 A4_2 D5_2 F#5_2 A5_4
  G5_2 F#5_2 E5_8 C#5_4
  D5_6 B4_2 D5_2 F#5_2 B5_4
  A5_2 G5_2 B5_8 G5_4`;

export const TITLE: SongSpec = {
  bpm: 140,
  instruments: {
    lead: PULSE_LEAD,
    bass: SAW_BASS,
    arp: ARP,
    kick: KICK,
    snare: SNARE,
    hat: HAT,
    crash: CRASH,
  },
  sections: [
    {
      chords: ['D', 'D', 'Bb', 'C'],
      lead: `r_16 r_16
        F5_2 Bb4_2 D5_2 F5_2 Bb5_6 r_2
        G5_2 C5_2 E5_2 G5_2 C6_6 r_2`,
      bass: 'octave8',
      arp: 'up16',
      drums: 'build',
      fill: true,
    },
    {
      chords: ['D', 'A', 'Bm', 'G', 'D', 'G', 'A', 'A'],
      lead: `${A_HEAD}
        A5_4 F#5_2 A5_2 D6_8
        B5_2 A5_2 G5_2 B5_2 D6_4 B5_4
        C#6_4 B5_2 A5_2 E5_4 A5_4
        A5_8 r_2 F#5_2 G5_2 A5_2`,
      bass: 'octave8',
      arp: 'broken8',
      drums: 'rock',
      fill: true,
      crash: true,
    },
    {
      chords: ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'Bb', 'C'],
      lead: `
        B5_6 A5_2 G5_4 D5_4
        E5_6 F#5_2 G5_4 A5_4
        C#6_6 B5_2 A5_4 F#5_4
        B5_8 F#5_4 D5_2 F#5_2
        G5_6 A5_2 B5_4 D6_4
        C#6_6 B5_2 A5_8
        Bb5_4 F5_2 D5_2 F5_4 Bb5_4
        C6_4 G5_2 E5_2 G5_4 C6_2 C#6_2`,
      bass: 'gallop',
      arp: 'up16',
      drums: 'rock',
      fill: true,
      crash: true,
    },
    {
      chords: ['D', 'A', 'Bm', 'G', 'Em', 'G', 'A', 'D'],
      lead: `${A_HEAD}
        G5_4 E5_2 G5_2 B5_8
        D6_4 B5_2 G5_2 B5_4 D6_4
        E6_6 D6_2 C#6_4 A5_4
        D6_12 r_4`,
      bass: 'octave8',
      arp: 'updown16',
      drums: 'rock',
      fill: true,
      crash: true,
    },
    {
      chords: ['G', 'A', 'Bb', 'C'],
      lead: `
        B5_2 D6_2 B5_2 G5_2 D5_8
        C#6_2 E6_2 C#6_2 A5_2 E5_8
        D6_2 F6_2 D6_2 Bb5_2 F5_8
        E6_2 G6_2 E6_2 C6_2 G5_8`,
      bass: 'gallop',
      arp: 'up16',
      drums: 'rock',
      fill: true,
    },
  ],
};
