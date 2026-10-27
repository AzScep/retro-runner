/**
 * Listening and verification tool for the audio layer.
 *
 *   node tools/audio/render.ts            # render everything to tools/audio/out/*.wav and check it
 *   node tools/audio/render.ts --no-wav   # checks only
 *
 * Renders every SFX (v3 included), every song (race and hurdles tiers 1-6, boss, the quarter
 * track's base and final-100 renders, the v3 gauntlet loop) and the crowd loop with the same pure modules the game uses, prints duration /
 * peak / RMS, render time and memory, and fails (exit 1) on clipping, silence, wrong lengths,
 * clicky loop/edge boundaries or a final-100 render that differs in length from its base.
 * Imports only Web-Audio-free modules.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSfx, SFX } from '../../src/audio/sfx.ts';
import { levels, SAMPLE_RATE } from '../../src/audio/synth.ts';
import { renderCrowdLoop } from '../../src/audio/crowd.ts';
import { getSong, renderSongSteps, resolveTrack, type TrackRef } from '../../src/audio/music/index.ts';
import { SFX_IDS, type MusicId, type SfxId } from '../../src/audio/types.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const writeWav = !process.argv.includes('--no-wav');

/** Design 7.1 loop lengths in seconds (min, max). Shorter-but-clean is allowed for race/boss. */
const SONG_RANGE: Record<MusicId, readonly [number, number]> = {
  title: [45, 60],
  ladder: [30, 45],
  race: [23, 33],
  boss: [23, 35],
  champion: [55, 65],
  hurdles: [27, 33],
  quarter: [64, 64],
  gauntlet: [44.99, 45], // 30 bars at 160 BPM; ZzFXM's whole-sample rows make it 44.996 s
};

function wav(path: string, channels: readonly Float32Array[], sampleRate: number): void {
  const n = channels[0]!.length;
  const c = channels.length;
  const data = Buffer.alloc(44 + n * c * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * c * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(c, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * c * 2, 28);
  data.writeUInt16LE(c * 2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * c * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < c; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch]![i]!));
      data.writeInt16LE(Math.round(s * 32767), o);
      o += 2;
    }
  }
  writeFileSync(path, data);
}

/** Largest jump across the loop seam (last -> first sample) over all channels. */
function seamJump(channels: readonly Float32Array[]): number {
  return Math.max(...channels.map((ch) => Math.abs(ch[0]! - ch[ch.length - 1]!)));
}

/** 99.9th percentile of sample-to-sample deltas inside the file: what "normal motion" looks like. */
function typicalDelta(channels: readonly Float32Array[]): number {
  const d: number[] = [];
  for (const ch of channels) for (let i = 1; i < ch.length; i += 7) d.push(Math.abs(ch[i]! - ch[i - 1]!));
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length * 0.999)] ?? 0;
}

interface Row {
  name: string;
  seconds: number;
  peak: number;
  rms: number;
  edge: string;
  ok: boolean;
  why: string[];
}
const rows: Row[] = [];

function check(
  name: string,
  channels: readonly Float32Array[],
  expected: readonly [number, number],
  loop: boolean,
): void {
  const seconds = channels[0]!.length / SAMPLE_RATE;
  const { peak, rms } = levels(channels);
  const why: string[] = [];
  if (peak >= 1) why.push('clipping');
  if (rms < 0.005) why.push('silent');
  if (seconds < expected[0] - 1e-3 || seconds > expected[1] + 1e-3) {
    why.push(`length ${seconds.toFixed(3)} s not in ${expected[0]}-${expected[1]} s`);
  }
  let edge: string;
  if (loop) {
    const jump = seamJump(channels);
    const typical = typicalDelta(channels);
    edge = `seam ${jump.toFixed(4)} (p99.9 step ${typical.toFixed(4)})`;
    if (jump > Math.max(0.02, typical)) why.push('loop seam click');
  } else {
    const first = Math.max(...channels.map((c) => Math.abs(c[0]!)));
    const last = Math.max(...channels.map((c) => Math.abs(c[c.length - 1]!)));
    edge = `first ${first.toFixed(4)} last ${last.toFixed(4)}`;
    if (first > 0.01 || last > 0.01) why.push('edge click');
  }
  if (writeWav) wav(join(OUT, `${name}.wav`), channels, SAMPLE_RATE);
  rows.push({ name, seconds, peak, rms, edge, ok: why.length === 0, why });
}

