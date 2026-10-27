import Phaser from 'phaser';
import {
  EVENTS,
  formatTime,
  meet,
  modality,
  OPPONENTS,
  toKmh,
  TUNING,
  type CountdownBeat,
  type EventId,
  type ModalityState,
  type OpponentId,
  type RaceEvent,
  type RaceState,
  type Side,
} from '../core/index.ts';
import { GAME_WIDTH, iconKey, keyIconKey, meetBadgeKey, portraitKey } from '../art/index.ts';
import { playSfx } from '../audio/index.ts';
import { SpeechBubble } from '../ui/bubble.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { gauntletStrip, type GauntletRun } from '../ui/gauntlet.ts';
import {
  cleanZone,
  flashHz,
  flashOn,
  gapLabel,
  gaugeOffset,
  gaugeVisible,
  jumpReady,
  litSegments,
  offscreenIndicators,
  OVAL,
  ovalDot,
  PAL,
  padClock,
  PROGRESS,
  progressMarkerX,
  PlaceHold,
  progressTickMarks,
  RIVAL_KIT,
  segmentColorIndex,
  SPEED_SEGMENTS,
  S_FATIGUE,
  STAMINA_BAR_W,
  staminaColorIndex,
  staminaFillW,
  staminaLabelColor,
  sustainTickOffset,
} from '../ui/hudMath.ts';
import {
  firstRaceTip,
  livePlaceColor,
  meetSubtitle,
  ordinal,
  splitPopup,
  starterBubble,
} from '../ui/screenText.ts';
import { Label } from '../ui/text.ts';
import { ARROW_8X8, drawMask, drawPanel, fillRect, HEAD_6X4, HEAD_8X8, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, SceneKey, settings, tierOf } from './app.ts';

/** What the HUD needs from the art RaceView (screen positions, design 27.4 and 31.2). */
export interface RaceViewPositions {
  runnerScreenPos(lane: number): { readonly x: number; readonly y: number };
  starterScreenPos(): { readonly x: number; readonly y: number };
}

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
  /** v3 (design 27): held live position, off-screen indicators, strip, meet card, bubble, trip. */
  readonly place: string | null;
  readonly leader: string | null;
  readonly behind: string | null;
  readonly strip: string | null;
  readonly meet: string | null;
  readonly bubble: string | null;
  readonly trip: boolean;
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
  /** Gauntlet strip bounds in game px (layout checks), null outside Gauntlet races. */
  readonly stripBox: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  } | null;
}

