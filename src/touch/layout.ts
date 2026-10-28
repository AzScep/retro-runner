/**
 * Pure touch layout (design 17.2, 17.4): run/jump hit zones, pad visuals and the pause button, all
 * in viewport CSS px so they may use the letterbox bars.
 *
 * Zones are screen halves below a top strip (22 % of the height), 12 CSS px inside the left and
 * right safe-area insets and above the bottom inset. The LEFT and RIGHT pads go to the first
 * placement that has room (a bar at least 56 CSS px deep):
 * - `sideBars`: the side bars inside the safe area (most Android phones).
 * - `insetBars`: the side bars measured out to 12 CSS px from the screen edge, so they include the
 *   side safe-area insets (notched iPhones, whose 59 px insets leave under 56 px of safe bar). The
 *   insets are touchable, so the zones reach out there too; only the island blocks touch, and it is
 *   centred on its edge, well above the bottom-aligned pads.
 * - `bottomBar`: the bar under the canvas (4:3 iPads), pads under the canvas's bottom corners.
 * - `canvas`: over the canvas at the design's game-px positions (16:9 tablets).
 *
 * The JUMP pad stacks above the RIGHT pad in `sideBars`; everywhere else it sits over the canvas
 * at its design position (a stack in an iPhone side inset would reach the island).
 *
 * In hurdles the line between JUMP (above) and RIGHT (below) is 58 % of the height when the jump
 * pad is over the canvas (between the jump pad at game y 62-102 and the right pad at y 118). With
 * both in a side bar the jump pad sits directly above the right pad, so the line moves to the middle
 * of the 8 px gap between them: the zone under each pad graphic is the zone that graphic names.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export const LAYOUT = {
  /** Top strip share of the viewport height: no run input there. */
  topStrip: 0.22,
  /** Hurdles: JUMP above, RIGHT below this share of the height (pads over the canvas). */
  jumpSplit: 0.58,
  /** Zones start this far inside the left/right safe insets (Android back-gesture strips). */
  edgeMargin: 12,
  /** Minimum size of anything tappable, CSS px. */
  minTap: 44,
  /** Side bars at least this wide hold the pads. */
  minBar: 56,
  /** Gap between pads and from pads to the bottom inset, and pad width = bar - padGap. */
  padGap: 8,
  /** Pad art sizes in game px. */
  runPad: { w: 64, h: 48 },
  jumpPad: { w: 64, h: 40 },
  pauseIcon: 16,
  /** Game-px positions of the pads over the canvas. */
  overCanvas: { L: { x: 6, y: 118 }, R: { x: 250, y: 118 }, jump: { x: 250, y: 62 } },
  /** Pause icon top-left in game px. */
  pauseAt: { x: 300, y: 18 },
} as const;

export interface LayoutInput {
  readonly viewW: number;
  readonly viewH: number;
  readonly insets: Insets;
  /** Canvas rect in viewport CSS px. */
  readonly canvas: Rect;
  /** CSS px per game px. */
  readonly gamePx: number;
  /** Hurdles race: adds the JUMP zone and pad. */
  readonly hurdles: boolean;
}

export type PadPlacement = 'sideBars' | 'insetBars' | 'bottomBar' | 'canvas';

export interface TouchLayout {
  readonly zones: { readonly L: Rect; readonly R: Rect; readonly jump: Rect | null };
  readonly pads: { readonly L: Rect; readonly R: Rect; readonly jump: Rect | null };
  /** Pause hit area (>= 44 CSS px square). */
  readonly pause: Rect;
  /** Pause icon size in CSS px (centred in the hit area). */
  readonly pauseIcon: number;
  readonly placement: PadPlacement;
  /** The LEFT and RIGHT pads cover the canvas (the HUD moves its meters, 17.4). */
  readonly padsOverCanvas: boolean;
  /** The JUMP pad covers the canvas (drawn as a thin frame, 27.6.4); false outside hurdles. */
  readonly jumpOverCanvas: boolean;
}

