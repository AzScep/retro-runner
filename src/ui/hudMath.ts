/**
 * Pure layout and display maths for the race HUD and screens (design 6.2-6.5).
 * No Phaser imports so it runs under Vitest in Node.
 */
import {
  EVENTS,
  formatTime,
  hurdlePositions,
  TUNING,
  WORLD,
  type EventId,
  type HurdleTiming,
  type RaceOutcome,
  type Side,
} from '../core/index.ts';
import { MINI_HEIGHT, miniTextWidth } from './miniFont.ts';

// ---------------------------------------------------------------------------
// Palette indices used by the UI (design 5.2). Colours come from art's paletteColor(index).
// ---------------------------------------------------------------------------

export const PAL = {
  ink: 1,
  panel: 2,
  shadowDark: 3,
  darkGrey: 4,
  grey: 5,
  midGrey: 6,
  lightGrey: 7,
  white: 8,
  redShadow: 16,
  red: 17,
  redLight: 18,
  orangeDark: 20,
  orange: 21,
  gold: 22,
  green: 26,
  navy: 28,
  blue: 29,
  purple: 33,
  teal: 36,
  tealGlow: 37,
} as const;

/** Named rival's kit base colour (design 27.1-27.5); one table in core, shared with the world chevron. */
export { RIVAL_KIT } from '../core/index.ts';

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

/** Segments lit at the 400 m sustain speed (SUSTAIN_RATE alt/s = 7 m/s): 6. */
export function sustainSegments(): number {
  return litSegments(SUSTAIN_SPEED_MPS);
}

/**
 * 400 m segment colour: up to the sustain speed green; above it is over pace, red while the meter
 * drains (the player is stepping above SUSTAIN_RATE) and gold while coasting down. Other events use
 * the 6.2 ramp, where red means flat out.
 */
export function speedSegmentColor(i: number, event: EventId, draining: boolean): number {
  if (event !== '400m') return segmentColorIndex(i);
  if (i <= sustainSegments()) return PAL.green;
  return draining ? PAL.redLight : PAL.gold;
}

// ---------------------------------------------------------------------------
// Progress bar (design 6.2, 18.4): (40, 24, 240 x 8); 240 px = the event distance.
// ---------------------------------------------------------------------------

export const PROGRESS = { x: 40, y: 24, w: 240, h: 8 } as const;

/** Whole-pixel x of a marker centre on the progress bar for a runner at `xM` of `distanceM` metres. */
export function progressMarkerX(xM: number, distanceM = 100): number {
  const m = Math.min(distanceM, Math.max(0, xM));
  return PROGRESS.x + Math.round((m * PROGRESS.w) / distanceM);
}

/** Tick marks above the bar (design 18.4): hurdle positions in hurdles, 100/200/300 m in the 400 m. */
export function progressTickMarks(event: EventId): readonly number[] {
  if (event === '110mh') return hurdlePositions(event);
  if (event === '400m') return [100, 200, 300];
  return [];
}

// ---------------------------------------------------------------------------
// Oval lap icon (design 14.3.3, 18.4): 32 x 16 at (4, 22), home straight on the bottom.
// ---------------------------------------------------------------------------

export const OVAL = { x: 4, y: 22, w: 32, h: 16 } as const;
/** Centre line of the dots' path inside the icon: bend centres at x 8 and 24, radius 6. */
const OVAL_PATH = { left: 8, right: 24, cy: 8, r: 6 } as const;

/**
 * Top-left (icon-relative, whole px) of a runner's 2x2 dot at `xM` metres of the 400 m.
 * Runners go anticlockwise seen from above: bend (right end, bottom to top) 0-100 m, back straight
 * (top, right to left) 100-200 m, bend (left end, top to bottom) 200-300 m, home straight (bottom,
 * left to right) 300-400 m, so the start and the finish sit at the bottom right.
 */
export function ovalDot(xM: number): { readonly x: number; readonly y: number } {
  const m = Math.min(400, Math.max(0, xM));
  const { left, right, cy, r } = OVAL_PATH;
  let px: number;
  let py: number;
  if (m < 100) {
    const a = Math.PI / 2 - (m / 100) * Math.PI;
    px = right + r * Math.cos(a);
    py = cy + r * Math.sin(a);
  } else if (m < 200) {
    px = right - ((m - 100) / 100) * (right - left);
    py = cy - r;
  } else if (m < 300) {
    const a = -Math.PI / 2 - ((m - 200) / 100) * Math.PI;
    px = left + r * Math.cos(a);
    py = cy + r * Math.sin(a);
  } else {
    px = left + ((m - 300) / 100) * (right - left);
    py = cy + r;
  }
  return { x: Math.round(px - 1), y: Math.round(py - 1) };
}

