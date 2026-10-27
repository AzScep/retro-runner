/**
 * UI icons (design 6.2, 6.4, 6.7). 16x16 except head markers 6x4 and offscreenArrow 8x8.
 * Authored with their outline included so they fit their declared size exactly.
 */
import { createMap, flipH, outline, parseRows, setPx, type IndexMap, type Legend } from '../bake/index.ts';
import { poly, rect } from '../paint.ts';

export type IconName =
  | 'arrowLeft'
  | 'arrowRight'
  | 'trophy'
  | 'lock'
  | 'speakerOn'
  | 'speakerOff'
  | 'finishFlag'
  | 'headRival'
  | 'headPlayer'
  | 'offscreenArrow'
  // v2 (design 18.2-18.4, 18.7, 19.3)
  | 'keyUp'
  | 'crown'
  | 'newBadge'
  | 'pause'
  | 'rotatePhone'
  | 'staminaArrowUp'
  | 'staminaArrowDown'
  | 'lapOval'
  | 'hurdleTick'
  | 'hurdleTickHit'
  // v3 (design 27.4, 35.3)
  | 'finishFlagSmall'
  | 'offscreenArrowLeft';

export type KeyState = 'dim' | 'bright' | 'wrong';

const KEY_COLORS: Readonly<Record<KeyState, { fill: number; lip: number; border: number; glyph: number }>> = {
  // Before GO / not expected: dim (index 5).
  dim: { fill: 5, lip: 4, border: 4, glyph: 3 },
  // Expected key: index 8 fill, index 22 border (design 6.4).
  bright: { fill: 8, lip: 7, border: 22, glyph: 2 },
  // Fumble: tinted index 17 (design 6.2).
  wrong: { fill: 17, lip: 16, border: 16, glyph: 8 },
};

const RIGHT_GLYPH = ['....#...', '....##..', '#######.', '########', '#######.', '....##..', '....#...'];
const UP_GLYPH = ['...#...', '..###..', '.#####.', '#######', '..###..', '..###..', '..###..', '..###..'];

/** Keyboard key cap with an arrow, pointing right (or up for the jump key). */
function keyCap(state: KeyState, up = false): IndexMap {
  const c = KEY_COLORS[state];
  const m = createMap(16, 16);
  rect(m, 2, 1, 12, 13, c.border);
  rect(m, 1, 2, 14, 11, c.border);
  rect(m, 3, 2, 10, 10, c.fill);
  rect(m, 2, 3, 12, 8, c.fill);
  rect(m, 3, 12, 10, 1, c.lip);
  rect(m, 2, 11, 12, 1, c.lip);
  const arrow = up ? UP_GLYPH : RIGHT_GLYPH;
  const ox = up ? 4 : 4;
  const oy = up ? 2 : 3;
  arrow.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') rect(m, ox + x, oy + y, 1, 1, c.glyph);
  });
  // Outer outline within the 16x16 cell.
  const o = outline(m);
  return o;
}

/** Key cap icon: 'L' / 'R' run keys, 'U' the up / jump key (design 18.4, 19.3). */
export function keyIcon(side: 'L' | 'R' | 'U', state: KeyState): IndexMap {
  if (side === 'U') return keyCap(state, true);
  const m = keyCap(state);
  return side === 'R' ? m : flipH(m);
}

const L: Legend = {
  k: 1,
  d: 2,
  y: 22,
  Y: 23,
  o: 21,
  r: 20,
  w: 8,
  g: 7,
  G: 6,
  n: 5,
  N: 4,
  R: 17,
  P: 18,
  b: 29,
  B: 30,
};

type ArtIcon = Exclude<
  IconName,
  'arrowLeft' | 'arrowRight' | 'keyUp' | 'rotatePhone' | 'lapOval' | 'newBadge' | 'offscreenArrowLeft'
>;

