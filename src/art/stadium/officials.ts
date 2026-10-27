/**
 * Officials on the far side of the track (design 31.2, 31.3, 26.4): the starter with his pistol and
 * smoke, three finish judges on a bench, the photo-finish camera, and the 400 m lap-bell official.
 * All stand with their feet on FAR_SIDE_FEET_Y in front of the ad-board wall and face left, toward the
 * runners coming down the track. Pure.
 */
import { createMap, outline, setPx, type IndexMap } from '../bake/index.ts';
import { ellipse, line, poly, rect, type Ramp4 } from '../paint.ts';

// ---------------------------------------------------------------------------
// Standing official, 32x32: feet on row 30 (outline on 31), head fixed at the same place in every
// frame so the tier 7 helmet overlay always fits.
// ---------------------------------------------------------------------------

export const OFFICIAL_FRAME = { w: 32, h: 32, feetRow: 30 } as const;
/** Head centre in the 32x32 official frame (the bubble tail and the helmet are placed from it). */
export const OFFICIAL_HEAD = { x: 17, y: 9, top: 3 } as const;

type ArmPose = 'down' | 'downSwing' | 'up' | 'point' | 'bellLow' | 'bellUp';

interface OfficialOpts {
  readonly jacket: Ramp4;
  readonly trousers: readonly [number, number];
  readonly cap: readonly [number, number];
  readonly skin: Ramp4;
  readonly arm: ArmPose;
  /** Far hand cupped over the ear (starter while the pistol is up). */
  readonly earHand?: boolean;
  readonly blink?: boolean;
  readonly flash?: boolean;
}

function thick(m: IndexMap, x0: number, y0: number, x1: number, y1: number, v: number): void {
  line(m, x0, y0, x1, y1, v);
  line(m, x0 + 1, y0, x1 + 1, y1, v);
}

function official(o: OfficialOpts): IndexMap {
  const m = createMap(32, 32);
  const [jl, js, jb, jh] = o.jacket;
  // Far arm hangs behind the body (or reaches up to the ear).
  if (o.earHand) {
    thick(m, 21, 13, 21, 10, js);
    rect(m, 20, 8, 2, 2, o.skin[1]);
  } else {
    rect(m, 21, 13, 2, 8, js);
    rect(m, 21, 21, 2, 1, o.skin[1]);
  }
  // Legs and shoes (toes to the left).
  rect(m, 13, 22, 3, 7, o.trousers[0]);
  rect(m, 18, 22, 3, 7, o.trousers[1]);
  rect(m, 13, 22, 1, 6, o.trousers[1]);
  rect(m, 11, 29, 5, 2, 2);
  rect(m, 16, 29, 5, 2, 2);
  rect(m, 11, 29, 2, 1, 3);
  // Jacket: light from the top-left, shadow down the right side.
  poly(
    m,
    [
      [12, 13],
      [14, 11],
      [21, 11],
      [23, 13],
      [23, 23],
      [12, 23],
    ],
    jb,
  );
  rect(m, 21, 13, 2, 10, js);
  line(m, 12, 13, 12, 22, jh);
  line(m, 14, 12, 15, 12, jh);
  line(m, 12, 22, 22, 22, jl);
  // Collar and shirt: a white V.
  poly(
    m,
    [
      [14, 11],
      [17, 11],
      [15, 15],
    ],
    8,
  );
  setPx(m, 15, 14, 7);
  // Head: skin ball facing left, cap with the bill to the left.
  ellipse(m, OFFICIAL_HEAD.x, OFFICIAL_HEAD.y, 3.7, 4.2, o.skin, 0.4, -0.2);
  rect(m, 14, 4, 7, 3, o.cap[0]);
  rect(m, 15, 3, 5, 1, o.cap[0]);
  rect(m, 11, 6, 4, 1, o.cap[1]);
  rect(m, 14, 6, 7, 1, o.cap[1]);
  setPx(m, 15, 4, 8);
  // Face: eye, nose, mouth; ear on the back of the head.
  if (o.blink) setPx(m, 15, 9, o.skin[0]);
  else setPx(m, 15, 9, 1);
  setPx(m, 13, 10, o.skin[2]);
  setPx(m, 15, 12, o.skin[0]);
  setPx(m, 19, 9, o.skin[1]);
  setPx(m, 19, 10, o.skin[0]);
  // Near arm and whatever it holds.
  switch (o.arm) {
    case 'down':
    case 'downSwing': {
      const hx = o.arm === 'down' ? 11 : 10;
      thick(m, 12, 13, hx, 20, jb);
      line(m, 12, 13, hx, 20, jh);
      rect(m, hx, 21, 2, 2, o.skin[2]);
      // Pistol pointing at the ground.
      rect(m, hx, 23, 2, 1, 4);
      setPx(m, hx, 24, 4);
      break;
    }
    case 'up': {
      thick(m, 12, 13, 10, 5, jb);
      line(m, 12, 13, 10, 5, jh);
      rect(m, 9, 3, 3, 2, o.skin[2]);
      // Pistol pointing at the sky.
      rect(m, 10, 1, 2, 2, 4);
      setPx(m, 10, 3, 5);
      if (o.flash) {
        setPx(m, 10, 0, 23);
        setPx(m, 11, 0, 22);
      }
      break;
    }
    case 'point': {
      thick(m, 12, 13, 5, 16, jb);
      line(m, 12, 13, 5, 15, jh);
      rect(m, 3, 16, 3, 2, o.skin[2]);
      setPx(m, 2, 17, o.skin[2]);
      break;
    }
    case 'bellLow': {
      thick(m, 12, 13, 10, 20, jb);
      line(m, 12, 13, 10, 20, jh);
      rect(m, 9, 21, 2, 2, o.skin[2]);
      poly(
        m,
        [
          [9, 23],
          [11, 23],
          [13, 27],
          [7, 27],
        ],
        22,
      );
      line(m, 9, 24, 8, 26, 23);
      setPx(m, 10, 27, 21);
      break;
    }
    case 'bellUp': {
      thick(m, 12, 13, 9, 6, jb);
      line(m, 12, 13, 9, 6, jh);
      rect(m, 8, 4, 3, 2, o.skin[2]);
      // Bell above the hand, tilted, mouth to the left.
      poly(
        m,
        [
          [7, 3],
          [9, 1],
          [11, 3],
          [8, 5],
        ],
        22,
      );
      setPx(m, 8, 2, 23);
      setPx(m, 7, 4, 21);
      break;
    }
  }
  const out = outline(m);
  if (o.arm === 'bellUp') {
    // Ring marks outside the outline (sound marks carry no outline).
    setPx(out, 4, 1, 23);
    setPx(out, 3, 3, 23);
    setPx(out, 5, 0, 23);
  }
  return out;
}