// ---------------------------------------------------------------------------
// Jump gauge (design 18.4): the pip runs from the right end (next hurdle 1.0 s away) to the left
// end (0 s); the clean takeoff window 0.296-0.104 s is a fixed zone (design 13.2).
// ---------------------------------------------------------------------------

export const JUMP_GAUGE_SPAN_S = 1.0;
export const CLEAN_WINDOW_S = { from: 0.104, to: 0.296 } as const;

/** x offset (whole px, from the gauge track's left edge) of `s` seconds on a track `trackW` wide. */
export function gaugeOffset(s: number, trackW: number): number {
  const t = Math.min(JUMP_GAUGE_SPAN_S, Math.max(0, s)) / JUMP_GAUGE_SPAN_S;
  return Math.round(t * trackW);
}

/** The clean zone as [left offset, width] on a track `trackW` wide. */
export function cleanZone(trackW: number): { readonly x: number; readonly w: number } {
  const x = gaugeOffset(CLEAN_WINDOW_S.from, trackW);
  return { x, w: gaugeOffset(CLEAN_WINDOW_S.to, trackW) - x };
}

/** Gauge shown only while a hurdle is ahead and the player moves at 1 m/s or more. */
export function gaugeVisible(nextHurdleS: number | null, vMps: number): boolean {
  return nextHurdleS !== null && vMps >= 1;
}

/** Up key / JUMP pad bright once the next hurdle is within 1.0 s (design 18.4, no flashing). */
export function jumpReady(nextHurdleS: number | null): boolean {
  return nextHurdleS !== null && nextHurdleS <= JUMP_GAUGE_SPAN_S;
}

// ---------------------------------------------------------------------------
// Stamina meter (design 14.1, 18.4)
// ---------------------------------------------------------------------------

/** S_FATIGUE as a fraction. */
export const S_FATIGUE = 0.3;
/** SUSTAIN_RATE alternations per second gives this cruise speed (design 2.3, 14.1). */
export const SUSTAIN_SPEED_MPS = 7.0;
export const STAMINA_BAR_W = 56;

/** Fill colour: index 26 above 60, index 22 from 30 to 60, index 18 below 30. */
export function staminaColorIndex(stamina: number): number {
  const v = stamina * 100;
  if (v > 60) return PAL.green;
  if (v >= 30) return PAL.gold;
  return PAL.redLight;
}

/** Filled width in whole px of a `barW` px bar. */
export function staminaFillW(stamina: number, barW = STAMINA_BAR_W): number {
  return Math.round(Math.min(1, Math.max(0, stamina)) * barW);
}

/**
 * `STA` label colour: below 30 it alternates index 18 / index 8 at 1 Hz (steady index 18 with
 * reduced flashing); otherwise index 8.
 */
export function staminaLabelColor(stamina: number, elapsedMs: number, reducedFlashing: boolean): number {
  if (stamina * 100 >= 30) return PAL.white;
  if (reducedFlashing) return PAL.redLight;
  return flashOn(elapsedMs, flashHz(1, false)) ? PAL.redLight : PAL.white;
}

/** x offset (into the segment track) of the 1 px gap just after the sustain segments: 35. */
export function sustainDividerOffset(pitch = 6): number {
  return sustainSegments() * pitch - 1;
}

/** Sustain tick x offset into the speed segments: round(7.0 / 12.5 * 60) = 34 (design 18.4). */
export function sustainTickOffset(segmentsW = 60): number {
  return Math.round((SUSTAIN_SPEED_MPS / WORLD.V_MAX) * segmentsW);
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
// Live position (design 27.2): a new raw place shows only after holding POSITION_HOLD.
// ---------------------------------------------------------------------------

/**
 * Holds the raw live place for `holdMs` before showing it, so the label changes at most about 3
 * times a second and never flickers between level runners. Hidden (null) before GO and after a DQ;
 * once the player has crossed, the final place shows at once and stays.
 */
export class PlaceHold {
  #shown: number | null = null;
  #pending: number | null = null;
  #since = 0;
  #frozen = false;
  readonly holdMs: number;

  constructor(holdMs: number) {
    this.holdMs = holdMs;
  }

  get shown(): number | null {
    return this.#shown;
  }

  /** Feed the raw place every frame; `crossed` freezes it to the player's final place. */
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
    // The first place after GO shows at once (the label appears at GO, 27.2.3).
    if (this.#shown === null) {
      this.#shown = raw;
      this.#pending = null;
      return raw;
    }
    if (raw === this.#shown) {
      this.#pending = null;
      return raw;
    }
    if (raw !== this.#pending) {
      this.#pending = raw;
      this.#since = nowMs;
    }
    if (nowMs - this.#since >= this.holdMs) {
      this.#shown = raw;
      this.#pending = null;
    }
    return this.#shown;
  }
}

