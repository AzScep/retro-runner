/**
 * Shared animation poses (design 5.6). One table drives every character; proportions differ per spec.
 * Angles: limbs from vertical-down, positive = forward (right). Knee/elbow values are flexion.
 */
import type { Pose } from './rig.ts';

export type AnimName = 'idle' | 'walk' | 'ready' | 'run' | 'lean' | 'celebrate' | 'lose' | 'stumble';

export interface AnimDef {
  readonly name: AnimName;
  readonly fps: number;
  /** -1 loop, 0 play once (held on last frame). */
  readonly repeat: number;
  readonly poses: readonly Pose[];
}

/**
 * Sprint cycle for one leg over 8 frames (2 strides). Frame 0 = near foot contact.
 * [thigh, knee flexion, foot angle]
 */
const LEG_CYCLE: readonly (readonly [number, number, number | undefined])[] = [
  [28, 22, 92], // 0 contact: foot lands just ahead of the hip
  [8, 30, 90], // 1 support: knee absorbs
  [-18, 12, 62], // 2 drive: leg extends behind
  [-34, 48, 30], // 3 toe-off: foot leaves, heel rising
  [-14, 118, undefined], // 4 recovery: heel kicks up to the seat
  [34, 128, undefined], // 5 swing: knee drives forward
  [72, 104, undefined], // 6 high knee
  [56, 50, 100], // 7 reach: shin swings out to land
];

/** Arm swing opposite to the same-side leg. [upper, elbow flexion] */
const ARM_CYCLE: readonly (readonly [number, number])[] = [
  [-98, 64], // 0 near leg forward -> near arm swung high back, hand clear behind the back
  [-70, 58],
  [-6, 84],
  [36, 96],
  [62, 104], // 4 near arm fully forward (hand at chin)
  [40, 98],
  [0, 84],
  [-60, 52],
];

/** Body height: flight frames lift off the ground, support frames sit low. */
const RUN_LIFT = [0, 0, 0, 1, 2, 0, 0, 1];
const RUN_BOB = [0, 1, 0, 0, 0, 1, 0, 0];

function runPose(i: number, extra: Partial<Pose> = {}): Pose {
  const n = LEG_CYCLE[i % 8]!;
  const f = LEG_CYCLE[(i + 4) % 8]!;
  const an = ARM_CYCLE[i % 8]!;
  const af = ARM_CYCLE[(i + 4) % 8]!;
  const pose: Pose = {
    lean: 18,
    legN: [n[0], n[1]],
    legF: [f[0], f[1]],
    armN: an,
    armF: af,
    lift: RUN_LIFT[i % 8] ?? 0,
    bob: RUN_BOB[i % 8] ?? 0,
    head: 'effort',
    dx: -1,
    ...(n[2] !== undefined ? { footN: n[2] } : {}),
    ...(f[2] !== undefined ? { footF: f[2] } : {}),
    ...extra,
  };
  return pose;
}

export const RUN_POSES: readonly Pose[] = Array.from({ length: 8 }, (_, i) => runPose(i));

/** Run frames with a different head (Marco looking at the camera while coasting). */
export function runPosesWith(extra: Partial<Pose>): Pose[] {
  return Array.from({ length: 8 }, (_, i) => runPose(i, extra));
}

const WALK_LEG: readonly (readonly [number, number, number | undefined])[] = [
  [20, 6, 92],
  [8, 10, 90],
  [-8, 6, 84],
  [-20, 22, 62],
  [-6, 52, undefined],
  [16, 36, 96],
];
const WALK_ARM: readonly (readonly [number, number])[] = [
  [-18, 16],
  [-10, 14],
  [2, 14],
  [16, 22],
  [12, 20],
  [-4, 14],
];

const WALK_POSES: Pose[] = Array.from({ length: 6 }, (_, i) => {
  const n = WALK_LEG[i]!;
  const f = WALK_LEG[(i + 3) % 6]!;
  return {
    lean: 4,
    legN: [n[0], n[1]],
    legF: [f[0], f[1]],
    armN: WALK_ARM[i]!,
    armF: WALK_ARM[(i + 3) % 6]!,
    bob: i % 3 === 1 ? 0 : i % 3 === 2 ? 1 : 0,
    ...(n[2] !== undefined ? { footN: n[2] } : {}),
    ...(f[2] !== undefined ? { footF: f[2] } : {}),
  };
});

