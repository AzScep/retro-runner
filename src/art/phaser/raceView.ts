/**
 * Everything drawn in world space for one race (design 5.6, 5.7, 3.3; v2: 13, 14.3, 19; v3: 26, 31).
 * Reads core state, never changes it. All objects are screen-fixed (scrollFactor 0) and positioned
 * from the camera scroll computed here, rounded to whole pixels; the scene camera is left untouched.
 *
 * v3 layout R: 6 lanes (state.runners, index = lane), each lane shifted right by its oblique, drawn
 * far lane first with its hurdles, then its shadow, then its runner (design 26.3). Far-side officials:
 * the starter at the start line, three judges and the photo-finish camera at the finish, and the lap
 * bell official at 300 m in the 400 m.
 */
import type Phaser from 'phaser';
import { EVENTS, hurdlePositions, ladderEntry, TUNING } from '../../core/index.ts';
import type {
  EventId,
  LaneCharacter,
  OpponentId,
  RaceEvent,
  RaceState,
  RunnerState,
} from '../../core/index.ts';
import { JUDGE_COUNT, JUDGE_SEAT_ROW, OFFICIAL_FRAME, OFFICIAL_HEAD } from '../stadium/officials.ts';
import {
  FAR_SIDE_FEET_Y,
  LANE_COUNT,
  LAYERS,
  laneOffsetPx,
  MARKING_LEFT,
  MARKING_TOP,
  rowOffsetPx,
} from '../stadium/layers.ts';
import { AIR_SHADOW_SIZES, airShadowIndex, HURDLE_FRAME } from '../stadium/props.ts';
import { cameraScroll, finishXPx, VIEW, worldX } from '../view/camera.ts';
import { hurdleVisible, laneDepth, laneFeetY, runnerScreenX, type LaneDepths } from '../view/lanes.ts';
import { airRaisePx, pickFieldView, pickRunnerView, type RunnerViewState } from '../view/runner.ts';
import { DEPTH, StadiumView } from './stadium.ts';
import { BOARD50_M, frameAnchors, KEYS, SPLIT_BOARD_M } from './textures.ts';

export interface RaceViewOptions {
  readonly reducedFlashing: boolean;
  readonly screenShake: boolean;
}

const DUST_MIN_MS = 60;
/** Sweat drops above a tired runner (design 19.2). */
const SWEAT_EVERY_MS = 500;
/** The `bell` SFX lasts 600 ms; the official rings for as long (design 19.2, 20.1). */
const BELL_RING_MS = 600;
/** The lap-bell official stands on the far side at 300 m (design 26.4). */
const BELL_M = 300;
/** Hurdles race (design 13.1) shakes 2 px for 0.15 s on a HIT. */
const HIT_SHAKE_MS = 150;
/** Trip (design 33.2): 2 px shake for 0.15 s. */
const TRIP_SHAKE_MS = 150;
/** A field runner's HIT plays the 3-frame stumble at 12 fps (design 35.1). */
const FIELD_HIT_MS = 250;
/** Distance boards stand on the apron, drawn with the far lane's offset (design 26.4). */
const BOARD_FOOT_Y = LAYERS.track.y + 1;
const FAR_OFFSET = laneOffsetPx(LANE_COUNT - 1);
/** Far-side officials: px right of their line's far end (where the far line meets it). */
const LINE_FAR_END = rowOffsetPx(MARKING_TOP);
const STARTER_DX = LINE_FAR_END + 20;
/** The starter fires for this long, then lowers the pistol. */
const FIRE_MS = 450;
/** Judges' bench starts just past the finish line; judges sit 14 px apart. */
const BENCH_DX = LINE_FAR_END + 8;
const JUDGE_SPACING = 14;
/** Judges stand for 1.0 s on a close finish or the player's trip (design 31.3). */
const JUDGE_STAND_MS = 1000;
/** Photo-finish camera pole sits on the finish line's far end. */
const CAMERA_DX = LINE_FAR_END + 2;

