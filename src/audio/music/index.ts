/**
 * Song catalogue and pure rendering (no Web Audio): ZzFXM data -> normalised stereo PCM.
 * Rendering is split per channel so the engine can yield to the main thread between chunks.
 */

import type { MusicId, Pcm } from '../types.ts';
import { levels, SAMPLE_RATE } from '../synth.ts';
import { zzfxM, zzfxmSongLength } from '../vendor/zzfxm.ts';
import { buildSong, specBars, type Song, type SongSpec } from './compose.ts';
import { BOSS } from './boss.ts';
import { CHAMPION } from './champion.ts';
import { LADDER } from './ladder.ts';
import { RACE } from './race.ts';
import { TITLE } from './title.ts';

export type { Song, SongSpec } from './compose.ts';

export const SONG_SPECS: Record<MusicId, SongSpec> = {
  title: TITLE,
  ladder: LADDER,
  race: RACE,
  boss: BOSS,
  champion: CHAMPION,
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

/** Resolve playMusic(id, tier) to a track. race + tier 7 => boss; race tiers clamp to 1-6. */
export function resolveTrack(id: MusicId, tier?: number): TrackRef {
  if (id === 'race') {
    const t = Math.round(tier ?? 1);
    if (t >= BOSS_TIER) return { key: 'boss', id: 'boss', transpose: 0 };
    const clamped = Math.min(RACE_TIERS, Math.max(1, t));
    return { key: `race:${clamped}`, id: 'race', transpose: clamped - 1 };
  }
  return { key: id, id, transpose: 0 };
}

const songCache = new Map<string, Song>();

export function getSong(ref: TrackRef): Song {
  let song = songCache.get(ref.key);
  if (!song) {
    song = buildSong(SONG_SPECS[ref.id], ref.transpose);
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

/**
 * Render a song one ZzFXM channel per step. Yields after each channel; the generator's return
 * value is the finished, normalised stereo PCM. Channels are independent in ZzFXM, so the sum of
 * per-channel renders equals a full render.
 */
export function* renderSongSteps(song: Song, sampleRate = SAMPLE_RATE): Generator<void, Pcm, void> {
  const length = zzfxmSongLength(song.patterns, song.sequence, song.bpm, sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const channels = song.patterns[0]!.length;
  for (let c = 0; c < channels; c++) {
    const patterns = song.patterns.map((p) => [p[c]!]);
    const [l, r] = zzfxM(song.instruments, patterns, song.sequence, song.bpm, sampleRate);
    for (let i = 0; i < length; i++) {
      left[i]! += l[i]!;
      right[i]! += r[i]!;
    }
    yield;
  }
  const { peak, rms } = levels([left, right]);
  const gain = peak > 0 ? Math.min(PEAK_CEILING / peak, TARGET_RMS / rms) : 1;
  for (let i = 0; i < length; i++) {
    left[i]! *= gain;
    right[i]! *= gain;
  }
  return { sampleRate, channels: [left, right] };
}

/** Render a song synchronously (tests and tools). */
export function renderSong(song: Song, sampleRate = SAMPLE_RATE): Pcm {
  const it = renderSongSteps(song, sampleRate);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}
