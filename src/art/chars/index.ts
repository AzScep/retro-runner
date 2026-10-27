/**
 * Character catalog: every frame of every animation (design 5.6) plus character extras, as pure
 * index maps with per-frame anchors for overlays. Pure (no Phaser).
 */
import { createMap, outline, remap, setPx, getPx, type IndexMap } from '../bake/index.ts';
import { PALETTE } from '../palette.ts';
import { ANIMS, RUN_POSES, animPoses, runPosesWith } from './poses.ts';
import { renderPose, type Anchors, type Pose } from './rig.ts';
import { SPECS, type SpecId } from './specs.ts';

export const CHARACTER_IDS: readonly SpecId[] = [
  'rio',
  'pip',
  'jess',
  'marco',
  'kofi',
  'valentina',
  'unit7',
  'zyx',
];

export const FRAME_SIZE = 48;
/** Design pivot: bottom-centre (24, 47). */
export const PIVOT_X = 24;
export const PIVOT_Y = 47;

export interface CharFrame {
  readonly name: string;
  readonly map: IndexMap;
  readonly anchors: Anchors;
}

export interface CharAnim {
  /** Local name, e.g. 'run'; the Phaser key is `${id}.${name}`. */
  readonly name: string;
  readonly frames: readonly string[];
  readonly fps: number;
  readonly repeat: number;
}

export interface CharacterArt {
  readonly id: SpecId;
  readonly frames: readonly CharFrame[];
  readonly anims: readonly CharAnim[];
}

/** UNIT-7 overclock: visor and chest light glow red (design 3.3). */
export const OVERCLOCK_REMAP: Readonly<Record<number, number>> = { 35: 16, 36: 18, 37: 19 };

function addPoses(
  out: CharFrame[],
  anims: CharAnim[],
  id: SpecId,
  name: string,
  poses: readonly Pose[],
  fps: number,
  repeat: number,
  post?: (m: IndexMap) => IndexMap,
): void {
  const spec = SPECS[id];
  const names: string[] = [];
  poses.forEach((p, i) => {
    const r = renderPose(spec, p);
    const fname = `${name}${i}`;
    out.push({ name: fname, map: post ? post(r.map) : r.map, anchors: r.anchors });
    names.push(fname);
  });
  anims.push({ name, frames: names, fps, repeat });
}

/** Squeeze a frame horizontally toward x = cx (warp), keeping only opaque core pixels. */
function squeeze(m: IndexMap, k: number, cx: number): IndexMap {
  const out = createMap(m.w, m.h);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const sx = Math.round(cx + (x - cx) / k);
      const v = getPx(m, sx, y);
      if (v) setPx(out, x, y, v);
    }
  }
  return out;
}

function glow(m: IndexMap): IndexMap {
  // Body -> teal glow, outline -> teal shadow.
  return remap(
    m,
    Object.fromEntries(
      PALETTE.map((c, i) => {
        const lum = ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
        return [i, i === 1 ? 35 : lum > 120 ? 37 : 36];
      }),
    ),
  );
}

function warpFrames(base: IndexMap): IndexMap[] {
  const strip = (m: IndexMap) => {
    // Remove the outline so the squeezed shape can be re-outlined cleanly.
    const c = createMap(m.w, m.h);
    for (let i = 0; i < m.data.length; i++) if (m.data[i] !== 1) c.data[i] = m.data[i] as number;
    return c;
  };
  const core = strip(base);
  const f: IndexMap[] = [];
  f.push(base);
  f.push(outline(glow(core), { color: 35 }));
  f.push(outline(glow(squeeze(core, 0.5, 24)), { color: 35 }));
  f.push(outline(glow(squeeze(core, 0.18, 24)), { color: 35 }));
  const line = createMap(48, 48);
  for (let y = 4; y < 46; y += 1) if (y % 4 !== 1) setPx(line, 24, y, 37);
  f.push(line);
  const dots = createMap(48, 48);
  for (const [x, y] of [
    [24, 8],
    [22, 18],
    [26, 26],
    [23, 36],
    [25, 44],
  ] as const) {
    setPx(dots, x, y, 37);
  }
  f.push(dots);
  return f;
}

export function buildCharacter(id: SpecId): CharacterArt {
  const frames: CharFrame[] = [];
  const anims: CharAnim[] = [];
  for (const a of ANIMS) addPoses(frames, anims, id, a.name, animPoses(id, a), a.fps, a.repeat);

  // Character extras (design 5.6).
  if (id === 'pip') {
    const wave: Pose[] = [0, 2, 4, 6].map((i, k) => ({
      ...(RUN_POSES[i] as Pose),
      lean: 8,
      armN: k % 2 === 0 ? [84, 36] : [96, 70],
      head: 'look',
    }));
    addPoses(frames, anims, id, 'wave', wave, 8, -1);
  }
  if (id === 'marco')
    addPoses(frames, anims, id, 'runLook', runPosesWith({ head: 'look', lean: 12 }), 12, -1);
  if (id === 'unit7') {
    addPoses(frames, anims, id, 'runOc', RUN_POSES, 12, -1, (m) => remap(m, OVERCLOCK_REMAP));
  }
  if (id === 'zyx') {
    const base = frames.find((f) => f.name === 'run3') as CharFrame;
    const out = warpFrames(base.map);
    const names = out.map((m, i) => {
      frames.push({ name: `warpOut${i}`, map: m, anchors: base.anchors });
      return `warpOut${i}`;
    });
    anims.push({ name: 'warpOut', frames: names, fps: 20, repeat: 0 });
    const inNames = [...out].reverse().map((m, i) => {
      frames.push({ name: `warpIn${i}`, map: m, anchors: base.anchors });
      return `warpIn${i}`;
    });
    anims.push({ name: 'warpIn', frames: inNames, fps: 20, repeat: 0 });
  }
  return { id, frames, anims };
}
