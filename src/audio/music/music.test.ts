import { describe, expect, it } from 'vitest';
import { levels, SAMPLE_RATE } from '../synth.ts';
import { zzfxM, zzfxmSongLength } from '../vendor/zzfxm.ts';
import { MUSIC_IDS, type MusicId } from '../types.ts';
import { buildSong, hasFinalLayer, parseLine, specBars } from './compose.ts';
import { expectedSeconds, getSong, renderSong, resolveTrack, SONG_SPECS } from './index.ts';

/** Design 7.1 / 20.2 tempo and loop length (seconds, min-max; race themes may be shorter if clean). */
const DESIGN: Record<MusicId, { bpm: number; min: number; max: number; minBars: number }> = {
  title: { bpm: 140, min: 45, max: 60, minBars: 16 },
  ladder: { bpm: 110, min: 30, max: 45, minBars: 8 },
  race: { bpm: 165, min: 23, max: 33, minBars: 16 },
  boss: { bpm: 175, min: 23, max: 35, minBars: 16 },
  champion: { bpm: 120, min: 55, max: 65, minBars: 16 },
  hurdles: { bpm: 170, min: 27, max: 33, minBars: 16 },
  quarter: { bpm: 150, min: 64, max: 64, minBars: 40 },
};

describe('music specs', () => {
  it.each(MUSIC_IDS)('%s matches the design tempo and length', (id) => {
    const spec = SONG_SPECS[id];
    expect(spec.bpm).toBe(DESIGN[id].bpm);
    expect(specBars(spec)).toBeGreaterThanOrEqual(DESIGN[id].minBars);
    const s = expectedSeconds(id);
    expect(s).toBeGreaterThanOrEqual(DESIGN[id].min);
    expect(s).toBeLessThanOrEqual(DESIGN[id].max);
  });

  it('resolves race tiers to transpositions and tier 7 to the boss track', () => {
    expect(resolveTrack('race', 1)).toEqual({ key: 'race:1', id: 'race', transpose: 0 });
    expect(resolveTrack('race', 6)).toEqual({ key: 'race:6', id: 'race', transpose: 5 });
    expect(resolveTrack('race', 7)).toEqual({ key: 'boss', id: 'boss', transpose: 0 });
    expect(resolveTrack('race')).toEqual({ key: 'race:1', id: 'race', transpose: 0 });
    expect(resolveTrack('race', 0).key).toBe('race:1');
    expect(resolveTrack('title', 4).key).toBe('title');
  });

  it('resolves hurdles per tier, quarter to one track, and tier 7 to boss in every event', () => {
    expect(resolveTrack('hurdles', 1)).toEqual({ key: 'hurdles:1', id: 'hurdles', transpose: 0 });
    expect(resolveTrack('hurdles', 6)).toEqual({ key: 'hurdles:6', id: 'hurdles', transpose: 5 });
    expect(resolveTrack('hurdles', 9).key).toBe('boss');
    expect(resolveTrack('hurdles').key).toBe('hurdles:1');
    expect(resolveTrack('quarter', 1)).toEqual({ key: 'quarter', id: 'quarter', transpose: 0 });
    expect(resolveTrack('quarter', 6).key).toBe('quarter');
    expect(resolveTrack('quarter', 7).key).toBe('boss');
    expect(resolveTrack('quarter', Number.NaN).key).toBe('quarter');
  });

  it('only the quarter track has a final-100 layer, appended after identical base channels', () => {
    for (const id of MUSIC_IDS) expect(hasFinalLayer(SONG_SPECS[id])).toBe(id === 'quarter');
    const base = buildSong(SONG_SPECS.quarter, 0, false);
    const final = buildSong(SONG_SPECS.quarter, 0, true);
    expect(base.baseChannels).toBe(base.patterns[0]!.length);
    expect(final.baseChannels).toBe(base.baseChannels);
    expect(final.patterns[0]!.length).toBe(base.baseChannels + 4); // descant + kick, snare, hat
    expect(final.sequence.length).toBe(base.sequence.length);
    final.sequence.forEach((p, bar) => {
      expect(final.patterns[p]!.slice(0, base.baseChannels)).toEqual(base.patterns[base.sequence[bar]!]);
    });
  });

  it('hurdles accents the downbeat of every bar', () => {
    const song = buildSong(SONG_SPECS.hurdles);
    const crash = song.baseChannels - 1;
    for (const p of song.sequence) expect(song.patterns[p]![crash]![2]).toBeGreaterThan(0);
  });

  it('transposes melodic channels by one semitone per tier and leaves drums alone', () => {
    const t1 = buildSong(SONG_SPECS.race, 0);
    const t4 = buildSong(SONG_SPECS.race, 3);
    expect(t4.sequence.length).toBe(t1.sequence.length);
    const p1 = t1.patterns[t1.sequence[4]!]!;
    const p4 = t4.patterns[t4.sequence[4]!]!;
    const lead1 = p1[0]!.slice(2).filter((n) => n > 0);
    const lead4 = p4[0]!.slice(2).filter((n) => n > 0);
    expect(lead4).toEqual(lead1.map((n) => n + 3));
    const kick = p1.length - 4;
    expect(p4[kick]).toEqual(p1[kick]);
  });

  it('rejects malformed lines', () => {
    expect(() => parseLine('C5_4 H5_4')).toThrow();
    expect(parseLine('C4_2 r_2')).toEqual([{ midi: 60, att: 0 }, 0, -1, 0]);
  });
});

