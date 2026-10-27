import Phaser from 'phaser';
import {
  formatTime,
  OPPONENTS,
  toKmh,
  type CountdownBeat,
  type OpponentId,
  type RaceEvent,
  type RaceState,
  type Side,
} from '../core/index.ts';
import { GAME_WIDTH, iconKey, keyIconKey, portraitKey } from '../art/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import {
  flashHz,
  flashOn,
  gapLabel,
  litSegments,
  offscreenSide,
  PAL,
  padClock,
  PROGRESS,
  progressMarkerX,
  segmentColorIndex,
  SPEED_SEGMENTS,
} from '../ui/hudMath.ts';
import { Label } from '../ui/text.ts';
import { drawPanel, fillRect, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, SceneKey, settings } from './app.ts';

export type KeyLook = 'hidden' | 'dim' | 'bright' | 'fumble';

/** Snapshot for the test hook. */
export interface HudSnapshot {
  readonly timer: string;
  readonly kmh: number;
  readonly lit: number;
  readonly keys: { readonly L: KeyLook; readonly R: KeyLook };
  readonly mash: boolean;
  readonly fumbles: number;
  readonly countdown: string | null;
  readonly banner: string | null;
  readonly offscreen: string | null;
}

const KEY_Y = 160;
const KEY_X: Readonly<Record<Side, number>> = { L: 136, R: 168 };
/**
 * Speed meter box (4, 163, 128 x 14) ends 4 px left of the key prompt at x = 136: SPD label, ten
 * 5 px segments on a 6 px pitch, then km/h right-aligned to the box's inner edge.
 */
const METER = { x: 4, w: 128 } as const;
const SEG_X = 28;
const SEG_Y = 166;
const SEG_PITCH = 6;
/** Off-screen arrow and gap label stay 2 px clear of the screen edge. */
const EDGE = 2;
const COUNT_Y = 72;
const MASH_IDLE_MS = 500;
const FUMBLE_FRAMES = 4;
const POP_FRAMES = 2;
/** Fumble red flashes are an element flashing, so they are capped like any flash (design 6.5). */
const FUMBLE_FLASH_HZ = 3;
const LANE_RIVAL_Y = 112;
/** HUD text floats over busy stadium art, so it gets the index 1 outline as well as the shadow. */
const HUD_TEXT = { outline: true } as const;

/**
 * S3/S4 HUD (design 6.2-6.5) on its own fixed camera, above the RaceScene world camera.
 * RaceScene pushes state every frame through onFrame(); this scene never changes game state.
 */
export class HudScene extends Phaser.Scene {
  private ready = false;
  private opponent: OpponentId = 'pip';
  private timer!: Label;
  private kmh!: Label;
  private segments!: Phaser.GameObjects.Graphics;
  private keyImages!: Record<Side, Phaser.GameObjects.Image>;
  private rivalHead!: Phaser.GameObjects.Image;
  private playerHead!: Phaser.GameObjects.Image;
  private offArrow!: Phaser.GameObjects.Image;
  private offLabel!: Label;
  private countdown!: Label;
  private banner!: Label;
  private mash!: Label;
  private lastLit = -1;
  private lastKeysSig = '';
  private lastBeat: CountdownBeat = null;
  private popFrames = 0;
  private fumbleSide: Side | null = null;
  private fumbleFrames = 0;
  private fumbles = 0;
  private lastFumbleFlash = -Infinity;
  private keyLooks: { L: KeyLook; R: KeyLook } = { L: 'dim', R: 'dim' };
  private mashOn = false;

  constructor() {
    super(SceneKey.Hud);
  }

