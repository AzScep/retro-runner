/**
 * Web Audio engine: one lazily created AudioContext and a fixed graph
 *
 *   music tracks -> [mix gain] -> trackGain -> duck -> music bus -\
 *   sfx sources ------------------------> sfx bus --+-> master (volume x mute) -> limiter -> out
 *   crowd loop -> low-pass -> crowdGain -> sfx bus -/
 *
 * Nothing touches Web Audio at import time. Before unlockAudio() (or without Web Audio at all) every
 * call only records state: volume, mute, duck, the wanted track and crowd intensity are applied when
 * the context appears, so UI can call playMusic('title') at boot and hear it on the first key press.
 *
 * Tracks with a final-100 render (quarter) play as two sample-locked looping sources started at the
 * same instant, each through its own mix gain; setQuarterFinal() crossfades the mix gains, so the
 * loop position never jumps.
 */

import type { MusicId, Pcm, SfxId } from './types.ts';
import { SFX_IDS } from './types.ts';
import { LATE_SFX, renderSfx, SFX } from './sfx.ts';
import { renderCrowdLoop } from './crowd.ts';
import { SAMPLE_RATE } from './synth.ts';
import { resolveTrack, type TrackRef } from './music/index.ts';
import { renderSfxBank, renderTrack } from './renderer.ts';

// Mix levels (linear gain) ---------------------------------------------------------------------
const MUSIC_LEVEL = 0.5;
const SFX_LEVEL = 0.85;
const CROWD_LEVEL = 0.32;
export const DUCK_LEVEL = 0.4;

// Ramp times (s) -------------------------------------------------------------------------------
const DUCK_IN = 0.08;
const DUCK_OUT = 0.3;
const XFADE_OUT = 0.6;
const XFADE_IN = 0.4;
const FIRST_FADE_IN = 0.02;
/** cutMusic(): fast enough to read as a dead stop, long enough not to click. */
const MUSIC_CUT = 0.012;
const VOLUME_RAMP = 0.04;
const CROWD_RAMP = 0.25;
const CROWD_STOP = 0.4;
/** Quarter track base <-> final-100 crossfade (design 20.2). */
export const QUARTER_XFADE = 1;

/**
 * Memory budget for rendered songs (stereo float32: 10 MB for a 30 s race theme, 21 MB for the
 * champion, 45 MB for the quarter pair). The playing and wanted tracks are never evicted.
 */
const MAX_TRACK_BYTES = 96 * 1024 * 1024;
/** Hard cap on simultaneous SFX voices. */
const MAX_SFX_VOICES = 24;
/** Field runner SFX (design 36.1): at most one per this many seconds, across every field lane. */
export const FIELD_SFX_INTERVAL = 0.1;
const FIELD_GROUP = '#field';

/** 0-10 slider -> linear gain. Squared curve: 5 is -12 dB, 8 is -3.9 dB, 0 is silence. */
export function volumeToGain(volume: number): number {
  const v = Math.min(10, Math.max(0, volume)) / 10;
  return v * v;
}

/** Crowd intensity 0-1 -> low-pass cutoff in Hz (darker murmur to bright roar). */
export function crowdCutoff(intensity: number): number {
  return 500 + 3500 * intensity ** 1.5;
}

interface Graph {
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly music: GainNode;
  readonly duck: GainNode;
  readonly sfx: GainNode;
}

interface Playing {
  readonly key: string;
  readonly sources: readonly AudioBufferSourceNode[];
  readonly gain: GainNode;
  /** Base and final-100 mix gains (quarter only). */
  readonly mix: { readonly base: GainNode; readonly final: GainNode } | null;
}

interface Crowd {
  readonly source: AudioBufferSourceNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
}

interface TrackEntry {
  pcm: Pcm | null;
  buffer: AudioBuffer | null;
  final: AudioBuffer | null;
  readonly bytes: number;
}

function pcmBytes(pcm: Pcm): number {
  const n = pcm.channels.length + (pcm.final?.length ?? 0);
  return n * pcm.channels[0]!.length * 4;
}

// State that exists without a context ---------------------------------------------------------
let volume = 8;
let muted = false;
let ducked = false;
let wanted: TrackRef | null = null;
let crowdIntensity = 0;
let quarterFinal = false;

// Context-bound state ---------------------------------------------------------------------------
let graph: Graph | null = null;
let playing: Playing | null = null;
let crowd: Crowd | null = null;
let suspendedForHidden = false;
let sfxVoices = 0;
const lastPlayed = new Map<string, number>();