const ART: Readonly<Record<ArtIcon, readonly string[]>> = {
  trophy: [
    '................',
    '..kkkkkkkkkkkk..',
    '.kkYYyyyyyyyokk.',
    'kyykYyyyyyyokyyk',
    'ky.kYyyyyyyok.yk',
    'kyykYyyyyyyokyyk',
    '.kkkYyyyyyoookk.',
    '...kkYyyyyook...',
    '.....kkyyokk....',
    '......kyok......',
    '......kyok......',
    '.....kyyook.....',
    '....kkkkkkkk....',
    '....kNnnnnNk....',
    '....kkkkkkkk....',
    '................',
  ],
  lock: [
    '................',
    '.....kkkkkk.....',
    '....kgGGGGgk....',
    '...kgk....kGk...',
    '...kGk....kGk...',
    '...kGk....kNk...',
    '..kkkkkkkkkkkk..',
    '..kYyyyyyyyyok..',
    '..kyyyykkyyyok..',
    '..kyyyykkyyyok..',
    '..kyyyyykyyyok..',
    '..kyyyyykyyyok..',
    '..kyyyyyyyyyok..',
    '..koooooooooork.',
    '..kkkkkkkkkkkk..',
    '................',
  ],
  speakerOn: [
    '................',
    '......kk........',
    '.....kwk....k...',
    '....kwgk.k...k..',
    'kkkkwggk..k..k..',
    'kwwwgggk..k...k.',
    'kwggggGk.k.k..k.',
    'kwggggGk.k.k..k.',
    'kwggggGk.k.k..k.',
    'kGGGGGGk..k...k.',
    'kkkkGGGk..k..k..',
    '....kGGk.k...k..',
    '.....kGk....k...',
    '......kk........',
    '................',
    '................',
  ],
  speakerOff: [
    '................',
    '......kk........',
    '.....kwk........',
    '....kwgk........',
    'kkkkwggk.R...R..',
    'kwwwgggk.RR.RR..',
    'kwggggGk..RRR...',
    'kwggggGk...R....',
    'kwggggGk..RRR...',
    'kGGGGGGk.RR.RR..',
    'kkkkGGGk.R...R..',
    '....kGGk........',
    '.....kGk........',
    '......kk........',
    '................',
    '................',
  ],
  finishFlag: [
    '.kkkkkkkkkkkk...',
    '.kwwddwwddwwdk..',
    '.kwwddwwddwwdk..',
    '.kddwwddwwddwk..',
    '.kddwwddwwddwk..',
    '.kwwddwwddwwdk..',
    '.kwwddwwddwwdk..',
    '.kddwwddwwddwk..',
    '.kkkkkkkkkkkkk..',
    '.kgk............',
    '.kgk............',
    '.kgk............',
    '.kgk............',
    '.kgk............',
    '.kgk............',
    '.kkk............',
  ],
  headRival: ['.kkkk.', 'kgwwgk', 'kGggGk', '.kkkk.'],
  headPlayer: ['.kkkk.', 'kPPPRk', 'kRRRRk', '.kkkk.'],
  // Champion crown, 8x8 (design 18.2): gold with red gems.
  crown: ['.k.kk.k.', 'kykyykyk', 'kyyyyyyk', 'kyRyyRyk', 'kYyyyyyk', 'kooooook', 'kkkkkkkk', '........'],
  // Pause button, 16x16 (design 17.4): two index 8 bars on an index 2 panel.
  pause: [
    '..kkkkkkkkkkkk..',
    '.kddddddddddddk.',
    'kddddddddddddddk',
    'kddddddddddddddk',
    'kddddwwddwwddddk',
    'kddddwwddwwddddk',
    'kddddwwddwwddddk',
    'kddddwwddwwddddk',
    'kddddwwddwwddddk',
    'kddddwwddwwddddk',
    'kddddwwddwwddddk',
    'kddddgGddgGddddk',
    'kddddddddddddddk',
    'kddddddddddddddk',
    '.kddddddddddddk.',
    '..kkkkkkkkkkkk..',
  ],
  // Stamina arrows, 5x3 (design 18.4).
  staminaArrowUp: ['..w..', '.www.', 'wwwww'],
  staminaArrowDown: ['wwwww', '.www.', '..w..'],
  // Hurdle ticks above the progress bar, 2x3 (design 18.4): standing (8) and knocked (17).
  hurdleTick: ['ww', 'ww', 'ww'],
  hurdleTickHit: ['RR', 'RR', 'RR'],
  // Ladder top before the reveal (design 35.3): 8x8 checkered flag on a short pole.
  finishFlagSmall: [
    'kkkkkkk.',
    'kwdwdwk.',
    'kdwdwdk.',
    'kwdwdwk.',
    'kkkkkkk.',
    'kgk.....',
    'kgk.....',
    'kkk.....',
  ],
  offscreenArrow: [
    '..kk....',
    '..kyk...',
    'kkkyyk..',
    'kyyyyyk.',
    'koooook.',
    'kkkook..',
    '..kok...',
    '..kk....',
  ],
};

/** `NEW!` badge, 24x8 (design 18.2): index 22 panel, ink text and outline. */
export function newBadge(): IndexMap {
  const m = createMap(24, 8);
  rect(m, 1, 1, 22, 6, 22);
  rect(m, 1, 6, 22, 1, 21);
  rect(m, 1, 1, 22, 1, 23);
  // Own 5 px tall lettering: the shared 3x5 font's W reads as an H at this size.
  const rows = [
    '#..#.###.#...#.#',
    '##.#.#...#...#.#',
    '#.##.##..#.#.#.#',
    '#..#.#...#.#.#..',
    '#..#.###..#.#..#',
  ];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') setPx(m, 4 + x, 1 + y, 1);
  });
  return outline(m);
}

/**
 * Oval lap icon, 32x16 (design 14.3, 18.4): a 1 px index 6 stadium-shaped track, home straight on the
 * bottom, with a 1x3 index 8 finish tick at the bottom-right end of the home straight (x 23).
 */
export function lapOval(): IndexMap {
  const m = createMap(32, 16);
  const r = 7;
  const cy = 7.5;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 32; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const cx = px < 8.5 ? 8.5 : px > 23.5 ? 23.5 : px;
      const d = Math.hypot(px - cx, py - cy);
      if (d <= r && d > r - 1.15) setPx(m, x, y, 6);
    }
  }
  for (let y = 13; y < 16; y++) setPx(m, 23, y, 8);
  return m;
}

