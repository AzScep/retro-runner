/**
 * Throwaway prototype (question 1): can 6 runners in 6 lanes read at 320x180?
 *
 * Composes one still frame per (layout, scene) from the real palette-indexed art (stadium layers,
 * character frames, hurdle, icons, portraits, RR Mini font) into a 320x180 index map, then shows it
 * at 4x. No Phaser and no core simulation: positions are hand-placed so every frame is reproducible.
 *
 *   npx vite --port 5191   then open /tools/prototype/lanes.html
 *   ?layout=P&scene=bunched&hud=dots&hurdle=16&dim=1   renders a single 1280x720 frame (screenshots)
 */
import { createMap, remap, setPx, toRGBA, type IndexMap } from '../../src/art/bake/index.ts';
import { buildCharacter } from '../../src/art/chars/index.ts';
import type { SpecId } from '../../src/art/chars/specs.ts';
import { RAMP_DARKEST } from '../../src/art/palette.ts';
import { buildIcon, keyIcon } from '../../src/art/sprites/icons.ts';
import { portrait16 } from '../../src/art/sprites/portraits.ts';
import {
  distanceBoard,
  farLayer,
  fgLayer,
  LAYERS,
  nearLayer,
  skyLayer,
  standsLayer,
  theme,
} from '../../src/art/stadium/layers.ts';
import { airShadow, HURDLE_FRAME, hurdleStanding } from '../../src/art/stadium/props.ts';
import { MINI_GLYPHS } from '../../src/ui/miniFont.ts';

const W = 320;
const H = 180;
const PX_PER_M = 24;
const START_X = 96;
const PLAYER_SCREEN_X = 96;
const TIER = 4;

// ---------------------------------------------------------------------------
// Lane layouts. feet[0] is the player's (nearest) lane, feet[5] the farthest.
// ---------------------------------------------------------------------------

interface Layout {
  readonly id: string;
  readonly label: string;
  readonly feet: readonly number[];
}

function even(spacing: number, nearest = 157): number[] {
  return [0, 1, 2, 3, 4, 5].map((k) => nearest - k * spacing);
}

export const LAYOUTS: readonly Layout[] = [
  { id: 'A', label: 'A even 7 px', feet: even(7) },
  { id: 'B', label: 'B even 9 px', feet: even(9) },
  { id: 'C', label: 'C even 11 px', feet: even(11) },
  // Perspective: lanes get narrower with distance; the player/rival gap stays wide.
  { id: 'P', label: 'P persp 12-11-9-8-7', feet: [157, 145, 134, 125, 117, 110] },
  { id: 'Q', label: 'Q persp 11-10-9-8-7', feet: [157, 146, 136, 127, 119, 112] },
  // Wider player/rival gap (14 px) so the rival's head and chest clear the player's head.
  { id: 'R', label: 'R persp 14-11-9-8-7', feet: [157, 143, 132, 123, 115, 108] },
];

interface Geometry {
  readonly feet: readonly number[];
  /** Lane line rows, nearest first; the last one is the far boundary of the farthest lane. */
  readonly lines: readonly number[];
  readonly trackTop: number;
  readonly trackBottom: number;
}

function geometry(l: Layout): Geometry {
  const f = l.feet;
  // Each lane's near boundary sits 4 px below its feet row (as today: 128 -> 132, 152 -> 156).
  const lines = f.map((y) => y + 4);
  const farGap = (f[4] as number) - (f[5] as number);
  lines.push((f[5] as number) - farGap + 4);
  const far = lines[lines.length - 1] as number;
  // Apron is 3 rows plus a shade row above the farthest line; never lower than today's 104.
  const trackTop = Math.min(LAYERS.track.y, far - 4);
  const trackBottom = (lines[0] as number) + 4; // line, shadow row, 2 dark rows
  return { feet: f, lines, trackTop, trackBottom };
}

// ---------------------------------------------------------------------------
// Characters: the real frames, field runners as palette swaps of existing bodies.
// ---------------------------------------------------------------------------

interface Cast {
  readonly key: string;
  readonly base: SpecId;
  readonly swap?: Readonly<Record<number, number>>;
  readonly role: 'player' | 'rival' | 'field';
}

const GREEN_TO_BLUE = { 24: 28, 25: 28, 26: 29, 27: 30 };
const BLUE_TO_PURPLE = { 28: 32, 29: 33, 30: 34, 31: 34 };
const BLUE_TO_ORANGE = { 28: 20, 29: 21, 30: 22, 31: 23 };
const PURPLE_TO_TEAL = { 32: 35, 33: 36, 34: 37 };

