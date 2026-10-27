/**
 * v3 UI art (design 31.1, 35.3, 30.2): meet badges, medal pips and medals, the speech bubble
 * 9-slice and tail, and the alien landing beam. Authored with their outline inside their size. Pure.
 */
import { createMap, outline, parseRows, setPx, type IndexMap, type Legend } from '../bake/index.ts';
import { rect } from '../paint.ts';

const L: Legend = {
  k: 1,
  d: 2,
  D: 3,
  n: 4,
  g: 5,
  G: 6,
  l: 7,
  w: 8,
  y: 22,
  Y: 23,
  o: 21,
  O: 20,
  r: 17,
  R: 16,
  p: 41,
  b: 29,
  B: 30,
  c: 31,
  N: 28,
  m: 33,
  M: 34,
  u: 32,
  t: 36,
  T: 37,
  q: 35,
  e: 25,
  E: 26,
  f: 15,
  F: 14,
};

// ---------------------------------------------------------------------------
// Meet badges, 16x16 (design 31.1).
// ---------------------------------------------------------------------------

const BADGES: readonly (readonly string[])[] = [
  // 1 SPORTS DAY: a whistle on a lanyard.
  [
    '.....kkkk.......',
    '....krrrrk......',
    '...krk..krk.....',
    '...kk....kk.....',
    '...kk.....kk....',
    '....kk.....k....',
    '.....kk...kk....',
    '..kkkkkkkkkk....',
    '.kGllllllwwlkkk.',
    'kGlllkkllllllwlk',
    'kllllkkllllllggk',
    'klllllllllllggk.',
    'kggllllllggggk..',
    '.kgggggggggk....',
    '..kkkkkkkkk.....',
    '................',
  ],
  // 2 SCHOOL CHAMPS: a shield crest with a chevron.
  [
    '.kkkkkkkkkkkkkk.',
    'kBBBBBBBBBBBBbNk',
    'kBbbbbbbbbbbbbNk',
    'kbbbbbbbbbbbbbNk',
    'kbbyykbbbbkyybNk',
    'kbbbyykbbkyybbNk',
    'kbbbbyykkyybbbNk',
    'kbbbbbyyyybbbbNk',
    'kbbbbbbyybbbbbNk',
    '.kbbbbbbbbbbbNk.',
    '.kbbbbbbbbbbbNk.',
    '..kbbbbbbbbbNk..',
    '...kbbbbbbbNk...',
    '....kNbbbbNk....',
    '.....kkNNkk.....',
    '.......kk.......',
  ],
  // 3 CAMPUS GAMES: a purple pennant on a pole.
  [
    '.kk.............',
    'kwlk............',
    'kGlkkkk.........',
    'kGlkMMMkkk......',
    'kGlkMmmmMMkkk...',
    'kGlkMmwmmmmmMkk.',
    'kGlkmmwwmmmmmmuk',
    'kGlkmmwmmmmmuukk',
    'kGlkmmmmmuuukk..',
    'kGlkmmuuukkk....',
    'kGlkuukkk.......',
    'kGlkkk..........',
    'kGlk............',
    'kGlk............',
    'kGgk............',
    'kkkk............',
  ],
  // 4 CITY OPEN: a night skyline with lit windows.
  [
    '................',
    '.......kk.......',
    '......kDDk......',
    '.kkk..kDDk......',
    'kDDDk.kDyk.kkk..',
    'kDyDk.kDDk.kDDk.',
    'kDDDkkkyDkkkDyDk',
    'kDyDkDDkDDkDDDDk',
    'kDDDkDykyDkDyDDk',
    'kDyDkDDkDDkDDDyk',
    'kDDDkyDkDykDyDDk',
    'kDDyDDDkDDkDDDDk',
    'kDDDDyDkyDkDDyDk',
    'kddddddddddddddk',
    '.kkkkkkkkkkkkkk.',
    '................',
  ],
  // 5 WORLD GAMES: a torch with a flame (no rings).
  [
    '......kk........',
    '.....krk........',
    '....kryrk.......',
    '...kryYyrk......',
    '...kryYYyrk.....',
    '...krryYyrk.....',
    '....krrrrk......',
    '..kkkkkkkkkk....',
    '..kYyyyyyyook...',
    '...kyyyyyook....',
    '....kyyyook.....',
    '.....kyyok......',
    '.....kyook......',
    '.....kyook......',
    '.....kOOOk......',
    '.....kkkkk......',
  ],
  // 6 NEON CUP: a circuit chip with neon traces.
  [
    '...k.k.k.k.k....',
    '...M.M.M.M.M....',
    '.kkkkkkkkkkkkk..',
    'kMkDDDDDDDDDDkMk',
    '..kDTTTTTTTTDk..',
    'kMkDTqqqqqqTDkMk',
    '..kDTqttttqTDk..',
    'kMkDTqtTTtqTDkMk',
    '..kDTqttttqTDk..',
    'kMkDTqqqqqqTDkMk',
    '..kDTTTTTTTTDk..',
    'kMkDDDDDDDDDDkMk',
    '.kkkkkkkkkkkkk..',
    '...M.M.M.M.M....',
    '...k.k.k.k.k....',
    '................',
  ],
  // 7 GALACTIC MEET: a saucer with a teal dome and lights.
  [
    '................',
    '......kkkk......',
    '.....kTTttk.....',
    '....kTTtttqk....',
    '....kTttttqk....',
    '..kkkkkkkkkkkk..',
    '.kllwwllllllGGk.',
    'kGlllllllllllGGk',
    'kGTlGTlGTlGTlGgk',
    '.kgggggggggggggk',
    '..kkgggggggggkk.',
    '....kkkkkkkkk...',
    '.....T..T..T....',
    '....T...T...T...',
    '...T....T....T..',
    '................',
  ],
];