interface Hurdle {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly x: number;
  knocked: boolean;
}

type Who =
  | { readonly kind: 'char'; readonly id: string }
  | { readonly kind: 'field'; readonly body: string; readonly variant: string };

interface Runner {
  readonly lane: number;
  who: Who | null;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  readonly overlay: Phaser.GameObjects.Sprite;
  readonly feetY: number;
  readonly depth: LaneDepths;
  readonly vs: RunnerViewState;
  readonly hurdles: Hurdle[];
  screenX: number;
  shadowIdx: number;
  hiddenUntil: number;
  stumbleUntil: number;
  lastExhaust: number;
  lastSpark: number;
  lastSweat: number;
}

type StarterPose = 'idle' | 'armUp' | 'fire' | 'point' | 'down';

function whoOf(c: LaneCharacter): Who {
  return c.kind === 'field'
    ? { kind: 'field', body: c.field.body, variant: c.field.variant }
    : { kind: 'char', id: c.id };
}

function sameWho(a: Who | null, b: Who): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === 'char'
    ? a.id === (b as Extract<Who, { kind: 'char' }>).id
    : a.body === (b as Extract<Who, { kind: 'field' }>).body &&
        a.variant === (b as Extract<Who, { kind: 'field' }>).variant;
}

export class RaceViewImpl {
  private readonly scene: Phaser.Scene;
  private readonly opts: RaceViewOptions;
  private readonly event: EventId;
  private readonly distanceM: number;
  private readonly tier: number;
  private readonly stadium: StadiumView;
  private readonly startLine: Phaser.GameObjects.Image;
  private readonly finishLine: Phaser.GameObjects.Image;
  private readonly boards: { readonly img: Phaser.GameObjects.Image; readonly x: number }[] = [];
  private readonly lanes: Runner[] = [];
  // Far-side officials (design 31.2, 31.3, 26.4).
  private readonly starter: Phaser.GameObjects.Sprite;
  private readonly helmet: Phaser.GameObjects.Image | null;
  private readonly starterX: number;
  private starterPose: StarterPose = 'idle';
  private starterUntil = 0;
  private readonly bench: Phaser.GameObjects.Image;
  private readonly benchX: number;
  private readonly judges: {
    readonly sprite: Phaser.GameObjects.Sprite;
    readonly x: number;
    standUntil: number;
    pose: string;
  }[] = [];
  private readonly camera: Phaser.GameObjects.Sprite;
  private readonly cameraX: number;
  private readonly bell: Phaser.GameObjects.Sprite | null = null;
  private readonly bellX: number = 0;
  private bellUntil = 0;
  /** One-shot effects and the world x they belong to (null = fixed to the screen, e.g. flashbulbs). */
  private readonly fx = new Map<Phaser.GameObjects.Sprite, number | null>();
  private readonly timers: Phaser.Time.TimerEvent[] = [];
  private scroll = 0;
  private lastDust = -Infinity;
  private shakeUntil = 0;
  private coastFromM: number | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, event: EventId, opponent: OpponentId, opts: RaceViewOptions) {
    this.scene = scene;
    this.opts = opts;
    this.event = event;
    this.distanceM = EVENTS[event].distanceM;
    this.tier = ladderEntry(event, opponent)?.tier ?? 1;
    this.stadium = new StadiumView(scene, this.tier, event);
    this.startLine = this.fixed(
      scene.add.image(0, MARKING_TOP, KEYS.layer(this.tier, 'start')),
      DEPTH.markings,
    );
    this.finishLine = this.fixed(scene.add.image(0, MARKING_TOP, KEYS.finish), DEPTH.markings);
    // Boards stand on the apron with the far lane's offset (design 5.7, 14.3, 26.4).
    if (event === '400m') {
      for (const m of BOARD50_M) this.addBoard(KEYS.board50(m), BOARD_FOOT_Y - 11, worldX(m) - 8);
      for (const m of SPLIT_BOARD_M) this.addBoard(KEYS.split(m), BOARD_FOOT_Y - 15, worldX(m) - 12);
    } else {
      for (let m = 10; m < this.distanceM; m += 10)
        this.addBoard(KEYS.board(m), BOARD_FOOT_Y - 13, worldX(m) - 6);
    }

    // Officials stand with their feet on the far-side row, in front of the wall.
    const offY = FAR_SIDE_FEET_Y + 1;
    const offOriginY = (OFFICIAL_FRAME.feetRow + 1) / OFFICIAL_FRAME.h;
    this.starterX = Math.round(VIEW.START_X_PX + STARTER_DX);
    this.starter = scene.add
      .sprite(0, offY, KEYS.starter, 'idle0')
      .setOrigin(0.5, offOriginY)
      .setScrollFactor(0)
      .setDepth(DEPTH.officials)
      .play(KEYS.starterIdleAnim);
    this.helmet =
      this.tier === 7
        ? scene.add
            .image(0, offY, KEYS.starterHelmet)
            .setOrigin(0.5, offOriginY)
            .setScrollFactor(0)
            .setDepth(DEPTH.officialsFx)
        : null;
    const finishX = finishXPx(this.distanceM);
    this.benchX = Math.round(finishX + BENCH_DX);
    this.bench = this.fixed(
      scene.add.image(0, FAR_SIDE_FEET_Y - 16 + 1 + JUDGE_SEAT_ROW, KEYS.bench),
      DEPTH.officials,
    );
    for (let v = 0; v < JUDGE_COUNT; v++) {
      const sprite = scene.add
        .sprite(0, FAR_SIDE_FEET_Y + 1, KEYS.judge(v), 'sit0')
        .setOrigin(0, 1)
        .setScrollFactor(0)
        .setDepth(DEPTH.officialsFx)
        .play({ key: KEYS.judgeSitAnim(v), startFrame: v % 2 });
      this.judges.push({ sprite, x: this.benchX + 2 + v * JUDGE_SPACING, standUntil: 0, pose: 'sit' });
    }
    this.cameraX = Math.round(finishX + CAMERA_DX);
    this.camera = scene.add
      .sprite(0, FAR_SIDE_FEET_Y + 1, KEYS.photo, 'off')
      .setOrigin(0.5, 1)
      .setScrollFactor(0)
      .setDepth(DEPTH.officials);
    if (event === '400m') {
      this.bellX = Math.round(worldX(BELL_M) + FAR_OFFSET + 24);
      this.bell = scene.add
        .sprite(0, offY, KEYS.bell, 'f0')
        .setOrigin(0.5, offOriginY)
        .setScrollFactor(0)
        .setDepth(DEPTH.officials);
    }

    // Lanes far to near; textures are bound on the first update from state.runners.
    const hurdleM = hurdlePositions(event);
    for (let lane = 0; lane < LANE_COUNT; lane++) this.lanes.push(this.makeLane(lane, hurdleM));
  }

  private addBoard(key: string, y: number, x: number): void {
    this.boards.push({
      img: this.fixed(this.scene.add.image(0, y, key), DEPTH.markings),
      x: Math.round(x) + FAR_OFFSET,
    });
  }

  private fixed<T extends Phaser.GameObjects.Image | Phaser.GameObjects.Sprite>(o: T, depth: number): T {
    o.setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
    return o;
  }

  private makeLane(lane: number, hurdleM: readonly number[]): Runner {
    const s = this.scene;
    const feetY = laneFeetY(lane);
    const depth = laneDepth(lane);
    const sprite = s.add
      .sprite(0, feetY + 1, KEYS.char('rio'), 'ready0')
      .setOrigin(24 / 48, 47 / 48)
      .setScrollFactor(0)
      .setDepth(depth.runner)
      .setVisible(false);
    const shadow = s.add
      .image(0, feetY, KEYS.shadow)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth.shadow)
      .setVisible(false);
    const overlay = s.add
      .sprite(0, 0, KEYS.fx, 'gum0')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth.fx)
      .setVisible(false);
    // This lane's hurdles: behind its own runner and in front of every farther lane (design 26.3).
    const offset = laneOffsetPx(lane);
    const hurdles = hurdleM.map((m) => ({
      sprite: s.add
        .sprite(0, feetY + 1, KEYS.hurdle, 'stand')
        .setOrigin(HURDLE_FRAME.pivotX / HURDLE_FRAME.w, HURDLE_FRAME.pivotY / HURDLE_FRAME.h)
        .setScrollFactor(0)
        .setDepth(depth.hurdle)
        .setVisible(false),
      x: Math.round(worldX(m)) + offset,
      knocked: false,
    }));
    return {
      lane,
      who: null,
      sprite,
      shadow,
      overlay,
      feetY,
      depth,
      vs: { phase: lane * 1.7, played: null },
      hurdles,
      screenX: 0,
      shadowIdx: 0,
      hiddenUntil: 0,
      stumbleUntil: 0,
      lastExhaust: 0,
      lastSpark: 0,
      lastSweat: 0,
    };
  }

  /** Binds a lane to its character (texture) the first time it is seen or if it changes. */
  private bind(r: Runner, c: LaneCharacter): void {
    const who = whoOf(c);
    if (sameWho(r.who, who)) return;
    r.who = who;
    r.vs.played = null;
    r.sprite.anims.stop();
    if (who.kind === 'char') r.sprite.setTexture(KEYS.char(who.id), 'ready0');
    else r.sprite.setTexture(KEYS.fieldChar(who.body, who.variant), 'ready0');
  }

  update(state: RaceState, events: readonly RaceEvent[]): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    const dtMs = Math.min(100, Math.max(0, this.scene.game.loop.delta));
    for (const lr of state.runners) {
      const r = this.lanes[lr.lane];
      if (r) this.bind(r, lr.who);
    }

    for (const e of events) this.onEvent(e, state, now);

    // Camera rule (design 5.7) over this event's world length, plus an integer screen shake.
    let shake = 0;
    if (now < this.shakeUntil) shake = Math.floor(now / 33) % 2 === 0 ? 1 : -1;
    this.scroll = cameraScroll(worldX(state.player.xM), this.distanceM) + shake;
    this.stadium.scrollTo(this.scroll);
    // Crowd rises over the last 20 m (100 m, hurdles) or the last 100 m (400 m) (design 13.4, 14.3).
    const zone = this.event === '400m' ? 100 : 20;
    const near = (s: RunnerState, m: number) => s.xM >= this.distanceM - m && s.xM < this.distanceM;
    this.stadium.setExcited(state.runners.some((lr) => near(lr.state, zone)));

    for (const [sp, wx] of this.fx) if (wx !== null) sp.x = wx - this.scroll;
    this.startLine.x = VIEW.START_X_PX - MARKING_LEFT - this.scroll;
    this.finishLine.x = finishXPx(this.distanceM) - MARKING_LEFT - this.scroll;
    for (const b of this.boards) {
      const x = b.x - this.scroll;
      b.img.setVisible(x > -32 && x < VIEW.WIDTH + 8).setX(x);
    }
    this.drawOfficials(state, now);

    for (let lane = LANE_COUNT - 1; lane >= 0; lane--) {
      const r = this.lanes[lane] as Runner;
      const lr = state.runners[lane];
      if (!lr) {
        r.sprite.setVisible(false);
        r.shadow.setVisible(false);
        for (const h of r.hurdles) h.sprite.setVisible(false);
        continue;
      }
      this.drawHurdles(r, lr.state);
      this.drawRunner(r, lr.state, dtMs, now);
    }
  }

  private onEvent(e: RaceEvent, state: RaceState, now: number): void {
    const player = this.lanes[0] as Runner;
    switch (e.type) {
      case 'step':
        // Steps in the air give no impulse and no dust (design 13.2).
        if (e.airborne !== true && state.player.airM <= 0 && now - this.lastDust >= DUST_MIN_MS) {
          this.lastDust = now;
          // Back foot: a little behind the pivot.
          this.spawnFx('dust', player.screenX - 10, player.feetY + 1, DEPTH.dust);
        }
        break;
      case 'jump':
      case 'land': {
        const r = this.lanes[e.lane];
        if (r) this.spawnFx('dust', r.screenX + (e.type === 'jump' ? -8 : 2), r.feetY + 1, r.depth.fx);
        break;
      }
      case 'hurdleClip':
      case 'hurdleHit': {
        const r = this.lanes[e.lane];
        if (!r) break;
        const h = r.hurdles[e.index];
        if (h && !h.knocked) {
          h.knocked = true;
          h.sprite.play(KEYS.hurdleKnockAnim);
          // Burst at the bar: bar top is 24 px above the feet row; the effect's bottom sits 7 px lower.
          if (hurdleVisible(h.x - this.scroll)) this.spawnFx('clip', h.x, r.feetY - 24 + 7, r.depth.fx);
        }
        if (e.type === 'hurdleHit' && e.lane === 0) this.shake(HIT_SHAKE_MS);
        // Field runners show their HIT with the stumble frames (design 35.1).
        if (e.type === 'hurdleHit' && r.who?.kind === 'field') r.stumbleUntil = now + FIELD_HIT_MS;
        break;
      }
      case 'beat':
        if (e.beat === 3) this.setStarter('idle', 0);
        else if (e.beat === 1) this.setStarter('armUp', 0);
        else if (e.beat === 'go') this.fireStarter(now);
        break;
      case 'falseStart':
        // First false start: arm down, pointing at the player; second: arm down (design 31.2).
        this.setStarter(e.count <= 1 ? 'point' : 'down', 0);
        break;
      case 'disqualified':
        this.setStarter('down', 0);
        break;
      case 'closeFinish':
        // The middle judge stands for the photo finish.
        this.standJudge(1, now);
        break;
      case 'trip':
        // The judge nearest the player stands; Rio falls (state.player.anim drives the frames).
        this.standJudge(0, now);
        this.shake(TRIP_SHAKE_MS);
        this.spawnFx('dust', player.screenX + 6, player.feetY + 1, player.depth.fx);
        break;
      case 'bell':
        if (this.bell) {
          this.bell.play(KEYS.bellAnim);
          this.bellUntil = now + BELL_RING_MS;
        }
        break;
      case 'playerFinish':
        this.shake(200);
        break;
      case 'quirk':
        this.onQuirk(e.name, state, now);
        break;
      default:
        break;
    }
  }

  private onQuirk(name: Extract<RaceEvent, { type: 'quirk' }>['name'], state: RaceState, now: number): void {
    const r = this.lanes[1] as Runner;
    const lane1 = laneOffsetPx(1);
    switch (name) {
      case 'trip':
        this.spawnFx('dust', r.screenX + 4, r.feetY + 1, r.depth.fx);
        break;
      case 'fade':
        this.sweat(r, now);
        break;
      case 'coast':
        this.coastFromM = state.rival.xM;
        break;
      case 'warpOut': {
        this.spawnSprite(
          KEYS.char('zyx'),
          KEYS.anim('zyx', 'warpOut'),
          r.screenX,
          r.feetY + 1,
          r.depth.runner,
        );
        this.spawnFx('warpRing', r.screenX, r.feetY - 14, r.depth.fx);
        break;
      }
      case 'warpIn': {
        const x = Math.round(worldX(state.rival.xM)) + lane1 - this.scroll;
        this.spawnSprite(KEYS.char('zyx'), KEYS.anim('zyx', 'warpIn'), x, r.feetY + 1, r.depth.runner);
        this.spawnFx('warpRing', x, r.feetY - 14, r.depth.fx);
        r.hiddenUntil = now + 300;
        this.shake(120);
        break;
      }
      case 'flashbulb':
        this.flashbulbs();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Officials
  // ---------------------------------------------------------------------------

  private setStarter(pose: StarterPose, until: number): void {
    this.starterPose = pose;
    this.starterUntil = until;
    if (pose === 'idle') {
      if (this.starter.anims.currentAnim?.key !== KEYS.starterIdleAnim || !this.starter.anims.isPlaying)
        this.starter.play(KEYS.starterIdleAnim);
      return;
    }
    this.starter.anims.stop();
    this.starter.setFrame(pose === 'down' ? 'idle0' : pose);
  }

  private fireStarter(now: number): void {
    this.setStarter('fire', now + FIRE_MS);
    // Smoke from the muzzle (frame px (10, 1)) of the raised pistol.
    const x = this.starterX - OFFICIAL_FRAME.w / 2 + 10;
    const y = FAR_SIDE_FEET_Y - OFFICIAL_FRAME.feetRow + 3;
    this.spawnSprite(KEYS.smoke, KEYS.smokeAnim, x - this.scroll, y, DEPTH.officialsFx, 8 / 16);
  }

  private standJudge(i: number, now: number): void {
    const j = this.judges[i];
    if (j) j.standUntil = now + JUDGE_STAND_MS;
  }

  private drawOfficials(state: RaceState, now: number): void {
    // Starter: the fire frame holds briefly, then the arm comes down (design 31.2).
    if (this.starterPose === 'fire' && now >= this.starterUntil) this.setStarter('down', 0);
    if (state.phase === 'intro' && this.starterPose !== 'idle') this.setStarter('idle', 0);
    const sx = this.starterX - this.scroll;
    const sVis = sx > -24 && sx < VIEW.WIDTH + 24;
    this.starter.setVisible(sVis).setX(sx);
    this.helmet?.setVisible(sVis).setX(sx);

    // Judges lean while any runner is within JUDGE_LEAN_M of the line; one stands on events.
    const leanM = TUNING.JUDGE_LEAN_M;
    const closing = state.runners.some((lr) => {
      const d = this.distanceM - lr.state.xM;
      return d > 0 && d <= leanM;
    });
    const bx = this.benchX - this.scroll;
    const jVis = bx > -60 && bx < VIEW.WIDTH + 8;
    this.bench.setVisible(jVis).setX(bx);
    this.judges.forEach((j, v) => {
      const pose = now < j.standUntil ? 'stand' : closing ? 'lean' : 'sit';
      if (pose !== j.pose) {
        j.pose = pose;
        if (pose === 'sit') j.sprite.play({ key: KEYS.judgeSitAnim(v), startFrame: v % 2 });
        else {
          j.sprite.anims.stop();
          j.sprite.setFrame(pose);
        }
      }
      j.sprite.setVisible(jVis).setX(j.x - this.scroll);
    });

    // Photo-finish light: steady on while anyone is within 10 m of the line; never a flash.
    const cx = this.cameraX - this.scroll;
    this.camera.setVisible(cx > -8 && cx < VIEW.WIDTH + 8).setX(cx);
    const on = closing ? 'on' : 'off';
    if (this.camera.frame.name !== on) this.camera.setFrame(on);

    if (this.bell) {
      const x = this.bellX - this.scroll;
      this.bell.setVisible(x > -24 && x < VIEW.WIDTH + 24).setX(x);
      if (this.bellUntil && now >= this.bellUntil) {
        this.bellUntil = 0;
        this.bell.stop();
        this.bell.setFrame('f0');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lanes
  // ---------------------------------------------------------------------------

  /** Position this lane's hurdles; knocked state from the runner catches any missed event. */
  private drawHurdles(r: Runner, s: RunnerState): void {
    r.hurdles.forEach((h, i) => {
      if (s.hurdlesKnocked[i] === true && !h.knocked) {
        h.knocked = true;
        h.sprite.setFrame('knock3');
      }
      const x = h.x - this.scroll;
      const vis = hurdleVisible(x);
      if (vis) h.sprite.setX(x);
      if (h.sprite.visible !== vis) h.sprite.setVisible(vis);
    });
  }

  private drawRunner(r: Runner, s: RunnerState, dtMs: number, now: number): void {
    const who = r.who;
    if (!who) return;
    const x = runnerScreenX(r.lane, s.xM, this.scroll);
    r.screenX = x;
    const raise = airRaisePx(s.airM);
    const onScreen = x > -32 && x < VIEW.WIDTH + 32;
    const visible = s.visible && now >= r.hiddenUntil && onScreen;
    r.sprite.setVisible(visible).setPosition(x, r.feetY + 1 - raise);

    // Ground shadow stays on the ground row and shrinks in the air (design 19.1).
    const si = airShadowIndex(raise);
    if (si !== r.shadowIdx) {
      r.shadowIdx = si;
      r.shadow.setTexture(KEYS.airShadow(si));
    }
    const [sw] = AIR_SHADOW_SIZES[si] ?? AIR_SHADOW_SIZES[0];
    r.shadow.setVisible(visible).setPosition(x - (sw >> 1), r.feetY - 1);
    if (!onScreen) return;

    if (who.kind === 'field') {
      const pick =
        now < r.stumbleUntil && (s.anim === 'run' || s.anim === 'hurdle')
          ? ({ kind: 'anim', anim: 'stumble' } as const)
          : pickFieldView(s, dtMs, r.vs);
      this.apply(r, pick, (name) => KEYS.fieldAnim(who.body, who.variant, name));
      return;
    }

    const id = who.id as Parameters<typeof pickRunnerView>[0];
    const rival = r.lane === 1;
    if (this.coastFromM !== null && rival && s.xM > this.coastFromM + 20) this.coastFromM = null;
    const pick = pickRunnerView(id, s, dtMs, r.vs, { coasting: rival && this.coastFromM !== null });
    this.apply(r, pick, (name) => KEYS.anim(id, name));
    this.overlays(r, id, s, visible, x, raise, now);
  }

  private apply(r: Runner, pick: ReturnType<typeof pickFieldView>, animKey: (name: string) => string): void {
    if (pick.kind === 'frame') {
      if (r.sprite.anims.isPlaying) r.sprite.anims.stop();
      if (r.sprite.frame.name !== pick.frame) r.sprite.setFrame(pick.frame);
      r.vs.played = null;
    } else if (r.vs.played !== pick.anim) {
      r.sprite.play(animKey(pick.anim));
      r.vs.played = pick.anim;
    }
  }

  /** Character overlays of the player and the named rival (design 3.3, 5.6, 19.2). */
  private overlays(
    r: Runner,
    id: string,
    s: RunnerState,
    visible: boolean,
    x: number,
    raise: number,
    now: number,
  ): void {
    const frameName = r.sprite.frame.name;
    const a = frameAnchors(id, String(frameName));
    const ox = x - 24;
    const oy = r.feetY + 1 - raise - 47;

    // Jess blows a gum bubble on celebrate (design 5.6 extra).
    const gum = id === 'jess' && s.anim === 'celebrate' && visible && a !== undefined;
    if (gum) {
      if (!r.overlay.visible) r.overlay.setVisible(true).play(KEYS.fxAnim('gum'));
      r.overlay.setPosition(ox + a.mouth[0] - 1, oy + a.mouth[1] - 8);
    } else if (r.overlay.visible) {
      r.overlay.stop().setVisible(false);
    }

    // UNIT-7 exhaust while running, sparks while overheating.
    if (id === 'unit7' && visible && a && s.anim === 'run') {
      if (s.vMps > 1 && now - r.lastExhaust > 220) {
        r.lastExhaust = now;
        this.spawnFx('exhaust', ox + a.back[0] - 8, oy + a.back[1] + 8, r.depth.runner - 1);
      }
      if (s.effect === 'overheat' && now - r.lastSpark > 140) {
        r.lastSpark = now;
        this.spawnFx('spark', ox + a.back[0], oy + a.back[1] + 6, r.depth.fx);
      }
    }
    // Sweat: Rio below S_FATIGUE, a rival with the sweat effect (Pip's 400 m gas-out), and anyone
    // slumped after a loss (design 19.2).
    const tired =
      (s.stamina !== null && s.stamina < TUNING.S_FATIGUE && s.finishMs === null) || s.effect === 'sweat';
    if (visible && tired && now - r.lastSweat >= SWEAT_EVERY_MS) this.sweat(r, now);
    else if (s.anim === 'lose' && visible && now - r.lastSweat > 1200) this.sweat(r, now);
  }

  private sweat(r: Runner, now: number): void {
    r.lastSweat = now;
    const id = r.who?.kind === 'char' ? r.who.id : '';
    const a = frameAnchors(id, String(r.sprite.frame.name));
    const x = r.screenX - 24 + (a ? a.headTop[0] - 4 : 24);
    const y = r.sprite.y - 47 + (a ? a.headTop[1] + 14 : 10);
    this.spawnFx('sweat', x, y, r.depth.fx);
  }

  private flashbulbs(): void {
    if (this.opts.reducedFlashing) return;
    // A few single pops spread over the stands; each bulb flashes once (well under 3 Hz).
    const st = LAYERS.stands;
    for (let i = 0; i < 4; i++) {
      const t = this.scene.time.delayedCall(i * 140, () => {
        const x = 20 + Math.floor(Math.random() * 280);
        const y = st.y + 4 + Math.floor(Math.random() * (st.h - 16)) + 16;
        this.spawnFx('flash', x, y, DEPTH.flash, false);
      });
      this.timers.push(t);
    }
  }

  private shake(ms: number): void {
    if (!this.opts.screenShake || this.opts.reducedFlashing) return;
    this.shakeUntil = Math.max(this.shakeUntil, this.scene.time.now + ms);
  }

  /** One-shot 16x16 effect, positioned by its bottom-centre. */
  private spawnFx(name: string, x: number, bottomY: number, depth: number, world = true): void {
    this.spawnSprite(KEYS.fx, KEYS.fxAnim(name), x, bottomY, depth, 8 / 16, world);
  }

  private spawnSprite(
    texture: string,
    anim: string,
    x: number,
    bottomY: number,
    depth: number,
    originX = 24 / 48,
    world = true,
  ): void {
    const sp = this.scene.add
      .sprite(Math.round(x), Math.round(bottomY), texture)
      .setOrigin(originX, 1)
      .setScrollFactor(0)
      .setDepth(depth);
    sp.play(anim);
    sp.once('animationcomplete', () => {
      this.fx.delete(sp);
      sp.destroy();
    });
    this.fx.set(sp, world ? Math.round(x) + this.scroll : null);
  }

  rivalScreenX(): number {
    return (this.lanes[1] as Runner).screenX;
  }

  runnerScreenPos(lane: number): { x: number; y: number } {
    const r = this.lanes[lane];
    if (!r) return { x: 0, y: 0 };
    return { x: r.screenX, y: r.feetY };
  }

  /** Where a speech bubble's tail points: 2 px above the starter's head, centred on it. */
  starterScreenPos(): { x: number; y: number } {
    const headTopY = FAR_SIDE_FEET_Y - OFFICIAL_FRAME.feetRow + OFFICIAL_HEAD.top;
    const headX = this.starterX - OFFICIAL_FRAME.w / 2 + OFFICIAL_HEAD.x;
    return { x: headX - this.scroll, y: headTopY - 2 - (this.helmet ? 2 : 0) };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const t of this.timers) t.remove(false);
    for (const f of this.fx.keys()) f.destroy();
    this.fx.clear();
    this.stadium.destroy();
    this.startLine.destroy();
    this.finishLine.destroy();
    this.starter.destroy();
    this.helmet?.destroy();
    this.bench.destroy();
    for (const j of this.judges) j.sprite.destroy();
    this.camera.destroy();
    this.bell?.destroy();
    for (const b of this.boards) b.img.destroy();
    for (const r of this.lanes) {
      r.sprite.destroy();
      r.shadow.destroy();
      r.overlay.destroy();
      for (const h of r.hurdles) h.sprite.destroy();
    }
  }
}
