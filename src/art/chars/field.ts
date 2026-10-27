/**
 * Field runners (design 24.2, 35.1): 7 cohort bodies, 4 palette variants each, 31 frames per variant.
 *
 * Each body is a CharacterSpec rig with one hand-drawn head. A variant swaps material ramps (kit,
 * skin, hair), patches a few head pixels for the hair shape and, for long hair, adds one hanging
 * torso prop. Kit ramps never contain index 18 (the player's kit, design 24.2). Pure (no Phaser).
 */
import { createMap, cloneMap, parseRows, setPx, type IndexMap, type Legend } from '../bake/index.ts';
import { fieldAnims, type FieldAnimName } from './poses.ts';
import {
  renderPose,
  type CharacterSpec,
  type HeadStamp,
  type HeadVariant,
  type Ramp,
  type TorsoProp,
} from './rig.ts';
import type { CharFrame, CharAnim } from './index.ts';
import { READY_SHIFT_PX } from '../view/runner.ts';

/** Design pivot column (chars/index.ts PIVOT_X; not imported to keep this module free of cycles). */
const PIVOT_X = 24;

export type FieldBody = 'fKid' | 'fTeen' | 'fStudent' | 'fClub' | 'fElite' | 'fBot' | 'fDrone';
export type FieldVariantId = 'A' | 'B' | 'C' | 'D';

export const FIELD_BODIES: readonly FieldBody[] = [
  'fKid',
  'fTeen',
  'fStudent',
  'fClub',
  'fElite',
  'fBot',
  'fDrone',
];
export const FIELD_VARIANTS: readonly FieldVariantId[] = ['A', 'B', 'C', 'D'];
/** Tier of each body (design 24.2). */
export const FIELD_TIER: Readonly<Record<FieldBody, number>> = {
  fKid: 1,
  fTeen: 2,
  fStudent: 3,
  fClub: 4,
  fElite: 5,
  fBot: 6,
  fDrone: 7,
};

// ---------------------------------------------------------------------------
// Ramps [line, shadow, base, highlight]. No ramp here contains index 18.
// ---------------------------------------------------------------------------

const K = {
  red: [16, 16, 17, 19],
  blue: [28, 28, 29, 30],
  sky: [29, 29, 30, 31],
  green: [24, 25, 26, 27],
  forest: [24, 24, 25, 26],
  yellow: [20, 21, 22, 23],
  orange: [20, 20, 21, 22],
  navy: [1, 2, 28, 29],
  white: [6, 7, 8, 8],
  purple: [32, 32, 33, 34],
  teal: [35, 35, 36, 37],
  grey: [3, 4, 5, 6],
  chrome: [3, 5, 6, 7],
  black: [1, 2, 3, 4],
  pink: [16, 17, 41, 19],
} as const satisfies Record<string, Ramp>;

const SKIN = {
  light: [11, 12, 13, 13],
  mid: [10, 11, 12, 13],
  tan: [9, 10, 11, 12],
  dark: [9, 9, 10, 11],
} as const satisfies Record<string, Ramp>;

/** Hair tones: k shadow, h base, H highlight. */
interface Hair {
  readonly k: number;
  readonly h: number;
  readonly H: number;
}
const HAIR = {
  black: { k: 1, h: 1, H: 3 },
  dark: { k: 1, h: 14, H: 15 },
  brown: { k: 14, h: 15, H: 11 },
  blonde: { k: 20, h: 21, H: 22 },
} as const satisfies Record<string, Hair>;

// ---------------------------------------------------------------------------
// Heads. Letters: s/S/z/Z skin base/highlight/shadow/line, e eye, m mouth, h/H/k hair, w white,
// c/C/d accessory in the kit ramp (cap, headband), plus body-specific letters for the machines.
// ---------------------------------------------------------------------------

type Patch = readonly (readonly [number, number, string])[];

interface HeadDef {
  readonly rows: readonly string[];
  readonly ax: number;
  readonly ay: number;
  /** Expression patches over the base face (same for every variant). */
  readonly faces: Partial<Record<HeadVariant, Patch>>;
}

