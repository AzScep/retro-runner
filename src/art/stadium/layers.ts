/**
 * Stadium layers (design 5.7) and tier themes (design 5.8) as pure index maps.
 * Shared layer builders + per-tier palette choices + 1-2 unique props per tier.
 */
import { createMap, getPx, outline, setPx, type IndexMap } from '../bake/index.ts';
import { checker, ellipse, hash, line, poly, rect, text, textWidth } from '../paint.ts';

export const TIERS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Screen rows and parallax factors (design 5.7). */
export const LAYERS = {
  sky: { y: 0, h: 48, factor: 0, w: 320 },
  far: { y: 24, h: 40, factor: 0.1, w: 256 },
  stands: { y: 48, h: 44, factor: 0.3, w: 128 },
  near: { y: 88, h: 16, factor: 0.6, w: 256 },
  track: { y: 104, h: 56, factor: 1, w: 64 },
  fg: { y: 160, h: 20, factor: 1.3, w: 480 },
} as const;
export type LayerName = keyof typeof LAYERS;

/** Feet rows (design 5.7). */
export const LANE_FEET_Y = { rival: 128, player: 152 } as const;
export const LANE_LINE_Y = [108, 132, 156] as const;

interface Theme {
  readonly sky: readonly number[];
  readonly skyDecor: 'clouds' | 'stars' | 'none';
  readonly cloud: readonly [number, number];
  readonly stars: readonly number[];
  readonly farBase: readonly [number, number, number];
  readonly standDark: readonly [number, number];
  readonly seat: number;
  readonly shirts: readonly number[];
  readonly skins: readonly number[];
  readonly wall: readonly [number, number];
  readonly boards: readonly (readonly [number, number])[];
  readonly track: {
    readonly base: number;
    readonly light: number;
    readonly dark: number;
    readonly line: number;
  };
  readonly apron: readonly [number, number];
  readonly grass: readonly [number, number, number];
}

const SKINS = [13, 12, 11, 10];

const THEMES: Readonly<Record<number, Theme>> = {
  1: {
    sky: [30, 31, 8],
    skyDecor: 'clouds',
    cloud: [8, 7],
    stars: [],
    farBase: [26, 25, 24],
    standDark: [25, 24],
    seat: 24,
    shirts: [18, 22, 29, 26, 41, 8],
    skins: SKINS,
    wall: [7, 6],
    boards: [
      [29, 8],
      [22, 2],
      [18, 8],
      [26, 2],
    ],
    track: { base: 25, light: 26, dark: 24, line: 8 },
    apron: [26, 25],
    grass: [26, 25, 27],
  },
  2: {
    sky: [29, 41, 21],
    skyDecor: 'clouds',
    cloud: [41, 19],
    stars: [],
    farBase: [33, 32, 2],
    standDark: [15, 14],
    seat: 20,
    shirts: [29, 8, 22, 18, 26],
    skins: SKINS,
    wall: [15, 14],
    boards: [
      [29, 22],
      [8, 29],
      [21, 2],
      [17, 8],
    ],
    track: { base: 39, light: 40, dark: 38, line: 8 },
    apron: [25, 24],
    grass: [25, 24, 26],
  },
  3: {
    sky: [30, 31],
    skyDecor: 'clouds',
    cloud: [8, 7],
    stars: [],
    farBase: [17, 16, 9],
    standDark: [4, 3],
    seat: 33,
    shirts: [33, 34, 8, 22, 29, 18],
    skins: SKINS,
    wall: [33, 32],
    boards: [
      [8, 33],
      [33, 8],
      [22, 32],
      [34, 2],
    ],
    track: { base: 39, light: 40, dark: 38, line: 8 },
    apron: [25, 24],
    grass: [25, 24, 26],
  },
  4: {
    sky: [28, 2],
    skyDecor: 'stars',
    cloud: [3, 2],
    stars: [7],
    farBase: [3, 2, 1],
    standDark: [3, 2],
    seat: 2,
    shirts: [26, 22, 8, 29, 18, 25],
    skins: SKINS,
    wall: [3, 2],
    boards: [
      [26, 2],
      [22, 2],
      [8, 25],
      [2, 26],
    ],
    track: { base: 39, light: 40, dark: 38, line: 8 },
    apron: [25, 24],
    grass: [25, 24, 26],
  },
  5: {
    sky: [41, 21, 22],
    skyDecor: 'clouds',
    cloud: [19, 23],
    stars: [],
    farBase: [16, 9, 2],
    standDark: [16, 9],
    seat: 29,
    shirts: [29, 22, 8, 18, 30, 21],
    skins: SKINS,
    wall: [29, 28],
    boards: [
      [22, 28],
      [29, 22],
      [8, 29],
      [28, 22],
    ],
    track: { base: 39, light: 40, dark: 38, line: 8 },
    apron: [25, 24],
    grass: [25, 24, 26],
  },
  6: {
    sky: [32, 2],
    skyDecor: 'none',
    cloud: [32, 2],
    stars: [34],
    farBase: [3, 2, 1],
    standDark: [2, 1],
    seat: 32,
    shirts: [34, 37, 41, 30, 36, 8],
    skins: [6, 5, 13, 11],
    wall: [2, 1],
    boards: [
      [2, 34],
      [2, 37],
      [2, 41],
      [2, 30],
    ],
    track: { base: 3, light: 4, dark: 2, line: 34 },
    apron: [32, 2],
    grass: [3, 2, 4],
  },
  7: {
    sky: [42, 1],
    skyDecor: 'stars',
    cloud: [42, 1],
    stars: [8, 37],
    farBase: [4, 3, 2],
    standDark: [2, 42],
    seat: 35,
    shirts: [36, 37, 33, 34, 29],
    skins: [36, 37, 35, 6],
    wall: [3, 2],
    boards: [
      [42, 37],
      [35, 37],
      [42, 34],
      [35, 8],
    ],
    track: { base: 4, light: 5, dark: 3, line: 37 },
    apron: [35, 42],
    grass: [3, 2, 35],
  },
};

