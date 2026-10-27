/**
 * Pose-driven paper-doll renderer for 48x48 side-view runners (pure, no Phaser).
 *
 * Every frame is rasterised from a Pose (joint angles) and a CharacterSpec (proportions, kit
 * materials, hand-drawn head stamps). One shared set of animation poses therefore drives all eight
 * characters while proportions and kits keep them distinct (research 3: shared templates + swaps).
 *
 * Rules applied here: light from the top-left with 3 tones per material (design 5.4), far-side limbs
 * one tone darker, interior separation lines in the material's darkest tone (5.3.4), and a 1 px
 * automatic outer outline in index 1 added by the bake step (5.3).
 */
import { createMap, getPx, outline, setPx, type IndexMap } from '../bake/index.ts';
import { RAMP_DARKEST } from '../palette.ts';

/** [line (darkest), shadow, base, highlight] palette indices. */
export type Ramp = readonly [number, number, number, number];

export type HeadVariant = 'normal' | 'effort' | 'happy' | 'sad' | 'look' | 'tired';

export interface HeadStamp {
  readonly map: IndexMap;
  /** Pixel in the stamp that sits on the top of the neck. */
  readonly ax: number;
  readonly ay: number;
}

/** A capsule fixed to the torso, in torso coordinates (u: 0 hip .. 1 neck, v: -1 back .. +1 front). */
export interface TorsoProp {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly r: number;
  readonly mat: string;
  /** Drawn behind the torso (backpack) or in front of it (medal). */
  readonly layer: 'behind' | 'front';
  /** Only for these head variants / frames (optional filter). */
  readonly when?: (pose: Pose) => boolean;
}

export interface CharacterSpec {
  readonly id: string;
  /** Segment lengths in px. */
  readonly thigh: number;
  readonly shin: number;
  readonly upperArm: number;
  readonly foreArm: number;
  readonly foot: number;
  /** Hip to neck base. */
  readonly torso: number;
  readonly neck: number;
  /** Radii in px (thickness ~ 2r). */
  readonly thighR: readonly [number, number];
  readonly shinR: readonly [number, number];
  readonly upperArmR: readonly [number, number];
  readonly foreArmR: readonly [number, number];
  readonly torsoR: readonly [number, number];
  readonly footR: number;
  readonly materials: Readonly<Record<string, Ramp>>;
  /** Material of a torso pixel. u 0 (hip) .. 1 (neck), v -1 (back) .. +1 (front). */
  readonly torsoMat: (u: number, v: number, pose: Pose) => string;
  /** Material along a limb, t 0 (proximal) .. 1 (distal). */
  readonly thighMat: (t: number) => string;
  readonly shinMat: (t: number) => string;
  readonly upperArmMat: (t: number) => string;
  readonly foreArmMat: (t: number) => string;
  /** Far-side forearm material, when it differs (Sol's watch is on the near, left wrist only). */
  readonly foreArmMatFar?: (t: number) => string;
  readonly footMat: string;
  readonly neckMat: string;
  readonly heads: Readonly<Partial<Record<HeadVariant, HeadStamp>>> & { readonly normal: HeadStamp };
  readonly props?: readonly TorsoProp[];
  /** Extra head offset relative to the neck tip (px), e.g. to tuck a big head. */
  readonly headOffset?: readonly [number, number];
  /** Scales Pose.armReach (raised arms) for tall characters so fists stay inside the frame. */
  readonly raisedReachScale?: number;
  /** Optional selective outline (design 5.3.3). */
  readonly selout?: boolean;
  /**
   * v3: a flat stamp on the chest (field bibs and painted model numbers, design 24.2), centred on the
   * torso point (u, v) and drawn over the torso, under the near leg, head and near arm.
   */
  readonly decal?: { readonly map: IndexMap; readonly u: number; readonly v: number };
}