const KID_HEAD: HeadDef = {
  rows: [
    '..............',
    '.....hhhhh....',
    '...hhhHHHhh...',
    '..hhHHhhhhhh..',
    '.hhhhhhhhhhhh.',
    '.hhhhhhhhhhs..',
    '.hhhhzssSsss..',
    '.hhhzZsssess..',
    '.hhhzzsssesss.',
    '..hhzsssSsss..',
    '...hzzssmms...',
    '....zzzsss....',
    '......zzz.....',
  ],
  ax: 5,
  ay: 12,
  faces: {
    effort: [
      [8, 10, 'Z'],
      [9, 10, 'm'],
    ],
    happy: [
      [9, 7, 'Z'],
      [9, 8, 's'],
      [8, 10, 'Z'],
      [9, 10, 'Z'],
    ],
    sad: [
      [9, 7, 's'],
      [8, 6, 'Z'],
      [8, 10, 's'],
      [9, 10, 'Z'],
    ],
  },
};

const TEEN_HEAD: HeadDef = {
  rows: [
    '.............',
    '....hhhhh....',
    '..hhhHHHhh...',
    '.hhhHHhhhhh..',
    '.hhhhhhhhhhh.',
    '.hhhhhhhhhs..',
    '.hhhhzsssSs..',
    '.hhhzZsssess.',
    '..hhzzsssss..',
    '..hhhzssmZ...',
    '...hhzzss....',
    '.....zzz.....',
  ],
  ax: 5,
  ay: 11,
  faces: {
    effort: [
      [8, 9, 'Z'],
      [9, 9, 's'],
    ],
    happy: [
      [9, 7, 'Z'],
      [8, 9, 'Z'],
      [9, 9, 'Z'],
    ],
    sad: [
      [9, 6, 'Z'],
      [9, 7, 'e'],
      [8, 9, 's'],
      [9, 9, 'm'],
    ],
  },
};

const STUDENT_HEAD: HeadDef = {
  rows: [
    '.............',
    '....hhhhh....',
    '..hhhHHHhh...',
    '.hhhHHhhhhh..',
    '.hhhhhhhhhhh.',
    '.ccccccCCCc..',
    '.hhhhzsssSs..',
    '.hhhzZsssess.',
    '..hhzzssssss.',
    '..hhhzsssmZ..',
    '...hhzzsss...',
    '.....zzzz....',
  ],
  ax: 5,
  ay: 11,
  faces: {
    effort: [
      [9, 9, 'Z'],
      [10, 9, 's'],
    ],
    happy: [
      [9, 7, 'Z'],
      [8, 9, 'Z'],
      [9, 9, 'Z'],
      [10, 9, 'Z'],
    ],
    sad: [
      [9, 6, 'Z'],
      [9, 7, 'e'],
      [9, 9, 's'],
      [10, 9, 'm'],
    ],
  },
};

const CLUB_HEAD: HeadDef = {
  rows: [
    '.............',
    '....hhhhh....',
    '..hhHHhhhh...',
    '.hhhhhhhhhh..',
    '.hhhhhhhhhhs.',
    '.hhhhzsssssS.',
    '.hhhzzsssbbs.',
    '.hzZzsssssess',
    '..zzzssssssss',
    '..zzzssssmZ..',
    '...zzzzsss...',
    '.....zzzz....',
  ],
  ax: 5,
  ay: 11,
  faces: {
    effort: [
      [9, 9, 'Z'],
      [10, 9, 'Z'],
      [9, 6, 'b'],
    ],
    happy: [
      [9, 6, 's'],
      [8, 9, 'Z'],
      [9, 9, 'Z'],
      [10, 9, 'Z'],
    ],
    sad: [
      [9, 6, 's'],
      [10, 6, 'b'],
      [9, 9, 's'],
      [10, 9, 'm'],
    ],
  },
};

const ELITE_HEAD: HeadDef = {
  rows: [
    '.............',
    '....hhhhh....',
    '..hhhHHHhh...',
    '.hhhHHhhhhh..',
    '.hhhhhhhhhhh.',
    '.hhhhhhhhhs..',
    '.hhhhzsssSe..',
    '.hhhzZsssess.',
    '..hhzzssssss.',
    '..hhhzssrrZ..',
    '...hhzzsss...',
    '.....zzzz....',
  ],
  ax: 5,
  ay: 11,
  faces: {
    effort: [
      [8, 9, 's'],
      [9, 9, 'r'],
      [10, 9, 'Z'],
    ],
    happy: [
      [9, 7, 'Z'],
      [8, 9, 'r'],
      [9, 9, 'r'],
      [10, 9, 'r'],
    ],
    sad: [
      [10, 6, 's'],
      [9, 6, 'Z'],
      [8, 9, 's'],
      [9, 9, 's'],
      [9, 10, 'r'],
    ],
  },
};

