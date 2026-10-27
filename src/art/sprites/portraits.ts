/**
 * Character portraits (design 5.5, 6.2, 6.7): 16x16 head icon (built from the in-game head stamp so
 * it matches the sprite) and a 48x48 bust for the rival card. Plus black silhouettes for locked rivals.
 */
import { blit, createMap, getPx, outline, setPx, silhouette, type IndexMap } from '../bake/index.ts';
import { SPECS, type SpecId } from '../chars/specs.ts';
import { ellipse, line, poly, rect, shadeSphere, type Ramp4 } from '../paint.ts';

// ---------------------------------------------------------------------------
// 16x16
// ---------------------------------------------------------------------------

/** Kit colour for the shoulders, sampled from the torso material near the neck. */
function shoulderRamp(id: SpecId): Ramp4 {
  const spec = SPECS[id];
  const mat = spec.torsoMat(0.75, 0.3, { lean: 0, legN: [0, 0], legF: [0, 0], armN: [0, 0], armF: [0, 0] });
  return (spec.materials[mat] ?? spec.materials['skin']) as Ramp4;
}

export function portrait16(id: SpecId): IndexMap {
  const spec = SPECS[id];
  const head = spec.heads.normal;
  const m = createMap(16, 16);
  const kit = shoulderRamp(id);
  // Shoulders: rounded block under the head.
  const top = Math.min(15, Math.max(11, head.map.h));
  for (let y = top; y < 16; y++) {
    const inset = y === top ? 3 : y === top + 1 ? 2 : 1;
    for (let x = inset; x < 15 - inset + 1; x++)
      setPx(m, x, y, y === top ? kit[3] : x > 11 ? kit[1] : kit[2]);
  }
  const hx = Math.round((16 - head.map.w) / 2);
  const hy = Math.max(1, top + 1 - head.map.h);
  blit(m, head.map, hx, hy);
  return outline(m);
}

// ---------------------------------------------------------------------------
// 48x48 busts
// ---------------------------------------------------------------------------

interface BustOpts {
  readonly skin: Ramp4;
  readonly kit: Ramp4;
  readonly faceRx?: number;
  readonly faceRy?: number;
  readonly cy?: number;
}

const HAIR_DARK: Ramp4 = [1, 2, 14, 15];
const HAIR_BROWN: Ramp4 = [14, 14, 15, 11];

/** Common bust: shoulders, neck, head, ear; returns the canvas for character details. */
function bust(o: BustOpts): IndexMap {
  const m = createMap(48, 48);
  const cy = o.cy ?? 21;
  const rx = o.faceRx ?? 10;
  const ry = o.faceRy ?? 12;
  // Shoulders and chest.
  poly(
    m,
    [
      [5, 48],
      [7, 39],
      [13, 35],
      [35, 35],
      [41, 39],
      [43, 48],
    ],
    o.kit[2],
  );
  for (let y = 35; y < 48; y++) {
    for (let x = 0; x < 48; x++) {
      if (getPx(m, x, y) !== o.kit[2]) continue;
      if (x < 12 && y < 41 - (x - 5)) setPx(m, x, y, o.kit[3]);
      else if (x > 36 || y > 45) setPx(m, x, y, o.kit[1]);
    }
  }
  // Neck with chin shadow.
  rect(m, 19, cy + ry - 4, 10, 48 - (cy + ry - 4) - 10, o.skin[2]);
  rect(m, 19, cy + ry - 4, 10, 3, o.skin[1]);
  rect(m, 26, cy + ry - 4, 3, 10, o.skin[1]);
  // Head, with the jaw pushed toward the viewer's right (3/4 view), shaded as one form.
  ellipse(m, 24, cy, rx, ry, o.skin[2]);
  ellipse(m, 27, cy + 4, rx - 2, ry - 4, o.skin[2]);
  shadeRegion(m, o.skin, 23, cy - 1, rx + 4, 0.8, -0.28, cy - ry - 1, cy + ry + 1);
  // Ear on the left.
  ellipse(m, 15, cy + 1, 2.2, 3, o.skin, 0.3, -0.1);
  setPx(m, 15, cy + 1, o.skin[0]);
  setPx(m, 15, cy + 2, o.skin[1]);
  return m;
}