const r = (x: number, y: number, w: number, h: number): Rect => ({
  x: Math.round(x),
  y: Math.round(y),
  w: Math.max(0, Math.round(w)),
  h: Math.max(0, Math.round(h)),
});

/** Width of the narrower side bar inside the safe area. */
export function sideBar(viewW: number, insets: Insets, canvas: Rect): number {
  const left = canvas.x - insets.left;
  const right = viewW - insets.right - (canvas.x + canvas.w);
  return Math.max(0, Math.min(left, right));
}

/** Width of the narrower side bar out to the edge margin, side safe-area insets included. */
export function outerSideBar(viewW: number, canvas: Rect): number {
  const left = canvas.x - LAYOUT.edgeMargin;
  const right = viewW - LAYOUT.edgeMargin - (canvas.x + canvas.w);
  return Math.max(0, Math.min(left, right));
}

/** Depth of the bar under the canvas, above the bottom safe-area inset. */
export function bottomBar(viewH: number, insets: Insets, canvas: Rect): number {
  return Math.max(0, viewH - insets.bottom - (canvas.y + canvas.h));
}

export function padPlacement(viewW: number, viewH: number, insets: Insets, canvas: Rect): PadPlacement {
  if (sideBar(viewW, insets, canvas) >= LAYOUT.minBar) return 'sideBars';
  if (outerSideBar(viewW, canvas) >= LAYOUT.minBar) return 'insetBars';
  if (bottomBar(viewH, insets, canvas) >= LAYOUT.minBar) return 'bottomBar';
  return 'canvas';
}