/** Practice robot: boxy grey head, one round visor at the front (design 24.2). */
const BOT_HEAD: HeadDef = {
  rows: [
    '...........',
    '..nmmmmmn..',
    '.nmMMMmmmn.',
    'nmMWMmmmmmn',
    'nmMmmmmvvvn',
    'nmmmmmvVVvd',
    'nmmmmmvVvvd',
    'nnmbmmmvvdd',
    'nnnmmmmmddd',
    '.nnnmmmmmn.',
    '..NnnmmmN..',
    '...NNNnn...',
  ],
  ax: 4,
  ay: 11,
  faces: {
    effort: [[8, 5, 'W']],
    happy: [
      [7, 5, 'W'],
      [8, 5, 'W'],
    ],
    sad: [
      [7, 4, 'n'],
      [8, 4, 'n'],
      [9, 4, 'n'],
    ],
  },
};

/** Alien drone: smooth teal dome, one dark band visor with a glow line, short antenna. */
const DRONE_HEAD: HeadDef = {
  rows: [
    '.....T......',
    '.....a......',
    '...tttttt...',
    '..tTTttttt..',
    '.tTTttttttt.',
    '.tTtttttttt.',
    '.uttddddddd.',
    '.uutdVVVVVd.',
    '.uutttttttt.',
    '..uutttttt..',
    '...uuutttt..',
    '....uuuu....',
  ],
  ax: 4,
  ay: 11,
  faces: {
    effort: [
      [9, 7, 'v'],
      [10, 7, 'v'],
    ],
    happy: [
      [5, 7, 'T'],
      [6, 7, 'T'],
    ],
    sad: [
      [8, 7, 'd'],
      [9, 7, 'd'],
    ],
  },
};

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

interface BodyDef {
  readonly head: HeadDef;
  /** Proportions (the CharacterSpec fields that do not depend on the variant). */
  readonly build: Omit<
    CharacterSpec,
    | 'id'
    | 'materials'
    | 'heads'
    | 'torsoMat'
    | 'thighMat'
    | 'shinMat'
    | 'upperArmMat'
    | 'foreArmMat'
    | 'footMat'
    | 'neckMat'
    | 'props'
    | 'decal'
  >;
  readonly torsoMat: CharacterSpec['torsoMat'];
  readonly thighMat: CharacterSpec['thighMat'];
  readonly shinMat: CharacterSpec['shinMat'];
  readonly upperArmMat: CharacterSpec['upperArmMat'];
  readonly foreArmMat: CharacterSpec['foreArmMat'];
  readonly neckMat: string;
}

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

