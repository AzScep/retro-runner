/**
 * Pure layout and display maths for the race HUD and screens (design 6.2-6.5).
 * No Phaser imports so it runs under Vitest in Node.
 */
import { WORLD } from '../core/index.ts';

// ---------------------------------------------------------------------------
// Palette indices used by the UI (design 5.2). Colours come from art's paletteColor(index).
// ---------------------------------------------------------------------------

export const PAL = {
  ink: 1,
  panel: 2,
  shadowDark: 3,
  darkGrey: 4,
  grey: 5,
  lightGrey: 7,
  white: 8,
  redShadow: 16,
  red: 17,
  redLight: 18,
  gold: 22,
  green: 26,
  navy: 28,
} as const;

// ---------------------------------------------------------------------------
// Speed meter (design 6.2)
// ---------------------------------------------------------------------------

export const SPEED_SEGMENTS = 10;

/** Lit segments = ceil(10 x v / V_MAX), clamped to 0-10. */
export function litSegments(vMps: number): number {
  if (!(vMps > 0)) return 0;
  return Math.min(SPEED_SEGMENTS, Math.ceil((SPEED_SEGMENTS * vMps) / WORLD.V_MAX - 1e-9));
}

/** Palette index of segment `i` (1-based): 1-5 green, 6-8 yellow, 9-10 red. */
export function segmentColorIndex(i: number): number {
  if (i <= 5) return PAL.green;
  if (i <= 8) return PAL.gold;
  return PAL.redLight;
}

// ---------------------------------------------------------------------------
// Progress bar (design 6.2): (40, 24, 240 x 8), 2.4 px per metre.
// ---------------------------------------------------------------------------

export const PROGRESS = { x: 40, y: 24, w: 240, h: 8 } as const;

/** Whole-pixel x of a marker centre on the progress bar for a runner at `xM` metres. */
export function progressMarkerX(xM: number): number {
  const m = Math.min(WORLD.RACE_DISTANCE_M, Math.max(0, xM));
  return PROGRESS.x + Math.round((m * PROGRESS.w) / WORLD.RACE_DISTANCE_M);
}

// ---------------------------------------------------------------------------
// Flashing (design 6.4, 6.5): never faster than 3 Hz, 1 Hz with reduced flashing.
// ---------------------------------------------------------------------------

export const MAX_FLASH_HZ = 3;
export const MAX_FLASH_HZ_REDUCED = 1;

/** Clamp a requested flash rate to the design limits. */
export function flashHz(requestedHz: number, reducedFlashing: boolean): number {
  return Math.min(requestedHz, reducedFlashing ? MAX_FLASH_HZ_REDUCED : MAX_FLASH_HZ);
}

/** On/off state of a square-wave flash at `hz` full cycles per second; on for the first half. */
export function flashOn(elapsedMs: number, hz: number): boolean {
  if (hz <= 0) return true;
  const periodMs = 1000 / hz;
  const phase = ((elapsedMs % periodMs) + periodMs) % periodMs;
  return phase < periodMs / 2;
}

// ---------------------------------------------------------------------------
// Off-screen rival arrow (design 6.2)
// ---------------------------------------------------------------------------

export type OffscreenSide = 'left' | 'right' | null;

export function offscreenSide(rivalScreenX: number, screenWidth: number): OffscreenSide {
  if (rivalScreenX < 0) return 'left';
  if (rivalScreenX >= screenWidth) return 'right';
  return null;
}

/** Gap label, e.g. 4.23 -> "4.2M". */
export function gapLabel(gapM: number): string {
  return `${Math.abs(gapM).toFixed(1)}M`;
}

// ---------------------------------------------------------------------------
// Time text helpers
// ---------------------------------------------------------------------------

/** Pads a formatTime() string to the HUD's SS.hh shape: "5.00" -> "05.00". Leaves "--.--" alone. */
export function padClock(formatted: string): string {
  return formatted.length < 5 ? formatted.padStart(5, '0') : formatted;
}

/** Ladder total as SSS.hh, rounded up to the hundredth like every displayed time (design 4.1, 4.5). */
export function formatLadderTotal(ms: number | null): string {
  if (ms === null) return '---.--';
  const cs = Math.ceil(ms / 10);
  const s = Math.floor(cs / 100);
  return `${String(s).padStart(3, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Integer scaling (design 5.1, research 1)
// ---------------------------------------------------------------------------

export interface ZoomLayout {
  /** Device pixels per game pixel; fractional when the window is not a whole multiple. */
  readonly factor: number;
  /** Phaser zoom to apply (CSS px per game px). */
  readonly zoom: number;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly cssLeft: number;
  readonly cssTop: number;
}

/**
 * Largest size with the game's aspect ratio that fits the viewport (design 5.1), so the game fills
 * the window with bars only on the two sides that do not match 16:9. Sizes and offsets snap to
 * whole DEVICE pixels, so nearest-neighbour upscaling stays sharp at any devicePixelRatio; at
 * fractional factors some game pixels are one device pixel wider than others.
 */
export function fitZoom(
  viewportCssW: number,
  viewportCssH: number,
  dpr: number,
  gameW: number,
  gameH: number,
): ZoomLayout {
  const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const devW = Math.max(1, Math.floor(viewportCssW * ratio));
  const devH = Math.max(1, Math.floor(viewportCssH * ratio));
  const factor = Math.min(devW / gameW, devH / gameH);
  const outW = Math.max(1, Math.floor(gameW * factor));
  const outH = Math.max(1, Math.floor(gameH * factor));
  const leftDev = Math.floor((devW - outW) / 2);
  const topDev = Math.floor((devH - outH) / 2);
  return {
    factor,
    zoom: factor / ratio,
    cssWidth: outW / ratio,
    cssHeight: outH / ratio,
    cssLeft: leftDev / ratio,
    cssTop: topDev / ratio,
  };
}

// ---------------------------------------------------------------------------
// Ladder map (design 6.7)
// ---------------------------------------------------------------------------

export const LADDER = {
  /** Node centre y of tier 1 (Pip); higher tiers go up. */
  bottomY: 156,
  spacing: 22,
  ropeX: 28,
  nodeSize: 20,
} as const;

/** Node centre y for a 1-based tier. 22 px apart from Pip at y = 156 (Zyx at y = 24). */
export function ladderNodeY(tier: number): number {
  return LADDER.bottomY - (tier - 1) * LADDER.spacing;
}

// ---------------------------------------------------------------------------
// Crowd intensity (design 7.2: rises in the last 20 m)
// ---------------------------------------------------------------------------

export function crowdIntensity(leadXM: number): number {
  const base = 0.35;
  const t = Math.min(1, Math.max(0, (leadXM - 80) / 20));
  return base + (1 - base) * t;
}