const STARTER = {
  jacket: [16, 16, 17, 19] as Ramp4,
  trousers: [28, 2] as const,
  cap: [8, 7] as const,
  skin: [9, 10, 11, 12] as Ramp4,
};

export type StarterFrame = 'idle0' | 'idle1' | 'armUp' | 'fire' | 'point';
export const STARTER_FRAMES: readonly StarterFrame[] = ['idle0', 'idle1', 'armUp', 'fire', 'point'];

/** Starter (design 31.2): idle 2 (2 fps), arm up, fire, and pointing at the player on a false start. */
export function starter(frame: StarterFrame): IndexMap {
  switch (frame) {
    case 'idle0':
      return official({ ...STARTER, arm: 'down' });
    case 'idle1':
      return official({ ...STARTER, arm: 'downSwing', blink: true });
    case 'armUp':
      return official({ ...STARTER, arm: 'up', earHand: true });
    case 'fire':
      return official({ ...STARTER, arm: 'up', earHand: true, flash: true });
    case 'point':
      return official({ ...STARTER, arm: 'point' });
  }
}

/** Tier 7: a glass space helmet over the starter's head, 32x32, drawn over any starter frame. */
export function starterHelmet(): IndexMap {
  const m = createMap(32, 32);
  const cx = OFFICIAL_HEAD.x;
  const cy = OFFICIAL_HEAD.y - 1;
  const r = 6.6;
  // Rim only (the glass stays see-through), plus two glints and a collar ring.
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r && d > r - 1 && y < cy + 5) setPx(m, x, y, y < cy - 2 && x < cx ? 31 : 37);
    }
  }
  rect(m, cx - 5, cy + 5, 11, 2, 5);
  rect(m, cx - 5, cy + 5, 11, 1, 6);
  setPx(m, cx - 3, cy - 3, 8);
  setPx(m, cx - 4, cy - 2, 8);
  return outline(m);
}

// ---------------------------------------------------------------------------
// Pistol smoke, 16x16, 3 frames at 12 fps: a puff that grows and drifts up from the muzzle.
// ---------------------------------------------------------------------------

export const SMOKE_FPS = 12;
const SMOKE: Ramp4 = [6, 7, 8, 8];

export function pistolSmoke(): IndexMap[] {
  const puffs: (readonly [number, number, number])[][] = [
    [
      [8, 12, 2],
      [7, 10, 1.4],
    ],
    [
      [8, 10, 3],
      [5.5, 8, 2],
      [10.5, 8, 1.8],
    ],
    [
      [8, 7, 3],
      [4.5, 5, 2.2],
      [11, 5, 2],
      [8, 3, 1.4],
    ],
  ];
  return puffs.map((ps, i) => {
    const m = createMap(16, 16);
    for (const [x, y, r] of ps) ellipse(m, x, y, r, r * 0.85, SMOKE, 0.35, -0.35);
    return i < 2 ? outline(m, { color: 6 }) : m;
  });
}

// ---------------------------------------------------------------------------
// Finish judges (design 31.3): 16x16, 3 palette variants, sit 2 frames, lean, stand.
// ---------------------------------------------------------------------------