// ---------------------------------------------------------------------------
// Off-screen indicators (design 27.4)
// ---------------------------------------------------------------------------

export interface OffscreenRunner {
  readonly lane: number;
  /** Drawn screen x of the runner (oblique included). */
  readonly screenX: number;
  readonly xM: number;
  readonly visible: boolean;
}

export interface OffscreenIndicators {
  /** The race leader is off-screen ahead: its lane and the true gap in metres. */
  readonly leader: { readonly lane: number; readonly gapM: number } | null;
  /** Runners off-screen behind, and whether the named rival (lane 1) is among them. */
  readonly behind: { readonly count: number; readonly rival: boolean } | null;
}

/** Leader ahead and pack behind (27.4) from each runner's drawn x; the player is lane 0. */
export function offscreenIndicators(
  runners: readonly OffscreenRunner[],
  leaderLane: number,
  screenWidth: number,
): OffscreenIndicators {
  const player = runners.find((r) => r.lane === 0);
  const lead = runners.find((r) => r.lane === leaderLane);
  const leader =
    player && lead && leaderLane !== 0 && lead.visible && Math.round(lead.screenX) >= screenWidth
      ? { lane: leaderLane, gapM: lead.xM - player.xM }
      : null;
  const out = runners.filter((r) => r.lane !== 0 && r.visible && Math.round(r.screenX) < 0);
  return {
    leader,
    behind: out.length > 0 ? { count: out.length, rival: out.some((r) => r.lane === 1) } : null,
  };
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
// Crowd intensity (design 7.2, 13.4.3, 14.3.7): rises over the last 20 m (400 m: last 100 m).
// ---------------------------------------------------------------------------

export function crowdIntensity(leadXM: number, event: EventId = '100m'): number {
  const base = 0.35;
  const distance = EVENTS[event].distanceM;
  const rise = event === '400m' ? 100 : 20;
  const t = Math.min(1, Math.max(0, (leadXM - (distance - rise)) / rise));
  return base + (1 - base) * t;
}

// ---------------------------------------------------------------------------
// Speech bubble placement (design 31.2)
// ---------------------------------------------------------------------------

/** Text inset from the bubble edge, and the screen margin the bubble keeps. */
export const BUBBLE_PAD = 4;
const PAD = BUBBLE_PAD;
const MARGIN = 2;
const TAIL = 3;

export interface BubbleBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly tailX: number;
  readonly tailY: number;
}

export interface AvoidRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Pure placement: bubble box and tail for `text` above the anchor (ax, ay), clamped on screen.
 * A bubble that would overlap `avoid` (the big countdown digit or a banner) slides sideways past
 * it, toward the anchor's side; the tail stays under the bubble as close to the anchor as it can.
 */
export function bubbleBox(
  text: string,
  ax: number,
  ay: number,
  screenW = 320,
  avoid: AvoidRect | null = null,
): BubbleBox {
  const w = miniTextWidth(text) + PAD * 2;
  const h = MINI_HEIGHT + PAD * 2;
  let x = Math.round(Math.min(Math.max(ax - w / 2, MARGIN), screenW - MARGIN - w));
  const y0 = Math.round(Math.max(MARGIN, ay - TAIL - h));
  if (avoid) {
    const hit = x < avoid.x + avoid.w && avoid.x < x + w && y0 < avoid.y + avoid.h && avoid.y < y0 + h;
    if (hit) {
      const right = ax >= avoid.x + avoid.w / 2;
      x = right ? avoid.x + avoid.w + 2 : avoid.x - 2 - w;
      x = Math.round(Math.min(Math.max(x, MARGIN), screenW - MARGIN - w));
    }
  }
  const y = y0;
  const tailX = Math.round(Math.min(Math.max(ax - 1, x + PAD), x + w - PAD - TAIL));
  return { x, y, w, h, tailX, tailY: y + h - 1 };
}

// ---------------------------------------------------------------------------
// Key prompt (design 6.4, R1): MASH! for an idle player, ALTERNATE! for a one-key masher.
// ---------------------------------------------------------------------------

/** No valid step for this long during the race shows a prompt (6.4.3). */
export const MASH_IDLE_MS = 500;
/** Fumbles since the last valid step that turn MASH! into ALTERNATE!. */
export const ALTERNATE_AFTER_FUMBLES = 2;
/**
 * Reduced flashing: the expected key alone stays lit for this many valid steps after GO and after
 * any fumble, then both keys stay bright (the swap would alternate faster than 1 Hz).
 */
export const GUIDE_STEPS = 4;

export type PromptKeyLook = 'dim' | 'bright' | 'wrong';

