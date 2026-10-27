/**
 * Touch control art (design 17.4, 19.3) as pure index maps: hollow run pads (64x48), the jump pad
 * (64x40), the pause button (16x16) and the rotate-device phone (32x32, 4 frames). Palette only,
 * 1 px ink outlines on both sides of every stroke and a transparent interior, so the pads never hide
 * the race underneath.
 */
import { blit, createMap, flipH, getPx, outline, setPx, type IndexMap } from '../bake/index.ts';
import { poly, rect } from '../paint.ts';
import { buildIcon, rotatePhone } from './icons.ts';

export type TouchArtId = 'padL' | 'padR' | 'padJump' | 'pause' | 'rotatePhone';
export type TouchArtState = 'idle' | 'expected' | 'ready' | 'pressed' | 'blocked' | 'fumble';

export const TOUCH_ART_IDS: readonly TouchArtId[] = ['padL', 'padR', 'padJump', 'pause', 'rotatePhone'];
export const TOUCH_ART_STATES: readonly TouchArtState[] = [
  'idle',
  'expected',
  'ready',
  'pressed',
  'blocked',
  'fumble',
];

/** Size in game px of each control (design 17.4). */
export const TOUCH_ART_SIZE: Readonly<Record<TouchArtId, readonly [number, number]>> = {
  padL: [64, 48],
  padR: [64, 48],
  padJump: [64, 40],
  pause: [16, 16],
  rotatePhone: [32, 32],
};

/** States each control really distinguishes; any other state is drawn as `idle`, except as noted. */
export const TOUCH_ART_DESIGN_STATES: Readonly<Record<TouchArtId, readonly TouchArtState[]>> = {
  padL: ['idle', 'expected', 'pressed', 'blocked', 'fumble'],
  padR: ['idle', 'expected', 'pressed', 'blocked', 'fumble'],
  padJump: ['idle', 'ready', 'pressed'],
  pause: ['idle', 'pressed'],
  rotatePhone: ['idle'],
};

interface PadLook {
  readonly border: number;
  readonly glyph: number;
  readonly down: boolean;
  readonly ring: boolean;
}

/** Design 17.4 state table, shared by the run pads and the jump pad. */
function look(state: TouchArtState): PadLook {
  switch (state) {
    case 'expected':
    case 'ready':
      return { border: 22, glyph: 8, down: false, ring: false };
    case 'pressed':
      return { border: 22, glyph: 8, down: true, ring: true };
    case 'blocked':
      return { border: 5, glyph: 6, down: false, ring: false };
    case 'fumble':
      return { border: 6, glyph: 17, down: false, ring: false };
    default:
      return { border: 6, glyph: 6, down: false, ring: false };
  }
}

/** Rounded rectangle ring of thickness `t` at inset `i` (corner radius r). */
function ring(m: IndexMap, i: number, t: number, r: number, v: number): void {
  const inside = (x: number, y: number, ins: number, rad: number) => {
    const x0 = ins;
    const y0 = ins;
    const x1 = m.w - 1 - ins;
    const y1 = m.h - 1 - ins;
    if (x < x0 || y < y0 || x > x1 || y > y1) return false;
    const dx = Math.max(0, x0 + rad - x, x - (x1 - rad));
    const dy = Math.max(0, y0 + rad - y, y - (y1 - rad));
    return dx * dx + dy * dy <= rad * rad + rad * 0.8;
  };
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (inside(x, y, i, r) && !inside(x, y, i + t, Math.max(0, r - t))) setPx(m, x, y, v);
    }
  }
}

/** Hollow pad frame: ink, 2 px border, ink; pressed adds an inner index 22 ring and ink (17.4). */
function padFrame(w: number, h: number, l: PadLook): IndexMap {
  const m = createMap(w, h);
  ring(m, 0, 1, 4, 1);
  ring(m, 1, 2, 3, l.border);
  ring(m, 3, 1, 2, 1);
  if (l.ring) {
    ring(m, 4, 1, 1, 22);
    ring(m, 5, 1, 1, 1);
  }
  return m;
}

/** A glyph drawn in `v` with a 1 px ink outline, blitted with its top-left at (x, y). */
function glyph(dst: IndexMap, shape: IndexMap, x: number, y: number): void {
  const pad = createMap(shape.w + 2, shape.h + 2);
  blit(pad, shape, 1, 1);
  blit(dst, outline(pad), x - 1, y - 1);
}

/** Right-pointing arrow, 22x20. */
function arrowShape(v: number): IndexMap {
  const m = createMap(22, 20);
  rect(m, 0, 7, 11, 6, v);
  poly(
    m,
    [
      [10, 0],
      [22, 10],
      [10, 20],
    ],
    v,
  );
  return m;
}

/** Up arrow, 14x11. */
function upArrowShape(v: number): IndexMap {
  const m = createMap(14, 11);
  poly(
    m,
    [
      [7, 0],
      [14, 7],
      [0, 7],
    ],
    v,
  );
  rect(m, 4, 7, 6, 4, v);
  return m;
}

/** Chunky 5x7 letters for the `JUMP` label (8 px tall with the outline). */
const LETTERS: Readonly<Record<string, readonly string[]>> = {
  J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
};

function labelShape(s: string, v: number): IndexMap {
  const w = s.length * 5 + (s.length - 1) * 2;
  const m = createMap(w, 7);
  [...s].forEach((ch, i) => {
    const g = LETTERS[ch];
    if (!g) throw new Error(`touch label: no glyph ${ch}`);
    g.forEach((row, y) => {
      for (let x = 0; x < 5; x++) if (row[x] === '#') setPx(m, i * 7 + x, y, v);
    });
  });
  return m;
}

export function runPad(side: 'L' | 'R', state: TouchArtState): IndexMap {
  const l = look(state);
  const m = padFrame(64, 48, l);
  const a = arrowShape(l.glyph);
  const shape = side === 'R' ? a : flipH(a);
  glyph(m, shape, 21, 14 + (l.down ? 1 : 0));
  return m;
}

export function jumpPad(state: TouchArtState): IndexMap {
  const l = look(state === 'expected' ? 'ready' : state);
  const m = padFrame(64, 40, l);
  const dy = l.down ? 1 : 0;
  glyph(m, upArrowShape(l.glyph), 25, 7 + dy);
  const label = labelShape('JUMP', l.glyph);
  glyph(m, label, 32 - Math.floor(label.w / 2), 23 + dy);
  return m;
}

/** Pause button: the 16x16 icon; pressed moves the bars 1 px down (design 17.4). */
export function pauseButton(state: TouchArtState): IndexMap {
  const m = buildIcon('pause');
  if (state !== 'pressed') return m;
  const out = createMap(16, 16);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = getPx(m, x, y);
      // Shift only the bar pixels (8, 7, 6) down by one, refilling with the panel.
      if (v === 8 || v === 7 || v === 6) continue;
      setPx(out, x, y, v);
    }
  }
  for (let y = 15; y >= 0; y--) {
    for (let x = 0; x < 16; x++) {
      const v = getPx(m, x, y);
      if (v === 8 || v === 7 || v === 6) setPx(out, x, y + 1, v);
    }
  }
  return out;
}

export function touchArt(id: TouchArtId, state: TouchArtState, frame = 0): IndexMap {
  switch (id) {
    case 'padL':
      return runPad('L', state);
    case 'padR':
      return runPad('R', state);
    case 'padJump':
      return jumpPad(state);
    case 'pause':
      return pauseButton(state);
    case 'rotatePhone':
      return rotatePhone(frame);
  }
}
