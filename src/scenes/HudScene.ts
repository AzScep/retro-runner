import Phaser from 'phaser';
import {
  EVENTS,
  formatTime,
  modality,
  OPPONENTS,
  toKmh,
  type CountdownBeat,
  type EventId,
  type ModalityState,
  type OpponentId,
  type RaceEvent,
  type RaceState,
  type Side,
} from '../core/index.ts';
import { GAME_WIDTH, iconKey, keyIconKey, portraitKey } from '../art/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import {
  cleanZone,
  flashHz,
  flashOn,
  gapLabel,
  gaugeOffset,
  gaugeVisible,
  jumpReady,
  litSegments,
  offscreenSide,
  OVAL,
  ovalDot,
  PAL,
  padClock,
  PROGRESS,
  progressMarkerX,
  progressTickMarks,
  segmentColorIndex,
  SPEED_SEGMENTS,
  S_FATIGUE,
  STAMINA_BAR_W,
  staminaColorIndex,
  staminaFillW,
  staminaLabelColor,
  sustainTickOffset,
} from '../ui/hudMath.ts';
import { firstRaceTip, splitPopup } from '../ui/screenText.ts';
import { Label } from '../ui/text.ts';
import { drawPanel, fillRect, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, SceneKey, settings } from './app.ts';

export type KeyLook = 'hidden' | 'dim' | 'bright' | 'fumble';
/** Where the HUD's bottom elements sit (design 17.4): pads over the canvas move the meters. */
export type HudLayout = 'keyboard' | 'touchBars' | 'touchCanvas';

/** Snapshot for the test hook. */
export interface HudSnapshot {
  readonly event: EventId;
  readonly layout: HudLayout;
  readonly timer: string;
  readonly kmh: number;
  readonly lit: number;
  readonly keys: { readonly L: KeyLook; readonly R: KeyLook; readonly U: KeyLook };
  readonly mash: boolean;
  readonly fumbles: number;
  readonly countdown: string | null;
  readonly banner: string | null;
  readonly offscreen: string | null;
  readonly tip: string | null;
  readonly gauge: { readonly visible: boolean; readonly pipX: number; readonly label: boolean };
  readonly stamina: {
    readonly fill: number;
    readonly color: number;
    readonly arrow: 'up' | 'down' | null;
  } | null;
  readonly popup: string | null;
  readonly split: string | null;
  readonly knockedTicks: number;
  readonly speedMeter: { readonly x: number; readonly y: number };
}

export interface HudData {
  readonly event: EventId;
  readonly opponent: OpponentId;
  /** First race ever in this event: show the pre-race tip and the JUMP label (13.4.4, 14.3.9). */
  readonly firstRace: boolean;
}

/** Key prompt (design 6.2, 18.4): two keys, or Left / Up / Right in the hurdles. */
const KEY_Y = 160;
const KEY_X_TWO: Readonly<Record<'L' | 'R', number>> = { L: 136, R: 168 };
const KEY_X_HURDLES: Readonly<Record<'L' | 'U' | 'R', number>> = { L: 120, U: 152, R: 184 };
/**
 * Speed meter box (128 x 14) ends 4 px left of the key prompt at x = 136: SPD label, ten 5 px
 * segments on a 6 px pitch, then km/h right-aligned to the box's inner edge. Touch with pads over the
 * canvas moves it to (118, 166) (design 17.4).
 */
const METER_W = 128;
const SEG_DX = 24;
const SEG_DY = 3;
const SEG_PITCH = 6;
/**
 * In the keyboard hurdles the key prompt starts at x 120, so the meter shrinks to 102 px: the label
 * becomes the unit (`KMH`) and the value is the bare number, keeping km/h as text (design 8.8).
 */
const METER_W_COMPACT = 102;
const SPEED_AT: Readonly<Record<HudLayout, { x: number; y: number }>> = {
  keyboard: { x: 4, y: 163 },
  touchBars: { x: 4, y: 163 },
  touchCanvas: { x: 118, y: 165 },
};
/** Stamina meter (design 18.4): STA label then a 56 x 8 bar with an outline; box matches the speed meter. */
const STA_W = 88;
const STA_BAR_DX = 26;
const STAMINA_AT: Readonly<Record<HudLayout, { x: number; y: number }>> = {
  keyboard: { x: 228, y: 163 },
  touchBars: { x: 228, y: 163 },
  touchCanvas: { x: 118, y: 150 },
};
/**
 * Jump gauge (design 18.4): 80 x 6 at (120, 150) on keyboard, 56 x 6 at (118, 140) with pads over the
 * canvas. With pads in the side bars the bar area is DOM, not canvas, so the gauge keeps the keyboard
 * spot (the key prompt is hidden there).
 */