const BODIES: Readonly<Record<FieldBody, BodyDef>> = {
  // Sports day kid (~30 px): house-colour PE shirt, white shorts, plimsolls, pinned bib.
  fKid: {
    head: KID_HEAD,
    build: {
      thigh: 5,
      shin: 5,
      upperArm: 4,
      foreArm: 3.6,
      foot: 3,
      torso: 8,
      neck: 0.5,
      thighR: [2.1, 1.6],
      shinR: [1.5, 1.3],
      upperArmR: [1.35, 1.15],
      foreArmR: [1.1, 1.45],
      torsoR: [3.4, 3.8],
      footR: 1.4,
    },
    torsoMat: (u) => (u < 0.3 ? 'shorts' : 'kit'),
    thighMat: (t) => (t < 0.45 ? 'shorts' : 'skin'),
    shinMat: (t) => (t > 0.78 ? 'sock' : 'skin'),
    upperArmMat: (t) => (t < 0.38 ? 'kit' : 'skin'),
    foreArmMat: () => 'skin',
    neckMat: 'skin',
  },
  // School team (~37 px): slim, track vest with trim, shorts, long socks.
  fTeen: {
    head: TEEN_HEAD,
    build: {
      thigh: 7,
      shin: 7.2,
      upperArm: 5.4,
      foreArm: 5,
      foot: 3.4,
      torso: 10.6,
      neck: 1.2,
      thighR: [2.35, 1.75],
      shinR: [1.7, 1.3],
      upperArmR: [1.4, 1.25],
      foreArmR: [1.2, 1.5],
      torsoR: [3.5, 4.0],
      footR: 1.35,
    },
    torsoMat: (u, v) => {
      if (u < 0.3) return 'shorts';
      if (u > 0.86 && v > -0.3) return 'trim';
      if (v < -0.6 && u > 0.36) return 'trim';
      return 'kit';
    },
    thighMat: (t) => (t < 0.42 ? 'shorts' : 'skin'),
    shinMat: (t) => (t > 0.42 ? 'sock' : 'skin'),
    upperArmMat: () => 'skin',
    foreArmMat: () => 'skin',
    neckMat: 'skin',
  },
  // Campus runner (~40 px): club tee with sleeves, black running tights, headband or cap.
  fStudent: {
    head: STUDENT_HEAD,
    build: { ...ADULT, torsoR: [3.9, 4.5] },
    torsoMat: (u) => (u < 0.28 ? 'tights' : 'kit'),
    thighMat: () => 'tights',
    shinMat: (t) => (t < 0.62 ? 'tights' : t > 0.86 ? 'sock' : 'skin'),
    upperArmMat: (t) => (t < 0.5 ? 'kit' : 'skin'),
    foreArmMat: () => 'skin',
    neckMat: 'skin',
  },
  // Club athlete (~40 px): broad build, singlet with a hoop stripe, compression shorts to the knee.
  fClub: {
    head: CLUB_HEAD,
    build: {
      ...ADULT,
      thighR: [3.0, 2.25],
      shinR: [2.1, 1.5],
      upperArmR: [1.8, 1.5],
      foreArmR: [1.5, 1.8],
      torsoR: [4.4, 5.3],
    },
    torsoMat: (u, v) => {
      if (u < 0.3) return 'shorts';
      if (u > 0.52 && u < 0.68) return 'hoop';
      if (u > 0.88 && v > -0.3) return 'hoop';
      return 'kit';
    },
    thighMat: (t) => (t < 0.78 ? 'shorts' : 'skin'),
    shinMat: (t) => (t > 0.86 ? 'sock' : 'skin'),
    upperArmMat: () => 'skin',
    foreArmMat: () => 'skin',
    neckMat: 'skin',
  },
  // International finalist (~41 px): lean, long legs, crop top and briefs, spikes.
  fElite: {
    head: ELITE_HEAD,
    build: {
      thigh: 8.3,
      shin: 8.5,
      upperArm: 6.3,
      foreArm: 5.8,
      foot: 3.7,
      torso: 12,
      neck: 1.6,
      thighR: [2.4, 1.7],
      shinR: [1.65, 1.2],
      upperArmR: [1.45, 1.25],
      foreArmR: [1.2, 1.55],
      torsoR: [3.5, 4.1],
      footR: 1.4,
      raisedReachScale: 0.6,
    },
    torsoMat: (u, v) => {
      if (u < 0.26) return 'briefs';
      if (u < 0.46) return 'skin';
      if (u > 0.88 && v > -0.3) return 'trim';
      if (v < -0.62) return 'trim';
      return 'kit';
    },
    thighMat: (t) => (t < 0.24 ? 'briefs' : 'skin'),
    shinMat: () => 'skin',
    upperArmMat: () => 'skin',
    foreArmMat: () => 'skin',
    neckMat: 'skin',
  },
  // Practice robot (~40 px): boxy chassis, ribbed hose limbs, single round visor.
  fBot: {
    head: BOT_HEAD,
    build: {
      ...ADULT,
      thighR: [2.0, 1.7],
      shinR: [1.9, 1.9],
      upperArmR: [1.35, 1.2],
      foreArmR: [1.5, 1.8],
      torsoR: [4.8, 5.0],
      footR: 1.55,
    },
    torsoMat: (u, v) => {
      if (u < 0.2) return 'hose';
      if (u > 0.9 && v > -0.4) return 'hose';
      if (v < -0.7) return 'trim';
      return 'chassis';
    },
    thighMat: (t) => (t < 0.3 ? 'hose' : 'chassis'),
    shinMat: (t) => (t < 0.18 || t > 0.8 ? 'hose' : 'chassis'),
    upperArmMat: (t) => (t < 0.45 ? 'hose' : 'chassis'),
    foreArmMat: () => 'chassis',
    neckMat: 'hose',
  },
  // Alien drone (~44 px): Zyx's long build in a silver-grey suit, teal head and hands.
  fDrone: {
    head: DRONE_HEAD,
    build: {
      raisedReachScale: 0,
      thigh: 9.5,
      shin: 10,
      upperArm: 6.6,
      foreArm: 6.2,
      foot: 3.8,
      torso: 11.5,
      neck: 2,
      thighR: [2.3, 1.6],
      shinR: [1.55, 1.2],
      upperArmR: [1.4, 1.15],
      foreArmR: [1.1, 1.45],
      torsoR: [3.6, 4.4],
      footR: 1.35,
    },
    torsoMat: (u, v) => {
      if (u > 0.24 && u < 0.31) return 'trim';
      if (u > 0.86 && v > -0.3) return 'trim';
      return 'kit';
    },
    thighMat: () => 'kit',
    shinMat: (t) => (t > 0.8 ? 'shoe' : 'kit'),
    upperArmMat: () => 'kit',
    foreArmMat: (t) => (t < 0.8 ? 'kit' : 'skin'),
    neckMat: 'skin',
  },
};

