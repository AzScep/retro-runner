/**
 * v2 track props (design 19.2): hurdle (standing, 4 knock frames, the last one lying), 400 m distance
 * boards, large split boards, and the airborne ground shadows (19.1). Pure.
 */
import { createMap, outline, setPx, type IndexMap } from '../bake/index.ts';
import { line, rect, text, textWidth } from '../paint.ts';

// ---------------------------------------------------------------------------
// Hurdle
// ---------------------------------------------------------------------------

/**
 * Hurdle frames share one 40x28 cell so the falling hurdle fits; the standing hurdle occupies the
 * design's 16x28 box at x 0-15. The pivot (origin) is (8, 27): like the runner frames, the body's
 * ground row is 26 (on the lane feet row) and row 27 holds the outline under it, so a hurdle is placed
 * at (worldX, feetY + 1) with origin (8/40, 27/28).
 */
export const HURDLE_FRAME = { w: 40, h: 28, pivotX: 8, pivotY: 27, groundRow: 26 } as const;
/** Top edge of the bar (outline included) is exactly 24 px above the feet row (design 13.1, 19.2). */
export const HURDLE_BAR_TOP_ROW = HURDLE_FRAME.groundRow - 24;

/** Knock frames: tilt in degrees, the last one lying flat (design 19.2: 4 frames at 16 fps). */
export const HURDLE_KNOCK_DEG = [24, 50, 74, 90] as const;
export const HURDLE_KNOCK_FPS = 16;

type V = readonly [number, number];

/** Hurdle drawn tipped forward (in the running direction) by `deg` about the front of its feet. */
export function hurdleFrame(deg: number): IndexMap {
  const m = createMap(HURDLE_FRAME.w, HURDLE_FRAME.h);
  const gy = HURDLE_FRAME.groundRow;
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // Rotate a vector given with y pointing down: tipping forward moves "up" toward +x.
  const rot = (v: V): V => [v[0] * c - v[1] * s, v[0] * s + v[1] * c];
  const at = (b: V, v: V): V => {
    const r = rot(v);
    return [b[0] + r[0], b[1] + r[1]];
  };
  const P = (p: V): [number, number] => [Math.round(p[0]), Math.round(p[1])];
  // Oblique: two uprights 8 px apart under a 12 px bar (x 2-13 when standing), so the bar reads.
  const nearB: V = [4, gy];
  const farB: V = [12, gy];
  const H = 20; // upright length from the ground to the bar's underside
  const BAR = 3; // bar thickness in px (outline excluded)

  const leg = (b: V, metal: number, foot: number) => {
    const [x0, y0] = P(b);
    const [x1, y1] = P(at(b, [0, -H + 1]));
    line(m, x0, y0, x1, y1, metal);
    const [tx, ty] = P(at(b, [-3, 0]));
    line(m, x0, y0, tx, ty, foot);
  };
  // Far upright first (darker metal), then the near one, then the bar on top.
  leg(farB, 4, 4);
  leg(nearB, 6, 5);

  // Bar: its length runs across the lane, parallel to the tipping axis, so it stays level on screen
  // and only travels along the uprights' arc. BAR rows of 12 px (x 2-13 standing).
  for (let k = 0; k < BAR; k++) {
    for (let u = 0; u < 12; u++) {
      // The striped face stays BAR rows tall on screen and rests on the ground when lying.
      const p = at([2 + u, gy], [0, -H - BAR]);
      const x = Math.round(p[0]);
      const y = Math.round(p[1] - BAR * s) + k;
      const white = Math.floor(u / 2) % 2 === 0;
      setPx(m, x, y, white ? (k === BAR - 1 ? 7 : 8) : 1);
    }
  }
  return outline(m);
}

export function hurdleStanding(): IndexMap {
  return hurdleFrame(0);
}

export function hurdleKnockFrames(): IndexMap[] {
  return HURDLE_KNOCK_DEG.map((d) => hurdleFrame(d));
}

// ---------------------------------------------------------------------------
// 400 m boards (design 14.3, 19.2)
// ---------------------------------------------------------------------------

/** Small distance board for the 400 m (`50`, `150`, ...), 16x12 on a post. */
export function board50(meters: number): IndexMap {
  const m = createMap(16, 12);
  const s = String(meters);
  rect(m, 1, 1, 14, 7, 8);
  rect(m, 1, 7, 14, 1, 7);
  text(m, 8 - Math.ceil(textWidth(s) / 2), 2, s, 1);
  rect(m, 7, 8, 2, 3, 6);
  setPx(m, 7, 8, 7);
  return outline(m);
}

/** Large split board (`100`, `200`, `300`), 24x16: yellow panel on a twin post. */
export function splitBoard(meters: number): IndexMap {
  const m = createMap(24, 16);
  const s = String(meters);
  rect(m, 1, 1, 22, 10, 22);
  rect(m, 1, 1, 22, 1, 23);
  rect(m, 1, 10, 22, 1, 21);
  rect(m, 1, 1, 1, 10, 23);
  // Double-size digits (3x5 font at 2x would be 23 px for 3 digits): draw 1x with a drop shadow.
  const x0 = 12 - Math.ceil(textWidth(s) / 2);
  text(m, x0 + 1, 4, s, 21);
  text(m, x0, 3, s, 1);
  for (const x of [5, 17]) {
    rect(m, x, 11, 2, 4, 6);
    setPx(m, x, 11, 7);
  }
  return outline(m);
}

/** v3: the lap-bell official stands on the far side now (design 26.4); drawn with the officials. */
export { bellOfficial } from './officials.ts';

// ---------------------------------------------------------------------------
// Airborne ground shadows (design 19.1): the shadow stays on the ground row and shrinks from 20x3
// to 14x2 at the peak. Index 0 is the grounded 20x3 shadow (same as groundShadow()).
// ---------------------------------------------------------------------------

export const AIR_SHADOW_SIZES = [
  [20, 3],
  [18, 3],
  [16, 2],
  [14, 2],
] as const;

export function airShadow(i: number): IndexMap {
  const [w, h] = AIR_SHADOW_SIZES[Math.max(0, Math.min(3, i))]!;
  const m = createMap(w, h);
  for (let y = 0; y < h; y++) {
    const edge = h === 3 ? y !== 1 : false;
    const inset = edge ? 3 : h === 2 ? (y === 0 ? 2 : 0) : 0;
    for (let x = inset; x < w - inset; x++) setPx(m, x, y, 38);
  }
  if (h === 2) {
    // Round the lower row's ends too so it reads as an ellipse.
    setPx(m, 0, 1, 0);
    setPx(m, w - 1, 1, 0);
  }
  return m;
}

/** Shadow size index for a feet height (px above the ground); peak is 31 px (design 13.2). */
export function airShadowIndex(raisePx: number): number {
  if (raisePx <= 0) return 0;
  return Math.min(3, 1 + Math.floor((raisePx / 31) * 3));
}
