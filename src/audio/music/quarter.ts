/**
 * 400 m theme - D minor, 150 BPM, 40 bars (64.0 s loop; at 150 BPM one 16th is exactly 0.1 s).
 * A steady pacing groove that develops over the race: intro, A (the theme), B (lifts to the
 * relative major), C (a sparser bridge for the back straight), A' (theme up an octave), tag on A
 * (V) that falls back into Dm.
 *
 * Rendered twice (design 20.2): the base mix, and the "final 100" mix that adds a high pulse
 * descant (Section.finalLead) and an overlay of offbeat kicks, ghost snares and 16th hats
 * (finalDrums 'push'). The engine crossfades between the two at 300 m without losing the loop
 * position.
 */

import type { SongSpec } from './compose.ts';
import { CRASH, DESCANT_LEAD, HAT, KICK, PULSE_LEAD, SNARE, SOFT_ARP, TRI_BASS } from './instruments.ts';

/** Half-note descant for the A sections (Dm Bb F C | Dm Bb Gm A). */
const A_DESCANT = `
  A6_8 F6_8 | F6_8 D6_8 | C7_8 A6_8 | G6_8 E6_8
  A6_8 F6_8 | D6_8 F6_8 | G6_8 Bb6_8 | E6_8 A6_8`;

export const QUARTER: SongSpec = {
  bpm: 150,
  instruments: {
    lead: PULSE_LEAD,
    finalLead: DESCANT_LEAD,
    bass: TRI_BASS,
    arp: SOFT_ARP,
    kick: KICK,
    snare: SNARE,
    hat: HAT,
    crash: CRASH,
  },
  sections: [
    // Intro
    {
      chords: ['Dm', 'Bb', 'C', 'A'],
      lead: `r_16 | r_16
        r_8 C5_2 D5_2 E5_2 G5_2 | A5_4 E5_4 C#5_4 E5_4`,
      finalLead: `A5_2 D6_2 F6_2 A6_10 | Bb6_6 A6_2 F6_8 | E6_8 G6_8 | A6_8 E6_8`,
      bass: 'root8',
      arp: 'broken8',
      drums: 'light',
      finalDrums: 'push',
      fill: true,
    },
    // A
    {
      chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'],
      lead: `
        D5_6 F5_2 A5_6 D6_2 | C6_4 Bb5_4 F5_8
        A5_6 C6_2 F6_4 E6_2 C6_2 | G5_8 E5_4 C5_4
        D5_6 F5_2 A5_6 D6_2 | F6_6 E6_2 D6_4 Bb5_4
        G5_4 Bb5_4 D6_4 C6_2 Bb5_2 | A5_8 C#6_4 E6_4`,
      finalLead: A_DESCANT,
      bass: 'octave8',
      arp: 'broken8',
      drums: 'rock',
      finalDrums: 'push',
      fill: true,
      crash: true,
    },
    // B
    {
      chords: ['Bb', 'C', 'Am', 'Dm', 'Gm', 'C', 'F', 'A'],
      lead: `
        F6_6 D6_2 Bb5_8 | G6_6 E6_2 C6_8
        E6_4 C6_2 A5_2 E6_4 A6_4 | F6_8 D6_4 A5_4
        Bb5_2 D6_2 G6_4 F6_2 D6_2 Bb5_4 | C6_2 E6_2 G6_4 F6_2 E6_2 C6_4
        A6_6 G6_2 F6_4 C6_4 | E6_4 C#6_4 A5_4 E5_4`,
      finalLead: `
        Bb6_8 F6_8 | C7_8 G6_8 | A6_8 E6_8 | D6_8 A6_8
        G6_8 D6_8 | E6_8 G6_8 | F6_8 A6_8 | A6_8 E6_8`,
      bass: 'octave8',
      arp: 'up16',
      drums: 'rock',
      finalDrums: 'push',
      fill: true,
      crash: true,
    },
    // C (bridge, back straight)
    {
      chords: ['Gm', 'Dm', 'Bb', 'F', 'Gm', 'Dm', 'E', 'A'],
      lead: `
        D6_8 Bb5_8 | A5_8 F5_8
        Bb5_4 C6_4 D6_4 F6_4 | C6_12 r_4
        G5_4 Bb5_4 D6_4 G6_4 | F6_8 A5_8
        G#5_4 B5_4 E6_4 D6_4 | C#6_8 A5_4 E5_4`,
      finalLead: `
        G6_3 D6_3 G6_2 Bb6_3 G6_3 D6_2 | F6_3 D6_3 F6_2 A6_3 F6_3 D6_2
        F6_3 D6_3 F6_2 Bb6_3 F6_3 D6_2 | A6_3 F6_3 A6_2 C7_3 A6_3 F6_2
        G6_3 D6_3 G6_2 Bb6_3 G6_3 D6_2 | F6_3 D6_3 F6_2 A6_3 F6_3 D6_2
        G#6_3 E6_3 G#6_2 B6_3 G#6_3 E6_2 | A6_3 E6_3 A6_2 C#7_3 A6_3 E6_2`,
      bass: 'walk4',
      arp: 'offbeat8',
      drums: 'light',
      finalDrums: 'push',
      fill: true,
      crash: true,
    },
    // A' (theme an octave up)
    {
      chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A'],
      lead: `
        D6_6 F6_2 A6_6 F6_2 | D6_4 C6_4 Bb5_8
        A5_2 C6_2 F6_2 A6_2 G6_4 F6_2 E6_2 | E6_8 G6_4 E6_4
        F6_6 E6_2 D6_6 A5_2 | Bb5_6 C6_2 D6_4 F6_4
        G6_4 F6_2 D6_2 Bb5_4 G5_4 | A5_4 C#6_4 E6_4 A6_4`,
      finalLead: A_DESCANT,
      bass: 'octave8',
      arp: 'updown16',
      drums: 'rock',
      finalDrums: 'push',
      fill: true,
      crash: true,
    },
    // Tag on the dominant
    {
      chords: ['Bb', 'C', 'A', 'A'],
      lead: `
        D6_8 F6_8 | E6_8 G6_8
        C#6_4 E6_4 A6_8 | G6_2 F6_2 E6_2 C#6_2 A5_8`,
      finalLead: `F6_8 Bb6_8 | G6_8 C7_8 | C#7_8 A6_8 | A6_8 E6_8`,
      bass: 'gallop',
      arp: 'up16',
      drums: 'drive',
      finalDrums: 'push',
      fill: true,
      crash: true,
    },
  ],
};
