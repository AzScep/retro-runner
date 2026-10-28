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
import { miniTextWidth } from '../ui/miniFont.ts';
import { gauntletStrip, type GauntletRun } from '../ui/gauntlet.ts';
import {
  cleanZone,
  finishCall,
  flashHz,
  FUMBLE_LOOK_MS,
  gapLabel,
  gaugeOffset,
  gaugeVisible,
  hurdlePopup,
  jumpReady,
  keyPrompt,
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
  speedSegmentColor,
  SPEED_SEGMENTS,
  splitPopupText,
  S_FATIGUE,
  STAMINA_BAR_W,
  staminaColorIndex,
  staminaFillW,
  staminaLabelColor,
  sustainDividerOffset,
} from '../ui/hudMath.ts';
import { firstRaceTip, livePlaceColor, meetSubtitle, ordinal, starterBubble } from '../ui/screenText.ts';
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
  /** Key prompt text: `MASH!` (idle) or `ALTERNATE!` (one-key mashing), else null. */
  readonly prompt: string | null;
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
  /** Finish callout (`1ST!`, `3RD` ...) and its 2x time, shown from the crossing to the card. */
  readonly finish: string | null;
  readonly finishTime: string | null;
  /** `PHOTO!` above the finish callout (player within 50 ms of a neighbour). */
  readonly photo: boolean;
  /** Second banner line (`ONE MORE AND YOU ARE OUT` after the first false start). */
  readonly bannerSub: string | null;
  /** False start strike pip beside the timer. */
  readonly strike: boolean;
  /** Paused: countdown, meet card, banners and tip are hidden under the pause menu. */
  readonly pausedLook: boolean;
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
/**
 * Stamina meter (design 18.4): STA label, the 5x3 drain/refill arrow, then a 56 x 8 bar with an
 * outline, 2 px apart, inside a box as tall as the speed meter (92 wide so the arrow sits inside the
 * box instead of on the lane line above it).
 */
const STA_W = 92;
const STA_ARROW = { x: 23, y: SEG_DY + 2 } as const;
const STA_BAR_DX = 31;
const STAMINA_AT: Readonly<Record<HudLayout, { x: number; y: number }>> = {
  keyboard: { x: 224, y: 163 },
  touchBars: { x: 224, y: 163 },
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
  banner: { x: 60, y: 61, w: 200, h: 33 },
} as const;
/** The starter's DISQUALIFIED bubble shows this long (31.2). */
const DQ_BUBBLE_MS = 1500;
const SPLIT_POPUP = { x: 160, y: 44, ms: 2000 } as const;
const KNOCK_POPUP_MS = 500;
/** Player sprite: screen x 96 while racing (camera follow), feet on y 152, ~44 px tall. */
const PLAYER_POPUP = { x: 96, y: 152 - 56 } as const;
/** Hurdle popups sit this far above the player's feet (clear of the head, under the meet rows). */
const KNOCK_ABOVE_FEET = 54;
/** Dark plates behind HUD text over the stadium: padding around the glyphs. */
const PLATE_PAD = { x: 3, y: 2 } as const;
const POP_FRAMES = 2;
/** Finish callout (R7): place at 4x on the countdown spot, time at 2x under it, PHOTO! above. */
const FINISH_TIME_Y = COUNT_Y + 22;
const PHOTO_Y = COUNT_Y - 32;
/** False start strike pip (R8), right of the widest (400 m) timer, which ends at x 215. */
const STRIKE = { x: 220, y: 7, size: 6 } as const;
/** Fumble red flashes are an element flashing, so they are capped like any flash (design 6.5). */
const FUMBLE_FLASH_HZ = 3;
/** HUD text floats over busy stadium art, so it gets the index 1 outline as well as the shadow. */
const HUD_TEXT = { outline: true } as const;
const JUMP_LABEL_HURDLES = 3;