export function theme(tier: number): Theme {
  return THEMES[Math.min(7, Math.max(1, Math.round(tier)))] as Theme;
}

// ---------------------------------------------------------------------------
// L0 sky: gradient bands with 2x2 checker dither between adjacent tones.
// ---------------------------------------------------------------------------
export function skyLayer(tier: number): IndexMap {
  const t = theme(tier);
  const { w, h } = LAYERS.sky;
  const m = createMap(w, h);
  const n = t.sky.length;
  const band = h / n;
  for (let y = 0; y < h; y++) {
    const fi = Math.min(n - 1, Math.floor(y / band));
    const into = y - fi * band;
    for (let x = 0; x < w; x++) {
      let v = t.sky[fi] as number;
      // 4-row dither transition into the next band: sparse, checker, dense.
      if (fi < n - 1 && into >= band - 4) {
        const k = into - (band - 4);
        const next = t.sky[fi + 1] as number;
        const pick =
          k < 1 ? x % 4 === 0 && y % 2 === 0 : k < 3 ? checker(x, y) : !(x % 4 === 2 && y % 2 === 1);
        if (pick) v = next;
      }
      setPx(m, x, y, v);
    }
  }
  if (t.skyDecor === 'clouds') {
    for (const [cx, cy, s] of [
      [40, 10, 1],
      [150, 6, 0.8],
      [250, 14, 1.2],
    ] as const) {
      ellipse(m, cx, cy, 10 * s, 3 * s, t.cloud[0]);
      ellipse(m, cx + 6 * s, cy - 2 * s, 7 * s, 3 * s, t.cloud[0]);
      for (let x = Math.floor(cx - 10 * s); x < cx + 13 * s; x++) {
        if (getPx(m, x, Math.round(cy + 2 * s)) === t.cloud[0])
          setPx(m, x, Math.round(cy + 2 * s), t.cloud[1]);
      }
    }
  }
  if (t.stars.length) {
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(hash(i, 1, tier) * w);
      const y = Math.floor(hash(i, 2, tier) * (h - 10));
      setPx(m, x, y, t.stars[i % t.stars.length] as number);
      if (i % 11 === 0) {
        setPx(m, x - 1, y, t.stars[0] as number);
        setPx(m, x + 1, y, t.stars[0] as number);
        setPx(m, x, y - 1, t.stars[0] as number);
        setPx(m, x, y + 1, t.stars[0] as number);
        setPx(m, x, y, 8);
      }
    }
  }
  if (tier === 6) {
    // Neon grid lines in the dark sky.
    for (let y = 30; y < h; y += 6) for (let x = 0; x < w; x++) if (x % 2 === 0) setPx(m, x, y, 33);
    for (let y = 10; y < 20; y++) for (let x = 0; x < w; x += 2) if (y === 14) setPx(m, x, y, 34);
  }
  return m;
}