export interface Pose {
  /** Torso lean in degrees from vertical, positive = forward (right). */
  readonly lean: number;
  /** [thigh angle from vertical-down (+ forward), knee flexion >= 0]. */
  readonly legN: readonly [number, number];
  readonly legF: readonly [number, number];
  /** Optional absolute foot angle (90 = toes forward, flat). */
  readonly footN?: number;
  readonly footF?: number;
  /** [upper arm angle from vertical-down (+ forward), elbow flexion >= 0]. */
  readonly armN: readonly [number, number];
  readonly armF: readonly [number, number];
  /** Pixels the lowest point is raised above the ground row (flight). */
  readonly lift?: number;
  /** Horizontal hip offset from the frame centre. */
  readonly dx?: number;
  /** Shift upper body (torso, head, arms) down by whole px without moving feet (breathing). */
  readonly bob?: number;
  readonly head?: HeadVariant;
  /** Extra head offset for this pose (e.g. dropped head when exhausted). */
  readonly headDx?: number;
  readonly headDy?: number;
  /** Raise the shoulder joint toward the neck (px) and scale arm reach, for arms raised overhead. */
  readonly shoulderUp?: number;
  readonly armReach?: number;
  /** Draw the near arm behind the head (raised arms), separated by the head's darkest tones. */
  readonly armBehindHead?: boolean;
  /** Free-form tag that props can filter on (e.g. 'medal'). */
  readonly tag?: string;
}

type Vec = readonly [number, number];

const LIGHT: Vec = [-Math.SQRT1_2, -Math.SQRT1_2];
const D2R = Math.PI / 180;

function dirOf(deg: number): Vec {
  // Angle from vertical-down, positive toward +x.
  return [Math.sin(deg * D2R), Math.cos(deg * D2R)];
}
function add(a: Vec, b: Vec, k = 1): Vec {
  return [a[0] + b[0] * k, a[1] + b[1] * k];
}

/** Working canvas with per-pixel material names (for interior lines) and the drawn bounding box. */
class Canvas {
  readonly w: number;
  readonly h: number;
  readonly idx: Uint8Array;
  readonly mat: (string | null)[];
  readonly far: Uint8Array;
  /** Per-pixel generation marks: a set of pixels without allocating a Set per part. */
  readonly mark: Uint32Array;
  #gen = 0;
  /** Bounding box of every opaque pixel (lines only recolour existing pixels, so parts suffice). */
  minX: number;
  minY: number;
  maxX = -1;
  maxY = -1;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.idx = new Uint8Array(w * h);
    this.mat = new Array<string | null>(w * h).fill(null);
    this.far = new Uint8Array(w * h);
    this.mark = new Uint32Array(w * h);
    this.minX = w;
    this.minY = h;
  }
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  /** A fresh mark value: no pixel carries it until marked. */
  nextMark(): number {
    return ++this.#gen;
  }
  /** Back to empty for the next frame (marks stay valid: generations keep counting). */
  clear(): void {
    this.idx.fill(0);
    this.mat.fill(null);
    this.far.fill(0);
    this.minX = this.w;
    this.minY = this.h;
    this.maxX = -1;
    this.maxY = -1;
  }
}

