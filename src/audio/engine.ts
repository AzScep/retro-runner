/**
 * Web Audio engine: one lazily created AudioContext and a fixed graph
 *
 *   music tracks -> trackGain -> duck -> music bus -\
 *   sfx sources ------------------------> sfx bus --+-> master (volume x mute) -> limiter -> out
 *   crowd loop -> low-pass -> crowdGain -> sfx bus -/
 *
 * Nothing touches Web Audio at import time. Before unlockAudio() (or without Web Audio at all) every
 * call only records state: volume, mute, duck, the wanted track and crowd intensity are applied when
 * the context appears, so UI can call playMusic('title') at boot and hear it on the first key press.
 */

import type { MusicId, Pcm, SfxId } from './types.ts';
import { SFX_IDS } from './types.ts';
import { renderSfx, SFX } from './sfx.ts';
import { renderCrowdLoop } from './crowd.ts';
import { SAMPLE_RATE } from './synth.ts';
import { resolveTrack, type TrackRef } from './music/index.ts';
import { renderTrack } from './renderer.ts';

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
const VOLUME_RAMP = 0.04;
const CROWD_RAMP = 0.25;
const CROWD_STOP = 0.4;

/** Most rendered songs kept in memory (each 10-21 MB of stereo float). */
const MAX_TRACKS = 4;
/** Hard cap on simultaneous SFX voices. */
const MAX_SFX_VOICES = 24;

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
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

interface Crowd {
  readonly source: AudioBufferSourceNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
}

interface TrackEntry {
  pcm: Pcm | null;
  buffer: AudioBuffer | null;
}

// State that exists without a context ---------------------------------------------------------
let volume = 8;
let muted = false;
let ducked = false;
let wanted: TrackRef | null = null;
let crowdIntensity = 0;

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

/** Render all SFX plus the title, ladder and tier-1 race songs. Never rejects. */
export function preloadAudio(): Promise<void> {
  preloading ??= (async () => {
    try {
      for (const id of SFX_IDS) {
        if (!sfxPcm.has(id)) sfxPcm.set(id, renderSfx(id));
        if (graph) sfxBuffer(id);
      }
      crowdPcm ??= renderCrowdLoop();
      for (const ref of [resolveTrack('title'), resolveTrack('ladder'), resolveTrack('race', 1)]) {
        await ensureTrack(ref);
      }
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
  for (const key of tracks.keys()) {
    if (tracks.size <= MAX_TRACKS) return;
    if (key === playing?.key || key === wanted?.key) continue;
    tracks.delete(key);
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
        tracks.set(ref.key, { pcm, buffer: null });
        evict();
      })
      .finally(() => pending.delete(ref.key));
    pending.set(ref.key, p);
  }
  return p;
}

function trackBuffer(key: string): AudioBuffer | null {
  const entry = tracks.get(key);
  if (!entry || !graph) return null;
  if (!entry.buffer && entry.pcm) {
    entry.buffer = toBuffer(graph.ctx, entry.pcm.channels, entry.pcm.sampleRate);
    entry.pcm = null; // keep one copy only
  }
  touch(key, entry);
  return entry.buffer;
}

// ---------------------------------------------------------------------------------------------
// Music

export function playMusic(id: MusicId | null, tier?: number): void {
  const ref = id ? resolveTrack(id, tier) : null;
  if (ref?.key === wanted?.key) return;
  wanted = ref;
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
  const buffer = trackBuffer(ref.key);
  if (!buffer) {
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
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain).connect(duck);
  source.start(t);
  playing = { key: ref.key, source, gain };
}

function fadeOutPlaying(): void {
  if (!graph || !playing) return;
  const { source, gain } = playing;
  const t = graph.ctx.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(gain.gain.value, t);
  gain.gain.linearRampToValueAtTime(0, t + XFADE_OUT);
  source.stop(t + XFADE_OUT + 0.05);
  source.onended = () => gain.disconnect();
  playing = null;
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

export function playSfx(id: SfxId): void {
  try {
    if (!graph || graph.ctx.state !== 'running') return;
    const def = SFX[id];
    if (!def) return;
    const { ctx, sfx } = graph;
    const now = ctx.currentTime;
    if (def.minInterval) {
      const group = def.group ?? id;
      const last = lastPlayed.get(group);
      if (last !== undefined && now - last < def.minInterval - 1e-4) return;
      lastPlayed.set(group, now);
    }
    if (sfxVoices >= MAX_SFX_VOICES) return;
    const buffer = sfxBuffer(id);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    if (def.jitter) source.playbackRate.value = 1 + def.jitter * (Math.random() * 2 - 1);
    source.connect(sfx);
    sfxVoices++;
    source.onended = () => {
      sfxVoices--;
      source.disconnect();
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
  readonly cachedTracks: readonly string[];
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
    cachedTracks: [...tracks.keys()],
  };
}
