/**
 * Character specs: proportions, kit materials and hand-drawn heads (design 3.3, 3.4, 5.5).
 * Heads face right. Each head is drawn once; variants patch a few face pixels.
 */
import { cloneMap, parseRows, setPx, type Legend } from '../bake/index.ts';
import type { CharacterSpec, HeadStamp, HeadVariant, Pose, Ramp } from './rig.ts';

type Patch = readonly (readonly [number, number, string])[];

function makeHeads(
  rows: readonly string[],
  legend: Legend,
  ax: number,
  ay: number,
  variants: Partial<Record<HeadVariant, Patch>>,
): CharacterSpec['heads'] {
  const base = parseRows(rows, legend);
  const out: Partial<Record<HeadVariant, HeadStamp>> = {};
  out.normal = { map: base, ax, ay };
  for (const [name, patch] of Object.entries(variants) as [HeadVariant, Patch][]) {
    const m = cloneMap(base);
    for (const [x, y, ch] of patch) {
      const v = ch === '.' ? 0 : legend[ch];
      if (v === undefined) throw new Error(`head patch: unknown char ${ch}`);
      setPx(m, x, y, v);
    }
    out[name] = { map: m, ax, ay };
  }
  return out as CharacterSpec['heads'];
}

// Shared ramps [line, shadow, base, highlight].
const R = {
  skinLight: [11, 12, 13, 13] as Ramp,
  skinMid: [10, 11, 12, 13] as Ramp,
  skinTan: [9, 10, 11, 12] as Ramp,
  skinDark: [9, 9, 10, 11] as Ramp,
  white: [6, 7, 8, 8] as Ramp,
  red: [16, 17, 18, 19] as Ramp,
  yellow: [20, 21, 22, 23] as Ramp,
  orange: [20, 20, 21, 22] as Ramp,
  green: [24, 25, 26, 27] as Ramp,
  blue: [28, 28, 29, 30] as Ramp,
  navy: [2, 28, 28, 29] as Ramp,
  purple: [32, 32, 33, 34] as Ramp,
  teal: [35, 35, 36, 37] as Ramp,
  grey: [3, 4, 5, 6] as Ramp,
  chrome: [3, 5, 6, 7] as Ramp,
  black: [1, 2, 3, 4] as Ramp,
  hairDark: [1, 2, 14, 15] as Ramp,
  hairBrown: [14, 14, 15, 11] as Ramp,
};

const ADULT = {
  thigh: 8,
  shin: 8,
  upperArm: 6,
  foreArm: 5.5,
  foot: 3.6,
  torso: 12,
  neck: 1.5,
  thighR: [2.7, 2.0] as const,
  shinR: [1.9, 1.4] as const,
  upperArmR: [1.6, 1.4] as const,
  foreArmR: [1.35, 1.7] as const,
  torsoR: [4.0, 4.6] as const,
  footR: 1.45,
};

const kitFns = {
  skin: () => 'skin',
};

// ---------------------------------------------------------------------------
// Rio (player): red singlet with white trim, white shorts, yellow headband, dark short hair.
// ---------------------------------------------------------------------------
const rio: CharacterSpec = {
  id: 'rio',
  ...ADULT,
  materials: { skin: R.skinMid, kit: R.red, white: R.white, trim: R.white, shoe: R.white, sock: R.white },
  torsoMat: (u, v) => {
    if (u < 0.3) return 'white';
    if (u > 0.86 && v > -0.3) return 'trim';
    if (v < -0.62 && u > 0.36 && u < 0.86) return 'trim';
    return 'kit';
  },
  thighMat: (t) => (t < 0.42 ? 'white' : 'skin'),
  shinMat: (t) => (t > 0.86 ? 'sock' : 'skin'),
  upperArmMat: kitFns.skin,
  foreArmMat: kitFns.skin,
  footMat: 'shoe',
  neckMat: 'skin',
  heads: makeHeads(
    [
      '...hhhhh...',
      '.hhhHHHhh..',
      'hhhHHhhhhh.',
      'oyyyYYYYYy.',
      'ooooyyyyyo.',
      'hhhhzsssSs.',
      'hhhzZsssess',
      '.hhzzssssss',
      '.khhzsssmZ.',
      '..kkzzsss..',
      '....zzzz...',
    ],
    { h: 14, H: 15, k: 2, s: 12, S: 13, z: 11, Z: 10, y: 22, Y: 23, o: 21, e: 1, m: 10, w: 8 },
    4,
    10,
    {
      effort: [
        [8, 8, 'm'],
        [9, 8, 'w'],
      ],
      happy: [
        [8, 6, 'Z'],
        [7, 8, 'm'],
        [8, 8, 'Z'],
        [9, 8, 'Z'],
      ],
      sad: [
        [8, 5, 'Z'],
        [8, 8, 's'],
        [9, 8, 'm'],
      ],
    },
  ),
};