export const MEET_TIERS = [1, 2, 3, 4, 5, 6, 7] as const;

export function meetBadge(tier: number): IndexMap {
  const rows = BADGES[Math.min(7, Math.max(1, Math.round(tier))) - 1] as readonly string[];
  return parseRows(rows, L);
}

// ---------------------------------------------------------------------------
// Medals (design 29, 35.3): 6x6 pips with the place digit, 8x8 medals with a ribbon.
// ---------------------------------------------------------------------------

export type MedalPlace = 1 | 2 | 3;
export const MEDAL_PLACES: readonly MedalPlace[] = [1, 2, 3];

/** [shadow/digit, base, highlight] per place: gold, silver, bronze. */
const MEDAL_RAMP: Readonly<Record<MedalPlace, readonly [number, number, number]>> = {
  1: [20, 22, 23],
  2: [4, 7, 8],
  3: [38, 40, 19],
};

const PIP_DIGIT: Readonly<Record<MedalPlace, readonly string[]>> = {
  1: ['.#', '##', '.#', '.#'],
  2: ['##', '.#', '#.', '##'],
  3: ['##', '.#', '.#', '##'],
};

/** 6x6 ladder pip: a coin with the place digit in its shadow tone. */
export function medalPip(place: MedalPlace): IndexMap {
  const [sh, base, hi] = MEDAL_RAMP[place];
  const m = createMap(6, 6);
  rect(m, 1, 1, 4, 4, base);
  rect(m, 2, 0, 2, 1, base);
  rect(m, 2, 5, 2, 1, base);
  rect(m, 0, 2, 1, 2, base);
  rect(m, 5, 2, 1, 2, base);
  setPx(m, 1, 1, hi);
  PIP_DIGIT[place].forEach((r, y) => {
    for (let x = 0; x < 2; x++) if (r[x] === '#') setPx(m, 2 + x, 1 + y, sh);
  });
  // Outline the corners only: the coin edge is its own shadow tone so the 6 px stay a disc.
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [4, 0],
    [5, 0],
    [5, 1],
    [0, 4],
    [0, 5],
    [1, 5],
    [5, 4],
    [4, 5],
    [5, 5],
  ] as const)
    setPx(m, x, y, 1);
  setPx(m, 4, 4, sh);
  return m;
}