describe('music rendering', () => {
  const cases: [string, MusicId, number?][] = [
    ['title', 'title'],
    ['ladder', 'ladder'],
    ['race tier 1', 'race', 1],
    ['race tier 6', 'race', 6],
    ['boss (race tier 7)', 'race', 7],
    ['champion', 'champion'],
    ['hurdles tier 1', 'hurdles', 1],
    ['hurdles tier 6', 'hurdles', 6],
    ['quarter', 'quarter'],
  ];
  it.each(cases)('%s renders a full-length, normalised, seamless loop', (_name, id, tier) => {
    const ref = resolveTrack(id, tier);
    const song = getSong(ref);
    const pcm = renderSong(song);
    const [left, right] = pcm.channels as [Float32Array, Float32Array];
    expect(pcm.sampleRate).toBe(SAMPLE_RATE);
    expect(left.length).toBe(Math.round(expectedSeconds(ref.id) * SAMPLE_RATE));
    expect(right.length).toBe(left.length);
    const { peak, rms } = levels([left, right]);
    expect(peak).toBeLessThan(1);
    expect(peak).toBeGreaterThan(0.5);
    expect(rms).toBeGreaterThan(0.08);
    // Loop seam: last sample flows into the first without a step.
    expect(Math.abs(left[0]! - left[left.length - 1]!)).toBeLessThan(0.02);
    expect(Math.abs(right[0]! - right[right.length - 1]!)).toBeLessThan(0.02);
    // No silent gaps longer than one bar anywhere.
    const bar = Math.round((SAMPLE_RATE * 60 * 4) / song.bpm);
    for (let start = 0; start + bar <= left.length; start += bar) {
      expect(levels([left.subarray(start, start + bar)]).rms).toBeGreaterThan(0.01);
    }
    expect(pcm.final === undefined).toBe(id !== 'quarter');
  });

  it('quarter final-100 render: same length, seamless, louder, and exactly base + extra', () => {
    const song = getSong(resolveTrack('quarter'));
    const pcm = renderSong(song);
    const final = pcm.final!;
    expect(final).toHaveLength(2);
    expect(final[0]!.length).toBe(pcm.channels[0]!.length);
    expect(final[0]!.length).toBe(64 * SAMPLE_RATE);
    const f = levels(final);
    expect(f.peak).toBeLessThan(1);
    expect(f.rms).toBeGreaterThan(levels(pcm.channels).rms * 1.05);
    for (const ch of final) expect(Math.abs(ch[0]! - ch[ch.length - 1]!)).toBeLessThan(0.02);
    // Shared gain: the base part of the final mix is the base render, so the difference is just
    // the added layer, rendered on its own at the same gain.
    const extraOnly = {
      ...song,
      patterns: song.patterns.map((p) => p.slice(song.baseChannels)),
      baseChannels: 0,
    };
    const [xl] = zzfxM(extraOnly.instruments, extraOnly.patterns, extraOnly.sequence, extraOnly.bpm);
    const base = pcm.channels[0]!;
    let k = 0;
    for (let i = 0; i < xl.length; i++) if (Math.abs(xl[i]!) > Math.abs(xl[k]!)) k = i;
    const g = (final[0]![k]! - base[k]!) / xl[k]!;
    let maxErr = 0;
    for (let i = 0; i < xl.length; i += 89) {
      maxErr = Math.max(maxErr, Math.abs(final[0]![i]! - base[i]! - xl[i]! * g));
    }
    expect(maxErr).toBeLessThan(1e-4);
  });

  it('per-channel rendering equals the vendored whole-song render', () => {
    const song = getSong(resolveTrack('ladder'));
    const [l] = zzfxM(song.instruments, song.patterns, song.sequence, song.bpm);
    expect(l.length).toBe(zzfxmSongLength(song.patterns, song.sequence, song.bpm));
    const pcm = renderSong(song);
    const left = pcm.channels[0]!;
    // renderSong normalises; compare shapes via the ratio at the loudest sample.
    let k = 0;
    for (let i = 0; i < l.length; i++) if (Math.abs(l[i]!) > Math.abs(l[k]!)) k = i;
    const g = left[k]! / l[k]!;
    let maxErr = 0;
    for (let i = 0; i < l.length; i += 97) maxErr = Math.max(maxErr, Math.abs(left[i]! - l[i]! * g));
    expect(maxErr).toBeLessThan(1e-4);
  });
});
