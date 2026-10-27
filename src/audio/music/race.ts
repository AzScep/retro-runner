/**
 * Race theme - E minor at tier 1, 165 BPM, 20 bars (29.1 s loop). Driving: four-on-the-floor kick,
 * 16th hats, octave-bounce saw bass, 16th arpeggios. Transposed up a semitone per tier (1-6);
 * tier 7 plays the boss track instead. The last bars sit on B major (V) and resolve into the
 * loop's Em.
 */

import type { SongSpec } from './compose.ts';
import { ARP, CRASH, HAT, KICK, PULSE_LEAD, SAW_BASS, SNARE } from './instruments.ts';

export const RACE: SongSpec = {
  bpm: 165,
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
      chords: ['Em', 'Em', 'C', 'D'],
      lead: `r_16 r_16
        r_8 B4_2 C5_2 E5_2 G5_2
        F#5_6 A5_2 D6_4 C6_2 A5_2`,
      bass: 'octave8',
      arp: 'up16',
      drums: 'drive',
      fill: true,
    },
    {
      chords: ['Em', 'C', 'D', 'Em', 'Em', 'C', 'D', 'B'],
      lead: `
        B5_6 G5_2 E5_4 B5_2 A5_2
        G5_4 E5_2 G5_2 C6_6 B5_2
        A5_4 F#5_2 D5_2 A5_4 B5_2 C6_2
        B5_8 G5_2 A5_2 B5_2 D6_2
        E6_6 D6_2 B5_4 G5_2 A5_2
        B5_2 C6_2 B5_2 G5_2 E5_4 G5_4
        A5_2 B5_2 C6_2 D6_2 F#6_4 D6_4
        D#6_6 B5_2 F#5_4 D#5_4`,
      bass: 'octave8',
      arp: 'updown16',
      drums: 'drive',
      fill: true,
      crash: true,
    },
    {
      chords: ['C', 'D', 'Bm', 'Em', 'C', 'D', 'B', 'B'],
      lead: `
        E6_4 r_2 E6_2 D6_2 C6_2 B5_4
        A5_4 r_2 A5_2 B5_2 C6_2 D6_4
        F#6_4 r_2 F#6_2 E6_2 D6_2 B5_4
        E6_8 B5_4 G5_4
        G5_2 C6_2 E6_2 C6_2 G5_2 C6_2 E6_2 G6_2
        F#6_2 D6_2 A5_2 D6_2 F#6_2 A6_2 F#6_2 D6_2
        D#6_8 F#6_8
        B5_4 D#6_4 F#6_4 r_4`,
      bass: 'gallop',
      arp: 'up16',
      drums: 'drive',
      fill: true,
      crash: true,
    },
  ],
};