// Rendered audio caches ------------------------------------------------------------------------
const tracks = new Map<string, TrackEntry>(); // insertion order = LRU order
const pending = new Map<string, Promise<void>>();
const sfxPcm = new Map<SfxId, Float32Array>();
const sfxBuffers = new Map<SfxId, AudioBuffer>();
let crowdPcm: Float32Array | null = null;
let crowdBuffer: AudioBuffer | null = null;
let preloading: Promise<void> | null = null;

function contextCtor(): typeof AudioContext | undefined {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return g.AudioContext ?? g.webkitAudioContext;
}

function ramp(param: AudioParam, target: number, seconds: number): void {
  if (!graph) return;
  const t = graph.ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(target, t + seconds);
}

function masterTarget(): number {
  return muted ? 0 : volumeToGain(volume);
}

function toBuffer(ctx: AudioContext, channels: readonly Float32Array[], sampleRate: number): AudioBuffer {
  const buf = ctx.createBuffer(channels.length, channels[0]!.length, sampleRate);
  channels.forEach((c, i) => buf.getChannelData(i).set(c));
  return buf;
}

// ---------------------------------------------------------------------------------------------
// Unlock

export function unlockAudio(): void {
  try {
    if (!graph) {
      const Ctor = contextCtor();
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      const master = ctx.createGain();
      master.gain.value = masterTarget();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      master.connect(limiter).connect(ctx.destination);
      const music = ctx.createGain();
      music.gain.value = MUSIC_LEVEL;
      const duck = ctx.createGain();
      duck.gain.value = ducked ? DUCK_LEVEL : 1;
      duck.connect(music).connect(master);
      const sfx = ctx.createGain();
      sfx.gain.value = SFX_LEVEL;
      sfx.connect(master);
      graph = { ctx, master, music, duck, sfx };
      watchVisibility();
      for (const id of sfxPcm.keys()) sfxBuffer(id);
    }
    if (graph.ctx.state === 'suspended') {
      suspendedForHidden = false;
      void graph.ctx.resume().catch(() => {});
    }
    applyMusic();
    applyCrowd();
  } catch {
    // Web Audio refused (policy, broken implementation): stay silent.
  }
}

