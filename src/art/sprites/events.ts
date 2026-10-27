/**
 * Event pictograms (design 18.2, 18.8, 19.3): `100m` sprinter, `110mh` runner over a hurdle, `400m`
 * runner with a stopwatch. 32x32 (event cards) and 16x16 (title), in colour and as a locked variant
 * (black figure on a dark tile). The 32 px figures are stroked from hand-placed joints (thick limbs,
 * separate round head, far limbs one tone darker); the 16 px ones are drawn pixel by pixel.
 */
import { blit, createMap, outline, setPx, type IndexMap } from '../bake/index.ts';
import { ellipse, line, rect } from '../paint.ts';

export type PictogramEvent = '100m' | '110mh' | '400m';
export const PICTOGRAM_EVENTS: readonly PictogramEvent[] = ['100m', '110mh', '400m'];

/** Tile ramps [shadow, base, highlight] per event. */
const TILE: Readonly<Record<PictogramEvent, readonly [number, number, number]>> = {
  '100m': [16, 17, 18],
  '110mh': [28, 29, 30],
  '400m': [20, 21, 22],
};
const LOCKED_TILE = [2, 2, 3] as const;

function tile(size: number, ramp: readonly [number, number, number]): IndexMap {
  const m = createMap(size, size);
  const r = size >= 32 ? 3 : 2;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      // Rounded corners.
      const dx = Math.max(0, r - x, x - (size - 1 - r));
      const dy = Math.max(0, r - y, y - (size - 1 - r));
      if (dx * dx + dy * dy > r * r) continue;
      const hi = x === 1 || y === 1;
      const sh = x === size - 2 || y === size - 2;
      setPx(m, x, y, hi && !sh ? ramp[2] : sh ? ramp[0] : ramp[1]);
    }
  }
  return outline(m);
}

// ---------------------------------------------------------------------------
// 32 px: pictogram figures stroked from hand-placed joints with a separate round head,
// thick strokes with a separate round head, like a stadium pictogram. Near limbs index 8, far limbs
// index 7, one ink outline around the whole figure.
// ---------------------------------------------------------------------------

type Vec = readonly [number, number];
const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k];

function stroke(m: IndexMap, a: Vec, b: Vec, r: number, v: number): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len * 3));
  for (let i = 0; i <= n; i++) {
    const p = add(a, [b[0] - a[0], b[1] - a[1]], i / n);
    for (let y = Math.floor(p[1] - r - 1); y <= Math.ceil(p[1] + r + 1); y++) {
      for (let x = Math.floor(p[0] - r - 1); x <= Math.ceil(p[0] + r + 1); x++) {
        if (Math.hypot(x + 0.5 - p[0], y + 0.5 - p[1]) <= r) setPx(m, x, y, v);
      }
    }
  }
}

/** Joint positions (32 px tile coordinates) of one pictogram figure; `far` limbs draw in index 7. */
interface Stick {
  readonly head: Vec;
  readonly neck: Vec;
  readonly hip: Vec;
  readonly near: { readonly arm: readonly Vec[]; readonly leg: readonly Vec[] };
  readonly far: { readonly arm: readonly Vec[]; readonly leg: readonly Vec[] };
}

function chain(m: IndexMap, pts: readonly Vec[], r: number, v: number): void {
  for (let i = 0; i + 1 < pts.length; i++) stroke(m, pts[i] as Vec, pts[i + 1] as Vec, r, v);
}

function figure(f: Stick): IndexMap {
  const m = createMap(32, 32);
  chain(m, f.far.arm, 0.95, 7);
  chain(m, f.far.leg, 1.05, 7);
  chain(m, [f.hip, f.neck], 1.6, 8);
  chain(m, f.near.leg, 1.15, 8);
  ellipse(m, f.head[0], f.head[1], 2.6, 2.6, 8);
  chain(m, f.near.arm, 0.95, 8);
  return outline(m);
}

/** Sprinter: forward lean, front knee driven up, rear leg pushing off, arms pumping. */
const SPRINTER: Stick = {
  head: [20.5, 5.5],
  neck: [17.5, 10],
  hip: [12.5, 17],
  near: {
    arm: [
      [17, 11],
      [21, 14],
      [24, 10.5],
    ],
    leg: [
      [12.5, 17],
      [18.5, 19],
      [18, 25],
      [20.5, 25.5],
    ],
  },
  far: {
    arm: [
      [16.5, 11],
      [12, 12],
      [10.5, 15.5],
    ],
    leg: [
      [12.5, 17],
      [9, 22],
      [4.5, 25],
    ],
  },
};

/** Hurdler at the peak: lead leg straight out over the bar, trail leg folded, chest dipped. */
const HURDLER: Stick = {
  head: [20.5, 4.5],
  neck: [17, 8],
  hip: [12, 13.5],
  near: {
    arm: [
      [16.5, 9],
      [13, 11.5],
      [10, 10],
    ],
    leg: [
      [12, 13.5],
      [19, 13.5],
      [25.5, 12.5],
    ],
  },
  far: {
    arm: [
      [17, 9],
      [21.5, 9.5],
      [25.5, 8],
    ],
    leg: [
      [12, 13.5],
      [7, 13],
      [6, 9],
    ],
  },
};