/** 8x8 medal for the results medal row: ribbon V, disc with a highlight and a shadow edge. */
export function medal(place: MedalPlace): IndexMap {
  const [sh, base, hi] = MEDAL_RAMP[place];
  const m = createMap(8, 8);
  // Ribbon: red and blue strips meeting at the disc.
  setPx(m, 1, 0, 29);
  setPx(m, 2, 1, 29);
  setPx(m, 6, 0, 17);
  setPx(m, 5, 1, 17);
  setPx(m, 3, 2, 29);
  setPx(m, 4, 2, 17);
  // Disc 6x5 under it.
  rect(m, 2, 3, 4, 5, base);
  rect(m, 1, 4, 6, 3, base);
  setPx(m, 2, 4, hi);
  setPx(m, 3, 3, hi);
  setPx(m, 6, 6, sh);
  setPx(m, 5, 7, sh);
  setPx(m, 5, 6, sh);
  const o = outline(m);
  // Keep inside 8x8: outline() never grows the map, so the bottom row's disc pixels stay unoutlined.
  return o;
}

// ---------------------------------------------------------------------------
// Speech bubble (design 31.2, 35.2): 9-slice of 4x4 corners/edges, index 8 fill, index 1 outline,
// plus a 3x3 tail that pokes down out of the bubble's bottom edge.
// ---------------------------------------------------------------------------

export const BUBBLE_CORNER = 4;
/** Frame names of the 9-slice pieces on the bubble texture (each 4x4), row by row. */
export const BUBBLE_PIECES = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'] as const;

/** 12x12 bubble: 4x4 corners, 4x4 edges and a 4x4 centre (stretch the edges and centre). */
export function speechBubble(): IndexMap {
  return parseRows(
    [
      '..kkkkkkkk..',
      '.kwwwwwwwwk.',
      'kwwwwwwwwwwk',
      'kwwwwwwwwwwk',
      'kwwwwwwwwwwk',
      'kwwwwwwwwwwk',
      'kwwwwwwwwwwk',
      'kwwwwwwwwwwk',
      'kwwwwwwwwwwk',
      'kwwwwwwwwwwk',
      '.kwwwwwwwwk.',
      '..kkkkkkkk..',
    ],
    L,
  );
}

/** 3x3 tail: place its top row over the bubble's bottom outline row (it opens the outline). */
export function speechBubbleTail(): IndexMap {
  return parseRows(['kwk', 'kwk', '.k.'], L);
}

// ---------------------------------------------------------------------------
// Alien landing beam (design 30.2 step 7, 35.2): 16x48, 4 frames at 12 fps, one static frame.
// ---------------------------------------------------------------------------

export const BEAM_FPS = 12;
export const BEAM_FRAMES = 4;

/** Frame i of the shimmer (0-3); `static` draws the beam with no moving bands (reduced flashing). */
export function landingBeam(i: number | 'static'): IndexMap {
  const m = createMap(16, 48);
  const shift = i === 'static' ? -1 : i * 3;
  for (let y = 0; y < 48; y++) {
    // The beam widens slightly toward the ground: 8 px at the top, 12 at the bottom.
    const half = 4 + Math.round((y / 47) * 2);
    for (let x = 8 - half; x < 8 + half; x++) {
      const edge = x === 8 - half || x === 8 + half - 1;
      const core = x >= 7 && x <= 8;
      let v = edge ? 35 : core ? 37 : 36;
      if (shift >= 0 && !edge && (y + shift) % 12 < 2) v = core ? 8 : 37;
      setPx(m, x, y, v);
    }
  }
  // Emitter lip at the top.
  rect(m, 3, 0, 10, 1, 37);
  return m;
}