function watchVisibility(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (!graph) return;
    if (document.hidden && graph.ctx.state === 'running') {
      suspendedForHidden = true;
      void graph.ctx.suspend().catch(() => {});
    } else if (!document.hidden && suspendedForHidden) {
      suspendedForHidden = false;
      void graph.ctx.resume().catch(() => {});
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Preload

async function loadSfx(name: string, ids: readonly SfxId[], crowd: boolean): Promise<void> {
  const bank = await renderSfxBank(name, ids, crowd);
  for (const id of ids) {
    const pcm = bank.sfx.get(id);
    if (pcm && !sfxPcm.has(id)) sfxPcm.set(id, pcm);
    if (graph) sfxBuffer(id);
  }
  crowdPcm ??= bank.crowd;
}

/**
 * Render all SFX plus the title, ladder and tier-1 race songs, off the main thread when a worker
 * is available, in the order they are first needed: menu SFX and the crowd, the title song, the
 * race / reveal / Gauntlet SFX (LATE_SFX), then the ladder and race songs. Never rejects.
 */
export function preloadAudio(): Promise<void> {
  preloading ??= (async () => {
    try {
      await loadSfx(
        'boot',
        SFX_IDS.filter((id) => !LATE_SFX.has(id)),
        true,
      );
      await ensureTrack(resolveTrack('title'));
      await loadSfx('late', [...LATE_SFX], false);
      for (const ref of [resolveTrack('ladder'), resolveTrack('race', 1)]) await ensureTrack(ref);
    } catch {
      // Rendering failures leave the game silent rather than broken.
    }
  })();
  return preloading;
}

/** Render a track ahead of time (e.g. the next race tier on the ladder screen). Never rejects. */
export function prepareMusic(id: MusicId, tier?: number): Promise<void> {
  return ensureTrack(resolveTrack(id, tier)).catch(() => {});
}

function touch(key: string, entry: TrackEntry): void {
  tracks.delete(key);
  tracks.set(key, entry);
}

function evict(): void {
  let bytes = 0;
  for (const e of tracks.values()) bytes += e.bytes;
  for (const [key, e] of tracks) {
    if (bytes <= MAX_TRACK_BYTES) return;
    if (key === playing?.key || key === wanted?.key) continue;
    tracks.delete(key);
    bytes -= e.bytes;
  }
}

function ensureTrack(ref: TrackRef): Promise<void> {
  const have = tracks.get(ref.key);
  if (have) {
    touch(ref.key, have);
    return Promise.resolve();
  }
  let p = pending.get(ref.key);
  if (!p) {
    p = renderTrack(ref)
      .then((pcm) => {
        tracks.set(ref.key, { pcm, buffer: null, final: null, bytes: pcmBytes(pcm) });
        evict();
      })
      .finally(() => pending.delete(ref.key));
    pending.set(ref.key, p);
  }
  return p;
}

function trackBuffers(
  key: string,
): { readonly main: AudioBuffer; readonly final: AudioBuffer | null } | null {
  const entry = tracks.get(key);
  if (!entry || !graph) return null;
  if (!entry.buffer && entry.pcm) {
    const { channels, final, sampleRate } = entry.pcm;
    entry.buffer = toBuffer(graph.ctx, channels, sampleRate);
    entry.final = final ? toBuffer(graph.ctx, final, sampleRate) : null;
    entry.pcm = null; // keep one copy only
  }
  touch(key, entry);
  return entry.buffer ? { main: entry.buffer, final: entry.final } : null;
}

// ---------------------------------------------------------------------------------------------
// Music

export function playMusic(id: MusicId | null, tier?: number): void {
  const ref = id ? resolveTrack(id, tier) : null;
  if (ref?.key === wanted?.key) return;
  wanted = ref;
  quarterFinal = false; // a newly started track always begins on its base mix
  try {
    applyMusic();
  } catch {
    // ignore
  }
}

function applyMusic(): void {
  if (!graph) return;
  const ref = wanted;
  if (!ref) {
    fadeOutPlaying();
    return;
  }
  if (playing?.key === ref.key) return;
  const buffers = trackBuffers(ref.key);
  if (!buffers) {
    ensureTrack(ref).then(
      () => {
        if (wanted?.key === ref.key) applyMusic();
      },
      () => {},
    );
    return;
  }
  const { ctx, duck } = graph;
  const hadPrevious = playing !== null;
  fadeOutPlaying();
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(1, t + (hadPrevious ? XFADE_IN : FIRST_FADE_IN));
  gain.connect(duck);
  const loopSource = (buffer: AudioBuffer, into: AudioNode) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(into);
    return source;
  };
  let sources: AudioBufferSourceNode[];
  let mix: Playing['mix'] = null;
  if (buffers.final) {
    const base = ctx.createGain();
    const final = ctx.createGain();
    base.gain.value = quarterFinal ? 0 : 1;
    final.gain.value = quarterFinal ? 1 : 0;
    base.connect(gain);
    final.connect(gain);
    sources = [loopSource(buffers.main, base), loopSource(buffers.final, final)];
    mix = { base, final };
  } else {
    sources = [loopSource(buffers.main, gain)];
  }
  // Same start time and same length: the two quarter loops stay sample-locked forever.
  for (const s of sources) s.start(t);
  playing = { key: ref.key, sources, gain, mix };
}

function fadeOutPlaying(seconds = XFADE_OUT): void {
  if (!graph || !playing) return;
  const { sources, gain } = playing;
  const t = graph.ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + seconds);
  for (const s of sources) s.stop(t + seconds + 0.05);
  sources[0]!.onended = () => gain.disconnect();
  playing = null;
}

/** Stop music dead (reveal step 3, design 30.2): a click-free MUSIC_CUT ramp instead of the fade. */
export function cutMusic(): void {
  wanted = null;
  quarterFinal = false;
  try {
    fadeOutPlaying(MUSIC_CUT);
  } catch {
    // ignore
  }
}

/**
 * Crossfade the playing quarter track to its final-100 render (or back) over QUARTER_XFADE.
 * Linear ramps are exact here: final = base + extra with one shared gain, so the blend is
 * base + k * extra at every instant. Remembered until the next track change; harmless otherwise.
 */
export function setQuarterFinal(final: boolean): void {
  if (final === quarterFinal) return;
  quarterFinal = final;
  try {
    if (!graph || !playing?.mix) return;
    ramp(playing.mix.base.gain, final ? 0 : 1, QUARTER_XFADE);
    ramp(playing.mix.final.gain, final ? 1 : 0, QUARTER_XFADE);
  } catch {
    // ignore
  }
}

export function duckMusic(isDucked: boolean): void {
  ducked = isDucked;
  if (graph) ramp(graph.duck.gain, ducked ? DUCK_LEVEL : 1, ducked ? DUCK_IN : DUCK_OUT);
}

// ---------------------------------------------------------------------------------------------
// SFX

function sfxBuffer(id: SfxId): AudioBuffer | null {
  if (!graph) return null;
  let buf = sfxBuffers.get(id);
  if (!buf) {
    let pcm = sfxPcm.get(id);
    if (!pcm) {
      pcm = renderSfx(id);
      sfxPcm.set(id, pcm);
    }
    buf = toBuffer(graph.ctx, [pcm], SAMPLE_RATE);
    sfxBuffers.set(id, buf);
  }
  return buf;
}

