/**
 * Draws a core RaceState on a canvas the way the game's RaceView does (design 5.7, 26): the tier 1
 * stadium in parallax, start and finish lines, distance boards, then the six lanes far to near with
 * their shadows, then the foreground. One canvas pixel is one art pixel; CSS scales it up.
 *
 * Characters come from src/landing/art. The rest of the game's view is pure, Phaser-free art code
 * that landing/art does not re-export (camera and lane math, animation picks, track markings and
 * the tier 1 field runners), so it is imported from src/art directly; none of it is a spoiler.
 */
import { fieldRunners, type FieldRunnerInfo, type RaceEvent, type RaceState } from '../../core/index.ts';
import { toRGBA, type IndexMap } from '../../art/landing.ts';
import { buildField } from '../../art/chars/field.ts';
import { cameraScroll, finishXPx, VIEW, worldX } from '../../art/view/camera.ts';
import { laneFeetY, runnerScreenX } from '../../art/view/lanes.ts';
import {
  airRaisePx,
  pickFieldView,
  pickRunnerView,
  type RunnerPick,
  type RunnerViewState,
} from '../../art/view/runner.ts';
import {
  distanceBoard,
  finishLine,
  LANE_COUNT,
  LAYERS,
  laneOffsetPx,
  MARKING_LEFT,
  MARKING_TOP,
  startLine,
} from '../../art/stadium/layers.ts';
import { AIR_SHADOW_SIZES, airShadow, airShadowIndex } from '../../art/stadium/props.ts';
import {
  characterAnims,
  characterFrames,
  CROWD_FRAME_MS,
  layerOffset,
  stadiumLayers,
  STADIUM_HEIGHT,
  type StadiumLayer,
} from '../art/index.ts';

const TIER = 1;
const DISTANCE_M = 100;
/** RaceView: boards stand on the apron with the far lane's offset, every 10 m. */
const BOARD_FOOT_Y = LAYERS.track.y + 1;
const FAR_OFFSET = laneOffsetPx(LANE_COUNT - 1);
/** RaceView: the crowd gets excited while a runner is in the last 20 m. */
const EXCITED_ZONE_M = 20;
/** RaceView: Rio's fumble stumble shows 160 ms, restarted at most 3 times a second. */
const FUMBLE_STUMBLE_MS = 160;
const FUMBLE_RESTART_MS = 1000 / 3;

type Bitmap = HTMLCanvasElement;

function bitmap(m: IndexMap): Bitmap {
  const c = document.createElement('canvas');
  c.width = m.w;
  c.height = m.h;
  const data = new Uint8ClampedArray(toRGBA(m).buffer as ArrayBuffer);
  c.getContext('2d')?.putImageData(new ImageData(data, m.w, m.h), 0, 0);
  return c;
}

interface Anim {
  readonly frames: readonly Bitmap[];
  readonly fps: number;
  readonly loop: boolean;
}

/** One runner's animations by name, as bitmaps. */
type Sheet = ReadonlyMap<string, Anim>;

function characterSheet(id: 'rio' | 'pip'): Sheet {
  const out = new Map<string, Anim>();
  for (const name of characterAnims(id)) {
    const clip = characterFrames(id, name);
    out.set(name, { frames: clip.frames.map(bitmap), fps: clip.fps, loop: clip.loop });
  }
  return out;
}

function fieldSheet(info: FieldRunnerInfo): Sheet {
  const art = buildField(info.body, info.variant);
  const byName = new Map(art.frames.map((f) => [f.name, f.map]));
  const out = new Map<string, Anim>();
  for (const a of art.anims) {
    const frames = a.frames.map((n) => bitmap(byName.get(n) as IndexMap));
    out.set(a.name, { frames, fps: a.fps, loop: a.repeat === -1 });
  }
  return out;
}

/** 'run3' -> run frame 3, as RaceView's frame names index their animation. */
function namedFrame(sheet: Sheet, name: string): Bitmap | null {
  const m = /^([a-zA-Z]+)(\d+)$/.exec(name);
  if (m === null) return null;
  return sheet.get(m[1] as string)?.frames[Number(m[2])] ?? null;
}

interface Lane {
  readonly sheet: Sheet;
  readonly character: 'rio' | 'pip' | null;
  vs: RunnerViewState;
  /** When the current one-shot or looping animation started (performance.now ms). */
  animStart: number;
  stumbleUntil: number;
}

interface LayerArt {
  readonly layer: StadiumLayer;
  readonly a: Bitmap;
  readonly b: Bitmap | null;
}