// ---------------------------------------------------------------------------
// Pip: ~30 px kid, oversized yellow cap, green PE shirt, red sneakers, tiny backpack.
// ---------------------------------------------------------------------------
const pip: CharacterSpec = {
  id: 'pip',
  thigh: 5,
  shin: 5,
  upperArm: 4,
  foreArm: 3.6,
  foot: 3,
  torso: 8,
  neck: 0.5,
  thighR: [2.2, 1.7],
  shinR: [1.6, 1.35],
  upperArmR: [1.4, 1.2],
  foreArmR: [1.15, 1.5],
  torsoR: [3.5, 3.9],
  footR: 1.45,
  materials: {
    skin: R.skinLight,
    kit: R.green,
    shorts: R.navy,
    shoe: R.red,
    sock: R.white,
    pack: R.blue,
    strap: R.navy,
  },
  torsoMat: (u) => (u < 0.3 ? 'shorts' : 'kit'),
  thighMat: (t) => (t < 0.45 ? 'shorts' : 'skin'),
  shinMat: (t) => (t > 0.72 ? 'sock' : 'skin'),
  upperArmMat: (t) => (t < 0.35 ? 'kit' : 'skin'),
  foreArmMat: kitFns.skin,
  footMat: 'shoe',
  neckMat: 'skin',
  props: [{ from: [0.42, -1.25], to: [0.9, -1.3], r: 2.1, mat: 'pack', layer: 'behind' }],
  heads: makeHeads(
    [
      '....yyyyy....',
      '..yyYYYyyy...',
      '.yYYYyyyyyy..',
      '.yyyyyyyyyyyy',
      '.hoooooooooo.',
      'hhhhssssSSs..',
      'hhhzZsssSes..',
      'hhhzzssssess.',
      '.hhzsssSssss.',
      '..hzzssmms...',
      '...zzzsss....',
      '.....zzz.....',
    ],
    { h: 15, s: 13, S: 13, z: 12, Z: 11, y: 22, Y: 23, o: 20, e: 1, m: 11 },
    4,
    11,
    {
      effort: [
        [7, 9, 'Z'],
        [8, 9, 'm'],
      ],
      happy: [
        [9, 6, 'Z'],
        [9, 7, 's'],
        [7, 9, 'Z'],
        [8, 9, 'Z'],
      ],
      sad: [
        [9, 6, 's'],
        [8, 5, 'Z'],
        [7, 9, 's'],
        [8, 9, 'Z'],
      ],
      look: [
        [9, 6, 's'],
        [10, 7, 's'],
        [8, 6, 'e'],
        [8, 7, 'e'],
      ],
    },
  ),
};

// ---------------------------------------------------------------------------
// Jess: ponytail, blue track jacket, earbuds, white shorts.
// ---------------------------------------------------------------------------
const jess: CharacterSpec = {
  id: 'jess',
  ...ADULT,
  torso: 11.5,
  thighR: [2.5, 1.8],
  torsoR: [3.8, 4.3],
  materials: { skin: R.skinLight, jacket: R.blue, zip: R.white, white: R.white, shoe: R.blue, sock: R.white },
  torsoMat: (u, v) => {
    if (u < 0.28) return 'white';
    if (v > 0.6 && u > 0.34) return 'zip';
    return 'jacket';
  },
  thighMat: (t) => (t < 0.38 ? 'white' : 'skin'),
  shinMat: (t) => (t > 0.85 ? 'sock' : 'skin'),
  upperArmMat: () => 'jacket',
  foreArmMat: (t) => (t < 0.72 ? 'jacket' : 'skin'),
  footMat: 'shoe',
  neckMat: 'skin',
  heads: makeHeads(
    [
      '.....hhhhh...',
      '...hhhHHHhh..',
      '..hhhHHhhhhh.',
      'Hhhhhhhhhhhh.',
      'hHhhhhhhhhhs.',
      'hhh.hhzsssSs.',
      'hh..hwZsssess',
      'hk..hzwssssss',
      '.k..hzwsssmZ.',
      '.....zwsss...',
      '......zzzz...',
    ],
    { h: 15, H: 11, k: 14, s: 13, S: 13, z: 12, Z: 11, e: 1, m: 11, w: 8 },
    6,
    10,
    {
      effort: [
        [10, 8, 'Z'],
        [11, 8, 's'],
      ],
      happy: [
        [10, 6, 'Z'],
        [9, 8, 'Z'],
        [10, 8, 'Z'],
      ],
      sad: [
        [10, 5, 'Z'],
        [10, 8, 's'],
        [11, 8, 'm'],
      ],
    },
  ),
};