interface PartPixel {
  readonly x: number;
  readonly y: number;
  readonly v: number;
  readonly mat: string;
  readonly line: number;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Composite a part: draws a separation line in the part's darkest tone on underlying body pixels
 * that touch it (only against a different material or a far-side part), then writes the part.
 */
function composite(cv: Canvas, px: readonly PartPixel[], far: boolean, lineMode: 'auto' | 'none'): void {
  if (lineMode === 'auto') {
    const own = cv.nextMark();
    for (const p of px) cv.mark[p.y * cv.w + p.x] = own;
    // Collected first, applied after: a line must not change what later neighbours compare against.
    const lineAt: number[] = [];
    const lineV: number[] = [];
    for (const p of px) {
      for (const [ox, oy] of NEIGHBOURS) {
        const x = p.x + ox;
        const y = p.y + oy;
        if (!cv.inside(x, y)) continue;
        const k = y * cv.w + x;
        if (cv.mark[k] === own || cv.idx[k] === 0) continue;
        const underMat = cv.mat[k];
        const underFar = cv.far[k] === 1;
        if (underMat !== p.mat || (underFar && !far)) {
          lineAt.push(k);
          lineV.push(p.line);
        }
      }
    }
    for (let i = 0; i < lineAt.length; i++) {
      const k = lineAt[i]!;
      cv.idx[k] = lineV[i]!;
      cv.mat[k] = '__line';
    }
  }
  for (const p of px) {
    const k = p.y * cv.w + p.x;
    cv.idx[k] = p.v;
    cv.mat[k] = p.mat;
    cv.far[k] = far ? 1 : 0;
    if (p.x < cv.minX) cv.minX = p.x;
    if (p.x > cv.maxX) cv.maxX = p.x;
    if (p.y < cv.minY) cv.minY = p.y;
    if (p.y > cv.maxY) cv.maxY = p.y;
  }
}

function toneOf(ramp: Ramp, lit: number, far: boolean, hiT: number, shT: number): number {
  let t = lit > hiT ? 3 : lit < shT ? 1 : 2;
  if (far) t = Math.max(0, t - 1);
  return ramp[t] as number;
}

interface CapsuleOpts {
  readonly a: Vec;
  readonly b: Vec;
  readonly r0: number;
  readonly r1: number;
  readonly matAt: (t: number, side: number) => string;
  readonly far: boolean;
  readonly hiT?: number;
  readonly shT?: number;
}

function rasterCapsule(cv: Canvas, spec: CharacterSpec, o: CapsuleOpts): PartPixel[] {
  const out: PartPixel[] = [];
  const [ax, ay] = o.a;
  const [bx, by] = o.b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-6;
  const len = Math.sqrt(len2);
  const nx = -dy / len;
  const ny = dx / len;
  const rMax = Math.max(o.r0, o.r1);
  // Bounding box of the capsule, clipped to the canvas.
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rMax - 1));
  const x1 = Math.min(cv.w - 1, Math.ceil(Math.max(ax, bx) + rMax + 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rMax - 1));
  const y1 = Math.min(cv.h - 1, Math.ceil(Math.max(ay, by) + rMax + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + dx * t;
      const cy = ay + dy * t;
      const ox = px - cx;
      const oy = py - cy;
      const d = Math.sqrt(ox * ox + oy * oy);
      const r = o.r0 + (o.r1 - o.r0) * t;
      if (d > r) continue;
      const lit = (ox * LIGHT[0] + oy * LIGHT[1]) / Math.max(r, 0.75);
      const side = (ox * nx + oy * ny) / Math.max(r, 0.75);
      const mat = o.matAt(t, side);
      const ramp = spec.materials[mat];
      if (!ramp) throw new Error(`${spec.id}: unknown material ${mat}`);
      out.push({ x, y, v: toneOf(ramp, lit, o.far, o.hiT ?? 0.5, o.shT ?? -0.3), mat, line: ramp[0] });
    }
  }
  return out;
}

export interface Anchors {
  /** Mouth / face front, in frame px. */
  readonly mouth: Vec;
  /** Top of head. */
  readonly headTop: Vec;
  /** Middle of the back (exhaust, backpack). */
  readonly back: Vec;
  /** Near and far knees and feet. */
  readonly kneeN: Vec;
  readonly footN: Vec;
  readonly footF: Vec;
  readonly handN: Vec;
}

export interface RenderedFrame {
  readonly map: IndexMap;
  readonly anchors: Anchors;
}

const WORK = 96;
const HIP: Vec = [WORK / 2 + 0.5, WORK / 2 + 0.5];
/** Reused by every renderPose call (rendering is synchronous, so never shared). */
const scratch = new Canvas(WORK, WORK);