const IDLE_POSES: Pose[] = [0, 1, 2, 3].map((i) => ({
  lean: 2,
  legN: [6, 4],
  legF: [-6, 2],
  footN: 90,
  footF: 88,
  armN: [i === 1 || i === 2 ? 10 : 8, 22 + (i === 2 ? 4 : 0)],
  armF: [-10, 14],
  bob: i === 1 || i === 2 ? 1 : 0,
}));

/**
 * Sprinter in the blocks. The near arm is drawn behind the hanging head so the face stays clear
 * and the arm reads below the chin. The race view shifts these frames back (READY_SHIFT_PX in
 * view/runner.ts) so the whole figure waits behind the start line.
 */
const READY_POSES: Pose[] = [
  // On your marks: rear (far) knee down on the track, front (near) foot forward under the hips,
  // straight arms with hands on the track, back almost flat, head down.
  {
    lean: 80,
    legN: [70, 140],
    legF: [8, 102],
    footN: 100,
    footF: 0,
    armN: [0, 0],
    armF: [-4, 0],
    dx: -6,
    headDx: -1,
    headDy: 3,
    armBehindHead: true,
  },
  // Set: hips rise above the shoulders, rear knee lifts off the track, weight forward on the hands.
  {
    lean: 106,
    legN: [48, 98],
    legF: [-26, 44],
    footN: 96,
    footF: 30,
    armN: [8, 0],
    armF: [4, 0],
    dx: -6,
    headDx: -1,
    headDy: 3,
    armBehindHead: true,
  },
];

const LEAN_POSES: Pose[] = [
  {
    lean: 38,
    legN: [40, 30],
    legF: [-30, 40],
    footN: 96,
    footF: 30,
    armN: [-70, 40],
    armF: [-60, 50],
    head: 'effort',
    dx: -2,
  },
  {
    lean: 52,
    legN: [46, 20],
    legF: [-34, 52],
    footN: 98,
    footF: 26,
    armN: [-96, 30],
    armF: [-84, 40],
    head: 'effort',
    dx: -3,
  },
];

/**
 * Victory jump (6 frames, loop): crouch, take off, two airborne frames at the peak, fall, land.
 * Side view cannot show both arms straight up without hiding one behind the head, so the arms
 * open into a wide V: the near arm pumps up in front of the face, the far arm up behind the head.
 */
const CELEBRATE_KEYS: readonly {
  lift: number;
  bob: number;
  up: number;
  legs: 'crouch' | 'tuck' | 'land';
}[] = [
  { lift: 0, bob: 1, up: 0.75, legs: 'crouch' },
  { lift: 3, bob: 0, up: 1, legs: 'tuck' },
  { lift: 5, bob: 0, up: 1, legs: 'tuck' },
  { lift: 5, bob: 0, up: 0.95, legs: 'tuck' },
  { lift: 3, bob: 0, up: 1, legs: 'tuck' },
  { lift: 0, bob: 1, up: 0.9, legs: 'land' },
];
const CELEBRATE_POSES: Pose[] = CELEBRATE_KEYS.map((k) => {
  const legs =
    k.legs === 'tuck'
      ? { legN: [30, 70] as const, legF: [-14, 64] as const, footN: 70, footF: 30 }
      : k.legs === 'crouch'
        ? { legN: [26, 40] as const, legF: [-8, 30] as const, footN: 92, footF: 86 }
        : { legN: [20, 32] as const, legF: [-6, 22] as const, footN: 92, footF: 88 };
  return {
    lean: -4,
    ...legs,
    // Near arm: elbow out in front of the chin, forearm up and forward (fist pump clear of the face).
    armN: [84 + 14 * k.up, 30 + 46 * k.up] as const,
    // Far arm: up and back behind the head.
    armF: [-(100 + 30 * k.up), -30 * k.up] as const,
    // Chin up: the head tips back, which also keeps the face clear of the near arm.
    headDx: -2,
    shoulderUp: 1,
    armReach: 1.25,
    lift: k.lift,
    bob: k.bob,
    head: 'happy',
    tag: 'celebrate',
  };
});