// ---------------------------------------------------------------------------
// Marco: purple uni hoodie, headphones on neck, sunglasses pushed up, scruffy hair.
// ---------------------------------------------------------------------------
const marco: CharacterSpec = {
  id: 'marco',
  ...ADULT,
  materials: {
    skin: R.skinTan,
    hoodie: R.purple,
    hood: R.purple,
    shorts: R.grey,
    shoe: R.black,
    sock: R.white,
    phones: R.white,
    cup: R.grey,
  },
  torsoMat: (u, v) => {
    if (u < 0.26) return 'shorts';
    if (u < 0.36 && v > -0.6) return 'hood';
    return 'hoodie';
  },
  thighMat: (t) => (t < 0.45 ? 'shorts' : 'skin'),
  shinMat: (t) => (t > 0.85 ? 'sock' : 'skin'),
  upperArmMat: () => 'hoodie',
  foreArmMat: (t) => (t < 0.7 ? 'hoodie' : 'skin'),
  footMat: 'shoe',
  neckMat: 'skin',
  props: [
    { from: [0.78, -1.15], to: [0.98, -1.25], r: 1.8, mat: 'hood', layer: 'behind' },
    // Headphones round the neck: a white band with a grey ear cup at the front, so the shape reads
    // against both the purple hoodie and the skin.
    { from: [1.02, -0.8], to: [1.06, 0.3], r: 0.9, mat: 'phones', layer: 'front' },
    { from: [1.0, 0.6], to: [0.96, 0.62], r: 1.7, mat: 'cup', layer: 'front' },
  ],
  heads: makeHeads(
    [
      '.h.hh.hh...',
      'hhhhhhhhhh.',
      'hhhHHhhhhhh',
      'hhhhhgGGGg.',
      'hhhhhhhhhs.',
      'hhhhzsssSs.',
      'hhhzZsssess',
      '.hhzzssssss',
      '.hhhzsssmZ.',
      '..hhzzsss..',
      '....zzzz...',
    ],
    { h: 15, H: 11, s: 11, S: 12, z: 10, Z: 9, g: 1, G: 3, e: 1, m: 9 },
    4,
    10,
    {
      effort: [
        [8, 8, 'Z'],
        [9, 8, 's'],
      ],
      happy: [
        [8, 6, 'Z'],
        [7, 8, 'Z'],
        [8, 8, 'Z'],
      ],
      sad: [
        [8, 5, 'Z'],
        [8, 8, 's'],
        [9, 8, 'm'],
      ],
      // Looks at the camera while coasting: eye moves back, cheeky grin.
      look: [
        [8, 6, 's'],
        [7, 6, 'e'],
        [7, 8, 'Z'],
        [8, 8, 'Z'],
        [9, 8, 'Z'],
      ],
    },
  ),
};