export interface HudData {
  readonly event: EventId;
  readonly opponent: OpponentId;
  /** First race ever in this event: show the pre-race tip and the JUMP label (13.4.4, 14.3.9). */
  readonly firstRace: boolean;
  /** How long the meet card shows during the intro walk (31.1). */
  readonly meetMs: number;
  /** The Gauntlet run this race belongs to (strip, meet line), else null. */
  readonly gauntlet: GauntletRun | null;
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
/**
 * MASH! above the keys (above the gauge in hurdles); touch: above the pads' midpoint, at y 92 so it
 * clears the named rival's head row (27.6.6).
 */
const MASH_Y = { keys: KEY_Y - 11, hurdles: 128, touch: 92 } as const;
/** Off-screen indicators (27.4) at y 38, 2 px clear of the screen edge. */
const EDGE = 2;
const OFF_Y = 38;
const COUNT_Y = 72;
/** Pre-race tip after the meet card (31.1). */
const TIP_Y = 100;
/** Live position (4, 4) at 2x and the rival badge frame (56, 4, 18 x 18) (27.1). */
const PLACE_AT = { x: 4, y: 4 } as const;
const BADGE = { x: 56, y: 4, size: 18 } as const;
/**
 * Gauntlet strip, mini font right-aligned to x 316 at y 4: it replaces the PB line in Gauntlet
 * races (director call on 32.3), so it clears the timer (ends at x 215) and the finish flag (y 16).
 */
const STRIP_AT = { x: 316, y: 4 } as const;
/** Meet card (31.1): panel, badge at (8, 12), name 2x and a mini line. */
const MEET = { x: 40, y: 52, w: 240, h: 40 } as const;
/** TRIP! popup above the player for 0.6 s (33.2). */
const TRIP_POPUP_MS = 600;
/** Screen areas the starter's bubble keeps clear of: the 4x/5x countdown digit and the 2x banner. */
const BUBBLE_AVOID = {
  digit: { x: 138, y: 50, w: 44, h: 42 },
  banner: { x: 62, y: 62, w: 196, h: 20 },
} as const;
/** The starter's DISQUALIFIED bubble shows this long (31.2). */
const DQ_BUBBLE_MS = 1500;
const SPLIT_POPUP = { x: 160, y: 44, ms: 2000 } as const;
const KNOCK_POPUP_MS = 500;
/** Player sprite: screen x 96 while racing (camera follow), feet on y 152, ~44 px tall. */
const PLAYER_POPUP = { x: 96, y: 152 - 56 } as const;
const MASH_IDLE_MS = 500;
const FUMBLE_FRAMES = 4;
const POP_FRAMES = 2;
/** Fumble red flashes are an element flashing, so they are capped like any flash (design 6.5). */
const FUMBLE_FLASH_HZ = 3;
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
  private markers!: Phaser.GameObjects.Graphics;
  private playerHead!: Phaser.GameObjects.Image;
  private ticks!: Phaser.GameObjects.Graphics;
  private ovalDots: Phaser.GameObjects.Graphics | null = null;
  private offMarks!: Phaser.GameObjects.Graphics;
  private leaderLabel!: Label;
  private behindLabel!: Label;
  private placeLabel!: Label;
  private placeHold = new PlaceHold(TUNING.POSITION_HOLD_MS);
  private strip: Label | null = null;
  private gauntlet: GauntletRun | null = null;
  private meetObjs: { setVisible(v: boolean): unknown }[] = [];
  private meetText: string | null = null;
  private meetUntil = 0;
  private bubble!: SpeechBubble;
  private dqUntil = 0;
  private tripLabel!: Label;
  private tripUntil = 0;
  private lastMarkSig = '';
  private lastOffSig = '';
  private kit = 8;
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
    this.placeHold = new PlaceHold(TUNING.POSITION_HOLD_MS);
    this.gauntlet = data.gauntlet;
    this.strip = null;
    this.meetObjs = [];
    this.dqUntil = 0;
    this.tripUntil = 0;
    this.lastMarkSig = '';
    this.lastOffSig = '';
    this.kit = RIVAL_KIT[data.opponent];
    applyCrt(this);
    const rec = getApp().records;
    const hurdles = this.event === '110mh';
    const quarter = this.event === '400m';