export class DashRenderer {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #layers: readonly LayerArt[];
  readonly #start: Bitmap;
  readonly #finish: Bitmap;
  readonly #boards: readonly { readonly img: Bitmap; readonly x: number }[];
  readonly #shadows: readonly Bitmap[];
  readonly #lanes: readonly Lane[];
  #lastFumble = Number.NEGATIVE_INFINITY;
  #lastNow: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('dash: no 2d canvas');
    this.#ctx = ctx;
    this.#layers = stadiumLayers(TIER).map((layer) => ({
      layer,
      a: bitmap(layer.map),
      b: layer.alt ? bitmap(layer.alt) : null,
    }));
    this.#start = bitmap(startLine(TIER));
    this.#finish = bitmap(finishLine());
    const boards = [];
    for (let m = 10; m < DISTANCE_M; m += 10)
      boards.push({ img: bitmap(distanceBoard(m)), x: Math.round(worldX(m) - 6) + FAR_OFFSET });
    this.#boards = boards;
    this.#shadows = AIR_SHADOW_SIZES.map((_, i) => bitmap(airShadow(i)));
    const sheets: { sheet: Sheet; character: 'rio' | 'pip' | null }[] = [
      { sheet: characterSheet('rio'), character: 'rio' },
      { sheet: characterSheet('pip'), character: 'pip' },
      ...fieldRunners(TIER).map((f) => ({ sheet: fieldSheet(f), character: null })),
    ];
    this.#lanes = sheets.map((s) => ({
      ...s,
      vs: { phase: 0, played: null },
      animStart: 0,
      stumbleUntil: 0,
    }));
  }

  /** Forget animation state between races. */
  reset(): void {
    for (const l of this.#lanes) {
      l.vs = { phase: 0, played: null };
      l.stumbleUntil = 0;
    }
    this.#lastFumble = Number.NEGATIVE_INFINITY;
  }

  /**
   * Draws one frame `viewW` art px wide. `state` null is the start screen: everyone idle behind
   * the line. `events` are this frame's race events (fumble stumbles).
   */
  draw(state: RaceState | null, events: readonly RaceEvent[], now: number, viewW: number): void {
    const dtMs = this.#lastNow === null ? 0 : Math.min(100, Math.max(0, now - this.#lastNow));
    this.#lastNow = now;
    const ctx = this.#ctx;
    for (const e of events) {
      if (e.type === 'fumble' && now - this.#lastFumble >= FUMBLE_RESTART_MS) {
        this.#lastFumble = now;
        (this.#lanes[0] as Lane).stumbleUntil = now + FUMBLE_STUMBLE_MS;
      }
    }
    const scroll = state === null ? 0 : cameraScroll(worldX(state.player.xM), DISTANCE_M);
    const excited =
      state !== null &&
      state.runners.some((r) => r.state.xM >= DISTANCE_M - EXCITED_ZONE_M && r.state.xM < DISTANCE_M);
    const crowdMs = excited ? CROWD_FRAME_MS / 2 : CROWD_FRAME_MS;
    const crowdAlt = Math.floor(now / crowdMs) % 2 === 1;

    // The game's camera background (index 1) shows through any gap.
    ctx.fillStyle = '#0b0b14';
    ctx.fillRect(0, 0, viewW, STADIUM_HEIGHT);
    for (const { layer, a, b } of this.#layers) {
      const tile = crowdAlt && b ? b : a;
      const off = layerOffset(layer, scroll) % tile.width;
      for (let x = -off; x < viewW; x += tile.width) ctx.drawImage(tile, x, layer.y);
      // Markings and lanes go on the track, under the foreground layer.
      if (layer.name === 'track') {
        this.#drawMarkings(scroll, viewW);
        this.#drawLanes(state, scroll, viewW, now, dtMs);
      }
    }
  }

  #drawMarkings(scroll: number, viewW: number): void {
    const ctx = this.#ctx;
    ctx.drawImage(this.#start, VIEW.START_X_PX - MARKING_LEFT - scroll, MARKING_TOP);
    ctx.drawImage(this.#finish, finishXPx(DISTANCE_M) - MARKING_LEFT - scroll, MARKING_TOP);
    for (const b of this.#boards) {
      const x = b.x - scroll;
      if (x > -32 && x < viewW + 8) ctx.drawImage(b.img, x, BOARD_FOOT_Y - 13);
    }
  }

  #drawLanes(state: RaceState | null, scroll: number, viewW: number, now: number, dtMs: number): void {
    for (let lane = LANE_COUNT - 1; lane >= 0; lane--) {
      const l = this.#lanes[lane];
      if (l === undefined) continue;
      const s = state?.runners[lane]?.state ?? null;
      const xM = s?.xM ?? 0;
      const x = runnerScreenX(lane, xM, scroll);
      if (x <= -32 || x >= viewW + 32 || (s !== null && !s.visible)) continue;
      const feetY = laneFeetY(lane);
      const raise = s === null ? 0 : airRaisePx(s.airM);
      // Ground shadow stays on the ground row and shrinks in the air (design 19.1).
      const si = airShadowIndex(raise);
      const [sw] = AIR_SHADOW_SIZES[si] ?? AIR_SHADOW_SIZES[0];
      const shadow = this.#shadows[si];
      if (shadow) this.#ctx.drawImage(shadow, x - (sw >> 1), feetY - 1);
      const img = this.#frame(l, lane, s, now, dtMs);
      if (img) this.#ctx.drawImage(img, x - 24, feetY + 1 - raise - 47);
    }
  }

  #frame(l: Lane, lane: number, s: RaceState['player'] | null, now: number, dtMs: number): Bitmap | null {
    let pick: RunnerPick;
    if (s === null) {
      pick = l.character === null ? { kind: 'frame', frame: 'walk1' } : { kind: 'anim', anim: 'idle' };
    } else if (l.character === null) {
      pick = pickFieldView(s, dtMs, l.vs);
    } else {
      // Rio's fumble stumble shows over the run cycle and the crouch (RaceView R2).
      const fumbling = lane === 0 && now < l.stumbleUntil && (s.anim === 'run' || s.anim === 'ready2');
      pick = fumbling ? { kind: 'anim', anim: 'stumble' } : pickRunnerView(l.character, s, dtMs, l.vs);
    }
    if (pick.kind === 'frame') {
      l.vs.played = null;
      return namedFrame(l.sheet, pick.frame);
    }
    if (l.vs.played !== pick.anim) {
      l.vs.played = pick.anim;
      l.animStart = now;
    }
    const anim = l.sheet.get(pick.anim) ?? l.sheet.get('idle') ?? l.sheet.get('walk');
    if (anim === undefined) return null;
    // One-shots (lean, stumble) hold their last frame, as Phaser plays them.
    const n = Math.floor(((now - l.animStart) * anim.fps) / 1000);
    const i = anim.loop ? n % anim.frames.length : Math.min(n, anim.frames.length - 1);
    return anim.frames[i] ?? null;
  }
}