// ---------------------------------------------------------------------------
// Kofi: green and yellow club singlet, muscular build, focused eyebrows.
// ---------------------------------------------------------------------------
const kofi: CharacterSpec = {
  id: 'kofi',
  ...ADULT,
  thighR: [3.0, 2.2],
  shinR: [2.1, 1.5],
  upperArmR: [1.95, 1.6],
  foreArmR: [1.6, 1.9],
  torsoR: [4.3, 5.2],
  materials: {
    skin: R.skinDark,
    kit: R.green,
    band: R.yellow,
    shorts: R.black,
    shoe: R.yellow,
    sock: R.white,
  },
  torsoMat: (u, v) => {
    if (u < 0.28) return 'shorts';
    if (Math.abs(u - 0.62 + v * 0.25) < 0.1) return 'band';
    if (u > 0.88 && v > -0.3) return 'band';
    return 'kit';
  },
  thighMat: (t) => (t < 0.4 ? 'shorts' : 'skin'),
  shinMat: (t) => (t > 0.86 ? 'sock' : 'skin'),
  upperArmMat: kitFns.skin,
  foreArmMat: kitFns.skin,
  footMat: 'shoe',
  neckMat: 'skin',
  heads: makeHeads(
    [
      '...hhhhh...',
      '.hhHHhhhh..',
      'hhhhhhhhhh.',
      'hhhhhhhhhs.',
      'hhhzsssssS.',
      'hhzzsssbbs.',
      'hzZzssssess',
      '.zzzssssss.',
      '.zzzsssmZ..',
      '..zzzsss...',
      '....zzzz...',
    ],
    { h: 1, H: 14, s: 10, S: 11, z: 9, Z: 14, b: 1, e: 1, m: 9 },
    4,
    10,
    {
      effort: [
        [7, 8, 'm'],
        [8, 8, 'Z'],
      ],
      happy: [
        [8, 5, 's'],
        [9, 5, 's'],
        [8, 6, 'b'],
        [6, 8, 'Z'],
        [7, 8, 'Z'],
      ],
      sad: [
        [8, 5, 's'],
        [8, 6, 'b'],
        [9, 6, 's'],
        [7, 8, 's'],
      ],
    },
  ),
};

// ---------------------------------------------------------------------------
// Valentina: gold and blue national kit, long braid, medal glint on celebrate.
// ---------------------------------------------------------------------------
const valentina: CharacterSpec = {
  id: 'valentina',
  ...ADULT,
  thighR: [2.5, 1.8],
  shinR: [1.75, 1.3],
  torsoR: [3.6, 4.2],
  materials: {
    skin: R.skinMid,
    kit: R.blue,
    gold: R.yellow,
    shoe: R.yellow,
    sock: R.white,
    braid: R.hairBrown,
    medal: R.yellow,
    ribbon: R.red,
  },
  torsoMat: (u, v) => {
    if (u < 0.27) return 'kit';
    if (u < 0.33) return 'gold';
    if (u > 0.86 && v > -0.3) return 'gold';
    if (v < -0.62 && u > 0.33) return 'gold';
    return u < 0.5 ? 'skin' : 'kit';
  },
  thighMat: (t) => (t < 0.3 ? 'kit' : 'skin'),
  shinMat: (t) => (t > 0.86 ? 'sock' : 'skin'),
  upperArmMat: kitFns.skin,
  foreArmMat: kitFns.skin,
  footMat: 'shoe',
  neckMat: 'skin',
  props: [
    { from: [1.05, -1.2], to: [0.45, -1.35], r: 1.25, mat: 'braid', layer: 'front' },
    {
      from: [0.98, 0.1],
      to: [0.72, 0.55],
      r: 0.6,
      mat: 'ribbon',
      layer: 'front',
      when: (p) => p.tag === 'celebrate',
    },
    {
      from: [0.66, 0.6],
      to: [0.64, 0.62],
      r: 1.4,
      mat: 'medal',
      layer: 'front',
      when: (p) => p.tag === 'celebrate',
    },
  ],
  heads: makeHeads(
    [
      '...hhhhh...',
      '.hhhHHHhh..',
      'hhhHHhhhhh.',
      'hhhhhhhhhhh',
      'hhhhhhhhhs.',
      'hhhhzsssSe.',
      'hhhzZsssess',
      '.hhzzssssss',
      '.hhhzssrrZ.',
      '..hhzzsss..',
      '....zzzz...',
    ],
    { h: 15, H: 11, s: 12, S: 13, z: 11, Z: 10, e: 1, r: 17 },
    4,
    10,
    {
      effort: [
        [7, 8, 's'],
        [8, 8, 'r'],
        [9, 8, 'Z'],
      ],
      happy: [
        [8, 6, 'Z'],
        [9, 5, 's'],
        [7, 8, 'r'],
        [8, 8, 'r'],
        [9, 8, 'r'],
      ],
      sad: [
        [9, 5, 's'],
        [8, 5, 'Z'],
        [7, 8, 's'],
        [8, 8, 's'],
        [8, 9, 'r'],
      ],
    },
  ),
};

