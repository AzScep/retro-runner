/**
 * The dash HUD rules, ported from the game's HudScene and src/ui (which the landing page may not
 * import): the MASH!/ALTERNATE! prompt, the held live place, the starter's calls and the stage fit.
 * Pure.
 */
import { TUNING, type CountdownBeat, type RacePhase, type RaceState } from '../../core/index.ts';

/** src/ui/hudMath.ts MASH_IDLE_MS: MASH! after this long without a valid step. */
export const MASH_IDLE_MS = 500;
/** src/ui/hudMath.ts ALTERNATE_AFTER_FUMBLES: same-side presses since the last step for ALTERNATE!. */
export const ALTERNATE_AFTER_FUMBLES = 2;
/** MASH! pulses at 2 Hz (design 6.4, inside the 3 Hz limit); static under reduced motion. */
export const MASH_HZ = 2;

export type Prompt = 'mash' | 'alternate' | null;

export interface PromptFacts {
  /** After GO and before the player crosses. */
  readonly running: boolean;
  readonly idleMs: number;
  readonly fumblesSinceStep: number;
  readonly reducedMotion: boolean;
}

/** The key prompt (src/ui/hudMath.ts keyPrompt): ALTERNATE! wins over MASH!, which pulses. */
export function promptFor(f: PromptFacts): Prompt {
  if (!f.running) return null;
  if (f.fumblesSinceStep >= ALTERNATE_AFTER_FUMBLES) return 'alternate';
  if (f.idleMs < MASH_IDLE_MS) return null;
  if (f.reducedMotion) return 'mash';
  const periodMs = 1000 / MASH_HZ;
  return (f.idleMs - MASH_IDLE_MS) % periodMs < periodMs / 2 ? 'mash' : null;
}

/** Running and not yet across the line (the prompt and the pads only matter then). */
export function isRunning(s: RaceState): boolean {
  return s.phase === 'running' && s.player.finishMs === null;
}

/** The starter's bubble (src/ui/screenText.ts starterBubble): MARKS at 3 and 2, SET at 1. */
export function starterCall(phase: RacePhase, beat: CountdownBeat): 'marks' | 'set' | null {
  if (phase !== 'countdown') return null;
  if (beat === 3 || beat === 2) return 'marks';
  if (beat === 1) return 'set';
  return null;
}

/** Ordinal place label: 1 -> 1ST, 2 -> 2ND, 3 -> 3RD, 4-6 -> 4TH..6TH. */
export function ordinal(place: number): string {
  const suffix = place === 1 ? 'ST' : place === 2 ? 'ND' : place === 3 ? 'RD' : 'TH';
  return `${place}${suffix}`;
}

/**
 * Live place as the HUD shows it (design 27.2, src/ui/hudMath.ts PlaceHold): a new place must hold
 * TUNING.POSITION_HOLD_MS before it shows, the first one shows at once, and the crossing freezes it.
 */
export class PlaceHold {
  #shown: number | null = null;
  #pending: number | null = null;
  #since = 0;
  #frozen = false;

  update(raw: number | null, nowMs: number, crossed: boolean): number | null {
    if (this.#frozen) return this.#shown;
    if (raw === null) {
      this.#shown = null;
      this.#pending = null;
      return null;
    }
    if (crossed) {
      this.#frozen = true;
      this.#shown = raw;
      return raw;
    }
    if (this.#shown === null || raw === this.#shown) {
      this.#shown = raw;
      this.#pending = null;
      return raw;
    }
    if (raw !== this.#pending) {
      this.#pending = raw;
      this.#since = nowMs;
    }
    if (nowMs - this.#since >= TUNING.POSITION_HOLD_MS) {
      this.#shown = raw;
      this.#pending = null;
    }
    return this.#shown;
  }
}

/** The game's view: 320 x 180 art px. */
export const VIEW_W = 320;
export const VIEW_H = 180;
/**
 * Narrowest crop of the view (the player sits at x 96, so 144 px of track ahead). A phone gets
 * bigger whole-pixel sprites from a cropped strip than from the full width at a smaller scale.
 */
export const MIN_VIEW_W = 240;

export interface StageFit {
  /** Device px per art px (a whole number, so pixels stay square and crisp). */
  readonly scale: number;
  /** Visible art width, MIN_VIEW_W to VIEW_W. */
  readonly viewW: number;
  /** CSS size of the canvas and CSS px per art px. */
  readonly cssW: number;
  readonly cssH: number;
  readonly cssPx: number;
}

/**
 * The largest whole device-pixel scale whose view is at least MIN_VIEW_W wide in `widthCss` and at
 * most `maxHeightCss` tall, then as much of the 320 px view as fits at that scale.
 */
export function fitStage(widthCss: number, maxHeightCss: number, dpr: number): StageFit {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const wDev = Math.max(1, Math.floor(widthCss * ratio));
  const hDev = Math.max(1, Math.floor(maxHeightCss * ratio));
  const scale = Math.max(1, Math.min(Math.floor(wDev / MIN_VIEW_W), Math.floor(hDev / VIEW_H)));
  const viewW = Math.max(1, Math.min(VIEW_W, Math.floor(wDev / scale)));
  return {
    scale,
    viewW,
    cssW: (viewW * scale) / ratio,
    cssH: (VIEW_H * scale) / ratio,
    cssPx: scale / ratio,
  };
}
