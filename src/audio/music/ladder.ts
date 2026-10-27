/**
 * Ladder map - F major, 110 BPM, 16 bars (34.9 s loop). Light and anticipatory: echoing pluck lead,
 * walking triangle bass, brushed-sounding ghost snare. Ends on the dominant (C) with a chromatic
 * walk-up into the loop's first F.
 */

import type { SongSpec } from './compose.ts';
import { CRASH, HAT, KICK, PLUCK_LEAD, SNARE, SOFT_ARP, TRI_BASS } from './instruments.ts';

const HEAD = `
  C5_2 r_2 A4_2 C5_2 F5_4 E5_2 F5_2
  D5_4 r_2 Bb4_2 D5_4 F5_4
  C5_2 r_2 A4_2 C5_2 F5_2 G5_2 A5_4`;

export const LADDER: SongSpec = {
  bpm: 110,
  instruments: {
    lead: PLUCK_LEAD,
    bass: TRI_BASS,
    arp: SOFT_ARP,
    kick: KICK,
    snare: SNARE,
    hat: HAT,
    crash: CRASH,
  },
  sections: [
    {
      chords: ['F', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'C'],
      lead: `${HEAD}
        G5_6 E5_2 C5_8
        A5_2 r_2 F5_2 A5_2 D6_4 C6_2 A5_2
        Bb5_4 F5_4 D5_4 F5_4
        G5_2 A5_2 Bb5_2 A5_2 G5_4 D5_4
        E5_4 G5_4 C6_6 r_2`,
      bass: 'walk4',
      arp: 'broken8',
      drums: 'light',
      fill: true,
    },
    {
      chords: ['F', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'C'],
      lead: `${HEAD}
        G5_2 A5_2 G5_2 E5_2 C5_8
        D6_4 C6_2 A5_2 F5_4 A5_4
        Bb5_2 C6_2 D6_4 C6_4 Bb5_4
        A5_4 G5_2 F5_2 G5_4 Bb5_4
        C6_4 r_4 G4_2 A4_2 Bb4_2 B4_2`,
      bass: 'walk4',
      arp: 'offbeat8',
      drums: 'light',
      fill: true,
    },
  ],
};