/** Eyes for a 3/4 face. `iris` index; `big` for kids. */
function eyes(m: IndexMap, y: number, iris: number, skinLine: number, big = false): void {
  // Near eye (larger) at x 23-26, far eye smaller at x 30-32.
  const h = big ? 4 : 3;
  rect(m, 23, y, 4, h, 8);
  rect(m, 25, y, 2, h, iris);
  setPx(m, 26, y, 1);
  setPx(m, 25, y + h - 1, 1);
  rect(m, 30, y, 3, h, 8);
  rect(m, 31, y, 2, h, iris);
  setPx(m, 32, y, 1);
  // Lashes / lid line.
  line(m, 22, y - 1, 27, y - 1, skinLine);
  line(m, 29, y - 1, 33, y - 1, skinLine);
}

function nose(m: IndexMap, y: number, skin: Ramp4): void {
  setPx(m, 29, y, skin[1]);
  setPx(m, 29, y + 1, skin[1]);
  setPx(m, 30, y + 2, skin[0]);
  setPx(m, 28, y + 2, skin[1]);
  setPx(m, 30, y + 1, skin[3]);
}

function mouth(m: IndexMap, y: number, v: number, w = 5): void {
  line(m, 26, y, 26 + w - 1, y, v);
  setPx(m, 25, y - 1, v);
}

function shadeRegion(
  m: IndexMap,
  ramp: Ramp4,
  cx: number,
  cy: number,
  r: number,
  hi = 0.5,
  sh = -0.3,
  y0 = 0,
  y1 = 47,
): void {
  // Re-shade every pixel of the ramp by its position relative to (cx, cy).
  for (let y = Math.max(0, y0); y <= Math.min(47, y1); y++) {
    for (let x = 0; x < m.w; x++) {
      const v = getPx(m, x, y);
      if (v !== ramp[2] && v !== ramp[3] && v !== ramp[1]) continue;
      setPx(m, x, y, shadeSphere(ramp, (x + 0.5 - cx) / r, (y + 0.5 - cy) / r, hi, sh));
    }
  }
}