const GAUGE_AT: Readonly<Record<HudLayout, { x: number; y: number; w: number }>> = {
  keyboard: { x: 120, y: 150, w: 80 },
  touchBars: { x: 120, y: 150, w: 80 },
  touchCanvas: { x: 118, y: 140, w: 56 },
};
const GAUGE_H = 6;
/** MASH! above the keys (above the gauge in hurdles); touch: above the pads' midpoint at y 100. */
const MASH_Y = { keys: KEY_Y - 11, hurdles: 128, touch: 100 } as const;
/** Off-screen arrow and gap label stay 2 px clear of the screen edge. */
const EDGE = 2;
const COUNT_Y = 72;
const TIP_Y = 60;
const SPLIT_POPUP = { x: 160, y: 44, ms: 2000 } as const;
const KNOCK_POPUP_MS = 500;
/** Player sprite: screen x 96 while racing (camera follow), feet on y 152, ~44 px tall. */
const PLAYER_POPUP = { x: 96, y: 152 - 56 } as const;
const MASH_IDLE_MS = 500;
const FUMBLE_FRAMES = 4;
const POP_FRAMES = 2;
/** Fumble red flashes are an element flashing, so they are capped like any flash (design 6.5). */
const FUMBLE_FLASH_HZ = 3;
const LANE_RIVAL_Y = 112;
/** HUD text floats over busy stadium art, so it gets the index 1 outline as well as the shadow. */
const HUD_TEXT = { outline: true } as const;
const JUMP_LABEL_HURDLES = 3;

function layoutOf(m: ModalityState): HudLayout {
  if (m.modality !== 'touch') return 'keyboard';
  return m.padsOverCanvas ? 'touchCanvas' : 'touchBars';
}

/**
 * S3/S4 HUD (design 6.2-6.5, 18.4) on its own fixed camera, above the RaceScene world camera.
 * RaceScene pushes state every frame through onFrame(); this scene never changes game state.
 */
export class HudScene extends Phaser.Scene {
  private ready = false;
  private event: EventId = '100m';
  private opponent: OpponentId = 'pip';
  private firstRace = false;
  private layout: HudLayout = 'keyboard';
  private timer!: Label;
  private kmh!: Label;
  private speed!: Phaser.GameObjects.Container;
  private meterBg!: Phaser.GameObjects.Graphics;
  private spdLabel!: Label;
  /** Keyboard hurdles: the meter must end before the Left key at x 120 (see METER_W_COMPACT). */
  private compactMeter = false;
  private segments!: Phaser.GameObjects.Graphics;
  private keyImages!: Partial<Record<'L' | 'R' | 'U', Phaser.GameObjects.Image>>;
  private rivalHead!: Phaser.GameObjects.Image;
  private playerHead!: Phaser.GameObjects.Image;
  private ticks!: Phaser.GameObjects.Graphics;
  private ovalDots: Phaser.GameObjects.Graphics | null = null;
  private offArrow!: Phaser.GameObjects.Image;
  private offLabel!: Label;
  private countdown!: Label;
  private banner!: Label;
  private mash!: Label;
  private tip!: Label;
  /** The tip sits on a panel: over the crowd and banners plain text is unreadable. */
  private tipPanel!: Phaser.GameObjects.Graphics;
  private gauge: Phaser.GameObjects.Graphics | null = null;
  private gaugeLabel: Label | null = null;
  private stamina: {
    readonly box: Phaser.GameObjects.Container;
    readonly bar: Phaser.GameObjects.Graphics;
    readonly label: Label;
    readonly arrow: Phaser.GameObjects.Image;
  } | null = null;
  private splitLabel!: Label;
  private knockLabel!: Label;
  private splitUntil = 0;
  private knockUntil = 0;
  private lastLit = -1;
  private lastKeysSig = '';
  private lastTicksSig = '';
  private lastStaSig = '';
  private lastGaugeSig = '';
  private lastBeat: CountdownBeat = null;
  private popFrames = 0;
  private fumbleSide: Side | null = null;
  private fumbleFrames = 0;
  private fumbles = 0;
  private lastFumbleFlash = -Infinity;
  private keyLooks: { L: KeyLook; R: KeyLook; U: KeyLook } = { L: 'dim', R: 'dim', U: 'hidden' };
  private mashOn = false;
  private gaugeState = { visible: false, pipX: 0, label: false };
  private staSnap: HudSnapshot['stamina'] = null;
  private knocked = 0;
  private t0 = 0;