/**
 * Pip's own kid celebration: a big star jump. Arms fly up and out wide so the fists clear his
 * oversized cap, legs kick apart at the peak, and he lands in a squat.
 */
const PIP_CELEBRATE_POSES: Pose[] = [
  { lift: 0, bob: 1, arms: 0.9, legs: 'squat' },
  { lift: 4, bob: 0, arms: 1, legs: 'tuck' },
  { lift: 8, bob: 0, arms: 1, legs: 'star' },
  { lift: 8, bob: 0, arms: 0.9, legs: 'star' },
  { lift: 4, bob: 0, arms: 1, legs: 'tuck' },
  { lift: 0, bob: 1, arms: 0.95, legs: 'squat' },
].map((k) => {
  const legs =
    k.legs === 'star'
      ? { legN: [42, 8] as const, legF: [-40, 6] as const, footN: 120, footF: 40 }
      : k.legs === 'tuck'
        ? { legN: [40, 80] as const, legF: [-10, 70] as const, footN: 80, footF: 30 }
        : { legN: [34, 60] as const, legF: [-6, 50] as const, footN: 92, footF: 86 };
  return {
    lean: -6,
    ...legs,
    // Near arm punches up and out under the chin so the fist clears the face and the cap bill.
    armN: [80 + 16 * k.arms, 56 * k.arms] as const,
    // Far arm flies up and back past the cap.
    armF: [-(80 + 44 * k.arms), -24 * k.arms] as const,
    headDx: -2,
    shoulderUp: 0,
    armReach: 1.6,
    lift: k.lift,
    bob: k.bob,
    head: 'happy' as const,
    tag: 'celebrate',
  };
});

const LOSE_POSES: Pose[] = [0, 1, 2, 3].map((i) => ({
  lean: 58 + (i === 1 || i === 2 ? 2 : 0),
  legN: [32, 30],
  legF: [22, 26],
  footN: 90,
  footF: 90,
  armN: [30, 6],
  armF: [24, 6],
  bob: i === 1 || i === 2 ? 1 : 0,
  head: 'sad',
  dx: -3,
}));

const STUMBLE_POSES: Pose[] = [
  {
    lean: 34,
    legN: [-26, 40],
    legF: [30, 24],
    footN: 40,
    footF: 96,
    armN: [70, 20],
    armF: [110, 10],
    lift: 1,
    head: 'sad',
    dx: -1,
  },
  {
    lean: 54,
    legN: [-44, 70],
    legF: [20, 30],
    footN: 30,
    footF: 92,
    armN: [120, 10],
    armF: [90, 10],
    lift: 2,
    head: 'sad',
    dx: 0,
  },
  {
    lean: 26,
    legN: [24, 26],
    legF: [-22, 40],
    footN: 94,
    footF: 50,
    armN: [60, 50],
    armF: [-40, 30],
    head: 'sad',
    dx: -1,
  },
];

export const ANIMS: readonly AnimDef[] = [
  { name: 'idle', fps: 6, repeat: -1, poses: IDLE_POSES },
  { name: 'walk', fps: 10, repeat: -1, poses: WALK_POSES },
  { name: 'ready', fps: 1, repeat: 0, poses: READY_POSES },
  { name: 'run', fps: 12, repeat: -1, poses: RUN_POSES },
  { name: 'lean', fps: 12, repeat: 0, poses: LEAN_POSES },
  { name: 'celebrate', fps: 8, repeat: -1, poses: CELEBRATE_POSES },
  { name: 'lose', fps: 6, repeat: -1, poses: LOSE_POSES },
  { name: 'stumble', fps: 12, repeat: 0, poses: STUMBLE_POSES },
];

/** Poses of an animation for one character (Pip has his own celebration). */
export function animPoses(id: string, anim: AnimDef): readonly Pose[] {
  if (id === 'pip' && anim.name === 'celebrate') return PIP_CELEBRATE_POSES;
  return anim.poses;
}

/** Frame counts required by design 5.6 (33 per character). */
export const ANIM_FRAME_COUNTS: Readonly<Record<AnimName, number>> = {
  idle: 4,
  walk: 6,
  ready: 2,
  run: 8,
  lean: 2,
  celebrate: 6,
  lose: 4,
  stumble: 3,
};