    // Live position (4, 4) at 2x, hidden before GO (27.1, 27.2).
    this.placeLabel = new Label(this, PLACE_AT.x, PLACE_AT.y, '', { ...HUD_TEXT, scale: 2 });
    this.placeLabel.setVisible(false);
    // Rival badge (56, 4, 18 x 18): portrait in a 1 px frame in the rival's kit colour.
    const badge = this.add.graphics().setDepth(UI_DEPTH);
    fillRect(badge, BADGE.x, BADGE.y, BADGE.size, BADGE.size, this.kit);
    this.add
      .image(BADGE.x + 1, BADGE.y + 1, portraitKey(this.opponent, 16))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH);
    // Timer centred on x 160 at 2x: `SS.hh` (64 px) or, in the 400 m, `M:SS.hh` (112 px, 104-215).
    this.timer = new Label(this, 160, 4, '00.00', { ...HUD_TEXT, scale: 2, align: 'center' });
    // PB right-aligned to the 4 px screen margin, mirroring the rival badge around the timer. In a
    // Gauntlet race the strip takes this slot instead (director call on 32.3).
    if (!data.gauntlet) {
      new Label(this, GAME_WIDTH - 4, 4, `PB ${formatTime(rec.bestMs(this.event, this.opponent))}`, {
        ...HUD_TEXT,
        align: 'right',
      });
    }

    // Progress bar (40, 24, 240 x 8) = the event distance; ticks above it (hurdles, 100/200/300 m).
    const bar = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(bar, PROGRESS.x, PROGRESS.y, PROGRESS.w, PROGRESS.h, PAL.grey);
    this.add
      .image(PROGRESS.x + PROGRESS.w, PROGRESS.y - 8, iconKey('finishFlag'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH);
    this.ticks = this.add.graphics().setDepth(UI_DEPTH);
    // Field pips inside the bar and the rival's head above it (27.3), redrawn per frame.
    this.markers = this.add.graphics().setDepth(UI_DEPTH + 1);
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

    // Off-screen leader (right) and pack behind (left) indicators at y 38 (27.4).
    this.offMarks = this.add.graphics().setDepth(UI_DEPTH);
    this.leaderLabel = new Label(this, 0, OFF_Y + 1, '', { ...HUD_TEXT, font: FONT_MINI, align: 'right' });
    this.leaderLabel.setVisible(false);
    this.behindLabel = new Label(this, EDGE + 10, OFF_Y + 1, '', { ...HUD_TEXT, font: FONT_MINI });
    this.behindLabel.setVisible(false);

    // Gauntlet strip (32.3).
    if (this.gauntlet) {
      this.strip = new Label(this, STRIP_AT.x, STRIP_AT.y, gauntletStrip(this.gauntlet, 0), {
        ...HUD_TEXT,
        font: FONT_MINI,
        align: 'right',
      });
    }

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
    this.tripLabel = new Label(this, PLAYER_POPUP.x, PLAYER_POPUP.y, 'TRIP!', {
      ...HUD_TEXT,
      align: 'center',
      color: PAL.red,
    });
    this.tripLabel.setVisible(false);

    // Starter speech bubble (31.2), under the countdown digits.
    this.bubble = new SpeechBubble(this, UI_DEPTH - 2);

    // Meet card (31.1) during the intro walk.
    this.buildMeetCard(data);

    this.drawSegments(0);
    this.applyLayout(layoutOf(modality.get()), true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.bubble.destroy());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.ready = false;
    });
    this.ready = true;
  }

  private buildMeetCard(data: HudData): void {
    const tier = tierOf(data.event, data.opponent);
    const name = meet(tier).name;
    const sub = meetSubtitle(data.event, OPPONENTS[data.opponent].name, data.gauntlet?.tier ?? null);
    const depth = UI_DEPTH + 3;
    const panel = this.add.graphics().setDepth(depth);
    drawPanel(panel, MEET.x, MEET.y, MEET.w, MEET.h);
    const badge = this.add
      .image(MEET.x + 8, MEET.y + 12, meetBadgeKey(tier))
      .setOrigin(0, 0)
      .setDepth(depth + 1);
    const title = new Label(this, MEET.x + 28, MEET.y + 6, name, {
      scale: 2,
      color: PAL.gold,
      depth: depth + 1,
    });
    const line = new Label(this, MEET.x + 28, MEET.y + 26, sub, { font: FONT_MINI, depth: depth + 1 });
    this.meetObjs = [panel, badge, title, line];
    this.meetText = `${name} | ${sub}`;
    this.meetUntil = this.t0 + data.meetMs;
  }

  private hideMeetCard(): void {
    if (this.meetText === null) return;
    this.meetText = null;
    for (const o of this.meetObjs) o.setVisible(false);
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
      offscreen: this.leaderLabel.visible ? this.leaderLabel.text : null,
      place: this.placeLabel.visible ? this.placeLabel.text : null,
      leader: this.leaderLabel.visible ? this.leaderLabel.text : null,
      behind: this.behindLabel.visible ? this.behindLabel.text : null,
      strip: this.strip?.text ?? null,
      meet: this.meetText,
      bubble: this.bubble.text,
      trip: this.tripLabel.visible,
      tip: this.tip.visible ? this.tip.text : null,
      gauge: { ...this.gaugeState },
      stamina: this.staSnap,
      popup: this.knockLabel.visible ? this.knockLabel.text : null,
      split: this.splitLabel.visible ? this.splitLabel.text : null,
      knockedTicks: this.knocked,
      speedMeter: { x: this.speed.x, y: this.speed.y },
      stripBox: this.strip
        ? { x: this.strip.main.x, y: this.strip.main.y, w: this.strip.width, h: this.strip.height }
        : null,
    };
  }

  onFrame(state: RaceState, events: readonly RaceEvent[], view: RaceViewPositions): void {
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
      } else if (ev.type === 'trip') {
        this.tripUntil = now + TRIP_POPUP_MS;
      } else if (ev.type === 'disqualified') {
        this.dqUntil = now + DQ_BUBBLE_MS;
      } else if ((ev.type === 'hurdleClip' || ev.type === 'hurdleHit') && ev.lane === 0) {
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
    // TRIP! rides above the player (who may be falling or lying).
    const tripOn = now < this.tripUntil;
    this.tripLabel.setVisible(tripOn);
    if (tripOn)
      this.tripLabel.setPosition(PLAYER_POPUP.x, PLAYER_POPUP.y - (this.knockLabel.visible ? 10 : 0));

    // Live position (27.2): held 0.35 s, hidden before GO and after a DQ, frozen once crossed.
    const crossedLine = p.finishMs !== null;
    const place = this.placeHold.update(state.livePlace, now, crossedLine);
    if (place === null) {
      this.placeLabel.setVisible(false);
    } else {
      this.placeLabel.setText(ordinal(place)).setColor(livePlaceColor(place)).setVisible(true);
    }

    // Gauntlet strip: won races plus the live timer, frozen at the crossing (32.3).
    if (this.strip && this.gauntlet) this.strip.setText(gauntletStrip(this.gauntlet, state.timerMs));

    // Meet card during the intro walk, then the starter's bubbles (31.1, 31.2).
    if (this.meetText !== null && (now >= this.meetUntil || state.phase !== 'intro')) this.hideMeetCard();
    const bubbleText = starterBubble({
      phase: state.phase,
      countdown: state.countdown,
      falseStarts: state.falseStarts,
      disqualified: now < this.dqUntil,
    });
    if (bubbleText === null) {
      this.bubble.hide();
    } else {
      const was = this.bubble.text;
      const at = view.starterScreenPos();
      // Never under the big countdown digit or the FALSE START! banner (6.3 stays the timing cue).
      const avoid = state.phase === 'falseStart' ? BUBBLE_AVOID.banner : BUBBLE_AVOID.digit;
      this.bubble.show(bubbleText, Math.round(at.x), Math.round(at.y), avoid);
      if (was !== bubbleText) playSfx('bubble');
    }

    // Timer: core's timerMs (0 before GO, live while running, frozen at the player's finish).
    this.timer.setText(padClock(formatTime(state.timerMs)));

    // Progress markers (27.3): field pips inside the bar, the rival's head above it in kit colour,
    // the player's head below; knocked hurdle ticks above.
    this.drawMarkers(state, distance);
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

    // Off-screen leader ahead and pack behind (27.4), from each runner's drawn x.
    this.drawOffscreen(state, view);

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
    const tip =
      this.firstRace && state.phase === 'intro' && this.meetText === null
        ? firstRaceTip(this.event, m.modality)
        : null;
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

  private drawMarkers(state: RaceState, distance: number): void {
    const xs = state.runners.map((r) => progressMarkerX(r.state.xM, distance));
    const sig = xs.join(',');
    if (sig === this.lastMarkSig) return;
    this.lastMarkSig = sig;
    const g = this.markers;
    g.clear();
    // Field: 2x4 pips inside the bar, index 7, all alike.
    state.runners.forEach((r, i) => {
      if (r.lane < 2) return;
      fillRect(g, (xs[i] ?? PROGRESS.x) - 1, PROGRESS.y + 2, 2, 4, PAL.lightGrey);
    });
    const rx = xs[1] ?? PROGRESS.x;
    drawMask(g, rx - 3, PROGRESS.y - 4, HEAD_6X4, { k: PAL.ink, c: this.kit, w: PAL.white });
  }

  private drawOffscreen(state: RaceState, view: RaceViewPositions): void {
    const p = state.player;
    const live = p.finishMs === null && state.phase !== 'finished' && state.phase !== 'intro';
    const ind = live
      ? offscreenIndicators(
          state.runners.map((r) => ({
            lane: r.lane,
            screenX: view.runnerScreenPos(r.lane).x,
            xM: r.state.xM,
            visible: r.state.visible,
          })),
          state.leaderLane,
          GAME_WIDTH,
        )
      : { leader: null, behind: null };
    const leader = ind.leader;
    const behind = ind.behind;
    const leaderText = leader ? `> ${gapLabel(leader.gapM)}` : null;
    const behindText = behind ? `< ${behind.count}` : null;
    const sig = `${leader?.lane ?? '-'}|${behind?.rival ?? '-'}|${behindText ?? ''}`;
    if (sig !== this.lastOffSig) {
      this.lastOffSig = sig;
      const g = this.offMarks;
      g.clear();
      if (leader) {
        const c = leader.lane === 1 ? this.kit : PAL.lightGrey;
        drawMask(g, GAME_WIDTH - EDGE - 8, OFF_Y, ARROW_8X8, { k: PAL.ink, c });
        drawMask(g, GAME_WIDTH - EDGE - 18, OFF_Y, HEAD_8X8, { k: PAL.ink, c, w: PAL.white });
      }
      if (behind) {
        const c = behind.rival ? this.kit : PAL.lightGrey;
        drawMask(g, EDGE, OFF_Y, ARROW_8X8, { k: PAL.ink, c }, true);
      }
    }
    if (leaderText === null) {
      this.leaderLabel.setVisible(false);
    } else {
      this.leaderLabel
        .setText(leaderText)
        .setPosition(GAME_WIDTH - EDGE - 21, OFF_Y + 1)
        .setVisible(true);
    }
    if (behindText === null) this.behindLabel.setVisible(false);
    else this.behindLabel.setText(behindText).setVisible(true);
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