// ---------------------------------------------------------------------------
// Variants (design 24.2): kit ramps, skin, hair colour and shape.
// ---------------------------------------------------------------------------

interface VariantDef {
  readonly materials: Readonly<Record<string, Ramp>>;
  readonly skin: Ramp;
  readonly hair: Hair;
  /** Head pixels changed for the hair shape (letters as the head rows). */
  readonly hairPatch?: Patch;
  /** Long hair hanging down the back (braid, locs, ponytail). */
  readonly hairProp?: Omit<TorsoProp, 'mat' | 'layer'>;
  /** Chest stamp: bib or model number digit. */
  readonly digit?: number;
  /** Extra head legend entries (robot visor colour). */
  readonly legend?: Legend;
}

const PIN_BIB = (kit: Ramp, shorts: Ramp): Readonly<Record<string, Ramp>> => ({
  kit,
  shorts,
  shoe: K.navy,
  sock: K.white,
  bib: K.white,
});

/** Drone suit: silver-grey, teal belt and collar, dark boots, the head's teal skin. */
const DRONE_MATS = { kit: K.chrome, trim: K.teal, shoe: K.black, bib: K.black } as const;

const VARIANTS: Readonly<Record<FieldBody, Readonly<Record<FieldVariantId, VariantDef>>>> = {
  fKid: {
    // DOT: red shirt, light skin, brown bob.
    A: {
      materials: PIN_BIB(K.red, K.white),
      skin: SKIN.light,
      hair: HAIR.brown,
      hairPatch: [
        [1, 9, 'h'],
        [2, 10, 'h'],
        [1, 10, 'k'],
        [3, 11, 'k'],
      ],
    },
    // MILO: blue shirt, dark skin, black puffs.
    B: {
      materials: PIN_BIB(K.blue, K.white),
      skin: SKIN.dark,
      hair: HAIR.black,
      hairPatch: [
        [3, 1, 'h'],
        [4, 0, 'h'],
        [5, 0, 'H'],
        [9, 0, 'h'],
        [10, 1, 'h'],
        [10, 0, 'h'],
      ],
    },
    // BEA: green shirt, tan skin, black crop.
    C: {
      materials: PIN_BIB(K.green, K.white),
      skin: SKIN.tan,
      hair: HAIR.black,
      hairPatch: [
        [5, 1, '.'],
        [6, 1, '.'],
        [9, 1, '.'],
        [3, 2, '.'],
        [2, 3, '.'],
        [1, 8, 's'],
      ],
    },
    // NOOR: yellow shirt, mid skin, brown pigtails.
    D: {
      materials: PIN_BIB(K.yellow, K.white),
      skin: SKIN.mid,
      hair: HAIR.brown,
      hairPatch: [
        [0, 6, 'h'],
        [0, 7, 'k'],
        [0, 8, 'h'],
        [0, 9, 'k'],
        [1, 10, 'h'],
        [0, 5, 'H'],
      ],
    },
  },
  fTeen: {
    // KAI: navy vest with yellow trim, mid skin, ponytail.
    A: {
      materials: { kit: K.navy, trim: K.yellow, shorts: K.navy, sock: K.white, shoe: K.white },
      skin: SKIN.mid,
      hair: HAIR.dark,
      hairProp: { from: [1.08, -1.1], to: [0.82, -1.55], r: 1.1 },
    },
    // RUBY: red vest with white trim, dark skin, short twists.
    B: {
      materials: { kit: K.red, trim: K.white, shorts: K.black, sock: K.white, shoe: K.black },
      skin: SKIN.dark,
      hair: HAIR.black,
      hairPatch: [
        [4, 0, 'h'],
        [6, 0, 'h'],
        [8, 0, 'h'],
        [2, 1, 'h'],
        [0, 4, 'h'],
        [0, 6, 'h'],
      ],
    },
    // TEO: white vest with green trim, light skin, blond curtains.
    C: {
      materials: { kit: K.white, trim: K.green, shorts: K.green, sock: K.white, shoe: K.green },
      skin: SKIN.light,
      hair: HAIR.blonde,
      hairPatch: [
        [10, 5, 'h'],
        [10, 6, 'k'],
        [9, 5, 'k'],
        [11, 4, 'h'],
      ],
    },
    // ZARA: purple vest with yellow trim, tan skin, bun.
    D: {
      materials: { kit: K.purple, trim: K.yellow, shorts: K.purple, sock: K.white, shoe: K.white },
      skin: SKIN.tan,
      hair: HAIR.dark,
      hairPatch: [
        [2, 0, 'h'],
        [3, 0, 'H'],
        [1, 1, 'h'],
        [2, 1, 'h'],
        [3, 1, 'h'],
      ],
    },
  },
  fStudent: {
    // FINN: purple tee, tan skin, cap: the hair above the band becomes the crown, plus a peak.
    A: {
      materials: { kit: K.purple, tights: K.black, sock: K.white, shoe: K.white },
      skin: SKIN.tan,
      hair: HAIR.dark,
      hairPatch: capPatch(STUDENT_HEAD.rows, 5),
    },
    // ANYA: green tee, light skin, headband over brown hair.
    B: {
      materials: { kit: K.green, tights: K.black, sock: K.white, shoe: K.orange },
      skin: SKIN.light,
      hair: HAIR.brown,
      hairProp: { from: [1.06, -1.1], to: [0.9, -1.4], r: 1.0 },
    },
    // RAJ: orange tee, dark skin, locs.
    C: {
      materials: { kit: K.orange, tights: K.black, sock: K.white, shoe: K.yellow },
      skin: SKIN.dark,
      hair: HAIR.black,
      hairProp: { from: [1.08, -1.0], to: [0.76, -1.35], r: 1.25 },
    },
    // LENA: grey tee, mid skin, buzz cut (no band).
    D: {
      materials: { kit: K.grey, tights: K.black, sock: K.white, shoe: K.sky },
      skin: SKIN.mid,
      hair: HAIR.dark,
      hairPatch: [
        [5, 1, '.'],
        [6, 1, '.'],
        [7, 1, '.'],
        [8, 1, '.'],
        [3, 2, '.'],
        [2, 3, '.'],
      ],
      legend: { c: 14, C: 15, d: 14 },
    },
  },
  fClub: {
    // BRUNO: yellow singlet with a green hoop (the reverse of Kofi's green kit), dark skin, shaved.
    A: {
      materials: { kit: K.yellow, hoop: K.forest, shorts: K.forest, sock: K.white, shoe: K.white },
      skin: SKIN.dark,
      hair: { k: 9, h: 9, H: 10 },
      hairPatch: [
        [1, 5, 'z'],
        [1, 6, 'z'],
      ],
    },
    // IMANI: blue singlet with a white hoop, mid skin, short hair.
    B: {
      materials: { kit: K.blue, hoop: K.white, shorts: K.navy, sock: K.white, shoe: K.yellow },
      skin: SKIN.mid,
      hair: HAIR.dark,
    },
    // SVEN: red singlet with a black hoop, light skin, braid.
    C: {
      materials: { kit: K.red, hoop: K.black, shorts: K.black, sock: K.white, shoe: K.white },
      skin: SKIN.light,
      hair: HAIR.blonde,
      hairProp: { from: [1.05, -1.15], to: [0.62, -1.3], r: 0.9 },
    },
    // MEI: orange singlet with a navy hoop, tan skin, quiff.
    D: {
      materials: { kit: K.orange, hoop: K.navy, shorts: K.navy, sock: K.white, shoe: K.sky },
      skin: SKIN.tan,
      hair: HAIR.black,
      hairPatch: [
        [9, 1, 'h'],
        [10, 1, 'H'],
        [10, 2, 'h'],
        [11, 3, 'h'],
        [11, 2, 'h'],
      ],
    },
  },
  fElite: {
    // ODA: gold crop top with blue trim and briefs (not Valentina's blue top), tan skin, tight bun.
    A: {
      materials: { kit: K.yellow, trim: K.blue, briefs: K.blue, shoe: K.blue },
      skin: SKIN.tan,
      hair: HAIR.black,
      hairPatch: [
        [2, 0, 'h'],
        [3, 0, 'H'],
        [1, 1, 'h'],
        [2, 1, 'h'],
        [3, 1, 'h'],
      ],
    },
    // PAZ: red with white, dark skin, short.
    B: {
      materials: { kit: K.red, trim: K.white, briefs: K.red, shoe: K.white },
      skin: SKIN.dark,
      hair: HAIR.black,
      hairPatch: [
        [1, 7, '.'],
        [2, 9, 'z'],
        [2, 10, '.'],
        [3, 10, 'z'],
      ],
    },
    // NIKO: green with white, mid skin, long braid.
    C: {
      materials: { kit: K.green, trim: K.white, briefs: K.forest, shoe: K.white },
      skin: SKIN.mid,
      hair: HAIR.brown,
      hairProp: { from: [1.05, -1.2], to: [0.42, -1.35], r: 1.2 },
    },
    // ADA: teal with navy, light skin, short.
    D: {
      materials: { kit: K.teal, trim: K.navy, briefs: K.navy, shoe: K.teal },
      skin: SKIN.light,
      hair: HAIR.blonde,
      hairPatch: [
        [1, 7, '.'],
        [2, 9, 'z'],
        [2, 10, '.'],
        [3, 10, 'z'],
      ],
    },
  },
  fBot: {
    // MK-2..MK-5: chrome or grey chassis, visor red / yellow / green / blue, painted model number.
    A: botVariant(K.chrome, [16, 17, 19], 2),
    B: botVariant(K.chrome, [20, 22, 23], 3),
    C: botVariant(K.grey, [24, 26, 27], 4),
    D: botVariant(K.grey, [28, 30, 31], 5),
  },
  fDrone: {
    // ZX-1..ZX-4: one palette, bib digit 1-4.
    A: droneVariant(1),
    B: droneVariant(2),
    C: droneVariant(3),
    D: droneVariant(4),
  },
};

