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

export function playSfx(id: SfxId): void {
  engine.playSfx(id);
}

/** Crossfade to a track (null = stop). `tier` 1-7 selects the race transposition. */
export function playMusic(id: MusicId | null, tier?: number): void {
  engine.playMusic(id, tier);
}

/** Duck music to 40% (countdown, result jingles) or restore. */
export function duckMusic(ducked: boolean): void {
  engine.duckMusic(ducked);
}

/** Crowd noise loop during races; intensity 0-1 (rises in the last 20 m). 0 stops it. */
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
 */
export function prepareMusic(id: MusicId, tier?: number): Promise<void> {
  return engine.prepareMusic(id, tier);
}