export interface KeyPromptInput {
  readonly running: boolean;
  readonly idleMs: number;
  readonly fumblesSinceStep: number;
  /** Valid steps since GO or since the last fumble, whichever is later. */
  readonly stepsSinceGuide: number;
  readonly expectedSide: Side | null;
  readonly reducedFlashing: boolean;
}

export interface KeyPrompt {
  readonly text: 'MASH!' | 'ALTERNATE!' | null;
  readonly L: PromptKeyLook;
  readonly R: PromptKeyLook;
}

/**
 * Key prompt while the race is on (6.4, 6.5). A player pressing the same key over and over gets
 * ALTERNATE! with the next key steadily bright and the repeated one in the wrong look, instead of
 * a MASH! pulse that lit both keys; MASH! stays for a player who presses nothing at all.
 */
export function keyPrompt(k: KeyPromptInput): KeyPrompt {
  if (!k.running) return { text: null, L: 'dim', R: 'dim' };
  const exp = k.expectedSide;
  if (k.fumblesSinceStep >= ALTERNATE_AFTER_FUMBLES && exp !== null) {
    return exp === 'L'
      ? { text: 'ALTERNATE!', L: 'bright', R: 'wrong' }
      : { text: 'ALTERNATE!', L: 'wrong', R: 'bright' };
  }
  if (k.idleMs >= MASH_IDLE_MS && k.fumblesSinceStep < ALTERNATE_AFTER_FUMBLES) {
    const on = flashOn(k.idleMs - MASH_IDLE_MS, flashHz(2, k.reducedFlashing));
    return on ? { text: 'MASH!', L: 'bright', R: 'bright' } : { text: null, L: 'dim', R: 'dim' };
  }
  if (exp === null) return { text: null, L: 'bright', R: 'bright' };
  if (k.reducedFlashing && k.stepsSinceGuide >= GUIDE_STEPS) return { text: null, L: 'bright', R: 'bright' };
  return exp === 'L' ? { text: null, L: 'bright', R: 'dim' } : { text: null, L: 'dim', R: 'bright' };
}

/** The wrong-key look after a fumble lasts this long, whatever the display rate (R2). */
export const FUMBLE_LOOK_MS = 200;

// ---------------------------------------------------------------------------
// Hurdle popups (R4): which way a knocked jump was off, and a clean clear.
// ---------------------------------------------------------------------------

/** Popup text and colour for the player's hurdle result. */
export function hurdlePopup(
  kind: 'clear' | 'clip' | 'hit',
  timing: HurdleTiming | undefined,
): { readonly text: string; readonly color: number } {
  if (kind === 'clear') return { text: 'CLEAN', color: PAL.green };
  if (kind === 'clip') return { text: timing === 'late' ? 'LATE' : 'EARLY', color: PAL.gold };
  return timing === 'early'
    ? { text: 'TOO EARLY', color: PAL.redLight }
    : { text: 'JUMP!', color: PAL.redLight };
}

// ---------------------------------------------------------------------------
// 400 m split popup (R5): cumulative time plus the last 100 m segment.
// ---------------------------------------------------------------------------

/** `100M 10.36`, then `200M 25.41 (+15.05)` with the last 100 m segment time. */
export function splitPopupText(index: number, splits: readonly number[]): string {
  const ms = splits[index] ?? 0;
  const head = `${(index + 1) * 100}M ${formatTime(ms)}`;
  const prev = index > 0 ? splits[index - 1] : undefined;
  return prev === undefined ? head : `${head} (+${formatTime(ms - prev)})`;
}

// ---------------------------------------------------------------------------
// Finish moment (R7)
// ---------------------------------------------------------------------------

/**
 * Centre callout once the player crosses: `1ST!` gold, `2ND`/`3RD` white, `4TH`-`6TH` red, and
 * `photo` when the player's time is within PHOTO_FINISH_MS of the runner just ahead or behind.
 */
export function finishCall(
  outcome: RaceOutcome,
): { readonly text: string; readonly color: number; readonly photo: boolean } | null {
  if (outcome.place === null || outcome.ms === null) return null;
  const place = outcome.place;
  const suffix = place === 1 ? 'ST' : place === 2 ? 'ND' : place === 3 ? 'RD' : 'TH';
  const text = place === 1 ? '1ST!' : `${place}${suffix}`;
  const color = place === 1 ? PAL.gold : place <= 3 ? PAL.white : PAL.redLight;
  const timed = outcome.standings.filter((s) => s.ms !== null);
  const i = timed.findIndex((s) => s.lane === 0);
  const ms = outcome.ms;
  const near = (s: (typeof timed)[number] | undefined): boolean =>
    s !== undefined && s.ms !== null && Math.abs(s.ms - ms) <= TUNING.PHOTO_FINISH_MS;
  return { text, color, photo: near(timed[i - 1]) || near(timed[i + 1]) };
}