/** A cap: every hair pixel above `bandRow` in the kit colours (lit top-left), and a 2 px peak. */
function capPatch(rows: readonly string[], bandRow: number): Patch {
  const out: [number, number, string][] = [];
  for (let y = 0; y < bandRow; y++) {
    const r = rows[y] as string;
    for (let x = 0; x < r.length; x++) {
      if (r[x] === 'h' || r[x] === 'H')
        out.push([x, y, y <= 2 && x < 7 ? 'C' : y === bandRow - 1 ? 'd' : 'c']);
    }
  }
  const band = rows[bandRow] as string;
  const front =
    band.lastIndexOf('c') >= 0 ? Math.max(band.lastIndexOf('c'), band.lastIndexOf('C')) : band.length - 2;
  out.push([front + 1, bandRow, 'd'], [front + 2, bandRow, 'd']);
  return out;
}

function botVariant(chassis: Ramp, visor: readonly [number, number, number], digit: number): VariantDef {
  return {
    materials: { chassis, hose: [2, 3, 4, 5], trim: chassis === K.chrome ? K.grey : K.black, shoe: K.black },
    skin: SKIN.mid,
    hair: HAIR.black,
    digit,
    legend: {
      n: chassis[1],
      m: chassis[2],
      M: chassis[3],
      W: 8,
      N: chassis[0] === 3 ? 4 : 3,
      b: 3,
      d: 2,
      v: visor[0],
      V: visor[1],
      // The visor's glint, used by the effort face.
      x: visor[2],
    },
  };
}