/** Lane order: index 0 is the nearest lane. */
const CAST: readonly Cast[] = [
  { key: 'rio', base: 'rio', role: 'player' },
  { key: 'kofi', base: 'kofi', role: 'rival' },
  { key: 'f1', base: 'kofi', swap: GREEN_TO_BLUE, role: 'field' },
  { key: 'f2', base: 'valentina', swap: BLUE_TO_PURPLE, role: 'field' },
  { key: 'f3', base: 'jess', swap: BLUE_TO_ORANGE, role: 'field' },
  { key: 'f4', base: 'marco', swap: PURPLE_TO_TEAL, role: 'field' },
];

const frameCache = new Map<string, Map<string, IndexMap>>();

/** Darken a map one ramp step (atmospheric "far lane" trick); outline stays ink. */
function dimMap(m: IndexMap): IndexMap {
  const table: Record<number, number> = {};
  for (let i = 2; i < RAMP_DARKEST.length; i++) {
    const d = RAMP_DARKEST[i] as number;
    table[i] = i > d ? i - 1 : i;
  }
  return remap(m, table);
}

function frames(c: Cast, dim: boolean): Map<string, IndexMap> {
  const k = `${c.key}${dim ? '-dim' : ''}`;
  let out = frameCache.get(k);
  if (!out) {
    out = new Map();
    for (const f of buildCharacter(c.base).frames) {
      let m = c.swap ? remap(f.map, c.swap) : f.map;
      if (dim) m = dimMap(m);
      out.set(f.name, m);
    }
    frameCache.set(k, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function blitClip(dst: IndexMap, src: IndexMap, dx: number, dy: number, clipBottom = H): void {
  for (let y = 0; y < src.h; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= clipBottom) continue;
    for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x] as number;
      if (v) setPx(dst, dx + x, ty, v);
    }
  }
}

function tileLayer(
  dst: IndexMap,
  src: IndexMap,
  y0: number,
  scroll: number,
  rows = src.h,
  srcRow0 = 0,
): void {
  for (let y = 0; y < rows; y++) {
    const sy = srcRow0 + y;
    if (sy >= src.h) break;
    for (let x = 0; x < W; x++) {
      const sx = (((x + scroll) % src.w) + src.w) % src.w;
      const v = src.data[sy * src.w + sx] as number;
      if (v) setPx(dst, x, y0 + y, v);
    }
  }
}

function fill(m: IndexMap, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(m, xx, yy, v);
}

function mini(m: IndexMap, x: number, y: number, s: string, v: number, scale = 1): number {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    if (ch === ' ') {
      cx += 4 * scale;
      continue;
    }
    const g = MINI_GLYPHS[ch];
    if (!g) continue;
    g.forEach((row, yy) => {
      for (let xx = 0; xx < row.length; xx++) {
        if (row[xx] === '#') fill(m, cx + xx * scale, y + yy * scale, scale, scale, v);
      }
    });
    cx += ((g[0] as string).length + 1) * scale;
  }
  return cx - x;
}

/** Mini text with a 1 px ink outline so it reads over the stadium. */
function miniOutlined(m: IndexMap, x: number, y: number, s: string, v: number, scale = 1): number {
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [1, 1],
  ] as const)
    mini(m, x + dx, y + dy, s, 1, scale);
  return mini(m, x, y, s, v, scale);
}

// Track band: same grain, apron and line style as trackLayer(), with variable lines.
function drawTrack(m: IndexMap, g: Geometry, scroll: number): void {
  const t = theme(TIER);
  const tr = t.track;
  for (let y = g.trackTop; y < g.trackBottom; y++) {
    const ly = y - g.trackTop;
    for (let x = 0; x < W; x++) {
      const wx = (((x + scroll) % 64) + 64) % 64;
      const grain = ly % 4 === 2 && (wx + (ly % 8 === 2 ? 0 : 4) + (ly >> 3) * 3) % 8 === 0;
      setPx(m, x, y, grain ? tr.light : tr.base);
    }
  }
  fill(m, 0, g.trackTop, W, 3, t.apron[0]);
  fill(m, 0, g.trackTop + 3, W, 1, t.apron[1]);
  for (const ly of g.lines) {
    fill(m, 0, ly, W, 1, tr.line);
    fill(m, 0, ly + 1, W, 1, tr.dark);
  }
  fill(m, 0, g.trackBottom - 2, W, 2, tr.dark);
}

