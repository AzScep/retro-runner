/**
 * Gauntlet theme (design 36.2) - G minor lifting to G major, 160 BPM, 30 bars (45.0 s loop).
 * Driving: four-on-the-floor kick, 16th hats, octave and gallop saw bass, 16th arpeggios, a pulse
 * lead with an automatic pulse harmony under it.
 *
 * Every loop makes the minor-to-major lift: intro and A in G minor, a pre-lift that lands on D
 * (V, with the F# that G major needs), B and its climax in G major, then a turnaround through
 * Eb - Cm - D (borrowed from the minor) that falls back into the intro's Gm. One track for every
 * Gauntlet tier 1-6 and the cards between races, so it is never transposed and never restarts.
 */

import type { SongSpec } from './compose.ts';
import { ARP, CRASH, HAT, KICK, PULSE_HARMONY, PULSE_LEAD, SAW_BASS, SNARE } from './instruments.ts';

export const GAUNTLET: SongSpec = {
  bpm: 160,
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
    // Intro (G minor): the engine idles, then a pickup into A.
    {
      chords: ['Gm', 'Gm'],
      lead: `r_16 | r_8 D5_2 G5_2 A5_2 Bb5_2`,
      bass: 'pulse16',
      arp: 'up16',
      drums: 'build',
      fill: true,
    },
    // A (G minor)
    {
      chords: ['Gm', 'Eb', 'F', 'D', 'Gm', 'Eb', 'Cm', 'D'],
      lead: `
        D6_6 Bb5_2 G5_4 D6_2 C6_2 | Bb5_4 G5_2 Bb5_2 Eb6_6 D6_2
        C6_4 A5_2 F5_2 C6_4 D6_2 Eb6_2 | D6_8 A5_4 F#5_4
        G6_6 F6_2 D6_4 Bb5_2 C6_2 | D6_2 Eb6_2 D6_2 Bb5_2 G5_4 Bb5_4
        C6_2 D6_2 Eb6_2 G6_2 F6_4 Eb6_4 | D6_6 C6_2 A5_4 F#5_4`,
      bass: 'octave8',
      arp: 'updown16',
      drums: 'drive',
      fill: true,
      crash: true,
    },
    // Pre-lift: climbing to D (V); the F# arpeggio announces G major.
    {
      chords: ['Eb', 'F', 'D', 'D'],
      lead: `
        G5_2 Bb5_2 Eb6_2 G6_2 F6_4 Eb6_4 | A5_2 C6_2 F6_2 A6_2 G6_4 F6_4
        F#6_8 D6_4 A5_4 | F#5_2 A5_2 D6_2 F#6_2 A6_8`,
      bass: 'gallop',
      arp: 'up16',
      drums: 'drive',
      fill: true,
    },
    // B (the lift: G major)
    {
      chords: ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'D'],
      lead: `
        B6_6 A6_2 G6_4 D6_4 | A6_6 F#6_2 D6_8
        G6_4 E6_2 B5_2 E6_4 G6_4 | E6_6 D6_2 C6_4 G5_4
        D6_2 G6_2 B6_2 D7_2 B6_4 G6_4 | A6_6 B6_2 A6_4 F#6_4
        G6_4 E6_2 C6_2 E6_4 G6_4 | F#6_8 A6_8`,
      bass: 'octave8',
      arp: 'updown16',
      drums: 'drive',
      fill: true,
      crash: true,
    },
    // Climax (G major)
    {
      chords: ['G', 'C', 'G', 'D'],
      lead: `
        B6_8 D7_4 B6_4 | C7_6 B6_2 A6_4 G6_4
        B6_4 G6_4 D6_4 G6_4 | A6_12 r_4`,
      bass: 'gallop',
      arp: 'up16',
      drums: 'drive',
      fill: true,
      crash: true,
    },
    // Turnaround: borrowed Eb and Cm darken it again, D (V) falls into the intro's Gm.
    {
      chords: ['Eb', 'Cm', 'D', 'D'],
      lead: `
        G6_6 F6_2 Eb6_4 Bb5_4 | C6_4 Eb6_4 G6_4 Eb6_4
        D6_8 F#6_4 A6_4 | A6_6 F#6_2 D6_4 r_4`,
      bass: 'pulse16',
      arp: 'up16',
      drums: 'drive',
      fill: true,
    },
  ],
};
