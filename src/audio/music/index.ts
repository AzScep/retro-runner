/**
 * Song catalogue and pure rendering (no Web Audio): ZzFXM data -> normalised stereo PCM.
 * Rendering is split per channel so the engine can yield to the main thread between chunks.
 */

import type { MusicId, Pcm } from '../types.ts';
import { levels, SAMPLE_RATE } from '../synth.ts';
import { zzfxM, zzfxmSongLength } from '../vendor/zzfxm.ts';
import { buildSong, hasFinalLayer, specBars, type Song, type SongSpec } from './compose.ts';
import { BOSS } from './boss.ts';
import { CHAMPION } from './champion.ts';
import { HURDLES } from './hurdles.ts';
import { LADDER } from './ladder.ts';
import { QUARTER } from './quarter.ts';
import { RACE } from './race.ts';
import { TITLE } from './title.ts';

export type { Song, SongSpec } from './compose.ts';

export const SONG_SPECS: Record<MusicId, SongSpec> = {
  title: TITLE,
  ladder: LADDER,
  race: RACE,
  boss: BOSS,
  champion: CHAMPION,
  hurdles: HURDLES,
  quarter: QUARTER,
};

export const RACE_TIERS = 6;
export const BOSS_TIER = 7;

/** A concrete track to render: which song, transposed how far. */
export interface TrackRef {
  /** Cache key, e.g. "title", "race:3". */
  readonly key: string;
  readonly id: MusicId;
  readonly transpose: number;
}

/** Worker request key for the SFX bank (every SFX plus the crowd loop); never a track key. */
export const SFX_BANK_KEY = '#sfx';

/** Race themes: tier 7 (Zyx) plays `boss` in every event. */
const RACE_THEMES: ReadonlySet<MusicId> = new Set(['race', 'hurdles', 'quarter']);
/** Race themes transposed a semitone per tier (1-6). */
const TRANSPOSED: ReadonlySet<MusicId> = new Set(['race', 'hurdles']);

/**
 * Resolve playMusic(id, tier) to a track. race / hurdles / quarter + tier 7 => boss; race and
 * hurdles tiers clamp to 1-6 and transpose; quarter is the same track on tiers 1-6.
 */
export function resolveTrack(id: MusicId, tier?: number): TrackRef {
  if (RACE_THEMES.has(id)) {
    const t = Math.round(Number.isFinite(tier) ? tier! : 1);
    if (t >= BOSS_TIER) return { key: 'boss', id: 'boss', transpose: 0 };
    if (TRANSPOSED.has(id)) {
      const clamped = Math.min(RACE_TIERS, Math.max(1, t));
      return { key: `${id}:${clamped}`, id, transpose: clamped - 1 };
    }
  }
  return { key: id, id, transpose: 0 };
}

const songCache = new Map<string, Song>();

export function getSong(ref: TrackRef): Song {
  let song = songCache.get(ref.key);
  if (!song) {
    const spec = SONG_SPECS[ref.id];
    song = buildSong(spec, ref.transpose, hasFinalLayer(spec));
    songCache.set(ref.key, song);
  }
  return song;
}

/** Expected loop length in seconds of a song spec (bars x 4 beats, with ZzFXM's row rounding). */
export function expectedSeconds(id: MusicId, sampleRate = SAMPLE_RATE): number {
  const spec = SONG_SPECS[id];
  const row = ((sampleRate / spec.bpm) * 60) >> 2;
  return (specBars(spec) * 16 * row) / sampleRate;
}

/** Peak ceiling after normalisation (about -1 dBFS) and the loudness target (-15 dBFS RMS). */
const PEAK_CEILING = 0.89;
const TARGET_RMS = 0.18;

function normGain(channels: readonly Float32Array[]): number {
  const { peak, rms } = levels(channels);
  return peak > 0 ? Math.min(PEAK_CEILING / peak, TARGET_RMS / rms) : 1;
}

function scale(channels: readonly Float32Array[], gain: number): void {
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i]! *= gain;
}

/**
 * Render a song one ZzFXM channel per step. Yields after each channel; the generator's return
 * value is the finished, normalised stereo PCM. Channels are independent in ZzFXM, so the sum of
 * per-channel renders equals a full render; each channel is added straight into the output.
 *
 * Songs with a final layer (song.baseChannels < channel count) also return `final`: after the
 * base channels the mix is copied and the extra channels are added to the copy. Both mixes share
 * one gain (the smaller of the two normalisation gains), so final = base + extra exactly and a
 * linear crossfade between them never dips or jumps.
 */
export function* renderSongSteps(song: Song, sampleRate = SAMPLE_RATE): Generator<void, Pcm, void> {
  const length = zzfxmSongLength(song.patterns, song.sequence, song.bpm, sampleRate);
  const base: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  let final: [Float32Array, Float32Array] | null = null;
  const channels = song.patterns[0]!.length;
  for (let c = 0; c < channels; c++) {
    if (c === song.baseChannels) final = [base[0].slice(), base[1].slice()];
    const patterns = song.patterns.map((p) => [p[c]!]);
    zzfxM(song.instruments, patterns, song.sequence, song.bpm, sampleRate, final ?? base);
    yield;
  }
  if (!final) {
    scale(base, normGain(base));
    return { sampleRate, channels: base };
  }
  const gain = Math.min(normGain(base), normGain(final));
  scale(base, gain);
  scale(final, gain);
  return { sampleRate, channels: base, final };
}

/** Render a song synchronously (tests and tools). */
export function renderSong(song: Song, sampleRate = SAMPLE_RATE): Pcm {
  const it = renderSongSteps(song, sampleRate);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