  create(data: { opponent: OpponentId }): void {
    this.ready = false;
    this.opponent = data.opponent;
    this.lastLit = -1;
    this.lastKeysSig = '';
    this.lastBeat = null;
    this.popFrames = 0;
    this.fumbleSide = null;
    this.fumbleFrames = 0;
    this.fumbles = 0;
    this.lastFumbleFlash = -Infinity;
    applyCrt(this);
    const info = OPPONENTS[this.opponent];
    const rec = getApp().records;

    // Rival badge (4, 4, 80 x 16).
    this.add.image(4, 4, portraitKey(this.opponent, 16)).setOrigin(0, 0).setDepth(UI_DEPTH);
    new Label(this, 22, 8, info.name, HUD_TEXT);
    // Timer (128, 4, 64 x 16) at 2x, centred on the box.
    this.timer = new Label(this, 160, 4, '00.00', { ...HUD_TEXT, scale: 2, align: 'center' });
    // PB at y 4 (clear of the finish flag below), right-aligned to the 4 px screen margin so it
    // mirrors the rival badge around the timer.
    new Label(this, GAME_WIDTH - 4, 4, `PB ${formatTime(rec.bestMs(this.opponent))}`, {
      ...HUD_TEXT,
      align: 'right',
    });

    // Progress bar (40, 24, 240 x 8): track index 2 inside a 1 px grey rim and index 1 outline (the
    // rim keeps the bar visible against dark skies such as Zyx's), finish flag at x = 280.
    const bar = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(bar, PROGRESS.x, PROGRESS.y, PROGRESS.w, PROGRESS.h, PAL.grey);
    this.add
      .image(PROGRESS.x + PROGRESS.w, PROGRESS.y - 8, iconKey('finishFlag'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH);
    this.rivalHead = this.add
      .image(PROGRESS.x, PROGRESS.y - 4, iconKey('headRival'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 1);
    this.playerHead = this.add
      .image(PROGRESS.x, PROGRESS.y + PROGRESS.h, iconKey('headPlayer'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 1);

    // Off-screen rival arrow at the rival lane.
    this.offArrow = this.add
      .image(0, LANE_RIVAL_Y - 4, iconKey('offscreenArrow'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH)
      .setVisible(false);
    this.offLabel = new Label(this, 0, LANE_RIVAL_Y - 3, '', { ...HUD_TEXT, font: FONT_MINI });
    this.offLabel.setVisible(false);

    // Speed meter (8, 164, 84 x 12).
    const meterBg = this.add.graphics().setDepth(UI_DEPTH);
    fillRect(meterBg, METER.x, SEG_Y - 3, METER.w, 14, PAL.ink);
    fillRect(meterBg, METER.x + 1, SEG_Y - 2, METER.w - 2, 12, PAL.panel);
    new Label(this, 8, SEG_Y, 'SPD', { font: FONT_MINI, depth: UI_DEPTH + 1 });
    this.segments = this.add.graphics().setDepth(UI_DEPTH + 1);
    this.kmh = new Label(this, METER.x + METER.w - 4, SEG_Y, '0KM/H', {
      align: 'right',
      font: FONT_MINI,
      depth: UI_DEPTH + 1,
    });

    // Key prompt (136, 160, 48 x 16) and MASH!.
    this.keyImages = {
      L: this.add.image(KEY_X.L, KEY_Y, keyIconKey('L', 'dim')).setOrigin(0, 0).setDepth(UI_DEPTH),
      R: this.add.image(KEY_X.R, KEY_Y, keyIconKey('R', 'dim')).setOrigin(0, 0).setDepth(UI_DEPTH),
    };
    this.mash = new Label(this, 160, KEY_Y - 11, 'MASH!', { ...HUD_TEXT, align: 'center', color: PAL.gold });
    this.mash.setVisible(false);

    // Countdown and banners.
    this.countdown = new Label(this, 160, COUNT_Y - 16, '', { scale: 4, outline: true, align: 'center' });
    this.countdown.setVisible(false);
    this.banner = new Label(this, 160, COUNT_Y - 8, '', {
      ...HUD_TEXT,
      scale: 2,
      align: 'center',
      color: PAL.redLight,
    });
    this.banner.setVisible(false);

    this.drawSegments(0);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ready = false;
    });
    this.ready = true;
  }

  snapshot(): HudSnapshot | null {
    if (!this.ready) return null;
    return {
      timer: this.timer.text,
      kmh: Number.parseInt(this.kmh.text, 10) || 0,
      lit: Math.max(0, this.lastLit),
      keys: { ...this.keyLooks },
      mash: this.mashOn,
      fumbles: this.fumbles,
      countdown: this.countdown.visible ? this.countdown.text : null,
      banner: this.banner.visible ? this.banner.text : null,
      offscreen: this.offLabel.visible ? this.offLabel.text : null,
    };
  }

  onFrame(state: RaceState, events: readonly RaceEvent[], rivalScreenX: number): void {
    if (!this.ready) return;
    const s = settings();
    const now = performance.now();
    // Same-key spam can fumble 10+ times a second; start a new red flash at most 3 times a second
    // (once a second with reduced flashing). Every fumble still counts.
    const minFlashGapMs = 1000 / flashHz(FUMBLE_FLASH_HZ, s.reducedFlashing);
    for (const ev of events) {
      if (ev.type !== 'fumble') continue;
      this.fumbles++;
      if (now - this.lastFumbleFlash >= minFlashGapMs) {
        this.lastFumbleFlash = now;
        this.fumbleSide = ev.side;
        this.fumbleFrames = FUMBLE_FRAMES;
      }
    }

    // Timer: core's timerMs (0 before GO, live while running, frozen at the player's finish).
    const p = state.player;
    this.timer.setText(padClock(formatTime(state.timerMs)));

    // Progress markers (6x4 heads centred on their metre position).
    this.rivalHead.setX(progressMarkerX(state.rival.xM) - 3);
    this.playerHead.setX(progressMarkerX(p.xM) - 3);

    // Off-screen rival arrow.
    const side =
      state.rival.visible && p.finishMs === null && state.phase !== 'finished'
        ? offscreenSide(Math.round(rivalScreenX), GAME_WIDTH)
        : null;
    if (side === null) {
      this.offArrow.setVisible(false);
      this.offLabel.setVisible(false);
    } else {
      const gap = gapLabel(state.rival.xM - p.xM);
      this.offArrow.setVisible(true).setFlipX(side === 'left');
      this.offArrow.setX(side === 'left' ? EDGE : GAME_WIDTH - EDGE - 8);
      this.offLabel.setText(gap).setVisible(true);
      this.offLabel.setPosition(
        side === 'left' ? EDGE + 10 : GAME_WIDTH - EDGE - 10 - this.offLabel.width,
        LANE_RIVAL_Y - 3,
      );
    }

    // Speed meter.
    const lit = litSegments(p.vMps);
    if (lit !== this.lastLit) this.drawSegments(lit);
    this.kmh.setText(`${toKmh(p.vMps)}KM/H`);

    // Key prompt and MASH! (6.4); pulse limited per 6.5.
    const crossed = p.finishMs !== null || state.phase === 'finished';
    const running = state.phase === 'running' && !crossed;
    const pulseHz = flashHz(2, s.reducedFlashing);
    const idle = running && state.idleMs >= MASH_IDLE_MS;
    const pulse = idle && flashOn(state.idleMs - MASH_IDLE_MS, pulseHz);
    this.mashOn = idle && pulse;
    this.mash.setVisible(this.mashOn);
    let looks: { L: KeyLook; R: KeyLook };
    if (crossed) looks = { L: 'hidden', R: 'hidden' };
    else if (!running) looks = { L: 'dim', R: 'dim' };
    else if (idle) looks = pulse ? { L: 'bright', R: 'bright' } : { L: 'dim', R: 'dim' };
    // The expected-side swap can alternate ~12 Hz while mashing, so reduced flashing keeps both lit.
    else if (state.expectedSide === null || s.reducedFlashing) looks = { L: 'bright', R: 'bright' };
    else looks = state.expectedSide === 'L' ? { L: 'bright', R: 'dim' } : { L: 'dim', R: 'bright' };
    if (this.fumbleFrames > 0 && this.fumbleSide && !crossed) looks[this.fumbleSide] = 'fumble';
    this.keyLooks = looks;
    // The 2 px key shake is motion like screen shake: off with reduced flashing or screen shake off.
    const shakeOn = s.screenShake && !s.reducedFlashing;
    const shake = shakeOn && this.fumbleFrames > 0 ? (this.fumbleFrames % 2 === 0 ? 2 : -2) : 0;
    const sig = `${looks.L}${looks.R}${this.fumbleSide ?? ''}${shake}`;
    if (sig !== this.lastKeysSig) {
      this.lastKeysSig = sig;
      this.drawKeys(looks, this.fumbleSide, shake);
    }
    if (this.fumbleFrames > 0) {
      this.fumbleFrames--;
      if (this.fumbleFrames === 0) this.fumbleSide = null;
    }

    // Countdown (6.3): 3-2-1 white with outline and a 2-frame 5x pop, GO! gold.
    const beat = state.phase === 'countdown' || state.phase === 'running' ? state.countdown : null;
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.popFrames = beat !== null && beat !== 'go' ? POP_FRAMES : 0;
    }
    if (beat === null) {
      this.countdown.setVisible(false);
    } else {
      const scale = this.popFrames > 0 ? 5 : 4;
      this.countdown
        .setText(beat === 'go' ? 'GO!' : String(beat))
        .setColor(beat === 'go' ? PAL.gold : PAL.white)
        .setScale(scale)
        .setPosition(160, COUNT_Y - (scale * 8) / 2)
        .setVisible(true);
      if (this.popFrames > 0) this.popFrames--;
    }

    // Banners: FALSE START! (1.5 s, core phase) and GET SET (core's frozen beat after resume).
    if (state.phase === 'falseStart') {
      this.banner.setText('FALSE START!').setColor(PAL.redLight).setVisible(true);
    } else if (state.getSet && !state.paused) {
      this.banner.setText('GET SET').setColor(PAL.gold).setVisible(true);
    } else {
      this.banner.setVisible(false);
    }
  }

  private drawSegments(lit: number): void {
    this.lastLit = lit;
    const g = this.segments;
    g.clear();
    fillRect(g, SEG_X - 1, SEG_Y - 1, SPEED_SEGMENTS * SEG_PITCH + 1, 10, PAL.ink);
    for (let i = 1; i <= SPEED_SEGMENTS; i++) {
      fillRect(
        g,
        SEG_X + (i - 1) * SEG_PITCH,
        SEG_Y,
        SEG_PITCH - 1,
        8,
        i <= lit ? segmentColorIndex(i) : PAL.shadowDark,
      );
    }
  }

  /** Key prompt from art's pre-coloured key icons (palette-exact, no runtime tint). */
  private drawKeys(looks: { L: KeyLook; R: KeyLook }, shakeSide: Side | null, shake: number): void {
    for (const side of ['L', 'R'] as const) {
      const img = this.keyImages[side];
      const look = looks[side];
      img.setVisible(look !== 'hidden');
      if (look === 'hidden') continue;
      img.setTexture(keyIconKey(side, look === 'fumble' ? 'wrong' : look));
      img.setX(KEY_X[side] + (side === shakeSide ? shake : 0));
    }
  }
}