function droneVariant(digit: number): VariantDef {
  return {
    materials: DRONE_MATS,
    skin: K.teal,
    hair: HAIR.black,
    digit,
    legend: { t: 36, T: 37, u: 35, a: 35, d: 2, V: 37, v: 36 },
  };
}

// ---------------------------------------------------------------------------
// 3x5 digits for bibs and model numbers.
// ---------------------------------------------------------------------------

const DIGITS: Readonly<Record<number, readonly string[]>> = {
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
};

/** Chest stamp: a bib (kid: plain white with a pin; drone: 5x7 dark plate with a teal digit). */
function decalFor(body: FieldBody, v: VariantDef): CharacterSpec['decal'] {
  if (body === 'fKid') {
    // 4x4 white bib with a two-pixel number and a silver pin.
    const m = createMap(4, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setPx(m, x, y, y === 3 ? 7 : 8);
    setPx(m, 1, 1, 3);
    setPx(m, 1, 2, 3);
    setPx(m, 2, 1, 3);
    setPx(m, 0, 0, 5);
    return { map: m, u: 0.62, v: -0.05 };
  }
  if (v.digit === undefined) return undefined;
  const rows = DIGITS[v.digit] as readonly string[];
  if (body === 'fDrone') {
    const m = createMap(5, 7);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 5; x++) setPx(m, x, y, 2);
    rows.forEach((r, y) => {
      for (let x = 0; x < 3; x++) if (r[x] === '#') setPx(m, 1 + x, 1 + y, 37);
    });
    return { map: m, u: 0.64, v: -0.3 };
  }
  // Robot: the model number painted straight on the chassis.
  const m = createMap(3, 5);
  rows.forEach((r, y) => {
    for (let x = 0; x < 3; x++) if (r[x] === '#') setPx(m, x, y, 22);
  });
  // On the upper back: the near arm swings across the chest in most frames.
  return { map: m, u: 0.74, v: -0.35 };
}

