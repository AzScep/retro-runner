/**
 * UI icons (design 6.2, 6.4, 6.7). 16x16 except head markers 6x4 and offscreenArrow 8x8.
 * Authored with their outline included so they fit their declared size exactly.
 */
import { createMap, flipH, outline, parseRows, type IndexMap, type Legend } from '../bake/index.ts';
import { rect } from '../paint.ts';

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
  | 'offscreenArrow';

export type KeyState = 'dim' | 'bright' | 'wrong';

const KEY_COLORS: Readonly<Record<KeyState, { fill: number; lip: number; border: number; glyph: number }>> = {
  // Before GO / not expected: dim (index 5).
  dim: { fill: 5, lip: 4, border: 4, glyph: 3 },
  // Expected key: index 8 fill, index 22 border (design 6.4).
  bright: { fill: 8, lip: 7, border: 22, glyph: 2 },
  // Fumble: tinted index 17 (design 6.2).
  wrong: { fill: 17, lip: 16, border: 16, glyph: 8 },
};

/** Keyboard key cap with an arrow, pointing right. */
function keyCap(state: KeyState): IndexMap {
  const c = KEY_COLORS[state];
  const m = createMap(16, 16);
  rect(m, 2, 1, 12, 13, c.border);
  rect(m, 1, 2, 14, 11, c.border);
  rect(m, 3, 2, 10, 10, c.fill);
  rect(m, 2, 3, 12, 8, c.fill);
  rect(m, 3, 12, 10, 1, c.lip);
  rect(m, 2, 11, 12, 1, c.lip);
  // Arrow pointing right.
  const arrow = ['....#...', '....##..', '#######.', '########', '#######.', '....##..', '....#...'];
  arrow.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') rect(m, 4 + x, 3 + y, 1, 1, c.glyph);
  });
  // Outer outline within the 16x16 cell.
  const o = outline(m);
  return o;
}

export function keyIcon(side: 'L' | 'R', state: KeyState): IndexMap {
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

const ART: Readonly<Record<Exclude<IconName, 'arrowLeft' | 'arrowRight'>, readonly string[]>> = {
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

export function buildIcon(name: IconName): IndexMap {
  if (name === 'arrowRight') return keyIcon('R', 'bright');
  if (name === 'arrowLeft') return keyIcon('L', 'bright');
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
];

export function iconSize(name: IconName): readonly [number, number] {
  if (name === 'headRival' || name === 'headPlayer') return [6, 4];
  if (name === 'offscreenArrow') return [8, 8];
  return [16, 16];
}
