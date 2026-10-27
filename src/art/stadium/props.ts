/**
 * v2 track props (design 19.2): hurdle (standing, 4 knock frames, the last one lying), 400 m distance
 * boards, large split boards, the lap-bell official, and the airborne ground shadows (19.1). Pure.
 */
import { createMap, outline, setPx, type IndexMap } from '../bake/index.ts';
import { ellipse, line, poly, rect, text, textWidth } from '../paint.ts';

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
/**
 * Perspective offset (px, to the right) for hurdles in the far (rival) lane: purely visual, the far
 * lane recedes along the hurdles' own oblique (8 px per upright spacing). Two spacings (16 px) is the
 * smallest even step at which the far hurdle's base clears the near hurdle's bar (8 overlaps it by
 * 10 px, 14 is the first without overlap), so the two lanes read as separate gates. Gameplay and the
 * rival's jump timing stay on the true positions.
 */
export const FAR_LANE_HURDLE_OFFSET_PX = 16;

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

// ---------------------------------------------------------------------------
// Lap-bell official (design 14.3, 19.2): L5 foreground at 300 m. 32x32, frame 0 holding the bell,
// frame 1 ringing (bell raised and tilted). Drawn as a close foreground figure cut off at the bottom
// of the screen, so it never reaches the runners' feet.
// ---------------------------------------------------------------------------

export function bellOfficial(frame: 0 | 1): IndexMap {
  const m = createMap(32, 32);
  // Blazer (navy) body, broad, cut off by the frame bottom.
  poly(
    m,
    [
      [7, 32],
      [8, 20],
      [12, 16],
      [21, 16],
      [25, 20],
      [26, 32],
    ],
    29,
  );
  poly(
    m,
    [
      [20, 17],
      [24, 20],
      [26, 32],
      [21, 32],
    ],
    28,
  );
  line(m, 9, 21, 12, 17, 30);
  // Shirt and red tie.
  poly(
    m,
    [
      [14, 16],
      [19, 16],
      [17, 22],
      [16, 22],
    ],
    8,
  );
  rect(m, 16, 18, 2, 6, 17);
  setPx(m, 16, 18, 18);
  // Head: skin, white cap with a red band.
  ellipse(m, 16.5, 11, 4.2, 4.6, [10, 11, 12, 13], 0.4, -0.2);
  rect(m, 12, 5, 9, 3, 8);
  rect(m, 13, 4, 7, 1, 8);
  rect(m, 12, 7, 9, 1, 17);
  rect(m, 20, 7, 3, 1, 7);
  setPx(m, 18, 10, 1);
  setPx(m, 17, 9, 10);
  setPx(m, 18, 9, 10);
  setPx(m, 18, 13, 10);
  setPx(m, 17, 13, 10);
  // Ear on the back of the head.
  setPx(m, 14, 11, 11);
  setPx(m, 14, 12, 10);
  // Far arm hangs at the side.
  rect(m, 8, 21, 3, 9, 28);
  // Near arm: holds the bell low (0) or raised high and swung (1).
  if (frame === 0) {
    poly(
      m,
      [
        [21, 18],
        [24, 18],
        [27, 25],
        [24, 26],
      ],
      30,
    );
    ellipse(m, 26.5, 26, 1.5, 1.5, [10, 11, 12, 12]);
    // Bell hanging, mouth down.
    poly(
      m,
      [
        [26, 27],
        [28, 27],
        [30, 31],
        [24, 31],
      ],
      22,
    );
    line(m, 26, 28, 25, 30, 23);
  } else {
    poly(
      m,
      [
        [21, 18],
        [24, 17],
        [27, 8],
        [25, 7],
      ],
      30,
    );
    ellipse(m, 26.5, 6.5, 1.5, 1.5, [10, 11, 12, 12]);
    // Bell above the hand, tilted, with a clapper and two ring marks.
    poly(
      m,
      [
        [27, 4],
        [29, 3],
        [31, 6],
        [28, 8],
      ],
      22,
    );
    setPx(m, 28, 5, 23);
    setPx(m, 30, 8, 21);
  }
  const o = outline(m);
  if (frame === 1) {
    // Ring marks outside the outline (no outline on sound marks).
    setPx(o, 22, 2, 23);
    setPx(o, 21, 1, 23);
    setPx(o, 23, 0, 23);
  }
  return o;
}

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