function drawStadium(m: IndexMap, g: Geometry, scroll: number, event: '100m' | '110mh'): void {
  const ls = (f: number) => Math.round(scroll * f);
  tileLayer(m, skyLayer(TIER), LAYERS.sky.y, 0);
  tileLayer(m, farLayer(TIER, event), LAYERS.far.y, ls(LAYERS.far.factor));
  tileLayer(m, standsLayer(TIER, 0), LAYERS.stands.y, ls(LAYERS.stands.factor));
  tileLayer(m, nearLayer(TIER, event), LAYERS.near.y, ls(LAYERS.near.factor));
  drawTrack(m, g, scroll);
  // Distance boards stand on the apron (bottom on the track's top row).
  for (let d = 10; d < 100; d += 10) {
    const x = Math.round(START_X + d * PX_PER_M) - 6 - scroll;
    if (x > -16 && x < W) blitClip(m, distanceBoard(d), x, g.trackTop - 12);
  }
}

/** Foreground grass from the track's bottom; props keep their bottom row at the screen bottom. */
function drawForeground(m: IndexMap, g: Geometry, scroll: number): void {
  const fg = fgLayer(TIER);
  const top = Math.max(LAYERS.fg.y, g.trackBottom);
  const rows = H - top;
  // Drop the top rows of the 20-row layer so props stay grounded on the bottom edge.
  tileLayer(m, fg, top, Math.round(scroll * LAYERS.fg.factor), rows, fg.h - rows);
  // Keep the grass edge highlight on the first row.
  const [, g1] = theme(TIER).grass;
  for (let x = 0; x < W; x++) if (m.data[top * W + x] === theme(TIER).grass[0]) setPx(m, x, top, g1);
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

type SceneId = 'spread' | 'bunched' | 'hurdles' | 'start';

interface Placed {
  /** Metres from the start line. */
  readonly xM: number;
  readonly frame: string;
  /** Px above the ground (hurdle jumps). */
  readonly raise?: number;
}

interface SceneDef {
  readonly event: '100m' | '110mh';
  /** Player metres: the camera follows the player at screen x 96. */
  readonly playerM: number;
  readonly runners: readonly Placed[];
}

const SCENES: Readonly<Record<SceneId, SceneDef>> = {
  // Mid-race, runners spread over 4 m, the leader 10.5 m up the road and off-screen.
  spread: {
    event: '100m',
    playerM: 52,
    runners: [
      { xM: 52, frame: 'run2' },
      { xM: 52.7, frame: 'run5' },
      { xM: 51.1, frame: 'run0' },
      { xM: 53.6, frame: 'run3' },
      { xM: 49.8, frame: 'run6' },
      { xM: 62.5, frame: 'run1' },
    ],
  },
  // Worst case: all six within 0.6 m of each other.
  bunched: {
    event: '100m',
    playerM: 52,
    runners: [
      { xM: 52, frame: 'run2' },
      { xM: 52.1, frame: 'run6' },
      { xM: 51.8, frame: 'run4' },
      { xM: 52.3, frame: 'run0' },
      { xM: 52.0, frame: 'run3' },
      { xM: 51.7, frame: 'run7' },
    ],
  },
  // Approaching H4 (41.14 m): rival over it, two field runners in the air, player about to jump.
  hurdles: {
    event: '110mh',
    playerM: 39.4,
    runners: [
      { xM: 39.4, frame: 'run1' },
      { xM: 41.0, frame: 'hurdle2', raise: 30 },
      { xM: 40.3, frame: 'hurdle0', raise: 18 },
      { xM: 38.6, frame: 'run5' },
      { xM: 41.6, frame: 'hurdle3', raise: 12 },
      { xM: 39.9, frame: 'run3' },
    ],
  },
  start: {
    event: '100m',
    playerM: 0,
    runners: [0, 1, 2, 3, 4, 5].map(() => ({ xM: 0, frame: 'ready1' })),
  },
};

const HURDLES_M = [13.72, 22.86, 32, 41.14, 50.28, 59.42, 68.56, 77.7, 86.84, 95.98];

export interface RenderOptions {
  readonly layout: Layout;
  readonly scene: SceneId;
  /** 'heads': six 6x4 heads; 'dots': rival and player heads, field as 2x2 dots inside the bar. */
  readonly hud: 'heads' | 'dots';
  /** Far-lane hurdle offset per lane, px. */
  readonly hurdleOffset: number;
  /** Dim field runners one ramp step. */
  readonly dim: boolean;
  /**
   * Oblique projection, px per lane: runners, hurdles and the start line of lane k are all drawn
   * k * oblique px to the right, so "level" runners form a diagonal and every jump stays over its gate.
   */
  readonly oblique: number;
}

/** Fractional lane index of a screen row (0 at the player's feet row, 5 at the farthest). */
function lanePos(g: Geometry, y: number): number {
  const f = g.feet;
  for (let i = 0; i < 5; i++) {
    const a = f[i] as number;
    const b = f[i + 1] as number;
    if (y >= b || i === 4) return i + (a - y) / (a - b);
  }
  return 5;
}

function worldX(m: number): number {
  return START_X + m * PX_PER_M;
}

export function render(o: RenderOptions): IndexMap {
  const g = geometry(o.layout);
  const sc = SCENES[o.scene];
  const scroll = Math.max(0, Math.round(worldX(sc.playerM)) - PLAYER_SCREEN_X);
  const m = createMap(W, H);
  drawStadium(m, g, scroll, sc.event);

  // Start line across all lanes (from the far line to the near line), or the finish-free mid-race.
  if (sc.playerM === 0) {
    const top = g.lines[g.lines.length - 1] as number;
    for (let y = top; y <= (g.lines[0] as number); y++) {
      fill(m, START_X - scroll + Math.round(lanePos(g, y) * o.oblique), y, 2, 1, theme(TIER).track.line);
    }
  }

  // Shadows first (ground level, under every runner), then lanes far to near: hurdles, runner.
  const screenX = (lane: number) => {
    const p = sc.runners[lane] as Placed;
    const shift = lane * o.oblique;
    const ready = p.frame.startsWith('ready') ? -12 : 0;
    return Math.round(worldX(p.xM)) - scroll + ready + shift;
  };
  for (let lane = 5; lane >= 0; lane--) {
    const p = sc.runners[lane] as Placed;
    const raise = p.raise ?? 0;
    const si = raise <= 0 ? 0 : Math.min(3, 1 + Math.floor((raise / 31) * 3));
    const sh = airShadow(si);
    blitClip(m, sh, screenX(lane) - (sh.w >> 1), (g.feet[lane] as number) - 1);
  }
  const hurdle = hurdleStanding();
  for (let lane = 5; lane >= 0; lane--) {
    const feet = g.feet[lane] as number;
    if (sc.event === '110mh') {
      for (const hm of HURDLES_M) {
        const x = Math.round(worldX(hm)) + lane * (o.oblique || o.hurdleOffset) - scroll;
        if (x > -40 && x < W + 40)
          blitClip(m, hurdle, x - HURDLE_FRAME.pivotX, feet + 1 - HURDLE_FRAME.pivotY);
      }
    }
    const c = CAST[lane] as Cast;
    const p = sc.runners[lane] as Placed;
    const fr = frames(c, o.dim && c.role === 'field').get(p.frame);
    if (!fr) throw new Error(`no frame ${p.frame} for ${c.base}`);
    blitClip(m, fr, screenX(lane) - 24, feet + 1 - (p.raise ?? 0) - 47);
  }

  drawForeground(m, g, scroll);
  drawHud(m, o, g, sc, scroll);
  return m;
}

function headIcon(role: Cast['role']): IndexMap {
  if (role === 'player') return buildIcon('headPlayer');
  const head = buildIcon('headRival');
  // Rival: its kit colour; field: neutral dark grey (design proposal 7.2).
  return role === 'rival' ? remap(head, { 8: 27, 7: 26, 6: 25 }) : remap(head, { 8: 6, 7: 5, 6: 4 });
}

function drawHud(m: IndexMap, o: RenderOptions, g: Geometry, sc: SceneDef, scroll: number): void {
  const dist = sc.event === '110mh' ? 110 : 100;
  // Rival badge, timer, place.
  blitClip(m, portrait16('kofi'), 4, 4);
  miniOutlined(m, 22, 8, 'KOFI', 8);
  const t = sc.playerM === 0 ? '00.00' : sc.event === '110mh' ? '06.12' : '06.48';
  miniOutlined(m, 136, 4, t, 8, 2);
  const placeText =
    o.scene === 'spread' ? '3RD' : o.scene === 'hurdles' ? '4TH' : o.scene === 'bunched' ? '3RD' : '';
  if (placeText) miniOutlined(m, 248, 4, placeText, 22, 2);

  // Progress bar (40, 24, 240 x 8): ink, grey border, panel fill.
  const P = { x: 40, y: 24, w: 240, h: 8 };
  fill(m, P.x, P.y, P.w, P.h, 1);
  fill(m, P.x + 1, P.y + 1, P.w - 2, P.h - 2, 5);
  fill(m, P.x + 2, P.y + 2, P.w - 4, P.h - 4, 2);
  blitClip(m, buildIcon('finishFlag'), P.x + P.w, P.y - 8);
  const mx = (xM: number) => P.x + Math.round((Math.min(dist, Math.max(0, xM)) * P.w) / dist);
  const order = [5, 4, 3, 2, 1, 0];
  for (const lane of order) {
    const c = CAST[lane] as Cast;
    const xM = (sc.runners[lane] as Placed).xM;
    if (c.role === 'player') {
      blitClip(m, headIcon('player'), mx(xM) - 3, P.y + P.h);
    } else if (c.role === 'rival') {
      continue; // drawn last, on top
    } else if (o.hud === 'heads') {
      blitClip(m, headIcon('field'), mx(xM) - 3, P.y - 4);
    } else {
      // 2x4 pip inside the bar (index 7), so field markers never cover the heads.
      fill(m, mx(xM) - 1, P.y + 2, 2, 4, 7);
    }
  }
  const rivalM = (sc.runners[1] as Placed).xM;
  blitClip(m, headIcon('rival'), mx(rivalM) - 3, P.y - 4);

  // Off-screen leader arrow at the right edge, on that runner's lane (chest height).
  const leaderLane = [1, 2, 3, 4, 5].reduce((a, b) =>
    (sc.runners[b] as Placed).xM > (sc.runners[a] as Placed).xM ? b : a,
  );
  const lx = Math.round(worldX((sc.runners[leaderLane] as Placed).xM)) - scroll + leaderLane * o.oblique;
  if (lx > W + 8) {
    const gap = ((sc.runners[leaderLane] as Placed).xM - sc.playerM).toFixed(1);
    // A fixed row under the progress bar: a far lane's chest height lands on the ad boards.
    const y = 38;
    const label = `${gap}M`;
    const tw = label.length * 6;
    blitClip(m, buildIcon('offscreenArrow'), W - 10, y);
    miniOutlined(m, W - 12 - tw, y + 1, label, 8);
  }

  // Speed meter (8, 164, 84 x 12) and key prompt (136, 160) as in design 6.2.
  fill(m, 8, 164, 84, 12, 1);
  fill(m, 9, 165, 82, 10, 5);
  fill(m, 10, 166, 80, 8, 2);
  mini(m, 12, 166, 'SPD', 8);
  for (let i = 0; i < 9; i++) {
    const v = sc.playerM === 0 ? 3 : i < 5 ? 26 : i < 8 ? 22 : 18;
    fill(m, 30 + i * 6, 166, 5, 8, i < 8 || sc.playerM === 0 ? v : 3);
  }
  if (sc.event === '110mh') {
    blitClip(m, keyIcon('L', 'dim'), 120, 160);
    blitClip(m, keyIcon('U', 'bright'), 152, 160);
    blitClip(m, keyIcon('R', 'bright'), 184, 160);
  } else {
    blitClip(m, keyIcon('L', sc.playerM === 0 ? 'dim' : 'bright'), 136, 160);
    blitClip(m, keyIcon('R', 'dim'), 168, 160);
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function toCanvas(m: IndexMap, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.style.width = `${W * scale}px`;
  c.style.height = `${H * scale}px`;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const img = ctx.createImageData(W, H);
  img.data.set(toRGBA(m));
  ctx.putImageData(img, 0, 0);
  return c;
}

const params = new URLSearchParams(location.search);
const app = document.getElementById('app') as HTMLElement;

function optsFromParams(layoutId: string, scene: SceneId): RenderOptions {
  const layout = LAYOUTS.find((l) => l.id === layoutId) ?? (LAYOUTS[5] as Layout);
  return {
    layout,
    scene,
    hud: params.get('hud') === 'heads' ? 'heads' : 'dots',
    hurdleOffset: Number(params.get('hurdle') ?? 16),
    dim: params.get('dim') === '1',
    oblique: Number(params.get('oblique') ?? 10),
  };
}

if (params.has('layout')) {
  const o = optsFromParams(params.get('layout') as string, (params.get('scene') ?? 'spread') as SceneId);
  const c = toCanvas(render(o), 4);
  c.id = 'frame';
  app.append(c);
} else {
  const only = params.get('scene') as SceneId | null;
  const scenes: SceneId[] = only ? [only] : ['spread', 'bunched', 'hurdles', 'start'];
  for (const l of LAYOUTS) {
    const h = document.createElement('h2');
    const g = geometry(l);
    h.textContent = `${l.label}: feet ${l.feet.join(', ')} | track ${g.trackTop}-${g.trackBottom}`;
    app.append(h);
    const row = document.createElement('div');
    row.className = 'row';
    for (const s of scenes) row.append(toCanvas(render(optsFromParams(l.id, s)), 2));
    app.append(row);
  }
}
document.body.dataset['ready'] = '1';