export type JudgeFrame = 'sit0' | 'sit1' | 'lean' | 'stand';
export const JUDGE_FRAMES: readonly JudgeFrame[] = ['sit0', 'sit1', 'lean', 'stand'];
/** Row of the bench seat top in a judge frame (sitting judges' hips rest on it). */
export const JUDGE_SEAT_ROW = 11;

const JUDGES: readonly { readonly jacket: Ramp4; readonly skin: Ramp4; readonly hair: number }[] = [
  { jacket: [1, 28, 29, 30], skin: [10, 11, 12, 13], hair: 7 },
  { jacket: [24, 24, 25, 26], skin: [9, 9, 10, 11], hair: 1 },
  { jacket: [16, 16, 17, 19], skin: [11, 12, 13, 13], hair: 15 },
];
export const JUDGE_COUNT = JUDGES.length;

export function judge(variant: number, frame: JudgeFrame): IndexMap {
  const j = JUDGES[variant % JUDGES.length]!;
  const m = createMap(16, 16);
  const [, js, jb, jh] = j.jacket;
  const sk = j.skin;
  const head = (hx: number, hy: number, blink: boolean) => {
    ellipse(m, hx, hy, 2.4, 2.6, sk, 0.4, -0.2);
    rect(m, Math.round(hx - 1), Math.round(hy - 3), 4, 1, j.hair);
    rect(m, Math.round(hx + 1), Math.round(hy - 2), 2, 2, j.hair);
    setPx(m, Math.round(hx - 1), Math.round(hy), blink ? sk[0] : 1);
  };
  if (frame === 'stand') {
    // Standing tall: legs, jacket, clipboard held out.
    rect(m, 6, 10, 2, 4, 2);
    rect(m, 8, 10, 2, 4, 3);
    rect(m, 5, 14, 5, 1, 1);
    rect(m, 5, 5, 6, 6, jb);
    rect(m, 9, 5, 2, 6, js);
    line(m, 5, 5, 5, 9, jh);
    rect(m, 3, 7, 3, 2, 8);
    setPx(m, 3, 7, 7);
    head(7.5, 2.6, false);
    return outline(m);
  }
  const lean = frame === 'lean';
  // Seated: thighs forward (left) on the bench, shins down.
  rect(m, 3, 10, 6, 2, 2);
  rect(m, 3, 12, 2, 3, 3);
  rect(m, 2, 14, 3, 1, 1);
  if (lean) {
    poly(
      m,
      [
        [5, 6],
        [9, 5],
        [11, 10],
        [6, 11],
      ],
      jb,
    );
    line(m, 9, 5, 11, 10, js);
    line(m, 5, 6, 6, 10, jh);
    // Elbow on the knee, chin forward.
    rect(m, 4, 8, 2, 2, sk[2]);
    head(5.5, 4.4, false);
  } else {
    rect(m, 7, 5, 5, 6, jb);
    rect(m, 10, 5, 2, 6, js);
    line(m, 7, 5, 7, 10, jh);
    rect(m, 5, 9, 2, 1, sk[2]);
    head(8.5, 3, frame === 'sit1');
  }
  return outline(m);
}

/** Judges' bench: 44x5 wooden seat on two legs; seat top on row 0. */
export function judgeBench(): IndexMap {
  const m = createMap(44, 5);
  rect(m, 1, 1, 42, 2, 15);
  rect(m, 1, 1, 42, 1, 11);
  rect(m, 4, 3, 2, 2, 14);
  rect(m, 38, 3, 2, 2, 14);
  return outline(m);
}

// ---------------------------------------------------------------------------
// Photo-finish camera (design 31.3): 8x40, a pole with a 6x6 camera and a 2x2 light (index 18 on).
// ---------------------------------------------------------------------------

export function photoCamera(lightOn: boolean): IndexMap {
  const m = createMap(8, 40);
  // Pole and base.
  rect(m, 3, 7, 2, 31, 5);
  rect(m, 3, 7, 1, 31, 6);
  rect(m, 1, 38, 6, 1, 4);
  // Camera body facing the track (lens to the left).
  rect(m, 1, 2, 6, 5, 3);
  rect(m, 1, 2, 6, 1, 4);
  rect(m, 1, 4, 2, 2, 31);
  setPx(m, 1, 4, 8);
  // Light on top.
  rect(m, 4, 0, 2, 2, lightOn ? 18 : 16);
  if (lightOn) setPx(m, 4, 0, 19);
  return outline(m);
}

// ---------------------------------------------------------------------------
// Lap-bell official (design 19.2, moved to the far side in 26.4): frame 0 bell held low, 1 ringing.
// ---------------------------------------------------------------------------

const BELL = {
  jacket: [1, 28, 29, 30] as Ramp4,
  trousers: [2, 3] as const,
  cap: [8, 17] as const,
  skin: [10, 11, 12, 13] as Ramp4,
};

export function bellOfficial(frame: 0 | 1): IndexMap {
  return official({ ...BELL, arm: frame === 0 ? 'bellLow' : 'bellUp' });
}