/** A dark plate (index 1 edge, index 2 fill) around a text box, so HUD text reads over the stadium. */
function plate(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
  const px = PLATE_PAD.x;
  const py = PLATE_PAD.y;
  fillRect(g, x - px, y - py, w + 2 * px, h + 2 * py, PAL.ink);
  fillRect(g, x - px + 1, y - py + 1, w + 2 * px - 2, h + 2 * py - 2, PAL.panel);
}

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
  /** 400 m: lit segments over the sustain speed turn red while the stamina drains (R5). */
  private draining = false;
  private lastKeysSig = '';
  private lastTicksSig = '';
  private lastStaSig = '';
  private lastGaugeSig = '';
  private lastBeat: CountdownBeat = null;
  private popFrames = 0;
  private fumbleSide: Side | null = null;
  /** The wrong-key look and shake run until this time (R2: time-based, not frame-counted). */
  private fumbleUntil = 0;
  private fumbles = 0;
  /** Fumbles since the last valid step (ALTERNATE!), and valid steps since GO or the last fumble. */
  private fumblesSinceStep = 0;
  private stepsSinceGuide = 0;
  private promptText: string | null = null;
  /** Dark plates behind the countdown / finish callout, the popups and the off-screen markers. */
  private countPlate!: Phaser.GameObjects.Graphics;
  private knockPlate!: Phaser.GameObjects.Graphics;
  private bannerSub!: Label;
  private finishTime!: Label;
  private photoLabel!: Label;
  private strike!: Phaser.GameObjects.Graphics;
  private finishShown = false;
  private pausedLook = false;
  private lastFumbleFlash = -Infinity;
  private lastPlateSig = '';
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
    this.draining = false;
    this.lastKeysSig = '';
    this.lastTicksSig = '';
    this.lastStaSig = '';
    this.lastGaugeSig = '';
    this.lastBeat = null;
    this.popFrames = 0;
    this.fumbleSide = null;
    this.fumbleUntil = 0;
    this.fumbles = 0;
    this.fumblesSinceStep = 0;
    this.stepsSinceGuide = 0;
    this.promptText = null;
    this.finishShown = false;
    this.pausedLook = false;
    this.lastPlateSig = '';
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
        .image(STA_ARROW.x, STA_ARROW.y, iconKey('staminaArrowDown'))
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

    // Countdown, banners, tip and popups. The centre callouts sit on one dark plate (R10): the white
    // 4x digits otherwise merge with the white crowd signs behind them.
    this.countPlate = this.add
      .graphics()
      .setDepth(UI_DEPTH - 1)
      .setVisible(false);
    this.countdown = new Label(this, 160, COUNT_Y - 16, '', { scale: 4, outline: true, align: 'center' });
    this.countdown.setVisible(false);
    this.banner = new Label(this, 160, COUNT_Y - 8, '', {
      ...HUD_TEXT,
      scale: 2,
      align: 'center',
      color: PAL.redLight,
    });
    this.banner.setVisible(false);
    this.bannerSub = new Label(this, 160, COUNT_Y + 11, '', {
      ...HUD_TEXT,
      font: FONT_MINI,
      align: 'center',
    });
    this.bannerSub.setVisible(false);
    // Finish callout (R7): the place reuses the countdown label; time and PHOTO! at 2x.
    this.finishTime = new Label(this, 160, FINISH_TIME_Y, '', { ...HUD_TEXT, scale: 2, align: 'center' });
    this.finishTime.setVisible(false);
    this.photoLabel = new Label(this, 160, PHOTO_Y, 'PHOTO!', {
      ...HUD_TEXT,
      scale: 2,
      align: 'center',
      color: PAL.gold,
    });
    this.photoLabel.setVisible(false);
    // False start strike (R8): a red pip beside the timer for the rest of the race.
    this.strike = this.add.graphics().setDepth(UI_DEPTH).setVisible(false);
    fillRect(this.strike, STRIKE.x, STRIKE.y, STRIKE.size, STRIKE.size, PAL.ink);
    fillRect(this.strike, STRIKE.x + 1, STRIKE.y + 1, STRIKE.size - 2, STRIKE.size - 2, PAL.red);
    this.tipPanel = this.add.graphics().setDepth(UI_DEPTH).setVisible(false);
    this.tip = new Label(this, 160, TIP_Y, '', { align: 'center', color: PAL.gold, depth: UI_DEPTH + 1 });
    this.tip.setVisible(false);
    this.splitLabel = new Label(this, SPLIT_POPUP.x, SPLIT_POPUP.y, '', { ...HUD_TEXT, align: 'center' });
    this.splitLabel.setVisible(false);
    // Hurdle popups ride above the player on a dark plate (R4), not on the busy ad boards.
    this.knockPlate = this.add
      .graphics()
      .setDepth(UI_DEPTH - 1)
      .setVisible(false);
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
    // An immediate retry has no meet card (R12).
    if (data.meetMs <= 0) {
      this.meetText = null;
      return;
    }
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

  /**
   * Under the pause menu (M9): the countdown, meet card, banners, tip and popups would show around
   * its panel as cut-off stubs, so they hide until the race resumes (onFrame redraws them).
   */
  setPausedLook(paused: boolean): void {
    if (!this.ready) return;
    this.pausedLook = paused;
    const meet = paused ? false : this.meetText !== null;
    for (const o of this.meetObjs) o.setVisible(meet);
    if (!paused) return;
    for (const l of [this.countdown, this.banner, this.bannerSub, this.tip, this.finishTime, this.photoLabel])
      l.setVisible(false);
    this.countPlate.setVisible(false);
    this.tipPanel.setVisible(false);
    this.bubble.hide();
    this.lastPlateSig = '';
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
      prompt: this.promptText,
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
      finish: this.finishShown && this.countdown.visible ? this.countdown.text : null,
      finishTime: this.finishTime.visible ? this.finishTime.text : null,
      photo: this.photoLabel.visible,
      bannerSub: this.bannerSub.visible ? this.bannerSub.text : null,
      strike: this.strike.visible,
      pausedLook: this.pausedLook,
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
        this.fumblesSinceStep++;
        this.stepsSinceGuide = 0;
        if (now - this.lastFumbleFlash >= minFlashGapMs) {
          this.lastFumbleFlash = now;
          this.fumbleSide = ev.side;
          this.fumbleUntil = now + FUMBLE_LOOK_MS;
        }
      } else if (ev.type === 'step') {
        this.fumblesSinceStep = 0;
        this.stepsSinceGuide++;
      } else if (ev.type === 'split') {
        this.splitLabel.setText(splitPopupText(ev.index, state.splits)).setVisible(true);
        this.splitUntil = now + SPLIT_POPUP.ms;
      } else if (ev.type === 'trip') {
        this.tripUntil = now + TRIP_POPUP_MS;
      } else if (ev.type === 'disqualified') {
        this.dqUntil = now + DQ_BUBBLE_MS;
      } else if (
        (ev.type === 'hurdleClip' || ev.type === 'hurdleHit' || ev.type === 'hurdleClear') &&
        ev.lane === 0
      ) {
        // R4: which way to correct (EARLY / LATE / TOO EARLY / JUMP!), and a clean clear confirmed.
        const pop =
          ev.type === 'hurdleClear'
            ? hurdlePopup('clear', undefined)
            : hurdlePopup(ev.type === 'hurdleClip' ? 'clip' : 'hit', ev.timing);
        this.knockLabel.setText(pop.text).setColor(pop.color).setVisible(true);
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
    // Popups follow the player's drawn position, above the head and the jump arc.
    const at = view.runnerScreenPos(0);
    const popX = Math.round(at.x);
    const popY = Math.round(at.y) - KNOCK_ABOVE_FEET - Math.round(p.airM * 24);
    if (this.knockLabel.visible) this.knockLabel.setPosition(popX, popY);
    // TRIP! rides above the player (who may be falling or lying).
    const tripOn = now < this.tripUntil;
    this.tripLabel.setVisible(tripOn);
    if (tripOn) this.tripLabel.setPosition(popX, popY - (this.knockLabel.visible ? 12 : 0));
    this.drawKnockPlate();

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
      const bannerUp = state.phase === 'falseStart' || state.outcome?.result === 'dq';
      const avoid = bannerUp ? BUBBLE_AVOID.banner : BUBBLE_AVOID.digit;
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
    if (lit !== this.lastLit || state.staminaDraining !== this.draining)
      this.drawSegments(lit, state.staminaDraining);
    this.kmh.setText(this.compactMeter ? String(toKmh(p.vMps)) : `${toKmh(p.vMps)}KM/H`);

    // Stamina meter.
    if (this.stamina && p.stamina !== null)
      this.drawStamina(p.stamina, state.staminaDraining, now, s.reducedFlashing);

    // Key prompt, MASH! and ALTERNATE! (6.4, 17.4, R1); pulse limited per 6.5.
    const crossed = p.finishMs !== null || state.phase === 'finished';
    const running = state.phase === 'running' && !crossed;
    const prompt = keyPrompt({
      running,
      idleMs: state.idleMs,
      fumblesSinceStep: this.fumblesSinceStep,
      stepsSinceGuide: this.stepsSinceGuide,
      expectedSide: state.expectedSide,
      reducedFlashing: s.reducedFlashing,
    });
    this.promptText = prompt.text;
    this.mashOn = prompt.text === 'MASH!';
    if (prompt.text === null) this.mash.setVisible(false);
    else
      this.mash
        .setText(prompt.text)
        .setColor(prompt.text === 'MASH!' ? PAL.gold : PAL.redLight)
        .setVisible(true);
    const look = (l: 'dim' | 'bright' | 'wrong'): KeyLook => (l === 'wrong' ? 'fumble' : l);
    const looks: { L: KeyLook; R: KeyLook } = crossed
      ? { L: 'hidden', R: 'hidden' }
      : { L: look(prompt.L), R: look(prompt.R) };
    const fumbleOn = now < this.fumbleUntil && this.fumbleSide !== null && !crossed;
    if (!fumbleOn) this.fumbleSide = null;
    if (fumbleOn && this.fumbleSide) looks[this.fumbleSide] = 'fumble';
    // Up: dim until the next hurdle is within 1.0 s, then bright; never flashes (18.4).
    const up: KeyLook =
      !this.keyImages.U || crossed ? 'hidden' : running && jumpReady(state.nextHurdleS) ? 'bright' : 'dim';
    const all = touch
      ? { L: 'hidden' as const, R: 'hidden' as const, U: 'hidden' as const }
      : { ...looks, U: up };
    this.keyLooks = all;
    // The 2 px key shake is motion like screen shake: off with reduced flashing or screen shake off.
    const shakeOn = s.screenShake && !s.reducedFlashing;
    // 2 px left-right every 33 ms while the wrong-key look lasts.
    const shake = shakeOn && fumbleOn ? (Math.floor((this.fumbleUntil - now) / 33) % 2 === 0 ? 2 : -2) : 0;
    const sig = `${all.L}${all.R}${all.U}${this.fumbleSide ?? ''}${shake}`;
    if (sig !== this.lastKeysSig) {
      this.lastKeysSig = sig;
      this.drawKeys(all, this.fumbleSide, shake);
    }

    // Jump gauge (hurdles).
    if (this.gauge) this.drawGauge(state, running);

    // Pre-race tip, first race of the event only (18.5): from the end of the meet card until GO, so
    // it is readable for the whole countdown (its panel at y 95-113 sits under the digit plate and
    // the banners, which end by y 92).
    const preRace = state.phase === 'intro' || state.phase === 'countdown' || state.phase === 'falseStart';
    const tip =
      this.firstRace && preRace && this.meetText === null ? firstRaceTip(this.event, m.modality) : null;
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
    // Finish moment (R7): the final place big in the centre and the time under it until the card,
    // PHOTO! (with a shutter click) when the player is within 50 ms of a neighbour.
    const call = p.finishMs !== null && state.outcome !== null ? finishCall(state.outcome) : null;
    if (call !== null && !this.finishShown) {
      this.finishShown = true;
      if (call.photo) playSfx('photo_click');
    }
    if (call !== null) {
      this.countdown.setText(call.text).setColor(call.color).setScale(4);
      this.countdown.setPosition(160, COUNT_Y - 16).setVisible(true);
      this.finishTime.setText(formatTime(p.finishMs)).setVisible(true);
      this.photoLabel.setVisible(call.photo);
    } else if (beat === null) {
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
    if (call === null) {
      this.finishTime.setVisible(false);
      this.photoLabel.setVisible(false);
    }

    // Banners: FALSE START! (1.5 s, core phase) with the strike warning on the first one (R8),
    // DISQUALIFIED until the card (core holds it for the banner time), GET SET after resume.
    const dq = state.outcome?.result === 'dq';
    let sub: string | null = null;
    if (dq) {
      this.banner.setText('DISQUALIFIED').setColor(PAL.redLight).setVisible(true);
    } else if (state.phase === 'falseStart') {
      this.banner.setText('FALSE START!').setColor(PAL.redLight).setVisible(true);
      if (state.falseStarts === TUNING.FALSE_STARTS_TO_DQ - 1) sub = 'ONE MORE AND YOU ARE OUT';
    } else if (state.getSet && !state.paused) {
      this.banner.setText('GET SET').setColor(PAL.gold).setVisible(true);
    } else {
      this.banner.setVisible(false);
    }
    if (sub === null) this.bannerSub.setVisible(false);
    else this.bannerSub.setText(sub).setVisible(true);
    this.strike.setVisible(state.falseStarts > 0 && !dq);
    this.drawCountPlate();
  }

  /** One dark plate behind whichever centre callouts show (countdown, banners, finish; R10). */
  private drawCountPlate(): void {
    // GO! is gold and reads without a plate, which would hide the starter firing behind it.
    const shown = [this.countdown, this.banner, this.bannerSub, this.finishTime, this.photoLabel].filter(
      (l) => l.visible && l.text !== '' && l.text !== 'GO!',
    );
    const sig = shown.map((l) => `${l.text}@${l.main.x},${l.main.y},${l.width}`).join('|');
    if (sig === this.lastPlateSig) return;
    this.lastPlateSig = sig;
    const g = this.countPlate;
    g.clear();
    if (shown.length === 0) {
      g.setVisible(false);
      return;
    }
    const x0 = Math.min(...shown.map((l) => l.main.x));
    const y0 = Math.min(...shown.map((l) => l.main.y));
    const x1 = Math.max(...shown.map((l) => l.main.x + l.width));
    const y1 = Math.max(...shown.map((l) => l.main.y + l.height));
    plate(g, x0, y0, x1 - x0, y1 - y0);
    g.setVisible(true);
  }

  private drawKnockPlate(): void {
    const shown = [this.knockLabel, this.tripLabel].filter((l) => l.visible);
    const g = this.knockPlate;
    g.clear();
    if (shown.length === 0) {
      g.setVisible(false);
      return;
    }
    const x0 = Math.min(...shown.map((l) => l.main.x));
    const y0 = Math.min(...shown.map((l) => l.main.y));
    const x1 = Math.max(...shown.map((l) => l.main.x + l.width));
    const y1 = Math.max(...shown.map((l) => l.main.y + l.height));
    plate(g, x0, y0, x1 - x0, y1 - y0);
    g.setVisible(true);
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
    // The arrow icons already point the way, so the labels carry only the number (R11).
    const leaderText = leader ? gapLabel(leader.gapM) : null;
    const behindText = behind ? String(behind.count) : null;
    const sig = `${leader?.lane ?? '-'}|${behind?.rival ?? '-'}|${behindText ?? ''}`;
    if (sig !== this.lastOffSig) {
      this.lastOffSig = sig;
      const g = this.offMarks;
      g.clear();
      // Dark plates under the markers (R11): a kit-coloured arrow vanishes on same-coloured scenery.
      if (leaderText !== null) {
        const w = miniTextWidth(leaderText);
        const x0 = GAME_WIDTH - EDGE - 21 - w;
        plate(g, x0, OFF_Y, GAME_WIDTH - EDGE - x0, 8);
      }
      if (behindText !== null) plate(g, EDGE, OFF_Y, 10 + miniTextWidth(behindText), 8);
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

  private drawSegments(lit: number, draining = false): void {
    this.lastLit = lit;
    this.draining = draining;
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
        i <= lit ? speedSegmentColor(i, this.event, this.draining) : PAL.shadowDark,
      );
    }
    if (this.event === '400m') {
      // Sustain divider (R5): a full-height 1 px index 8 line in the gap after the sustain segments,
      // through the box edges, so steady pace has a visible mark.
      fillRect(g, SEG_DX + sustainDividerOffset(SEG_PITCH), 0, 1, 14, PAL.white);
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
