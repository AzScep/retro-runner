/**
 * Everything drawn in world space for one race (design 5.6, 5.7, 3.3). Reads core state, never
 * changes it. All objects are screen-fixed (scrollFactor 0) and positioned from the camera scroll
 * computed here, rounded to whole pixels; the scene camera is left untouched.
 */
import type Phaser from 'phaser';
import { OPPONENTS } from '../../core/index.ts';
import type { CharacterId, OpponentId, RaceEvent, RaceState, RunnerState } from '../../core/index.ts';
import { LANE_FEET_Y, LANE_LINE_Y, LAYERS } from '../stadium/layers.ts';
import { cameraScroll, FINISH_X_PX, VIEW, worldX } from '../view/camera.ts';
import { blocksOffsetPx, pickRunnerView, type RunnerViewState } from '../view/runner.ts';
import { DEPTH, StadiumView } from './stadium.ts';
import { frameAnchors, KEYS } from './textures.ts';

export interface RaceViewOptions {
  readonly reducedFlashing: boolean;
  readonly screenShake: boolean;
}

const DUST_MIN_MS = 60;

interface Runner {
  readonly id: CharacterId;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  readonly overlay: Phaser.GameObjects.Sprite;
  readonly feetY: number;
  readonly depth: number;
  readonly vs: RunnerViewState;
  screenX: number;
  hiddenUntil: number;
  lastExhaust: number;
  lastSpark: number;
  lastSweat: number;
}

export class RaceViewImpl {
  private readonly scene: Phaser.Scene;
  private readonly opts: RaceViewOptions;
  private readonly stadium: StadiumView;
  private readonly startLine: Phaser.GameObjects.Image;
  private readonly finishLine: Phaser.GameObjects.Image;
  private readonly boards: { readonly img: Phaser.GameObjects.Image; readonly x: number }[] = [];
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

  constructor(scene: Phaser.Scene, opponent: OpponentId, opts: RaceViewOptions) {
    this.scene = scene;
    this.opts = opts;
    const tier = OPPONENTS[opponent].tier;
    this.stadium = new StadiumView(scene, tier);
    const top = LANE_LINE_Y[0];
    this.startLine = this.fixed(scene.add.image(0, top, KEYS.layer(tier, 'start')), DEPTH.markings);
    this.finishLine = this.fixed(scene.add.image(0, top, KEYS.finish), DEPTH.markings);
    for (let m = 10; m < 100; m += 10) {
      // Board post stands on the apron, just above the first lane line.
      this.boards.push({
        img: this.fixed(scene.add.image(0, LAYERS.track.y - 12, KEYS.board(m)), DEPTH.markings),
        x: worldX(m) - 6,
      });
    }
    this.rival = this.makeRunner(opponent, LANE_FEET_Y.rival, DEPTH.rival);
    this.player = this.makeRunner('rio', LANE_FEET_Y.player, DEPTH.player);
  }

  private fixed<T extends Phaser.GameObjects.Image | Phaser.GameObjects.Sprite>(o: T, depth: number): T {
    o.setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
    return o;
  }

  private makeRunner(id: CharacterId, feetY: number, depth: number): Runner {
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
    return {
      id,
      sprite,
      shadow,
      overlay,
      feetY,
      depth,
      vs: { phase: 0, played: null },
      screenX: 0,
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

    // Camera rule (design 5.7) plus an integer screen shake.
    let shake = 0;
    if (now < this.shakeUntil) shake = Math.floor(now / 33) % 2 === 0 ? 1 : -1;
    this.scroll = cameraScroll(worldX(state.player.xM)) + shake;
    this.stadium.scrollTo(this.scroll);
    const near = (r: RunnerState) => r.xM >= 90 && r.xM < 100;
    this.stadium.setExcited(near(state.player) || near(state.rival));

    for (const [sp, wx] of this.fx) if (wx !== null) sp.x = wx - this.scroll;
    this.startLine.x = VIEW.START_X_PX - this.scroll;
    this.finishLine.x = FINISH_X_PX - this.scroll;
    for (const b of this.boards) b.img.x = Math.round(b.x) - this.scroll;

    this.drawRunner(this.rival, state.rival, dtMs, now);
    this.drawRunner(this.player, state.player, dtMs, now);
  }

  private onEvent(e: RaceEvent, state: RaceState, now: number): void {
    switch (e.type) {
      case 'step':
        if (now - this.lastDust >= DUST_MIN_MS) {
          this.lastDust = now;
          // Back foot: a little behind the pivot.
          this.spawnFx('dust', this.player.screenX - 10, this.player.feetY + 1, DEPTH.dust);
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

  private drawRunner(r: Runner, s: RunnerState, dtMs: number, now: number): void {
    const x = Math.round(worldX(s.xM)) + blocksOffsetPx(s.xM) - this.scroll;
    r.screenX = x;
    const visible = s.visible && now >= r.hiddenUntil;
    r.sprite.setVisible(visible).setPosition(x, r.feetY + 1);
    r.shadow.setVisible(visible).setPosition(x - 10, r.feetY - 1);

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
    const oy = r.feetY + 1 - 47;

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
    // Sweat drops while slumped after a loss.
    if (s.anim === 'lose' && visible && now - r.lastSweat > 1200) this.sweat(r, now);
  }

  private sweat(r: Runner, now: number): void {
    r.lastSweat = now;
    const a = frameAnchors(r.id, String(r.sprite.frame.name));
    const x = r.screenX - 24 + (a ? a.headTop[0] - 4 : 24);
    const y = r.feetY + 1 - 47 + (a ? a.headTop[1] + 14 : 10);
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
    this.shakeUntil = this.scene.time.now + ms;
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
    for (const b of this.boards) b.img.destroy();
    for (const r of [this.player, this.rival]) {
      r.sprite.destroy();
      r.shadow.destroy();
      r.overlay.destroy();
    }
  }
}
