/**
 * Hurdles theme - A minor at tier 1, 170 BPM, 20 bars (28.2 s loop). Syncopated: the 3+3+2
 * "stride" figure runs through the kick, the bass and the lead, and a soft crash accents the
 * downbeat of every bar (one per hurdle-like stride cycle). Transposed up a semitone per tier
 * (1-6) like `race`; tier 7 plays the boss track. The loop ends on E (V) and falls into Am.
 */

import type { SongSpec } from './compose.ts';
import { ARP, CRASH, HAT, KICK, PULSE_HARMONY, PULSE_LEAD, SAW_BASS, SNARE } from './instruments.ts';

export const HURDLES: SongSpec = {
  bpm: 170,
  instruments: {
    lead: PULSE_LEAD,
    harmony: PULSE_HARMONY,
    bass: SAW_BASS,
    arp: ARP,
    kick: KICK,
    snare: SNARE,
    hat: HAT,
    crash: CRASH,
  },
  sections: [
    {
      chords: ['Am', 'Am', 'F', 'G'],
      lead: `r_16 r_16
        A5_3 A5_3 G5_2 E5_3 D5_3 C5_2
        B4_3 D5_3 G5_2 B5_8`,
      bass: 'synco',
      arp: 'none',
      drums: 'hurdle',
      fill: true,
      accent: true,
    },
    {
      chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'E', 'E'],
      lead: `
        A5_3 A5_3 C6_2 B5_3 A5_3 E5_2
        F5_3 A5_3 C6_2 F6_6 E6_2
        E6_3 D6_3 C6_2 G5_4 E5_2 G5_2
        D6_3 B5_3 G5_2 D6_6 r_2
        A5_3 A5_3 C6_2 E6_3 D6_3 C6_2
        A5_3 C6_3 F6_2 E6_4 C6_4
        B5_3 G#5_3 E5_2 B5_4 D6_4
        G#6_6 E6_2 B5_4 G#5_4`,
      bass: 'synco',
      arp: 'up16',
      drums: 'hurdle',
      fill: true,
      crash: true,
      accent: true,
    },
    {
      chords: ['Dm', 'G', 'C', 'F', 'Dm', 'E', 'Am', 'E'],
      lead: `
        F6_4 r_2 F6_2 E6_2 D6_2 A5_4
        B5_4 r_2 B5_2 C6_2 D6_2 G6_4
        E6_3 G6_3 E6_2 C6_3 E6_3 C6_2
        A5_3 C6_3 A5_2 F5_8
        D6_2 F6_2 A6_2 F6_2 D6_2 A5_2 D6_2 F6_2
        E6_2 G#6_2 B6_2 G#6_2 E6_2 B5_2 E6_2 G#6_2
        A6_6 E6_2 C6_4 A5_4
        B5_3 B5_3 B5_2 D6_3 E6_3 G#6_2`,
      bass: 'synco',
      arp: 'updown16',
      drums: 'hurdle',
      fill: true,
      crash: true,
      accent: true,
    },
  ],
};
