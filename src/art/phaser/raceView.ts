/**
 * Everything drawn in world space for one race (design 5.6, 5.7, 3.3; v2: 13, 14.3, 19). Reads core
 * state, never changes it. All objects are screen-fixed (scrollFactor 0) and positioned from the
 * camera scroll computed here, rounded to whole pixels; the scene camera is left untouched.
 */
import type Phaser from 'phaser';
import { EVENTS, hurdlePositions, ladderEntry, TUNING } from '../../core/index.ts';
import type {
  CharacterId,
  EventId,
  Lane,
  OpponentId,
  RaceEvent,
  RaceState,
  RunnerState,
} from '../../core/index.ts';
import { LANE_FEET_Y, LANE_LINE_Y, LAYERS } from '../stadium/layers.ts';
import {
  AIR_SHADOW_SIZES,
  airShadowIndex,
  FAR_LANE_HURDLE_OFFSET_PX,
  HURDLE_FRAME,
} from '../stadium/props.ts';
import { cameraScroll, finishXPx, layerScroll, VIEW, worldX } from '../view/camera.ts';
import { airRaisePx, blocksOffsetPx, pickRunnerView, type RunnerViewState } from '../view/runner.ts';
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
/** The lap-bell official stands at 300 m in L5 and sits at this screen x as the player passes it. */
const BELL_M = 300;
const BELL_SCREEN_X = 150;
const BELL_TOP_Y = 155;
/** Hurdles race (design 13.1) shakes 2 px for 0.15 s on a HIT. */
const HIT_SHAKE_MS = 150;

interface Hurdle {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly x: number;
  knocked: boolean;
}

interface Runner {
  readonly id: CharacterId;
  readonly lane: Lane;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  readonly overlay: Phaser.GameObjects.Sprite;
  readonly feetY: number;
  readonly depth: number;
  readonly vs: RunnerViewState;
  readonly hurdles: Hurdle[];
  screenX: number;
  shadowIdx: number;
  hiddenUntil: number;
  lastExhaust: number;
  lastSpark: number;
  lastSweat: number;
}