if (writeWav) mkdirSync(OUT, { recursive: true });

/** Design 36.1 lengths of the v3 SFX: the definitions must match the spec, not just themselves. */
const V3_SFX_LENGTH: Partial<Record<SfxId, number>> = {
  pistol: 0.25,
  trip_thud: 0.3,
  reveal_sting_1: 0.6,
  reveal_sting_2: 1.5,
  photo_click: 0.12,
  bubble: 0.06,
  gauntlet_clear: 3.0,
};

for (const id of SFX_IDS) {
  const len = V3_SFX_LENGTH[id] ?? SFX[id].length;
  check(`sfx_${id}`, [renderSfx(id)], [len, len], false);
}

check('crowd_loop', [renderCrowdLoop()], [2, 10], true);

const MB = 1024 * 1024;
setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;
const songs: [string, TrackRef, MusicId][] = [
  ['music_title', resolveTrack('title'), 'title'],
  ['music_ladder', resolveTrack('ladder'), 'ladder'],
  ...[1, 2, 3, 4, 5, 6].map((t): [string, TrackRef, MusicId] => [
    `music_race_tier${t}`,
    resolveTrack('race', t),
    'race',
  ]),
  ['music_boss', resolveTrack('race', 7), 'boss'],
  ['music_champion', resolveTrack('champion'), 'champion'],
  ...[1, 2, 3, 4, 5, 6].map((t): [string, TrackRef, MusicId] => [
    `music_hurdles_tier${t}`,
    resolveTrack('hurdles', t),
    'hurdles',
  ]),
  ['music_quarter', resolveTrack('quarter', 3), 'quarter'],
  ['music_gauntlet', resolveTrack('gauntlet', 2), 'gauntlet'],
];
for (const [name, ref, id] of songs) {
  const song = getSong(ref);
  // Render step by step (one ZzFXM channel each, as the worker does) and sample ArrayBuffer memory
  // above a collected baseline after each channel: output PCM plus that channel's instrument
  // sample cache (an estimate of the worker's peak; a GC mid-render can only lower it).
  gc();
  const before = process.memoryUsage().arrayBuffers;
  let peakMem = 0;
  const t0 = performance.now();
  const it = renderSongSteps(song);
  let r = it.next();
  for (; !r.done; r = it.next()) peakMem = Math.max(peakMem, process.memoryUsage().arrayBuffers - before);
  const pcm = r.value;
  const ms = performance.now() - t0;
  const outBytes = [...pcm.channels, ...(pcm.final ?? [])].reduce((a, c) => a + c.byteLength, 0);
  check(name, pcm.channels, SONG_RANGE[id], true);
  rows[rows.length - 1]!.edge +=
    ` render ${ms.toFixed(0)} ms, PCM ${(outBytes / MB).toFixed(1)} MB, peak ${(peakMem / MB).toFixed(1)} MB`;
  if (pcm.final) {
    check(`${name}_final100`, pcm.final, SONG_RANGE[id], true);
    const row = rows[rows.length - 1]!;
    if (pcm.final[0]!.length !== pcm.channels[0]!.length) {
      row.ok = false;
      row.why.push('final-100 length differs from base');
    }
    const lift = levels(pcm.final).rms / levels(pcm.channels).rms;
    row.edge += ` rms lift x${lift.toFixed(2)}`;
    if (lift < 1.05) {
      row.ok = false;
      row.why.push('final-100 adds no energy');
    }
  }
}

const pad = (s: string, n: number) => s.padEnd(n);
console.log(pad('file', 28), pad('dur s', 8), pad('peak', 7), pad('rms', 7), 'boundary');
for (const r of rows) {
  console.log(
    pad(r.name, 28),
    pad(r.seconds.toFixed(3), 8),
    pad(r.peak.toFixed(3), 7),
    pad(r.rms.toFixed(3), 7),
    r.edge,
    r.ok ? '' : `  FAIL: ${r.why.join(', ')}`,
  );
}
const failed = rows.filter((r) => !r.ok);
console.log(writeWav ? `\nWAV files in ${OUT}` : '', `\n${rows.length - failed.length}/${rows.length} ok`);
process.exitCode = failed.length ? 1 : 0;