// ---------------------------------------------------------------------------
// UNIT-7: chrome body (neutral ramp), teal visor glow, piston legs, exhaust.
// ---------------------------------------------------------------------------
const UNIT7_LEGEND: Legend = { n: 5, m: 6, M: 7, W: 8, N: 4, d: 2, v: 36, V: 37, b: 3 };
const unit7: CharacterSpec = {
  id: 'unit7',
  ...ADULT,
  thighR: [2.0, 1.6],
  shinR: [1.7, 1.7],
  upperArmR: [1.5, 1.3],
  foreArmR: [1.4, 1.8],
  torsoR: [4.0, 5.0],
  materials: {
    chrome: R.chrome,
    joint: R.black,
    panel: R.black,
    light: R.teal,
    shoe: R.grey,
    pipe: R.grey,
  },
  torsoMat: (u, v) => {
    if (u < 0.22) return 'joint';
    if (u > 0.5 && u < 0.62 && v > 0.1 && v < 0.6) return 'light';
    if (u > 0.4 && u < 0.78 && v > -0.1) return 'panel';
    return 'chrome';
  },
  thighMat: (t) => (t < 0.18 || t > 0.86 ? 'joint' : 'chrome'),
  shinMat: (t) => (t > 0.86 ? 'joint' : 'chrome'),
  upperArmMat: (t) => (t > 0.85 ? 'joint' : 'chrome'),
  foreArmMat: () => 'chrome',
  footMat: 'shoe',
  neckMat: 'joint',
  props: [{ from: [0.5, -1.1], to: [0.95, -1.45], r: 1.2, mat: 'pipe', layer: 'behind' }],
  selout: false,
  heads: makeHeads(
    [
      '...nmmmn...',
      '.nmmMMMmmn.',
      'nmmMWMmmmmn',
      'nmmMmmmmmmn',
      'nmmmmmddddd',
      'nmmmmdVVVVd',
      'nnmbmdvvvvd',
      'nnnmmmddddd',
      '.nnnmmmmmn.',
      '..NnnmmmmN.',
      '...NNNnn...',
    ],
    UNIT7_LEGEND,
    4,
    10,
    {
      effort: [
        [6, 5, 'V'],
        [6, 6, 'v'],
      ],
      happy: [
        [7, 6, 'V'],
        [8, 6, 'V'],
      ],
      sad: [
        [6, 5, 'd'],
        [7, 5, 'v'],
        [8, 5, 'v'],
        [9, 5, 'v'],
        [10, 5, 'v'],
      ],
    },
  ),
};

// ---------------------------------------------------------------------------
// Zyx: teal skin, three eyes, purple bodysuit, antenna, longer legs, ~44 px tall.
// ---------------------------------------------------------------------------
const zyx: CharacterSpec = {
  id: 'zyx',
  raisedReachScale: 0,
  thigh: 9.5,
  shin: 10,
  upperArm: 6.6,
  foreArm: 6.2,
  foot: 3.8,
  torso: 11.5,
  neck: 2,
  thighR: [2.3, 1.6],
  shinR: [1.5, 1.15],
  upperArmR: [1.4, 1.15],
  foreArmR: [1.1, 1.45],
  torsoR: [3.5, 4.3],
  footR: 1.35,
  materials: { skin: R.teal, suit: R.purple, belt: R.teal, shoe: [1, 32, 32, 33], glow: R.teal },
  torsoMat: (u, v) => {
    if (u > 0.25 && u < 0.31) return 'belt';
    if (u > 0.4 && u < 0.92 && v > 0.55) return 'glow';
    return 'suit';
  },
  thighMat: () => 'suit',
  shinMat: () => 'suit',
  upperArmMat: () => 'suit',
  foreArmMat: (t) => (t < 0.78 ? 'suit' : 'skin'),
  footMat: 'shoe',
  neckMat: 'skin',
  heads: makeHeads(
    [
      '......T.....',
      '......a.....',
      '.....a......',
      '...ttttttt..',
      '..tTTTttEtt.',
      '.tTTttttEtt.',
      '.tttttttttt.',
      '.uttttEttEtt',
      '.uutttEttEt.',
      '..uutttmmt..',
      '...uutttt...',
      '....uuuu....',
    ],
    { t: 36, T: 37, u: 35, a: 35, E: 1, m: 35 },
    4,
    11,
    {
      effort: [
        [7, 9, 't'],
        [8, 9, 'm'],
        [9, 9, 'm'],
      ],
      happy: [
        [7, 9, 'm'],
        [8, 9, 'T'],
        [9, 9, 'm'],
      ],
      sad: [
        [7, 9, 't'],
        [8, 10, 'm'],
        [9, 9, 'm'],
      ],
    },
  ),
};

export const SPECS = { rio, pip, jess, marco, kofi, valentina, unit7, zyx } as const;
export type SpecId = keyof typeof SPECS;
export type { Pose };
