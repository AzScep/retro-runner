/**
 * Champion / credits - Bb major, 120 BPM, 30 bars (60.0 s loop). Triumphant march: saw brass lead
 * with an automatic chord-tone harmony a third-to-sixth below, march snare, triangle-ish saw bass.
 * Intro fanfare (Eb-F) | A | B | A' | coda, which hands back to the intro's Eb.
 */

import type { SongSpec } from './compose.ts';
import { BRASS_HARMONY, BRASS_LEAD, CRASH, HAT, KICK, SAW_BASS, SNARE, SOFT_ARP } from './instruments.ts';

const A_HEAD = `
  D6_6 C6_2 Bb5_4 F5_4
  C6_6 A5_2 F5_8
  G5_4 Bb5_4 D6_4 G6_4
  G6_6 F6_2 Eb6_8`;

export const CHAMPION: SongSpec = {
  bpm: 120,
  instruments: {
    lead: BRASS_LEAD,
    harmony: BRASS_HARMONY,
    bass: SAW_BASS,
    arp: SOFT_ARP,
    kick: KICK,
    snare: SNARE,
    hat: HAT,
    crash: CRASH,
  },
  sections: [
    {
      chords: ['Eb', 'F'],
      lead: `
        Bb4_2 Eb5_2 G5_2 Bb5_10
        A5_2 C6_2 A5_2 F5_2 C6_8`,
      bass: 'hold',
      arp: 'up16',
      drums: 'march',
      fill: true,
    },
    {
      chords: ['Bb', 'F', 'Gm', 'Eb', 'Bb', 'Eb', 'F', 'F'],
      lead: `${A_HEAD}
        D6_4 F6_4 Bb6_6 A6_2
        G6_6 F6_2 Eb6_4 G6_4
        F6_8 C6_4 A5_4
        C6_4 D6_4 Eb6_4 F6_4`,
      bass: 'march',
      arp: 'broken8',
      drums: 'march',
      fill: true,
      crash: true,
    },
    {
      chords: ['Eb', 'F', 'Dm', 'Gm', 'Cm', 'F', 'Eb', 'F'],
      lead: `
        G6_6 F6_2 Eb6_4 Bb5_4
        A5_6 Bb5_2 C6_8
        D6_6 C6_2 A5_4 F5_4
        G5_4 A5_2 Bb5_2 D6_8
        Eb6_6 D6_2 C6_4 G5_4
        A5_4 C6_4 F6_8
        G6_4 F6_2 Eb6_2 D6_4 Eb6_4
        F6_8 r_4 F5_4`,
      bass: 'march',
      arp: 'up16',
      drums: 'march',
      fill: true,
      crash: true,
    },
    {
      chords: ['Bb', 'F', 'Gm', 'Eb', 'Cm', 'Eb', 'F', 'Bb'],
      lead: `${A_HEAD}
        Eb6_4 D6_2 C6_2 G5_4 C6_4
        Bb5_4 G5_2 Eb5_2 G5_4 Bb5_4
        C6_4 D6_4 Eb6_4 A5_4
        Bb5_12 r_4`,
      bass: 'march',
      arp: 'broken8',
      drums: 'march',
      fill: true,
      crash: true,
    },
    {
      chords: ['Eb', 'F', 'Bb', 'Bb'],
      lead: `
        G5_2 Bb5_2 Eb6_2 G6_2 Bb6_8
        A6_2 F6_2 C6_2 A5_2 F6_8
        D6_16
        r_16`,
      bass: 'hold',
      arp: 'up16',
      drums: 'halftime',
      fill: true,
      crash: true,
    },
  ],
};