export interface SfxOptions {
  /** Linear gain 0-1 for this play (default 1); rival takeoffs use 0.5. */
  readonly volume?: number;
  /**
   * A field runner's sound (lanes 2-5, design 36.1): all field plays share one limit of one per
   * FIELD_SFX_INTERVAL, separate from the player's and rival's limits so a field burst never
   * swallows theirs. `volume` still applies (UI passes 0.25).
   */
  readonly field?: boolean;
}

export function playSfx(id: SfxId, opts?: SfxOptions): void {
  try {
    const vol = opts?.volume ?? 1;
    if (!Number.isFinite(vol) || vol <= 0) return;
    if (!graph || graph.ctx.state !== 'running') return;
    const def = SFX[id];
    if (!def) return;
    const { ctx, sfx } = graph;
    const now = ctx.currentTime;
    const limit = opts?.field ? FIELD_SFX_INTERVAL : def.minInterval;
    if (limit) {
      // Plays at different volumes are rate-limited separately: a half-volume rival jump never
      // swallows the player's own jump in the same frame. Field plays share one group of their own.
      const group = opts?.field ? FIELD_GROUP : `${def.group ?? id}@${vol < 1 ? 'soft' : 'full'}`;
      const last = lastPlayed.get(group);
      if (last !== undefined && now - last < limit - 1e-4) return;
      lastPlayed.set(group, now);
    }
    if (sfxVoices >= MAX_SFX_VOICES) return;
    const buffer = sfxBuffer(id);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (def.jitter) source.playbackRate.value = 1 + def.jitter * (Math.random() * 2 - 1);
    let out: AudioNode = source;
    if (vol < 1) {
      const g = ctx.createGain();
      g.gain.value = vol;
      out = source.connect(g);
    }
    out.connect(sfx);
    sfxVoices++;
    source.onended = () => {
      sfxVoices--;
      source.disconnect();
      if (out !== source) out.disconnect();
    };
    source.start(now);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------------------------
// Crowd

export function setCrowd(intensity: number): void {
  if (!Number.isFinite(intensity)) return;
  crowdIntensity = Math.min(1, Math.max(0, intensity));
  try {
    applyCrowd();
  } catch {
    // ignore
  }
}

function applyCrowd(): void {
  if (!graph) return;
  const { ctx, sfx } = graph;
  if (crowdIntensity <= 0) {
    if (crowd) {
      const c = crowd;
      ramp(c.gain.gain, 0, CROWD_STOP);
      c.source.stop(ctx.currentTime + CROWD_STOP + 0.05);
      c.source.onended = () => c.gain.disconnect();
      crowd = null;
    }
    return;
  }
  if (!crowd) {
    crowdPcm ??= renderCrowdLoop();
    crowdBuffer ??= toBuffer(ctx, [crowdPcm], SAMPLE_RATE);
    const source = ctx.createBufferSource();
    source.buffer = crowdBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.value = crowdCutoff(crowdIntensity);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(sfx);
    source.start(ctx.currentTime, Math.random() * (crowdBuffer.duration - 0.01));
    crowd = { source, filter, gain };
  }
  ramp(crowd.gain.gain, CROWD_LEVEL * crowdIntensity, CROWD_RAMP);
  ramp(crowd.filter.frequency, crowdCutoff(crowdIntensity), CROWD_RAMP);
}

// ---------------------------------------------------------------------------------------------
// Volume and mute

export function setVolume(v: number): void {
  if (!Number.isFinite(v)) return;
  volume = Math.min(10, Math.max(0, v));
  if (graph) ramp(graph.master.gain, masterTarget(), VOLUME_RAMP);
}

export function setMuted(m: boolean): void {
  muted = m;
  if (graph) ramp(graph.master.gain, masterTarget(), VOLUME_RAMP);
}

/** Read-only snapshot for debugging and tests. */
export function audioState(): {
  readonly unlocked: boolean;
  readonly context: AudioContextState | 'none';
  readonly volume: number;
  readonly muted: boolean;
  readonly ducked: boolean;
  readonly music: string | null;
  readonly playing: string | null;
  readonly crowd: number;
  readonly quarterFinal: boolean;
  readonly cachedTracks: readonly string[];
  readonly cachedBytes: number;
} {
  return {
    unlocked: graph !== null,
    context: graph?.ctx.state ?? 'none',
    volume,
    muted,
    ducked,
    music: wanted?.key ?? null,
    playing: playing?.key ?? null,
    crowd: crowdIntensity,
    quarterFinal,
    cachedTracks: [...tracks.keys()],
    cachedBytes: [...tracks.values()].reduce((a, e) => a + e.bytes, 0),
  };
}