/** Lap oval geometry for placing the 2x2 runner dots (UI): centre of the dot's track point for d metres. */
export function lapOvalPoint(distanceM: number): readonly [number, number] {
  // Counter-clockwise from the finish (bottom right): bend 0-100, back straight 100-200,
  // bend 200-300, home straight 300-400 (design 14.3).
  const d = ((distanceM % 400) + 400) % 400;
  const r = 6.5;
  const L = 15; // straight length in px (x 8.5 .. 23.5)
  if (d < 100) {
    const a = Math.PI / 2 - (d / 100) * Math.PI; // bottom (+90 deg) round the right to the top
    return [23.5 + r * Math.cos(a), 7.5 + r * Math.sin(a)];
  }
  if (d < 200) return [23.5 - ((d - 100) / 100) * L, 7.5 - r];
  if (d < 300) {
    const a = -Math.PI / 2 - ((d - 200) / 100) * Math.PI; // top round the left to the bottom
    return [8.5 + r * Math.cos(a), 7.5 + r * Math.sin(a)];
  }
  return [8.5 + ((d - 300) / 100) * L, 7.5 + r];
}

/**
 * Rotate-device phone, 32x32, frame 0-3 = 0, 30, 60, 90 degrees (design 17.6, 19.3): the phone turns
 * from portrait to landscape, with a static yellow turn arrow in the top-right corner.
 */
export function rotatePhone(frame: number): IndexMap {
  const deg = [0, 30, 60, 90][Math.max(0, Math.min(3, frame))] as number;
  const a = (-deg * Math.PI) / 180; // counter-clockwise on screen
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cx = 15.5;
  const cy = 17;
  const pt = (x: number, y: number): readonly [number, number] => [cx + x * c - y * s, cy + x * s + y * c];
  const quad = (w: number, h: number, ox = 0, oy = 0) => [
    pt(-w / 2 + ox, -h / 2 + oy),
    pt(w / 2 + ox, -h / 2 + oy),
    pt(w / 2 + ox, h / 2 + oy),
    pt(-w / 2 + ox, h / 2 + oy),
  ];
  const m = createMap(32, 32);
  poly(m, quad(13, 21), 5);
  poly(m, quad(9, 14, 0, -0.5), 28);
  poly(m, quad(5, 3, -1, -4), 29);
  const btn = pt(0, 8.3);
  setPx(m, Math.floor(btn[0]), Math.floor(btn[1]), 6);
  const lit = pt(-5.3, -8.6);
  setPx(m, Math.floor(lit[0]), Math.floor(lit[1]), 7);
  const o = outline(m);
  // Turn arrow: quarter arc from the top to the right with a head pointing down.
  for (let k = 0; k <= 12; k++) {
    const t = (-Math.PI / 2) * (1 - k / 12);
    setPx(o, Math.round(21 + 8.5 * Math.cos(t)), Math.round(10 + 8.5 * Math.sin(t)), 22);
  }
  for (const [x, y] of [
    [27, 10],
    [28, 11],
    [30, 11],
    [31, 10],
  ] as const)
    setPx(o, x, y, 22);
  return o;
}

export function buildIcon(name: IconName): IndexMap {
  if (name === 'arrowRight') return keyIcon('R', 'bright');
  if (name === 'arrowLeft') return keyIcon('L', 'bright');
  if (name === 'keyUp') return keyIcon('U', 'bright');
  if (name === 'rotatePhone') return rotatePhone(0);
  if (name === 'lapOval') return lapOval();
  if (name === 'newBadge') return newBadge();
  // Pack-behind indicator (design 27.4): the leader arrow pointing left, same light from the top.
  if (name === 'offscreenArrowLeft') return flipH(parseRows(ART.offscreenArrow, L));
  return parseRows(ART[name], L);
}

export const ICON_NAMES: readonly IconName[] = [
  'arrowLeft',
  'arrowRight',
  'trophy',
  'lock',
  'speakerOn',
  'speakerOff',
  'finishFlag',
  'headRival',
  'headPlayer',
  'offscreenArrow',
  'keyUp',
  'crown',
  'newBadge',
  'pause',
  'rotatePhone',
  'staminaArrowUp',
  'staminaArrowDown',
  'lapOval',
  'hurdleTick',
  'hurdleTickHit',
  'finishFlagSmall',
  'offscreenArrowLeft',
];

export function iconSize(name: IconName): readonly [number, number] {
  switch (name) {
    case 'headRival':
    case 'headPlayer':
      return [6, 4];
    case 'offscreenArrow':
    case 'offscreenArrowLeft':
    case 'finishFlagSmall':
    case 'crown':
      return [8, 8];
    case 'newBadge':
      return [24, 8];
    case 'rotatePhone':
      return [32, 32];
    case 'staminaArrowUp':
    case 'staminaArrowDown':
      return [5, 3];
    case 'lapOval':
      return [32, 16];
    case 'hurdleTick':
    case 'hurdleTickHit':
      return [2, 3];
    default:
      return [16, 16];
  }
}