  constructor() {
    super(SceneKey.Hud);
  }

  create(data: HudData): void {
    this.ready = false;
    this.event = data.event;
    this.opponent = data.opponent;
    this.firstRace = data.firstRace;
    this.lastLit = -1;
    this.lastKeysSig = '';
    this.lastTicksSig = '';
    this.lastStaSig = '';
    this.lastGaugeSig = '';
    this.lastBeat = null;
    this.popFrames = 0;
    this.fumbleSide = null;
    this.fumbleFrames = 0;
    this.fumbles = 0;
    this.lastFumbleFlash = -Infinity;
    this.splitUntil = 0;
    this.knockUntil = 0;
    this.knocked = 0;
    this.gauge = null;
    this.gaugeLabel = null;
    this.stamina = null;
    this.ovalDots = null;
    this.staSnap = null;
    this.gaugeState = { visible: false, pipX: 0, label: false };
    this.t0 = performance.now();
    applyCrt(this);
    const info = OPPONENTS[this.opponent];
    const rec = getApp().records;
    const hurdles = this.event === '110mh';
    const quarter = this.event === '400m';

    // Rival badge (4, 4, 80 x 16).
    this.add.image(4, 4, portraitKey(this.opponent, 16)).setOrigin(0, 0).setDepth(UI_DEPTH);
    new Label(this, 22, 8, info.name, HUD_TEXT);
    // Timer centred on x 160 at 2x: `SS.hh` (64 px) or, in the 400 m, `M:SS.hh` (112 px, 104-215).
    this.timer = new Label(this, 160, 4, '00.00', { ...HUD_TEXT, scale: 2, align: 'center' });
    // PB right-aligned to the 4 px screen margin, mirroring the rival badge around the timer.
    new Label(this, GAME_WIDTH - 4, 4, `PB ${formatTime(rec.bestMs(this.event, this.opponent))}`, {
      ...HUD_TEXT,
      align: 'right',
    });

    // Progress bar (40, 24, 240 x 8) = the event distance; ticks above it (hurdles, 100/200/300 m).
    const bar = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(bar, PROGRESS.x, PROGRESS.y, PROGRESS.w, PROGRESS.h, PAL.grey);
    this.add
      .image(PROGRESS.x + PROGRESS.w, PROGRESS.y - 8, iconKey('finishFlag'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH);
    this.ticks = this.add.graphics().setDepth(UI_DEPTH);
    this.rivalHead = this.add
      .image(PROGRESS.x, PROGRESS.y - 4, iconKey('headRival'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 1);
    this.playerHead = this.add
      .image(PROGRESS.x, PROGRESS.y + PROGRESS.h, iconKey('headPlayer'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 1);
    this.drawTicks([]);

    // Oval lap icon (400 m).
    if (quarter) {
      this.add.image(OVAL.x, OVAL.y, iconKey('lapOval')).setOrigin(0, 0).setDepth(UI_DEPTH);
      this.ovalDots = this.add.graphics().setDepth(UI_DEPTH + 1);
    }

    // Off-screen rival arrow at the rival lane.
    this.offArrow = this.add
      .image(0, LANE_RIVAL_Y - 4, iconKey('offscreenArrow'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH)
      .setVisible(false);
    this.offLabel = new Label(this, 0, LANE_RIVAL_Y - 3, '', { ...HUD_TEXT, font: FONT_MINI });
    this.offLabel.setVisible(false);

    // Speed meter, in a container so the touch layout can move it as one piece.
    this.meterBg = this.add.graphics();
    this.segments = this.add.graphics();
    this.spdLabel = new Label(this, 4, SEG_DY, 'SPD', { font: FONT_MINI });
    this.kmh = new Label(this, METER_W - 4, SEG_DY, '0KM/H', { align: 'right', font: FONT_MINI });
    this.speed = this.add
      .container(0, 0, [this.meterBg, this.segments, ...this.spdLabel.objects(), ...this.kmh.objects()])
      .setDepth(UI_DEPTH);

    // Stamina meter (400 m).
    if (quarter) {
      const box = this.add.graphics();
      fillRect(box, 0, 0, STA_W, 14, PAL.ink);
      fillRect(box, 1, 1, STA_W - 2, 12, PAL.panel);
      const staBar = this.add.graphics();
      const label = new Label(this, 4, SEG_DY, 'STA', { font: FONT_MINI });
      const arrow = this.add
        .image(STA_BAR_DX + STAMINA_BAR_W - 5, -4, iconKey('staminaArrowDown'))
        .setOrigin(0, 0)
        .setVisible(false);
      const container = this.add.container(0, 0, [box, staBar, ...label.objects(), arrow]).setDepth(UI_DEPTH);
      this.stamina = { box: container, bar: staBar, label, arrow };
    }

    // Key prompt (keyboard only; pads replace it on touch, 17.4) and MASH!.
    const keyX = hurdles ? KEY_X_HURDLES : KEY_X_TWO;
    this.keyImages = {
      L: this.add.image(keyX.L, KEY_Y, keyIconKey('L', 'dim')).setOrigin(0, 0).setDepth(UI_DEPTH),
      R: this.add.image(keyX.R, KEY_Y, keyIconKey('R', 'dim')).setOrigin(0, 0).setDepth(UI_DEPTH),
      ...(hurdles
        ? {
            U: this.add
              .image(KEY_X_HURDLES.U, KEY_Y, keyIconKey('U', 'dim'))
              .setOrigin(0, 0)
              .setDepth(UI_DEPTH),
          }
        : {}),
    };
    this.mash = new Label(this, 160, MASH_Y.keys, 'MASH!', { ...HUD_TEXT, align: 'center', color: PAL.gold });
    this.mash.setVisible(false);

    // Jump gauge (hurdles).
    if (hurdles) {
      this.gauge = this.add.graphics().setDepth(UI_DEPTH);
      this.gaugeLabel = new Label(this, 160, 0, 'JUMP', { ...HUD_TEXT, font: FONT_MINI, align: 'center' });
      this.gaugeLabel.setVisible(false);
    }

    // Countdown, banners, tip and popups.
    this.countdown = new Label(this, 160, COUNT_Y - 16, '', { scale: 4, outline: true, align: 'center' });
    this.countdown.setVisible(false);
    this.banner = new Label(this, 160, COUNT_Y - 8, '', {
      ...HUD_TEXT,
      scale: 2,
      align: 'center',
      color: PAL.redLight,
    });
    this.banner.setVisible(false);
    this.tipPanel = this.add.graphics().setDepth(UI_DEPTH).setVisible(false);
    this.tip = new Label(this, 160, TIP_Y, '', { align: 'center', color: PAL.gold, depth: UI_DEPTH + 1 });
    this.tip.setVisible(false);
    this.splitLabel = new Label(this, SPLIT_POPUP.x, SPLIT_POPUP.y, '', { ...HUD_TEXT, align: 'center' });
    this.splitLabel.setVisible(false);
    this.knockLabel = new Label(this, PLAYER_POPUP.x, PLAYER_POPUP.y, '', { ...HUD_TEXT, align: 'center' });
    this.knockLabel.setVisible(false);

    this.drawSegments(0);
    this.applyLayout(layoutOf(modality.get()), true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ready = false;
    });
    this.ready = true;
  }

  /** Moves the bottom HUD for the modality and pad placement (design 17.4, 18.4). */
  private applyLayout(layout: HudLayout, force = false): void {
    if (layout === this.layout && !force) return;
    this.layout = layout;
    const sp = SPEED_AT[layout];
    this.speed.setPosition(sp.x, sp.y);
    this.compactMeter = this.event === '110mh' && layout === 'keyboard';
    const w = this.compactMeter ? METER_W_COMPACT : METER_W;
    const bg = this.meterBg;
    bg.clear();
    fillRect(bg, 0, 0, w, 14, PAL.ink);
    fillRect(bg, 1, 1, w - 2, 12, PAL.panel);
    if (this.event === '400m') {
      // Sustain tick: 1 px index 8 above the segments at SUSTAIN_RATE speed (design 18.4).
      fillRect(bg, SEG_DX + sustainTickOffset(SPEED_SEGMENTS * SEG_PITCH), 0, 1, 2, PAL.white);
    }
    this.spdLabel.setText(this.compactMeter ? 'KMH' : 'SPD');
    this.kmh.setPosition(w - 4, SEG_DY);
    if (this.stamina) {
      const st = STAMINA_AT[layout];
      this.stamina.box.setPosition(st.x, st.y);
    }
    this.mash.setPosition(
      160,
      layout !== 'keyboard' ? MASH_Y.touch : this.gauge ? MASH_Y.hurdles : MASH_Y.keys,
    );
    this.lastKeysSig = '';
    this.lastGaugeSig = '';
  }

  snapshot(): HudSnapshot | null {
    if (!this.ready) return null;
    return {
      event: this.event,
      layout: this.layout,
      timer: this.timer.text,
      kmh: Number.parseInt(this.kmh.text, 10) || 0,
      lit: Math.max(0, this.lastLit),
      keys: { ...this.keyLooks },
      mash: this.mashOn,
      fumbles: this.fumbles,
      countdown: this.countdown.visible ? this.countdown.text : null,
      banner: this.banner.visible ? this.banner.text : null,
      offscreen: this.offLabel.visible ? this.offLabel.text : null,
      tip: this.tip.visible ? this.tip.text : null,
      gauge: { ...this.gaugeState },
      stamina: this.staSnap,
      popup: this.knockLabel.visible ? this.knockLabel.text : null,
      split: this.splitLabel.visible ? this.splitLabel.text : null,
      knockedTicks: this.knocked,
      speedMeter: { x: this.speed.x, y: this.speed.y },
    };
  }

  onFrame(state: RaceState, events: readonly RaceEvent[], rivalScreenX: number): void {
    if (!this.ready) return;
    const s = settings();
    const now = performance.now();
    const m = modality.get();
    this.applyLayout(layoutOf(m));
    const touch = m.modality === 'touch';
    const p = state.player;
    const distance = EVENTS[this.event].distanceM;

    // Same-key spam can fumble 10+ times a second; start a new red flash at most 3 times a second
    // (once a second with reduced flashing). Every fumble still counts.
    const minFlashGapMs = 1000 / flashHz(FUMBLE_FLASH_HZ, s.reducedFlashing);
    for (const ev of events) {
      if (ev.type === 'fumble') {
        this.fumbles++;
        if (now - this.lastFumbleFlash >= minFlashGapMs) {
          this.lastFumbleFlash = now;
          this.fumbleSide = ev.side;
          this.fumbleFrames = FUMBLE_FRAMES;
        }
      } else if (ev.type === 'split') {
        this.splitLabel.setText(splitPopup(ev.index, ev.ms)).setVisible(true);
        this.splitUntil = now + SPLIT_POPUP.ms;
      } else if ((ev.type === 'hurdleClip' || ev.type === 'hurdleHit') && ev.lane === 'player') {
        const hit = ev.type === 'hurdleHit';
        const lift = Math.round(p.airM * 24);
        this.knockLabel
          .setText(hit ? 'HIT!' : 'CLIP')
          .setColor(hit ? PAL.red : PAL.gold)
          .setPosition(PLAYER_POPUP.x, PLAYER_POPUP.y - lift)
          .setVisible(true);
        this.knockUntil = now + KNOCK_POPUP_MS;
      }
    }
    if (this.splitUntil > 0 && now >= this.splitUntil) {
      this.splitUntil = 0;
      this.splitLabel.setVisible(false);
    }
    if (this.knockUntil > 0 && now >= this.knockUntil) {
      this.knockUntil = 0;
      this.knockLabel.setVisible(false);
    }

    // Timer: core's timerMs (0 before GO, live while running, frozen at the player's finish).
    this.timer.setText(padClock(formatTime(state.timerMs)));

    // Progress markers (6x4 heads centred on their metre position) and knocked hurdle ticks.
    this.rivalHead.setX(progressMarkerX(state.rival.xM, distance) - 3);
    this.playerHead.setX(progressMarkerX(p.xM, distance) - 3);
    this.drawTicks(p.hurdlesKnocked);
    if (this.ovalDots) {
      const g = this.ovalDots;
      g.clear();
      const r = ovalDot(state.rival.xM);
      const d = ovalDot(p.xM);
      fillRect(g, OVAL.x + r.x, OVAL.y + r.y, 2, 2, PAL.white);
      fillRect(g, OVAL.x + d.x, OVAL.y + d.y, 2, 2, PAL.redLight);
    }

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
    this.kmh.setText(this.compactMeter ? String(toKmh(p.vMps)) : `${toKmh(p.vMps)}KM/H`);

    // Stamina meter.
    if (this.stamina && p.stamina !== null)
      this.drawStamina(p.stamina, state.staminaDraining, now, s.reducedFlashing);

    // Key prompt and MASH! (6.4, 17.4); pulse limited per 6.5.
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
    // Up: dim until the next hurdle is within 1.0 s, then bright; never flashes (18.4).
    const up: KeyLook =
      !this.keyImages.U || crossed ? 'hidden' : running && jumpReady(state.nextHurdleS) ? 'bright' : 'dim';
    const all = touch
      ? { L: 'hidden' as const, R: 'hidden' as const, U: 'hidden' as const }
      : { ...looks, U: up };
    this.keyLooks = all;
    // The 2 px key shake is motion like screen shake: off with reduced flashing or screen shake off.
    const shakeOn = s.screenShake && !s.reducedFlashing;
    const shake = shakeOn && this.fumbleFrames > 0 ? (this.fumbleFrames % 2 === 0 ? 2 : -2) : 0;
    const sig = `${all.L}${all.R}${all.U}${this.fumbleSide ?? ''}${shake}`;
    if (sig !== this.lastKeysSig) {
      this.lastKeysSig = sig;
      this.drawKeys(all, this.fumbleSide, shake);
    }
    if (this.fumbleFrames > 0) {
      this.fumbleFrames--;
      if (this.fumbleFrames === 0) this.fumbleSide = null;
    }

    // Jump gauge (hurdles).
    if (this.gauge) this.drawGauge(state, running);

    // Pre-race tip during the intro walk, first race of the event only (18.5).
    const tip = this.firstRace && state.phase === 'intro' ? firstRaceTip(this.event, m.modality) : null;
    if (tip === null) {
      this.tip.setVisible(false);
      this.tipPanel.setVisible(false);
    } else if (tip !== this.tip.text || !this.tip.visible) {
      this.tip.setText(tip).setVisible(true);
      const w = this.tip.width + 16;
      this.tipPanel.clear();
      drawPanel(this.tipPanel, Math.round(160 - w / 2), TIP_Y - 5, w, 18);
      this.tipPanel.setVisible(true);
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

  /** 2x3 px ticks above the bar, index 8, or index 17 for a hurdle the player knocked (18.4). */
  private drawTicks(knocked: readonly boolean[]): void {
    const sig = knocked.map((k) => (k ? '1' : '0')).join('');
    if (sig === this.lastTicksSig && this.lastTicksSig !== '') return;
    this.lastTicksSig = sig || '-';
    this.knocked = knocked.filter(Boolean).length;
    const g = this.ticks;
    g.clear();
    const distance = EVENTS[this.event].distanceM;
    progressTickMarks(this.event).forEach((m, i) => {
      const x = progressMarkerX(m, distance) - 1;
      fillRect(g, x, PROGRESS.y - 3, 2, 3, knocked[i] === true ? PAL.red : PAL.white);
    });
  }

  private drawGauge(state: RaceState, running: boolean): void {
    const g = this.gauge;
    if (!g) return;
    const at = GAUGE_AT[this.layout];
    const visible = running && gaugeVisible(state.nextHurdleS, state.player.vMps);
    const trackW = at.w - 2;
    const pip = visible ? gaugeOffset(state.nextHurdleS ?? 0, trackW) : 0;
    const label =
      visible &&
      this.firstRace &&
      state.nextHurdleIndex !== null &&
      state.nextHurdleIndex < JUMP_LABEL_HURDLES;
    this.gaugeState = { visible, pipX: at.x + 1 + pip, label };
    const sig = `${visible}${pip}${this.layout}`;
    if (this.gaugeLabel) {
      this.gaugeLabel.setPosition(at.x + at.w / 2, at.y - 9).setVisible(label);
    }
    if (sig === this.lastGaugeSig) return;
    this.lastGaugeSig = sig;
    g.clear();
    if (!visible) return;
    // Frame index 1, track index 2, clean window index 26, pip 2x6 index 8 (centred on its time).
    fillRect(g, at.x, at.y, at.w, GAUGE_H, PAL.ink);
    fillRect(g, at.x + 1, at.y + 1, trackW, GAUGE_H - 2, PAL.panel);
    const zone = cleanZone(trackW);
    fillRect(g, at.x + 1 + zone.x, at.y + 1, zone.w, GAUGE_H - 2, PAL.green);
    const px = Math.min(at.x + at.w - 2, Math.max(at.x, at.x + 1 + pip - 1));
    fillRect(g, px, at.y, 2, GAUGE_H, PAL.white);
  }

  private drawStamina(stamina: number, draining: boolean, now: number, reducedFlashing: boolean): void {
    const st = this.stamina;
    if (!st) return;
    const fill = staminaFillW(stamina);
    const color = staminaColorIndex(stamina);
    const refilling = !draining && stamina < 1;
    const arrow: 'up' | 'down' | null = draining ? 'down' : refilling ? 'up' : null;
    this.staSnap = { fill, color, arrow };
    st.label.setColor(staminaLabelColor(stamina, now - this.t0, reducedFlashing));
    const sig = `${fill}${color}${arrow ?? ''}`;
    if (sig === this.lastStaSig) return;
    this.lastStaSig = sig;
    const g = st.bar;
    g.clear();
    const x = STA_BAR_DX;
    const y = SEG_DY - 1;
    // Bar 56 x 8 with a 1 px index 1 outline, empty part index 3, tick at 30 (S_FATIGUE) index 8.
    fillRect(g, x - 1, y - 1, STAMINA_BAR_W + 2, 10, PAL.ink);
    fillRect(g, x, y, STAMINA_BAR_W, 8, PAL.shadowDark);
    if (fill > 0) fillRect(g, x, y, fill, 8, color);
    fillRect(g, x + Math.round(S_FATIGUE * STAMINA_BAR_W), y, 1, 8, PAL.white);
    st.arrow.setVisible(arrow !== null);
    if (arrow !== null) st.arrow.setTexture(iconKey(arrow === 'up' ? 'staminaArrowUp' : 'staminaArrowDown'));
  }

  private drawSegments(lit: number): void {
    this.lastLit = lit;
    const g = this.segments;
    g.clear();
    fillRect(g, SEG_DX - 1, SEG_DY - 1, SPEED_SEGMENTS * SEG_PITCH + 1, 10, PAL.ink);
    for (let i = 1; i <= SPEED_SEGMENTS; i++) {
      fillRect(
        g,
        SEG_DX + (i - 1) * SEG_PITCH,
        SEG_DY,
        SEG_PITCH - 1,
        8,
        i <= lit ? segmentColorIndex(i) : PAL.shadowDark,
      );
    }
  }

  /** Key prompt from art's pre-coloured key icons (palette-exact, no runtime tint). */
  private drawKeys(
    looks: { L: KeyLook; R: KeyLook; U: KeyLook },
    shakeSide: Side | null,
    shake: number,
  ): void {
    const keyX: Readonly<Record<string, number>> = this.keyImages.U ? KEY_X_HURDLES : KEY_X_TWO;
    for (const key of ['L', 'R', 'U'] as const) {
      const img = this.keyImages[key];
      if (!img) continue;
      const look = looks[key];
      img.setVisible(look !== 'hidden');
      if (look === 'hidden') continue;
      img.setTexture(keyIconKey(key, look === 'fumble' ? 'wrong' : look));
      img.setX((keyX[key] ?? 0) + (key === shakeSide ? shake : 0));
    }
  }
}