/** 400 m runner: upright relaxed stride (the stopwatch sits top-right). */
const STRIDER: Stick = {
  head: [14.5, 6.5],
  neck: [13, 11],
  hip: [10.5, 18],
  near: {
    arm: [
      [12.8, 12],
      [15.5, 15],
      [18, 13],
    ],
    leg: [
      [10.5, 18],
      [14.5, 21.5],
      [13.5, 26],
      [16, 26.5],
    ],
  },
  far: {
    arm: [
      [12.5, 12],
      [9.5, 14.5],
      [8.5, 17.5],
    ],
    leg: [
      [10.5, 18],
      [8, 22.5],
      [4.5, 25],
    ],
  },
};

function stopwatch(m: IndexMap, cx: number, cy: number, r: number, face: number, ink: number): void {
  const w = createMap(m.w, m.h);
  ellipse(w, cx, cy, r, r, face);
  rect(w, Math.round(cx) - 1, Math.round(cy - r) - 2, 2, 2, face);
  const o = outline(w, { color: ink });
  // Hands: 12 o'clock and 2 o'clock.
  line(o, Math.floor(cx), Math.floor(cy), Math.floor(cx), Math.floor(cy - r + 1), ink);
  line(o, Math.floor(cx), Math.floor(cy), Math.floor(cx + r - 1.5), Math.floor(cy - 1), ink);
  blit(m, o, 0, 0);
}

function hurdleGlyph(m: IndexMap, x0: number, ground: number, w: number, h: number, metal: number): void {
  const g = createMap(m.w, m.h);
  for (let x = 0; x < w; x++) {
    setPx(g, x0 + x, ground - h, Math.floor(x / 2) % 2 === 0 ? 8 : 1);
    setPx(g, x0 + x, ground - h + 1, Math.floor(x / 2) % 2 === 0 ? 7 : 1);
  }
  line(g, x0 + 1, ground - h + 2, x0 + 1, ground, metal);
  line(g, x0 + w - 2, ground - h + 2, x0 + w - 2, ground, metal);
  blit(m, outline(g), 0, 0);
}

function pictogram32(event: PictogramEvent): IndexMap {
  const m = tile(32, TILE[event]);
  if (event === '100m') {
    blit(m, figure(SPRINTER), 0, 0);
  } else if (event === '110mh') {
    hurdleGlyph(m, 9, 28, 12, 9, 6);
    blit(m, figure(HURDLER), 0, 1);
  } else {
    blit(m, figure(STRIDER), -2, 0);
    stopwatch(m, 24.5, 9, 4, 8, 1);
  }
  return m;
}

// ---------------------------------------------------------------------------
// 16 px: hand-drawn with 1-2 px strokes.
// ---------------------------------------------------------------------------

function pictogram16(event: PictogramEvent): IndexMap {
  const m = tile(16, TILE[event]);
  const f = createMap(16, 16);
  const W = 8;
  if (event === '100m') {
    rect(f, 9, 2, 2, 2, W); // head
    line(f, 8, 4, 6, 8, W); // torso (2 px)
    line(f, 9, 4, 7, 8, W);
    line(f, 9, 5, 11, 6, W); // front arm
    setPx(f, 12, 5, W);
    line(f, 7, 5, 5, 6, W); // back arm
    line(f, 7, 8, 9, 9, W); // front thigh (knee up)
    line(f, 10, 9, 10, 11, W); // front shin
    line(f, 6, 8, 4, 11, W); // back leg
    setPx(f, 3, 11, W);
  } else if (event === '110mh') {
    rect(f, 10, 1, 2, 2, W);
    line(f, 9, 3, 7, 6, W);
    line(f, 10, 3, 8, 6, W);
    line(f, 10, 4, 12, 4, W); // reaching arm
    line(f, 8, 6, 13, 6, W); // lead leg straight out
    line(f, 7, 6, 5, 6, W); // trail thigh
    setPx(f, 4, 5, W); // trail foot tucked
    for (let x = 5; x < 11; x++) setPx(f, x, 9, Math.floor((x - 5) / 2) % 2 === 0 ? 8 : 1);
    line(f, 6, 10, 6, 13, 7);
    line(f, 9, 10, 9, 13, 7);
  } else {
    rect(f, 6, 3, 2, 2, W);
    line(f, 5, 5, 4, 8, W);
    line(f, 6, 5, 5, 8, W);
    line(f, 6, 6, 7, 7, W);
    line(f, 5, 8, 7, 10, W);
    setPx(f, 7, 11, W);
    line(f, 4, 8, 3, 11, W);
    setPx(f, 2, 11, W);
    // Stopwatch.
    rect(f, 10, 4, 4, 4, W);
    rect(f, 11, 3, 2, 6, W);
    rect(f, 9, 5, 6, 2, W);
    setPx(f, 11, 2, W);
    setPx(f, 12, 5, 1);
    setPx(f, 12, 4, 1);
    setPx(f, 13, 5, 1);
  }
  blit(m, f, 0, 0);
  return m;
}

/** Locked variant: the figure turns black on a dark tile (design 18.2 "black silhouette"). */
function lockedOf(m: IndexMap, event: PictogramEvent): IndexMap {
  const [s0, s1, s2] = TILE[event];
  const out = createMap(m.w, m.h);
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i] as number;
    if (!v) continue;
    out.data[i] =
      v === s0 ? LOCKED_TILE[0] : v === s1 ? LOCKED_TILE[1] : v === s2 ? LOCKED_TILE[2] : v === 1 ? 1 : 1;
  }
  // Keep the tile's own outline and the figure readable: figure pixels are 1, the tile edge stays 1.
  return out;
}

export function eventPictogram(event: PictogramEvent, size: 16 | 32, locked = false): IndexMap {
  const m = size === 32 ? pictogram32(event) : pictogram16(event);
  return locked ? lockedOf(m, event) : m;
}