// ---------------------------------------------------------------------------
// L1 far: stadium roof / skyline / tier props (256 px tile, rows 24-64).
// ---------------------------------------------------------------------------
function floodlight(m: IndexMap, x: number, top: number, on: boolean): void {
  rect(m, x, top + 6, 2, 40 - top, 3);
  line(m, x + 1, top + 6, x + 1, 39, 4);
  rect(m, x - 4, top, 10, 6, 2);
  for (let i = 0; i < 4; i++) {
    rect(m, x - 3 + i * 2, top + 1, 1, 2, on ? 23 : 6);
    rect(m, x - 3 + i * 2, top + 3, 1, 2, on ? 22 : 5);
  }
}

/**
 * First far-layer row clear of the race HUD. The HUD covers screen rows 0-34 (timer, progress bar
 * at y 24-32 and its head markers), so signs, scoreboards, screens and the planet start at screen
 * row 35 = far row 11. Only the rim, poles and sky decoration may sit higher.
 */
export const FAR_SAFE_ROW = 11;

export function farLayer(tier: number): IndexMap {
  const t = theme(tier);
  const { w, h } = LAYERS.far;
  const m = createMap(w, h);
  const [b0, b1, b2] = t.farBase;
  const S = FAR_SAFE_ROW;
  if (tier === 7) {
    // Planet hanging just above the station rim, clear of the HUD band.
    ellipse(m, 180, S + 6, 6, 6, [32, 33, 34, 41], 0.4, -0.3);
    line(m, 175, S + 5, 185, S + 7, 32);
    setPx(m, 177, S + 3, 33);
    setPx(m, 182, S + 9, 32);
  }
  // Generic stadium rim: a long low wall with a curved roof line.
  const rimBase = tier === 7 ? 23 : 18;
  const rimAmp = tier === 7 ? 1 : 3;
  for (let x = 0; x < w; x++) {
    const roof = rimBase + Math.round(rimAmp * Math.sin((x / w) * Math.PI * 2));
    for (let y = roof; y < h; y++)
      setPx(m, x, y, y < roof + 2 ? b0 : (x + y) % 2 === 0 && y < roof + 4 ? b0 : b1);
    if (x % 8 === 0) for (let y = roof + 4; y < h; y++) setPx(m, x, y, b2);
  }
  switch (tier) {
    case 1: {
      // Trees, then the school building with a gable clock.
      for (const x of [20, 40, 190, 220]) {
        ellipse(m, x, S + 6, 6, 6, [24, 25, 26, 27]);
        rect(m, x - 1, S + 11, 3, h - S - 11, 15);
      }
      rect(m, 74, S + 5, 82, h - S - 5, 18);
      rect(m, 74, S + 5, 82, 1, 19);
      poly(
        m,
        [
          [70, S + 6],
          [115, S],
          [160, S + 6],
        ],
        17,
      );
      for (let x = 80; x < 152; x += 10) if (x < 106 || x > 124) rect(m, x, S + 8, 6, 4, 31);
      rect(m, 109, S + 8, 12, h - S - 8, 15);
      ellipse(m, 115, S + 3.5, 1.6, 1.6, 8);
      setPx(m, 115, S + 3, 1);
      break;
    }
    case 2: {
      // Scoreboard: one line, HOME 00 AWAY 00.
      rect(m, 98, S, 62, 11, 2);
      rect(m, 99, S + 1, 60, 9, 1);
      text(m, 102, S + 3, 'HOME', 22);
      text(m, 120, S + 3, '00', 18);
      text(m, 132, S + 3, 'AWAY', 22);
      text(m, 150, S + 3, '00', 18);
      rect(m, 127, S + 11, 4, h - S - 11, 3);
      break;
    }
    case 3: {
      // Brick facade with arches and purple pennants along the cornice.
      const top = S + 5;
      rect(m, 0, top, w, h - top, 17);
      for (let y = top; y < h; y += 3) {
        for (let x = 0; x < w; x++)
          if ((x + (y % 6 === 1 ? 0 : 4)) % 8 === 0 || y % 3 === 0) setPx(m, x, y, 16);
      }
      for (let x = 8; x < w; x += 32) {
        rect(m, x, top + 6, 12, h - top - 6, 2);
        ellipse(m, x + 6, top + 6, 6, 4, 2);
      }
      for (let x = 4; x < w; x += 16) {
        line(m, x, S, x, top, 4);
        poly(
          m,
          [
            [x + 1, S],
            [x + 7, S + 1],
            [x + 1, S + 3],
          ],
          x % 32 === 4 ? 33 : 34,
        );
      }
      rect(m, 0, top - 1, w, 2, 9);
      break;
    }
    case 4: {
      floodlight(m, 30, S, true);
      floodlight(m, 220, S, true);
      // Big screen.
      rect(m, 90, S, 76, 13, 4);
      rect(m, 92, S + 1, 72, 11, 28);
      for (let y = S + 1; y < S + 12; y += 2) line(m, 92, y, 163, y, 29);
      text(m, 112, S + 4, 'GO!', 22);
      text(m, 128, S + 4, '100M', 8);
      break;
    }
    case 5: {
      // Flags on poles and a rings-free torch cauldron.
      for (const [x, c] of [
        [20, 29],
        [44, 18],
        [180, 22],
        [204, 26],
        [228, 8],
      ] as const) {
        line(m, x, S, x, 30, 6);
        rect(m, x + 1, S + 1, 10, 5, c);
        rect(m, x + 1, S + 3, 10, 1, c === 8 ? 17 : 8);
      }
      // Flame: a tapered tongue, red outside, yellow and pale core.
      ellipse(m, 120, S + 5, 4, 5, 18);
      ellipse(m, 120, S + 6, 2.5, 3.5, 22);
      ellipse(m, 120, S + 7, 1, 2, 23);
      poly(
        m,
        [
          [102, S + 8],
          [138, S + 8],
          [131, S + 13],
          [109, S + 13],
        ],
        21,
      );
      line(m, 102, S + 8, 138, S + 8, 22);
      rect(m, 116, S + 13, 8, h - S - 13, 20);
      break;
    }
    case 6: {
      // Neon arena roof rails and drones.
      for (let x = 0; x < w; x++) setPx(m, x, 16, x % 2 ? 34 : 33);
      for (const x of [40, 140, 200]) {
        rect(m, x, S + 1, 9, 3, 5);
        rect(m, x - 2, S, 3, 1, 6);
        rect(m, x + 8, S, 3, 1, 6);
        setPx(m, x + 4, S + 4, 37);
      }
      for (let x = 70; x < 186; x += 4) rect(m, x, 22, 2, 8, x % 8 === 2 ? 34 : 37);
      break;
    }
    case 7: {
      // Station struts.
      for (let x = 0; x < w; x += 24) line(m, x, 30, x + 12, 22, 4);
      break;
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// L2 far stands: crowd tile (128 px, rows 48-92), two bob frames.
// ---------------------------------------------------------------------------
export function standsLayer(tier: number, frame: 0 | 1): IndexMap {
  const t = theme(tier);
  const { w, h } = LAYERS.stands;
  const m = createMap(w, h);
  // Back wall of the stand, dithered (allowed in backgrounds).
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) setPx(m, x, y, checker(x >> 1, y >> 1) ? t.standDark[0] : t.standDark[1]);
  // Roof edge.
  rect(m, 0, 0, w, 2, t.farBase[2]);
  const rowH = 6;
  for (let r = 0; r < 6; r++) {
    const top = 4 + r * rowH;
    // Bench / seat row.
    rect(m, 0, top + 4, w, 2, t.seat);
    for (let i = 0; i < w / 4; i++) {
      const x = i * 4 + (r % 2) * 2;
      const n = hash(i, r, tier);
      if (n < 0.12) continue; // empty seat
      const bob = frame === 1 && hash(i, r + 31, tier) < 0.5 ? -1 : 0;
      const shirt = t.shirts[Math.floor(hash(i, r + 7, tier) * t.shirts.length)] as number;
      const skin = t.skins[Math.floor(hash(i, r + 13, tier) * t.skins.length)] as number;
      // Shirt 3x2, head 2x2.
      rect(m, x, top + 2 + bob, 3, 2, shirt);
      rect(m, x + 1, top + bob, 2, 2, skin);
      // Arms up on bob frame for some.
      if (frame === 1 && n > 0.85) setPx(m, x, top - 1 + bob, skin);
    }
  }
  // Front rail.
  rect(m, 0, h - 4, w, 1, t.wall[0]);
  rect(m, 0, h - 3, w, 3, t.wall[1]);
  if (tier === 1) {
    // Parents with a banner.
    rect(m, 20, 13, 30, 7, 8);
    rect(m, 20, 13, 30, 1, 7);
    text(m, 22, 14, 'GO PIP', 17);
    line(m, 19, 12, 19, 22, 15);
    line(m, 50, 12, 50, 22, 15);
  }
  if (tier === 2) {
    // Wooden bleacher planks.
    for (let y = 9; y < h - 4; y += 6) for (let x = 0; x < w; x++) if (x % 16 === 0) setPx(m, x, y, 14);
  }
  return m;
}

// ---------------------------------------------------------------------------
// L3 near stands: wall with brand-free ad boards (64 px tiles, rows 88-104).
// ---------------------------------------------------------------------------
const BOARD_TEXT = ['RUN', '100M', 'GO!', 'FAST'];

export function nearLayer(tier: number): IndexMap {
  const t = theme(tier);
  const { w, h } = LAYERS.near;
  const m = createMap(w, h);
  rect(m, 0, 0, w, h, t.wall[1]);
  rect(m, 0, 0, w, 1, t.wall[0]);
  for (let b = 0; b < 4; b++) {
    const x0 = b * 64;
    const [bg, fg] = t.boards[b] as readonly [number, number];
    rect(m, x0 + 2, 2, 60, 11, bg);
    // Board frame top highlight and bottom shadow.
    line(m, x0 + 2, 2, x0 + 61, 2, tier === 6 ? fg : bg === 8 ? 7 : bg);
    line(m, x0 + 2, 12, x0 + 61, 12, 2);
    const s = BOARD_TEXT[b] as string;
    text(m, x0 + 32 - Math.floor(textWidth(s) / 2), 5, s, fg);
    // Simple stripe motif.
    for (let k = 0; k < 3; k++) {
      line(m, x0 + 5 + k * 3, 10, x0 + 8 + k * 3, 4, fg);
      line(m, x0 + 50 + k * 3, 10, x0 + 53 + k * 3, 4, fg);
    }
    if (tier === 6) {
      // Neon tube border.
      line(m, x0 + 2, 2, x0 + 61, 2, fg);
      line(m, x0 + 2, 12, x0 + 61, 12, fg);
    }
  }
  rect(m, 0, 14, w, 2, t.wall[0]);
  return m;
}

// ---------------------------------------------------------------------------
// L4 track tile (64 px, rows 104-160).
// ---------------------------------------------------------------------------
export function trackLayer(tier: number): IndexMap {
  const t = theme(tier);
  const { w, h } = LAYERS.track;
  const m = createMap(w, h);
  const tr = t.track;
  // Calm, regular grain (about 3 % of pixels, one neighbouring tone) so runners pop off the track.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const grain = y % 4 === 2 && (x + (y % 8 === 2 ? 0 : 4) + (y >> 3) * 3) % 8 === 0;
      setPx(m, x, y, grain ? tr.light : tr.base);
    }
  }
  // Apron at the top edge (rows 104-107) and a shadow row under each line.
  rect(m, 0, 0, w, 3, t.apron[0]);
  rect(m, 0, 3, w, 1, t.apron[1]);
  for (const ly of LANE_LINE_Y) {
    const y = ly - LAYERS.track.y;
    rect(m, 0, y, w, 1, tr.line);
    rect(m, 0, y + 1, w, 1, tier === 7 || tier === 6 ? tr.dark : tr.dark);
  }
  if (tier === 7) {
    // Deck panel seams.
    for (let y = 5; y < h; y++) setPx(m, 0, y, 3);
    for (let x = 0; x < w; x++) setPx(m, x, 30, 3);
  }
  // Last rows 157-159 lead into the infield.
  rect(m, 0, h - 2, w, 2, tr.dark);
  return m;
}

