/**
 * Boss race (Zyx, tier 7) - C harmonic minor, 175 BPM, 24 bars (32.9 s loop). Arpeggio-heavy:
 * 16th up-down arpeggios throughout, pulsing 16th bass, syncopated kick, and a detuned "alien"
 * saw lead pair with a pitch warble. Uses the Neapolitan Db for menace; ends on G (V) to loop.
 */

import type { SongSpec } from './compose.ts';
import { ALIEN_LEAD_A, ALIEN_LEAD_B, ARP, CRASH, HAT, KICK, SAW_BASS, SNARE } from './instruments.ts';

export const BOSS: SongSpec = {
  bpm: 175,
  instruments: {
    lead: ALIEN_LEAD_A,
    lead2: ALIEN_LEAD_B,
    bass: SAW_BASS,
    arp: ARP,
    kick: KICK,
    snare: SNARE,
    hat: HAT,
    crash: CRASH,
  },
  sections: [
    {
      chords: ['Cm', 'Cm', 'Ab', 'G'],
      lead: `r_16 r_16
        Eb6_8 D6_4 C6_4
        B5_12 r_4`,
      bass: 'pulse16',
      arp: 'updown16',
      drums: 'halftime',
      fill: true,
    },
    {
      chords: ['Cm', 'Ab', 'Fm', 'G', 'Cm', 'Ab', 'Db', 'G'],
      lead: `
        C5_4 G5_4 Eb6_6 D6_2
        C6_6 Ab5_2 Eb5_4 C5_4
        F5_4 Ab5_4 C6_4 Eb6_2 D6_2
        D6_6 B5_2 G5_4 F5_2 D5_2
        Eb6_4 D6_2 C6_2 G6_8
        F6_4 Eb6_2 C6_2 Ab5_8
        Db6_6 C6_2 Ab5_4 F5_4
        G5_2 Ab5_2 B5_2 C6_2 D6_8`,
      bass: 'pulse16',
      arp: 'up16',
      drums: 'boss',
      fill: true,
      crash: true,
    },
    {
      chords: ['Fm', 'G', 'Cm', 'Eb', 'Ab', 'Fm', 'Db', 'G'],
      lead: `
        F6_8 Eb6_4 C6_4
        D6_6 B5_2 G5_8
        G5_2 C6_2 Eb6_2 G6_2 F6_4 Eb6_4
        D6_4 Eb6_4 Bb5_8
        C6_6 Bb5_2 Ab5_4 Eb5_4
        F5_2 G5_2 Ab5_2 C6_2 F6_8
        F6_6 Eb6_2 Db6_4 Ab5_4
        B5_6 D6_2 F6_4 D6_4`,
      bass: 'pulse16',
      arp: 'updown16',
      drums: 'boss',
      fill: true,
      crash: true,
    },
    {
      chords: ['Ab', 'Db', 'G', 'G'],
      lead: `
        Eb6_12 D6_2 Eb6_2
        F6_12 Eb6_2 Db6_2
        D6_8 B5_8
        G5_8 r_8`,
      bass: 'pulse16',
      arp: 'up16',
      drums: 'boss',
      fill: true,
    },
  ],
};