const BUSTS: Readonly<Record<SpecId, () => IndexMap>> = {
  rio: () => {
    const skin: Ramp4 = [10, 11, 12, 13];
    const m = bust({ skin, kit: [16, 17, 18, 19] });
    // Singlet straps and white trim.
    rect(m, 13, 35, 22, 2, 8);
    rect(m, 17, 37, 14, 11, skin[2]);
    rect(m, 26, 37, 5, 11, skin[1]);
    line(m, 16, 37, 16, 47, 8);
    line(m, 31, 37, 31, 47, 7);
    // Hair: short dark crop.
    ellipse(m, 23, 13, 11, 7, HAIR_DARK);
    rect(m, 13, 13, 4, 7, 14);
    poly(
      m,
      [
        [14, 12],
        [36, 12],
        [34, 9],
        [16, 7],
      ],
      14,
    );
    shadeRegion(m, HAIR_DARK, 20, 8, 10, 0.78, 0.1, 0, 17);
    // Headband.
    rect(m, 13, 14, 23, 3, 22);
    line(m, 14, 14, 34, 14, 23);
    line(m, 13, 16, 35, 16, 21);
    eyes(m, 19, 15, 10);
    line(m, 22, 18, 26, 17, 14);
    line(m, 29, 17, 33, 18, 14);
    nose(m, 22, skin);
    mouth(m, 27, 10);
    return m;
  },
  pip: () => {
    const skin: Ramp4 = [11, 12, 13, 13];
    const m = bust({ skin, kit: [24, 25, 26, 27], faceRx: 11, faceRy: 11, cy: 23 });
    // Backpack straps.
    rect(m, 12, 35, 3, 13, 28);
    rect(m, 33, 35, 3, 13, 28);
    line(m, 12, 35, 12, 47, 29);
    // Cap: dome + bill to the right.
    ellipse(m, 23, 14, 12, 8, [20, 21, 22, 23], 0.4, -0.35);
    rect(m, 11, 14, 25, 3, 22);
    poly(
      m,
      [
        [30, 15],
        [44, 15],
        [44, 18],
        [30, 18],
      ],
      21,
    );
    line(m, 30, 15, 44, 15, 22);
    line(m, 31, 18, 44, 18, 20);
    rect(m, 22, 8, 3, 2, 23);
    // Hair tufts under cap.
    rect(m, 12, 17, 5, 5, 15);
    setPx(m, 17, 18, 15);
    eyes(m, 21, 29, 11, true);
    nose(m, 25, skin);
    mouth(m, 29, 11, 4);
    // Rosy cheek.
    rect(m, 31, 26, 2, 1, 41);
    return m;
  },
  jess: () => {
    const skin: Ramp4 = [11, 12, 13, 13];
    const m = bust({ skin, kit: [28, 28, 29, 30] });
    // Jacket collar and zip.
    poly(
      m,
      [
        [15, 35],
        [21, 35],
        [24, 42],
        [27, 35],
        [33, 35],
        [30, 31],
        [18, 31],
      ],
      29,
    );
    line(m, 24, 40, 24, 47, 8);
    line(m, 18, 31, 15, 35, 30);
    // Hair with ponytail to the left.
    ellipse(m, 23, 13, 11, 8, HAIR_BROWN);
    poly(
      m,
      [
        [13, 12],
        [5, 16],
        [3, 26],
        [7, 31],
        [10, 22],
        [14, 18],
      ],
      15,
    );
    rect(m, 13, 13, 4, 10, 15);
    line(m, 19, 13, 30, 15, 15);
    shadeRegion(m, HAIR_BROWN, 18, 8, 12, 0.78, 0.1, 0, 17);
    rect(m, 12, 13, 2, 2, 29);
    // Earbud and wire.
    rect(m, 14, 21, 2, 2, 8);
    line(m, 15, 23, 18, 34, 8);
    eyes(m, 19, 29, 11);
    nose(m, 22, skin);
    mouth(m, 27, 11, 4);
    return m;
  },
  marco: () => {
    const skin: Ramp4 = [9, 10, 11, 12];
    const m = bust({ skin, kit: [32, 32, 33, 34] });
    // Hood behind the neck, drawstrings.
    poly(
      m,
      [
        [10, 36],
        [14, 30],
        [20, 34],
        [28, 34],
        [34, 30],
        [38, 36],
      ],
      34,
    );
    line(m, 21, 37, 21, 43, 8);
    line(m, 27, 37, 27, 44, 8);
    // Headphones around the neck.
    rect(m, 16, 32, 16, 2, 4);
    rect(m, 15, 30, 4, 5, 5);
    rect(m, 29, 30, 4, 5, 5);
    setPx(m, 15, 30, 6);
    setPx(m, 29, 30, 6);
    // Scruffy hair.
    ellipse(m, 23, 13, 12, 8, HAIR_BROWN);
    for (const [x, y] of [
      [12, 8],
      [16, 4],
      [21, 3],
      [27, 4],
      [32, 6],
      [35, 10],
    ] as const) {
      poly(
        m,
        [
          [x - 2, y + 5],
          [x, y],
          [x + 3, y + 5],
        ],
        15,
      );
    }
    rect(m, 13, 13, 4, 9, 15);
    shadeRegion(m, HAIR_BROWN, 18, 6, 12, 0.78, 0.1, 0, 17);
    // Sunglasses pushed up.
    rect(m, 20, 11, 6, 3, 2);
    rect(m, 28, 11, 5, 3, 2);
    line(m, 26, 12, 28, 12, 1);
    setPx(m, 21, 11, 6);
    setPx(m, 29, 11, 6);
    // Half-lidded, bored eyes.
    eyes(m, 20, 15, 9);
    line(m, 23, 20, 26, 20, 10);
    line(m, 30, 20, 32, 20, 10);
    nose(m, 23, skin);
    mouth(m, 28, 9, 4);
    setPx(m, 30, 27, 9);
    return m;
  },
  kofi: () => {
    const skin: Ramp4 = [9, 9, 10, 11];
    const m = bust({ skin, kit: [24, 25, 26, 27] });
    // Singlet with yellow trim, broad shoulders.
    rect(m, 16, 35, 16, 13, skin[2]);
    rect(m, 27, 35, 5, 13, skin[1]);
    line(m, 15, 35, 15, 47, 22);
    line(m, 32, 35, 32, 47, 21);
    line(m, 16, 38, 31, 46, 22);
    // Close-cropped hair: a cap over the top of the skull only.
    for (let y = 8; y < 16; y++) {
      for (let x = 13; x < 36; x++) {
        const dx = (x + 0.5 - 24) / 10.5;
        const dy = (y + 0.5 - 21) / 12.5;
        if (dx * dx + dy * dy <= 1 && y < 14 - (x > 30 ? x - 30 : 0))
          setPx(m, x, y, (x + y) % 5 === 0 ? 15 : 14);
      }
    }
    rect(m, 13, 13, 3, 6, 14);
    // Heavy focused brows.
    eyes(m, 20, 14, 9);
    rect(m, 22, 17, 5, 2, 1);
    rect(m, 29, 17, 4, 2, 1);
    setPx(m, 26, 19, 1);
    nose(m, 23, skin);
    line(m, 26, 28, 30, 28, 9);
    return m;
  },
  valentina: () => {
    const skin: Ramp4 = [10, 11, 12, 13];
    const m = bust({ skin, kit: [28, 28, 29, 30] });
    // Gold trim and collar.
    rect(m, 13, 35, 22, 2, 22);
    line(m, 13, 36, 34, 36, 21);
    rect(m, 18, 37, 12, 4, skin[2]);
    // Hair parted, braid over the left shoulder.
    ellipse(m, 23, 13, 12, 9, HAIR_BROWN);
    rect(m, 12, 13, 5, 12, 15);
    for (let i = 0; i < 6; i++) {
      ellipse(m, 10 + (i % 2), 26 + i * 3.5, 2.6, 2, HAIR_BROWN, 0.3, -0.2);
    }
    line(m, 20, 10, 34, 15, 14);
    shadeRegion(m, HAIR_BROWN, 18, 8, 12, 0.78, 0.1, 0, 17);
    // Earring glint.
    setPx(m, 15, 25, 22);
    eyes(m, 19, 15, 9);
    setPx(m, 27, 18, 1);
    setPx(m, 33, 18, 1);
    nose(m, 22, skin);
    line(m, 26, 27, 29, 27, 17);
    setPx(m, 27, 28, 18);
    return m;
  },
  unit7: () => {
    const chrome: Ramp4 = [3, 5, 6, 7];
    const m = createMap(48, 48);
    // Armoured shoulders.
    poly(
      m,
      [
        [4, 48],
        [6, 38],
        [14, 34],
        [34, 34],
        [42, 38],
        [44, 48],
      ],
      6,
    );
    shadeRegion(m, chrome, 14, 34, 14);
    rect(m, 18, 38, 12, 8, 2);
    rect(m, 20, 40, 8, 2, 36);
    rect(m, 21, 40, 3, 1, 37);
    // Neck joint.
    rect(m, 19, 30, 10, 6, 3);
    line(m, 19, 32, 28, 32, 4);
    // Helmet.
    ellipse(m, 24, 18, 12, 13, chrome, 0.45, -0.3);
    setPx(m, 17, 9, 8);
    setPx(m, 18, 9, 8);
    setPx(m, 17, 10, 8);
    // Visor band with glow.
    rect(m, 18, 16, 19, 6, 2);
    rect(m, 20, 17, 16, 4, 36);
    rect(m, 21, 17, 10, 1, 37);
    setPx(m, 33, 19, 37);
    // Bolt and grille.
    ellipse(m, 15, 20, 2, 2, [1, 4, 4, 6]);
    for (let x = 22; x < 33; x += 2) line(m, x, 25, x, 27, 4);
    return m;
  },
  zyx: () => {
    const skin: Ramp4 = [35, 35, 36, 37];
    const m = bust({ skin, kit: [32, 32, 33, 34], faceRx: 9, faceRy: 14, cy: 21 });
    // Tall cranium and antenna.
    ellipse(m, 23, 13, 10, 11, skin, 0.5, -0.3);
    line(m, 24, 3, 22, 0, 35);
    line(m, 24, 2, 24, 3, 35);
    rect(m, 21, 0, 2, 2, 37);
    // Bodysuit collar with glow seam.
    rect(m, 17, 34, 14, 2, 34);
    line(m, 24, 36, 24, 47, 37);
    // Three eyes: two below, one on the forehead. Black with a glint.
    for (const [x, y] of [
      [22, 22],
      [29, 22],
      [26, 15],
    ] as const) {
      rect(m, x, y, 3, 4, 1);
      setPx(m, x, y, 37);
    }
    line(m, 26, 29, 30, 29, 35);
    setPx(m, 31, 28, 35);
    return m;
  },
  sol: () => {
    const skin: Ramp4 = [9, 10, 11, 11];
    const m = bust({ skin, kit: [6, 7, 8, 8], faceRx: 9, faceRy: 13, cy: 20 });
    // Orange shoulder trim, orange chest band with the yellow sun emblem.
    rect(m, 13, 35, 22, 2, 21);
    line(m, 13, 36, 34, 36, 20);
    rect(m, 17, 37, 14, 3, skin[2]);
    rect(m, 26, 37, 5, 3, skin[1]);
    rect(m, 6, 42, 37, 4, 21);
    line(m, 6, 45, 42, 45, 20);
    ellipse(m, 24, 43.5, 3.2, 3.2, [20, 21, 22, 23], 0.3, -0.4);
    for (const [x, y] of [
      [19, 43],
      [29, 43],
      [24, 39],
    ] as const)
      setPx(m, x, y, 22);
    // Close-cropped dark hair with grey streaks at the temple.
    for (let y = 5; y < 15; y++) {
      for (let x = 13; x < 35; x++) {
        const dx = (x + 0.5 - 24) / 10;
        const dy = (y + 0.5 - 20) / 14;
        if (dx * dx + dy * dy <= 1 && y < 13 - (x > 30 ? x - 30 : 0)) setPx(m, x, y, 14);
      }
    }
    rect(m, 13, 12, 4, 8, 14);
    // Grey at the temple, fading up into the crop.
    for (const [x, y, w] of [
      [13, 18, 3],
      [13, 15, 3],
      [14, 12, 2],
      [17, 9, 2],
      [21, 7, 2],
    ] as const)
      line(m, x, y, x + w - 1, y - 1, 7);
    // Calm, half-closed eyes: heavy lids over the top half.
    eyes(m, 19, 14, 9);
    rect(m, 23, 19, 4, 1, 10);
    rect(m, 30, 19, 3, 1, 10);
    line(m, 22, 18, 27, 18, 9);
    line(m, 29, 18, 33, 18, 9);
    nose(m, 22, skin);
    // Relaxed closed mouth and a hint of grey stubble.
    line(m, 26, 27, 30, 27, 9);
    setPx(m, 25, 26, 10);
    return m;
  },
};

export function portrait48(id: SpecId): IndexMap {
  return outline(BUSTS[id]());
}

/** Locked rival: black silhouette with an index-3 rim so it reads on index-2 panels. */
export function lockedPortrait(m: IndexMap): IndexMap {
  return silhouette(m, 1, 3);
}