// ---------------------------------------------------------------------------
// L5 foreground (480 px, rows 160-180): infield grass + max 1 prop per 160 px.
// ---------------------------------------------------------------------------
function cameraOperator(m: IndexMap, x: number): void {
  const p = createMap(24, 20);
  // Tripod.
  line(p, 12, 10, 8, 19, 4);
  line(p, 12, 10, 16, 19, 4);
  line(p, 12, 10, 12, 19, 5);
  // Camera.
  rect(p, 7, 5, 10, 5, 3);
  rect(p, 17, 6, 3, 3, 5);
  setPx(p, 19, 7, 31);
  rect(p, 8, 4, 4, 1, 4);
  // Operator: crouched behind, cap.
  rect(p, 2, 8, 5, 7, 29);
  rect(p, 2, 15, 5, 4, 2);
  rect(p, 3, 4, 4, 4, 12);
  rect(p, 2, 3, 5, 2, 17);
  rect(p, 6, 3, 2, 1, 17);
  blitShape(m, outline(p), x, 0);
}

function hurdles(m: IndexMap, x: number): void {
  const p = createMap(28, 20);
  for (let k = 0; k < 3; k++) {
    const o = k * 3;
    rect(p, 2 + o, 6 + k, 20, 3, k % 2 ? 8 : 17);
    for (let s = 0; s < 20; s += 8) rect(p, 2 + o + s, 6 + k, 4, 3, k % 2 ? 17 : 8);
    line(p, 3 + o, 9 + k, 3 + o, 18, 6);
    line(p, 20 + o, 9 + k, 20 + o, 18, 6);
  }
  rect(p, 1, 18, 26, 1, 4);
  blitShape(m, outline(p), x, 0);
}

