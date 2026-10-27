/**
 * Public API of the audio layer (owner: AUDIO).
 *
 * Engine-free Web Audio: one AudioContext, music and SFX gain buses, ZzFX sounds and ZzFXM songs
 * vendored under ./vendor (research 5). Every function is safe to call before unlock and in
 * environments without Web Audio (it silently does nothing).
 * Signatures here are the cross-team contract. Spec: docs/design.md section 7.
 *
 * State set before unlock (volume, mute, duck, wanted music, crowd) is remembered and applied when
 * unlockAudio() creates the context, so playMusic('title') at boot starts on the first key press.
 */

import * as engine from './engine.ts';
import type { MusicId, SfxId } from './types.ts';

export type { MusicId, SfxId } from './types.ts';

/** Create/resume the AudioContext. Call from the first user key press (autoplay policy). */
export function unlockAudio(): void {
  engine.unlockAudio();
}

/** Render songs to buffers ahead of time so the first playMusic() has no hitch. Resolves when done. */
export function preloadAudio(): Promise<void> {
  return engine.preloadAudio();
}

/**
 * Play a sound effect. `volume` 0-1 scales this play (rival takeoffs play `jump` at 0.5).
 * `field: true` marks a field runner's sound (v3, design 36.1): every field play shares one limit
 * of one per 100 ms, on top of `volume` (UI plays field hurdle_clip / hurdle_hit at 0.25).
 */
export function playSfx(id: SfxId, opts?: { readonly volume?: number; readonly field?: boolean }): void {
  engine.playSfx(id, opts);
}

/**
 * Crossfade to a track (null = stop). `tier` 1-7: `race` and `hurdles` transpose per tier 1-6,
 * `quarter` is one track for tiers 1-6, and tier 7 (Zyx) plays `boss` for all three.
 * `gauntlet` is one track for tiers 1-6 (any tier, or none, gives the same track) and `boss` at
 * tier 7. Asking for the track that is already wanted is a no-op: it keeps playing from where it
 * is, so playMusic('gauntlet') before every Gauntlet race and card never restarts it.
 * Starting a different track resets the quarter final-100 flag.
 */
export function playMusic(id: MusicId | null, tier?: number): void {
  engine.playMusic(id, tier);
}

/**
 * Additive (v3): stop music dead, without playMusic(null)'s 0.6 s fade (reveal step 3, design
 * 30.2, together with playSfx('reveal_sting_1')). Same state as playMusic(null) afterwards.
 */
export function cutMusic(): void {
  engine.cutMusic();
}

/**
 * 400 m: crossfade the quarter track to its "final 100" render over 1 s (design 20.2), keeping
 * the loop position. false fades back to the base render. Safe without a context or track.
 */
export function setQuarterFinal(final: boolean): void {
  engine.setQuarterFinal(final);
}

/** Duck music to 40% (countdown, result jingles) or restore. */
export function duckMusic(ducked: boolean): void {
  engine.duckMusic(ducked);
}

/**
 * Crowd noise loop during races; intensity 0-1 (rises over the last 20 m in the 100 m and
 * hurdles, over the last 100 m in the 400 m). 0 stops it.
 */
export function setCrowd(intensity: number): void {
  engine.setCrowd(intensity);
}

/** 0-10, design 4.3 settings.volume. */
export function setVolume(volume: number): void {
  engine.setVolume(volume);
}

export function setMuted(muted: boolean): void {
  engine.setMuted(muted);
}

/**
 * Optional (additive to the contract): render a track in the background before it is needed,
 * e.g. `prepareMusic('race', tier)` when the ladder screen opens. Never rejects.
 * `prepareMusic('quarter')` warms both quarter renders (~45 MB) in one worker job.
 */
export function prepareMusic(id: MusicId, tier?: number): Promise<void> {
  return engine.prepareMusic(id, tier);
}