export class RaceViewImpl {
  private readonly scene: Phaser.Scene;
  private readonly opts: RaceViewOptions;
  private readonly event: EventId;
  private readonly distanceM: number;
  private readonly stadium: StadiumView;
  private readonly startLine: Phaser.GameObjects.Image;
  private readonly finishLine: Phaser.GameObjects.Image;
  private readonly boards: { readonly img: Phaser.GameObjects.Image; readonly x: number }[] = [];
  private readonly bell: Phaser.GameObjects.Sprite | null = null;
  private readonly bellX: number = 0;
  private bellUntil = 0;
  private readonly player: Runner;
  private readonly rival: Runner;
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
    const tier = ladderEntry(event, opponent)?.tier ?? 1;
    this.stadium = new StadiumView(scene, tier, event);
    const top = LANE_LINE_Y[0];
    this.startLine = this.fixed(scene.add.image(0, top, KEYS.layer(tier, 'start')), DEPTH.markings);
    this.finishLine = this.fixed(scene.add.image(0, top, KEYS.finish), DEPTH.markings);
    // Boards stand on the apron, bottom on the track's top row (design 5.7, 14.3).
    const apron = LAYERS.track.y;
    if (event === '400m') {
      for (const m of BOARD50_M) this.addBoard(KEYS.board50(m), apron - 12, worldX(m) - 8);
      for (const m of SPLIT_BOARD_M) this.addBoard(KEYS.split(m), apron - 16, worldX(m) - 12);
    } else {
      for (let m = 10; m < this.distanceM; m += 10) this.addBoard(KEYS.board(m), apron - 12, worldX(m) - 6);
    }
    this.rival = this.makeRunner(opponent, 'rival', LANE_FEET_Y.rival, DEPTH.rival, DEPTH.rivalHurdle);
    this.player = this.makeRunner('rio', 'player', LANE_FEET_Y.player, DEPTH.player, DEPTH.playerHurdle);
    if (event === '400m') {
      // L5 parallax (1.3): at screen x BELL_SCREEN_X exactly when the player passes 300 m.
      const s300 = Math.round(worldX(BELL_M)) - VIEW.PLAYER_SCREEN_X;
      this.bellX = BELL_SCREEN_X + layerScroll(s300, LAYERS.fg.factor);
      this.bell = scene.add
        .sprite(0, BELL_TOP_Y, KEYS.bell, 'f0')
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH.fg);
    }
  }

  private addBoard(key: string, y: number, x: number): void {
    this.boards.push({ img: this.fixed(this.scene.add.image(0, y, key), DEPTH.markings), x: Math.round(x) });
  }

  private fixed<T extends Phaser.GameObjects.Image | Phaser.GameObjects.Sprite>(o: T, depth: number): T {
    o.setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
    return o;
  }

  private makeRunner(id: CharacterId, lane: Lane, feetY: number, depth: number, hurdleDepth: number): Runner {
    const s = this.scene;
    const sprite = s.add
      .sprite(0, feetY + 1, KEYS.char(id), 'ready0')
      .setOrigin(24 / 48, 47 / 48)
      .setScrollFactor(0)
      .setDepth(depth);
    const shadow = s.add
      .image(0, feetY, KEYS.shadow)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.shadow);
    const overlay = s.add
      .sprite(0, 0, KEYS.fx, 'gum0')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(depth + 1)
      .setVisible(false);
    // Hurdles of this lane: drawn behind runners of the same or a nearer lane (design 19.2), so the
    // player's hurdles sit between the rival (20) and the player (30). Far-lane hurdles are drawn with
    // a fixed perspective offset (visual only) so the two lanes never stack into one tall gate.
    const offset = lane === 'rival' ? FAR_LANE_HURDLE_OFFSET_PX : 0;
    const hurdles = hurdlePositions(this.event).map((m) => ({
      sprite: s.add
        .sprite(0, feetY + 1, KEYS.hurdle, 'stand')
        .setOrigin(HURDLE_FRAME.pivotX / HURDLE_FRAME.w, HURDLE_FRAME.pivotY / HURDLE_FRAME.h)
        .setScrollFactor(0)
        .setDepth(hurdleDepth),
      x: Math.round(worldX(m)) + offset,
      knocked: false,
    }));
    return {
      id,
      lane,
      sprite,
      shadow,
      overlay,
      feetY,
      depth,
      vs: { phase: 0, played: null },
      hurdles,
      screenX: 0,
      shadowIdx: 0,
      hiddenUntil: 0,
      lastExhaust: 0,
      lastSpark: 0,
      lastSweat: 0,
    };
  }

  update(state: RaceState, events: readonly RaceEvent[]): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    const dtMs = Math.min(100, Math.max(0, this.scene.game.loop.delta));

    for (const e of events) this.onEvent(e, state, now);

    // Camera rule (design 5.7) over this event's world length, plus an integer screen shake.
    let shake = 0;
    if (now < this.shakeUntil) shake = Math.floor(now / 33) % 2 === 0 ? 1 : -1;
    this.scroll = cameraScroll(worldX(state.player.xM), this.distanceM) + shake;
    this.stadium.scrollTo(this.scroll);
    // Crowd rises over the last 20 m (100 m, hurdles) or the last 100 m (400 m) (design 13.4, 14.3).
    const zone = this.event === '400m' ? 100 : 20;
    const near = (r: RunnerState) => r.xM >= this.distanceM - zone && r.xM < this.distanceM;
    this.stadium.setExcited(near(state.player) || near(state.rival));

    for (const [sp, wx] of this.fx) if (wx !== null) sp.x = wx - this.scroll;
    this.startLine.x = VIEW.START_X_PX - this.scroll;
    this.finishLine.x = finishXPx(this.distanceM) - this.scroll;
    for (const b of this.boards) {
      const x = b.x - this.scroll;
      b.img.setVisible(x > -32 && x < VIEW.WIDTH + 8).setX(x);
    }
    if (this.bell) {
      const x = this.bellX - layerScroll(this.scroll, LAYERS.fg.factor);
      this.bell.setVisible(x > -40 && x < VIEW.WIDTH + 8).setX(x);
      if (this.bellUntil && now >= this.bellUntil) {
        this.bellUntil = 0;
        this.bell.stop();
        this.bell.setFrame('f0');
      }
    }

    this.drawHurdles(this.rival, state.rival);
    this.drawHurdles(this.player, state.player);
    this.drawRunner(this.rival, state.rival, dtMs, now);
    this.drawRunner(this.player, state.player, dtMs, now);
  }

  private runnerOf(lane: Lane): Runner {
    return lane === 'player' ? this.player : this.rival;
  }

  private onEvent(e: RaceEvent, state: RaceState, now: number): void {
    switch (e.type) {
      case 'step':
        // Steps in the air give no impulse and no dust (design 13.2).
        if (e.airborne !== true && state.player.airM <= 0 && now - this.lastDust >= DUST_MIN_MS) {
          this.lastDust = now;
          // Back foot: a little behind the pivot.
          this.spawnFx('dust', this.player.screenX - 10, this.player.feetY + 1, DEPTH.dust);
        }
        break;
      case 'jump':
      case 'land': {
        const r = this.runnerOf(e.lane);
        this.spawnFx('dust', r.screenX + (e.type === 'jump' ? -8 : 2), r.feetY + 1, r.depth + 1);
        break;
      }
      case 'hurdleClip':
      case 'hurdleHit': {
        const r = this.runnerOf(e.lane);
        const h = r.hurdles[e.index];
        if (h && !h.knocked) {
          h.knocked = true;
          h.sprite.play(KEYS.hurdleKnockAnim);
          // Burst at the bar: bar top is 24 px above the feet row; the effect's bottom sits 7 px lower.
          this.spawnFx('clip', h.x, r.feetY - 24 + 7, r.depth + 1);
        }
        if (e.type === 'hurdleHit' && e.lane === 'player') this.shake(HIT_SHAKE_MS);
        break;
      }
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
    const r = this.rival;
    switch (name) {
      case 'trip':
        this.spawnFx('dust', r.screenX + 4, r.feetY + 1, r.depth + 1);
        break;
      case 'fade':
        this.sweat(r, now);
        break;
      case 'coast':
        this.coastFromM = state.rival.xM;
        break;
      case 'warpOut': {
        this.spawnSprite(KEYS.char('zyx'), KEYS.anim('zyx', 'warpOut'), r.screenX, r.feetY + 1, r.depth);
        this.spawnFx('warpRing', r.screenX, r.feetY - 14, r.depth + 1);
        break;
      }
      case 'warpIn': {
        const x = Math.round(worldX(state.rival.xM)) - this.scroll;
        this.spawnSprite(KEYS.char('zyx'), KEYS.anim('zyx', 'warpIn'), x, r.feetY + 1, r.depth);
        this.spawnFx('warpRing', x, r.feetY - 14, r.depth + 1);
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

  /** Position this lane's hurdles; knocked state from the runner catches any missed event. */
  private drawHurdles(r: Runner, s: RunnerState): void {
    r.hurdles.forEach((h, i) => {
      if (s.hurdlesKnocked[i] === true && !h.knocked) {
        h.knocked = true;
        h.sprite.setFrame('knock3');
      }
      const x = h.x - this.scroll;
      h.sprite.setVisible(x > -40 && x < VIEW.WIDTH + 40).setX(x);
    });
  }

  private drawRunner(r: Runner, s: RunnerState, dtMs: number, now: number): void {
    const x = Math.round(worldX(s.xM)) + blocksOffsetPx(s.xM) - this.scroll;
    r.screenX = x;
    const raise = airRaisePx(s.airM);
    const visible = s.visible && now >= r.hiddenUntil;
    r.sprite.setVisible(visible).setPosition(x, r.feetY + 1 - raise);

    // Ground shadow stays on the ground row and shrinks in the air (design 19.1).
    const si = airShadowIndex(raise);
    if (si !== r.shadowIdx) {
      r.shadowIdx = si;
      r.shadow.setTexture(KEYS.airShadow(si));
    }
    const [sw] = AIR_SHADOW_SIZES[si] ?? AIR_SHADOW_SIZES[0];
    r.shadow.setVisible(visible).setPosition(x - (sw >> 1), r.feetY - 1);

    if (this.coastFromM !== null && r === this.rival && s.xM > this.coastFromM + 20) this.coastFromM = null;
    const pick = pickRunnerView(r.id, s, dtMs, r.vs, {
      coasting: r === this.rival && this.coastFromM !== null,
    });
    if (pick.kind === 'frame') {
      if (r.sprite.anims.isPlaying) r.sprite.anims.stop();
      r.sprite.setFrame(pick.frame);
      r.vs.played = null;
    } else if (r.vs.played !== pick.anim) {
      r.sprite.play(KEYS.anim(r.id, pick.anim));
      r.vs.played = pick.anim;
    }

    const frameName = r.sprite.frame.name;
    const a = frameAnchors(r.id, String(frameName));
    const ox = x - 24;
    const oy = r.feetY + 1 - raise - 47;

    // Jess blows a gum bubble on celebrate (design 5.6 extra).
    const gum = r.id === 'jess' && s.anim === 'celebrate' && visible && a !== undefined;
    if (gum) {
      if (!r.overlay.visible) r.overlay.setVisible(true).play(KEYS.fxAnim('gum'));
      r.overlay.setPosition(ox + a.mouth[0] - 1, oy + a.mouth[1] - 8);
    } else if (r.overlay.visible) {
      r.overlay.stop().setVisible(false);
    }

    // UNIT-7 exhaust while running, sparks while overheating.
    if (r.id === 'unit7' && visible && a && s.anim === 'run') {
      if (s.vMps > 1 && now - r.lastExhaust > 220) {
        r.lastExhaust = now;
        this.spawnFx('exhaust', ox + a.back[0] - 8, oy + a.back[1] + 8, r.depth - 1);
      }
      if (s.effect === 'overheat' && now - r.lastSpark > 140) {
        r.lastSpark = now;
        this.spawnFx('spark', ox + a.back[0], oy + a.back[1] + 6, r.depth + 1);
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
    const a = frameAnchors(r.id, String(r.sprite.frame.name));
    const x = r.screenX - 24 + (a ? a.headTop[0] - 4 : 24);
    const y = r.sprite.y - 47 + (a ? a.headTop[1] + 14 : 10);
    this.spawnFx('sweat', x, y, r.depth + 1);
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
    return this.rival.screenX;
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
    this.bell?.destroy();
    for (const b of this.boards) b.img.destroy();
    for (const r of [this.player, this.rival]) {
      r.sprite.destroy();
      r.shadow.destroy();
      r.overlay.destroy();
      for (const h of r.hurdles) h.sprite.destroy();
    }
  }
}