function cones(m: IndexMap, x: number): void {
  const p = createMap(26, 20);
  for (const cx of [4, 13, 20]) {
    poly(
      p,
      [
        [cx - 3, 18],
        [cx, 9],
        [cx + 3, 18],
      ],
      21,
    );
    line(p, cx - 1, 13, cx + 1, 13, 8);
    line(p, cx, 10, cx - 1, 17, 22);
    rect(p, cx - 4, 18, 9, 1, 20);
  }
  blitShape(m, outline(p), x, 0);
}

function blitShape(dst: IndexMap, src: IndexMap, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x] as number;
      if (v) setPx(dst, dx + x, dy + y, v);
    }
  }
}

export function fgLayer(tier: number): IndexMap {
  const t = theme(tier);
  const { w, h } = LAYERS.fg;
  const m = createMap(w, h);
  const [g0, g1] = t.grass;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sparse regular tufts in one neighbouring tone (no bright speckle).
      const tuft = y % 3 === 2 && (x + (y % 6 === 2 ? 0 : 5) + (x >> 5)) % 10 === 0;
      setPx(m, x, y, y < 1 || tuft ? g1 : g0);
    }
  }
  // One prop per 160 px, alternating by tier so themes differ.
  const props = [cameraOperator, hurdles, cones];
  for (let i = 0; i < 3; i++) {
    const fn = props[(i + tier) % 3] as (m: IndexMap, x: number) => void;
    fn(m, i * 160 + 40 + ((tier * 37) % 60));
  }
  return m;
}