/** Render one 48x48 frame (outlined) for a pose. */
export function renderPose(spec: CharacterSpec, pose: Pose, size = 48, groundRow = 46): RenderedFrame {
  const cv = scratch;
  cv.clear();
  const bob = pose.bob ?? 0;
  const hip = HIP;
  const up: Vec = [hip[0], hip[1] + bob];
  const leanDir: Vec = [Math.sin(pose.lean * D2R), -Math.cos(pose.lean * D2R)];
  const frontDir: Vec = [Math.cos(pose.lean * D2R), Math.sin(pose.lean * D2R)];
  const neckBase = add(up, leanDir, spec.torso);
  const shoulder = add(up, leanDir, spec.torso - 2.2 + (pose.shoulderUp ?? 0) * (spec.raisedReachScale ?? 1));
  const reach = pose.armReach ? 1 + (pose.armReach - 1) * (spec.raisedReachScale ?? 1) : 1;
  const [rHip, rSh] = spec.torsoR;

  const legJoints = (leg: readonly [number, number], footAbs: number | undefined) => {
    const knee = add(hip, dirOf(leg[0]), spec.thigh);
    const shinAbs = leg[0] - leg[1];
    const ankle = add(knee, dirOf(shinAbs), spec.shin);
    const fAng = footAbs ?? Math.max(-60, Math.min(120, shinAbs + 90));
    const toe = add(ankle, dirOf(fAng), spec.foot);
    const heel = add(ankle, dirOf(fAng), -1);
    return { knee, ankle, toe, heel };
  };
  const armJoints = (arm: readonly [number, number]) => {
    const elbow = add(shoulder, dirOf(arm[0]), spec.upperArm * reach);
    const hand = add(elbow, dirOf(arm[0] + arm[1]), spec.foreArm * reach);
    return { elbow, hand };
  };

  const drawLeg = (leg: readonly [number, number], footAbs: number | undefined, far: boolean) => {
    const j = legJoints(leg, footAbs);
    composite(
      cv,
      rasterCapsule(cv, spec, {
        a: j.ankle,
        b: add(j.heel, dirOf(0), 0),
        r0: spec.footR,
        r1: spec.footR,
        matAt: () => spec.footMat,
        far,
      }).concat(
        rasterCapsule(cv, spec, {
          a: j.ankle,
          b: j.toe,
          r0: spec.footR,
          r1: spec.footR * 0.9,
          matAt: () => spec.footMat,
          far,
        }),
      ),
      far,
      'auto',
    );
    composite(
      cv,
      rasterCapsule(cv, spec, {
        a: j.knee,
        b: j.ankle,
        r0: spec.shinR[0],
        r1: spec.shinR[1],
        matAt: (t) => spec.shinMat(t),
        far,
      }),
      far,
      'auto',
    );
    composite(
      cv,
      rasterCapsule(cv, spec, {
        a: hip,
        b: j.knee,
        r0: spec.thighR[0],
        r1: spec.thighR[1],
        matAt: (t) => spec.thighMat(t),
        far,
      }),
      far,
      'auto',
    );
    return j;
  };
  const drawArm = (arm: readonly [number, number], far: boolean) => {
    const j = armJoints(arm);
    const fore = rasterCapsule(cv, spec, {
      a: j.elbow,
      b: j.hand,
      r0: spec.foreArmR[0],
      r1: spec.foreArmR[1],
      matAt: (t) => (far && spec.foreArmMatFar ? spec.foreArmMatFar(t) : spec.foreArmMat(t)),
      far,
    });
    const upper = rasterCapsule(cv, spec, {
      a: shoulder,
      b: j.elbow,
      r0: spec.upperArmR[0],
      r1: spec.upperArmR[1],
      matAt: (t) => spec.upperArmMat(t),
      far,
    });
    // Arm as one part so the elbow has no line across it (first pixel wins where they overlap).
    const seen = cv.nextMark();
    const merged: PartPixel[] = [];
    for (const p of upper.concat(fore)) {
      const k = p.y * cv.w + p.x;
      if (cv.mark[k] === seen) continue;
      cv.mark[k] = seen;
      merged.push(p);
    }
    composite(cv, merged, far, 'auto');
    return j;
  };

  const torsoPoint = (u: number, v: number): Vec => {
    const r = rHip + (rSh - rHip) * u;
    return add(add(up, leanDir, u * spec.torso), frontDir, v * r);
  };
  const drawProps = (layer: 'behind' | 'front') => {
    for (const p of spec.props ?? []) {
      if (p.layer !== layer || (p.when && !p.when(pose))) continue;
      composite(
        cv,
        rasterCapsule(cv, spec, {
          a: torsoPoint(p.from[0], p.from[1]),
          b: torsoPoint(p.to[0], p.to[1]),
          r0: p.r,
          r1: p.r,
          matAt: () => p.mat,
          far: false,
        }),
        false,
        'auto',
      );
    }
  };

  // Back to front: far arm, far leg, behind-props, torso, near leg, neck+head, front props, near arm.
  drawArm(pose.armF, true);
  const jf = drawLeg(pose.legF, pose.footF, true);
  drawProps('behind');

  // Torso: tapered capsule from just below the hip to the neck base.
  const torsoBottom = add(up, leanDir, -1.2);
  const torsoPx = rasterCapsule(cv, spec, {
    a: torsoBottom,
    b: add(neckBase, leanDir, -0.6),
    r0: rHip,
    r1: rSh,
    matAt: (t, side) => spec.torsoMat(t, side, pose),
    far: false,
    hiT: 0.55,
    shT: -0.25,
  });
  composite(cv, torsoPx, false, 'none');
  if (spec.decal) {
    const d = spec.decal;
    const c = torsoPoint(d.u, d.v);
    const dx0 = Math.round(c[0] - d.map.w / 2);
    const dy0 = Math.round(c[1] - d.map.h / 2);
    const decalPx: PartPixel[] = [];
    for (let y = 0; y < d.map.h; y++) {
      for (let x = 0; x < d.map.w; x++) {
        const v = getPx(d.map, x, y);
        if (v && cv.inside(dx0 + x, dy0 + y) && cv.idx[(dy0 + y) * cv.w + dx0 + x] !== 0) {
          decalPx.push({ x: dx0 + x, y: dy0 + y, v, mat: '__decal', line: v });
        }
      }
    }
    composite(cv, decalPx, false, 'none');
  }

  const jn = drawLeg(pose.legN, pose.footN, false);

  // Neck and head.
  const head = spec.heads[pose.head ?? 'normal'] ?? spec.heads.normal;
  const neckTip = add(neckBase, [0, -1], spec.neck);
  composite(
    cv,
    rasterCapsule(cv, spec, {
      a: neckBase,
      b: neckTip,
      r0: 1.2,
      r1: 1.2,
      matAt: () => spec.neckMat,
      far: false,
    }),
    false,
    'none',
  );
  const off = spec.headOffset ?? [0, 0];
  const hx = Math.round(neckTip[0] + off[0] + (pose.headDx ?? 0) - 0.5) - head.ax;
  const hy = Math.round(neckTip[1] + off[1] + (pose.headDy ?? 0) - 0.5) - head.ay;
  const headPx: PartPixel[] = [];
  for (let y = 0; y < head.map.h; y++) {
    for (let x = 0; x < head.map.w; x++) {
      const v = getPx(head.map, x, y);
      if (v && cv.inside(hx + x, hy + y)) {
        headPx.push({ x: hx + x, y: hy + y, v, mat: '__head', line: RAMP_DARKEST[v] ?? v });
      }
    }
  }
  const ja = pose.armBehindHead ? drawArm(pose.armN, false) : null;
  composite(cv, headPx, false, pose.armBehindHead ? 'auto' : 'none');
  drawProps('front');
  const jaFront = ja ?? drawArm(pose.armN, false);

  // Place into the frame: feet (lowest pixel) on groundRow - lift, hip at centre + dx.
  const bottom = cv.maxY;
  const top = cv.minY;
  // Flight lift is limited by the headroom so tall characters never clip (outline needs row 0 free).
  const headroom = groundRow - (bottom - top) - 2;
  const lift = Math.max(0, Math.min(pose.lift ?? 0, headroom));
  const shiftY = groundRow - lift - bottom;
  const shiftX = Math.round(size / 2 - HIP[0] + 0.5 + (pose.dx ?? 0)) - 1;
  const frame = createMap(size, size);
  for (let y = top; y <= bottom; y++) {
    for (let x = cv.minX; x <= cv.maxX; x++) {
      const v = cv.idx[y * WORK + x] as number;
      if (v) setPx(frame, x + shiftX, y + shiftY, v);
    }
  }
  const tr = (p: Vec): Vec => [Math.round(p[0] + shiftX - 0.5), Math.round(p[1] + shiftY - 0.5)];
  const anchors: Anchors = {
    mouth: tr([hx + head.map.w - 1.5, hy + head.map.h * 0.7]),
    headTop: tr([hx + head.map.w / 2, hy]),
    back: tr(torsoPoint(0.6, -1.2)),
    kneeN: tr(jn.knee),
    footN: tr(jn.ankle),
    footF: tr(jf.ankle),
    handN: tr(jaFront.hand),
  };
  return { map: outline(frame, spec.selout ? { selout: true } : {}), anchors };
}