export function computeLayout(input: LayoutInput): TouchLayout {
  const { viewW, viewH, insets, canvas, gamePx, hurdles } = input;
  const gp = gamePx > 0 && Number.isFinite(gamePx) ? gamePx : 1;
  const placement = padPlacement(viewW, viewH, insets, canvas);
  const bottom = viewH - insets.bottom;
  const inSideBar = placement === 'sideBars' || placement === 'insetBars';
  // Zones reach into the side insets only when the pads do (insetBars).
  const zoneLeft = placement === 'insetBars' ? 0 : insets.left;
  const zoneRight = placement === 'insetBars' ? 0 : insets.right;

  // Pads.
  const overCanvas = (p: { x: number; y: number }, size: { w: number; h: number }): Rect =>
    r(
      canvas.x + p.x * gp,
      canvas.y + p.y * gp,
      Math.max(LAYOUT.minTap, size.w * gp),
      Math.max(LAYOUT.minTap, size.h * gp),
    );
  let padL: Rect;
  let padR: Rect;
  let padJump: Rect | null = null;
  if (inSideBar) {
    // Each bar spans from the safe inset (sideBars) or the edge margin (insetBars) to the canvas.
    const leftBarX = placement === 'sideBars' ? insets.left : LAYOUT.edgeMargin;
    const rightBarX = canvas.x + canvas.w;
    const rightBarEnd = placement === 'sideBars' ? viewW - insets.right : viewW - LAYOUT.edgeMargin;
    const bar = Math.min(canvas.x - leftBarX, rightBarEnd - rightBarX);
    const w = Math.min(bar - LAYOUT.padGap, LAYOUT.runPad.w * gp);
    const h = Math.max(LAYOUT.minTap, (w * LAYOUT.runPad.h) / LAYOUT.runPad.w);
    const y = bottom - LAYOUT.padGap - h;
    padL = r(leftBarX + (canvas.x - leftBarX - w) / 2, y, w, h);
    padR = r(rightBarX + (rightBarEnd - rightBarX - w) / 2, y, w, h);
    if (hurdles && placement === 'sideBars') {
      const jh = Math.max(LAYOUT.minTap, (w * LAYOUT.jumpPad.h) / LAYOUT.jumpPad.w);
      padJump = r(padR.x, padR.y - LAYOUT.padGap - jh, padR.w, jh);
    }
  } else if (placement === 'bottomBar') {
    // Under the canvas's bottom corners, outer edges in line with the over-canvas pads.
    // Whole px, so the pad's bottom edge lands exactly padGap above the inset after rounding.
    const h = Math.floor(
      Math.max(
        LAYOUT.minTap,
        Math.min(bottomBar(viewH, insets, canvas) - 2 * LAYOUT.padGap, LAYOUT.runPad.h * gp),
      ),
    );
    const w = (h * LAYOUT.runPad.w) / LAYOUT.runPad.h;
    const y = bottom - LAYOUT.padGap - h;
    const rightEdge = canvas.x + (LAYOUT.overCanvas.R.x + LAYOUT.runPad.w) * gp;
    padL = r(canvas.x + LAYOUT.overCanvas.L.x * gp, y, w, h);
    padR = r(rightEdge - w, y, w, h);
  } else {
    padL = overCanvas(LAYOUT.overCanvas.L, LAYOUT.runPad);
    padR = overCanvas(LAYOUT.overCanvas.R, LAYOUT.runPad);
  }
  if (hurdles && !padJump) padJump = overCanvas(LAYOUT.overCanvas.jump, LAYOUT.jumpPad);

  // Zones.
  const top = Math.round(viewH * LAYOUT.topStrip);
  const mid = Math.round(viewW / 2);
  const leftX = zoneLeft + LAYOUT.edgeMargin;
  const rightEnd = viewW - zoneRight - LAYOUT.edgeMargin;
  const zoneL = r(leftX, top, mid - leftX, bottom - top);
  let zoneR = r(mid, top, rightEnd - mid, bottom - top);
  let zoneJump: Rect | null = null;
  if (hurdles && padJump) {
    const split =
      placement === 'sideBars'
        ? Math.round(padR.y - LAYOUT.padGap / 2)
        : Math.round(viewH * LAYOUT.jumpSplit);
    const s = Math.min(Math.max(split, top + LAYOUT.minTap), bottom - LAYOUT.minTap);
    zoneJump = r(mid, top, rightEnd - mid, s - top);
    zoneR = r(mid, s, rightEnd - mid, bottom - s);
  }

  // Pause: icon 16 game px, hit area at least 44 CSS px, top right inside the safe area. It uses
  // the right bar only inside the safe area (an inset corner is rounded and may hold the island).
  const icon = Math.round(LAYOUT.pauseIcon * gp);
  const size = Math.max(LAYOUT.minTap, icon);
  let px: number;
  let py: number;
  if (placement === 'sideBars') {
    const rightBarX = canvas.x + canvas.w;
    const rightBarW = viewW - insets.right - rightBarX;
    px = rightBarX + (rightBarW - size) / 2;
    py = insets.top + LAYOUT.padGap;
  } else {
    const cx = canvas.x + (LAYOUT.pauseAt.x + LAYOUT.pauseIcon / 2) * gp;
    const cy = canvas.y + (LAYOUT.pauseAt.y + LAYOUT.pauseIcon / 2) * gp;
    px = cx - size / 2;
    py = cy - size / 2;
  }
  px = Math.min(Math.max(px, insets.left), viewW - insets.right - size);
  py = Math.max(py, insets.top);

  return {
    zones: { L: zoneL, R: zoneR, jump: zoneJump },
    pads: { L: padL, R: padR, jump: padJump },
    pause: r(px, py, size, size),
    pauseIcon: icon,
    placement,
    padsOverCanvas: placement === 'canvas',
    jumpOverCanvas: hurdles && placement !== 'sideBars',
  };
}

/** Viewport point (CSS px) to game px through the canvas rect; null outside the canvas. */
export function toGamePx(
  clientX: number,
  clientY: number,
  canvas: Rect,
  gameW: number,
  gameH: number,
): { x: number; y: number } | null {
  if (canvas.w <= 0 || canvas.h <= 0) return null;
  const x = ((clientX - canvas.x) / canvas.w) * gameW;
  const y = ((clientY - canvas.y) / canvas.h) * gameH;
  if (x < 0 || y < 0 || x >= gameW || y >= gameH) return null;
  return { x, y };
}