// ---------------------------------------------------------------------------
// Track markings (world space, factor 1).
// ---------------------------------------------------------------------------

/** Start line: 2 px wide white line across both lanes (rows 108-156). */
export function startLine(tier: number): IndexMap {
  const m = createMap(2, 49);
  rect(m, 0, 0, 2, 49, theme(tier).track.line);
  return m;
}

/** Checkered finish line: 4 px wide, 2x2 checks (rows 108-156). */
export function finishLine(): IndexMap {
  const m = createMap(4, 49);
  for (let y = 0; y < 49; y++) for (let x = 0; x < 4; x++) setPx(m, x, y, ((x >> 1) + (y >> 1)) % 2 ? 1 : 8);
  return m;
}

/** Distance board "10".."90" on a post, 13x14, bottom at the apron. */
export function distanceBoard(meters: number): IndexMap {
  const m = createMap(13, 14);
  rect(m, 1, 1, 11, 8, 8);
  rect(m, 1, 8, 11, 1, 7);
  const s = String(meters);
  text(m, 7 - Math.ceil(textWidth(s) / 2), 2, s, 1);
  rect(m, 5, 9, 2, 4, 6);
  setPx(m, 5, 9, 7);
  return outline(m);
}

/** Runner ground shadow: solid 20x3 ellipse in index 38 (design 5.4.5). */
export function groundShadow(): IndexMap {
  const m = createMap(20, 3);
  for (let y = 0; y < 3; y++) {
    const inset = y === 1 ? 0 : 3;
    for (let x = inset; x < 20 - inset; x++) setPx(m, x, y, 38);
  }
  return m;
}