function legendFor(v: VariantDef): Legend {
  const s = v.skin;
  const kit = v.materials['kit'] ?? v.materials['chassis'] ?? K.grey;
  return {
    s: s[2],
    S: s[3],
    z: s[1],
    Z: s[0],
    e: 1,
    m: s[0],
    r: 17,
    b: 1,
    w: 8,
    h: v.hair.h,
    H: v.hair.H,
    k: v.hair.k,
    c: kit[2],
    C: kit[3],
    d: kit[1],
    ...v.legend,
  };
}

function headsFor(def: HeadDef, v: VariantDef): CharacterSpec['heads'] {
  const legend = legendFor(v);
  const base = parseRows(def.rows, legend);
  const patch = (m: IndexMap, p: Patch): IndexMap => {
    const out = cloneMap(m);
    for (const [x, y, ch] of p) {
      const val = ch === '.' ? 0 : legend[ch];
      if (val === undefined) throw new Error(`field head patch: unknown char ${ch}`);
      setPx(out, x, y, val);
    }
    return out;
  };
  const hair = v.hairPatch ? patch(base, v.hairPatch) : base;
  const out: Partial<Record<HeadVariant, HeadStamp>> = { normal: { map: hair, ax: def.ax, ay: def.ay } };
  for (const [name, p] of Object.entries(def.faces) as [HeadVariant, Patch][]) {
    out[name] = { map: patch(hair, p), ax: def.ax, ay: def.ay };
  }
  return out as CharacterSpec['heads'];
}

/** The rig spec of one body in one variant. */
export function fieldSpec(body: FieldBody, variant: FieldVariantId): CharacterSpec {
  const b = BODIES[body];
  const v = VARIANTS[body][variant];
  const props: TorsoProp[] = [];
  if (v.hairProp) props.push({ ...v.hairProp, mat: 'hair', layer: 'front' });
  const decal = decalFor(body, v);
  return {
    id: `${body}.${variant}`,
    ...b.build,
    materials: {
      skin: v.skin,
      hair: [v.hair.k, v.hair.k, v.hair.h, v.hair.H],
      ...v.materials,
    },
    torsoMat: b.torsoMat,
    thighMat: b.thighMat,
    shinMat: b.shinMat,
    upperArmMat: b.upperArmMat,
    foreArmMat: b.foreArmMat,
    footMat: 'shoe',
    neckMat: b.neckMat,
    heads: headsFor(b.head, v),
    ...(props.length ? { props } : {}),
    ...(decal ? { decal } : {}),
  };
}

/** Every ramp a variant can draw with (kit, skin, hair), for the "never index 18" check. */
export function fieldKitIndices(body: FieldBody, variant: FieldVariantId): Set<number> {
  const v = VARIANTS[body][variant];
  const out = new Set<number>();
  for (const r of Object.values(v.materials)) for (const i of r) out.add(i);
  for (const i of Object.values(legendFor(v))) out.add(i);
  return out;
}

export interface FieldArt {
  readonly body: FieldBody;
  readonly variant: FieldVariantId;
  readonly frames: readonly CharFrame[];
  readonly anims: readonly CharAnim[];
}

/** All 31 frames and 8 anims of one field variant (design 35.1). */
export function buildField(body: FieldBody, variant: FieldVariantId): FieldArt {
  const spec = fieldSpec(body, variant);
  const frames: CharFrame[] = [];
  const anims: CharAnim[] = [];
  for (const a of fieldAnims(body === 'fKid')) {
    const names: string[] = [];
    a.poses.forEach((p, i) => {
      let r = renderPose(spec, p);
      // In the blocks the whole figure waits behind the start line (as Sol's shift in poses.ts):
      // broad or long-limbed bodies move back a pixel at a time until it clears.
      for (
        let back = 1;
        a.name === 'ready' && rightmost(r.map) - READY_SHIFT_PX > PIVOT_X - 1 && back <= 3;
        back++
      )
        r = renderPose(spec, { ...p, dx: (p.dx ?? 0) - back });
      const name = `${a.name}${i}`;
      frames.push({ name, map: r.map, anchors: r.anchors });
      names.push(name);
    });
    anims.push({ name: a.name, frames: names, fps: a.fps, repeat: a.repeat });
  }
  return { body, variant, frames, anims };
}

function rightmost(m: IndexMap): number {
  for (let x = m.w - 1; x >= 0; x--) for (let y = 0; y < m.h; y++) if (m.data[y * m.w + x]) return x;
  return -1;
}

export type { FieldAnimName };
