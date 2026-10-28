import Phaser from 'phaser';
import { fieldRunners, meet, TUNING, type EventId } from '../core/index.ts';
import {
  createCharacterSprite,
  createFieldSprite,
  createLandingBeam,
  createStadium,
  LANE_FEET_Y,
  LANE_OBLIQUE_PX,
  laneDepth,
  paletteColor,
  type Stadium,
} from '../art/index.ts';
import { cutMusic, playMusic, playSfx, setCrowd } from '../audio/index.ts';
import { SpeechBubble } from '../ui/bubble.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { PAL } from '../ui/hudMath.ts';
import { MINI_LINE_HEIGHT } from '../ui/miniFont.ts';
import {
  bubbleAt,
  revealTimeline,
  skyStepAt,
  type RevealTimeline,
  type RevealVersion,
} from '../ui/reveal.ts';
import { championTitle } from '../ui/screenText.ts';
import { registerTapTarget } from '../ui/tapTargets.ts';
import { Label } from '../ui/text.ts';
import { addPanel, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, goTo, isTouch, onKeyDown, SceneKey, settings } from './app.ts';
import { CREDITS } from './ChampionScene.ts';

export interface RevealData {
  readonly event: EventId;
  readonly version: RevealVersion;
}

/** S9 layout of the fake champion card (ChampionScene). */
const VIEW = { x: 40, y: 72, w: 240, h: 72 } as const;
const SCROLL_PX_PER_S = 16;
/** Glitch bands (30.2 step 3): rows 40-140 in alternating 4-row bands, every other one 2 px right. */
const GLITCH = { top: 40, bottom: 140, band: 4, shift: 2 } as const;
/** Runners stand on the start line: Rio at the race camera's x 96, each lane +10 px (26.2). */
const START_X = 96;
const ZYX_HEAD = 46;
/** Final card in the sky, above the squad's heads (lane 5 heads reach up to y ~64). */
const FINAL = { x: 48, y: 6, w: 224, h: 58 } as const;
const BOSS_DELAY_MS = 1500;
/** The drones' shared landing pose (ART: field frame 'hurdle3'). */
const LANDING_FRAME = 'hurdle3';

function laneX(lane: number): number {
  return START_X + LANE_OBLIQUE_PX * lane;
}

function feetY(lane: number): number {
  return LANE_FEET_Y[lane] ?? 157;
}

/**
 * S12 The Zyx reveal (design 30): the fake champion card (full version), the interruption, the cut to
 * the tier 6 stadium, the sky stepping to tier 7, four drones beamed in, Zyx warping in with his
 * bubbles, then the final card. Enter, Space, Esc or a tap skips to the final card (after 1.0 s in
 * the full version, at once in the short one). The event is marked revealed when the final card
 * appears or on skip, then any input continues to the ladder, which grows its tier 7 node.
 */
export class RevealScene extends Phaser.Scene {
  private event: EventId = '100m';
  private tl!: RevealTimeline;
  private reduced = false;
  private t0 = 0;
  private card: { destroy(): void }[] = [];
  private credits: { label: Label; y0: number }[] = [];
  private creditsFrozenAt: number | null = null;
  private waitLabel: Label | null = null;
  private somethingLabel: Label | null = null;
  private glitchCams: Phaser.Cameras.Scene2D.Camera[] = [];
  private stadium6: Stadium | null = null;
  private stadium6Objs: Phaser.GameObjects.GameObject[] = [];
  private stadium7: Stadium | null = null;
  private skyCam: Phaser.Cameras.Scene2D.Camera | null = null;
  private skyStep = -1;
  private drones = new Map<number, Phaser.GameObjects.Sprite>();
  private beams: { beam: Phaser.GameObjects.Sprite; until: number }[] = [];
  private zyx: Phaser.GameObjects.Sprite | null = null;
  private bubble!: SpeechBubble;
  private fired = new Set<string>();
  private finalShown = false;
  private leaving = false;

  constructor() {
    super(SceneKey.Reveal);
  }

  create(data: RevealData): void {
    this.event = data.event;
    this.tl = revealTimeline(data.version, TUNING.REVEAL_SKIP_AFTER_MS);
    this.reduced = settings().reducedFlashing;
    this.card = [];
    this.credits = [];
    this.creditsFrozenAt = null;
    this.waitLabel = null;
    this.somethingLabel = null;
    this.glitchCams = [];
    this.stadium6 = null;
    this.stadium7 = null;
    this.skyCam = null;
    this.skyStep = -1;
    this.drones = new Map();
    this.beams = [];
    this.zyx = null;
    this.fired = new Set();
    this.finalShown = false;
    this.leaving = false;
    getApp().event = data.event;
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.bubble = new SpeechBubble(this, UI_DEPTH + 5);

    // The tier 6 stadium sits under the fake card and stays for the cut (step 6).
    const before = new Set(this.children.list);
    this.stadium6 = createStadium(this, 6, this.event);
    this.stadium6.scrollTo(0);
    this.stadium6Objs = this.children.list.filter((o) => !before.has(o));
    if (this.tl.card) this.buildFakeCard();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stadium6?.destroy();
      this.stadium7?.destroy();
      this.stadium6 = null;
      this.stadium7 = null;
      this.bubble.destroy();
      setCrowd(0);
    });

    this.t0 = this.game.loop.time;
    if (this.tl.card) playMusic('champion');

    const onInput = (): void => {
      if (this.finalShown) this.continueToLadder();
      else if (this.elapsed() >= this.tl.skipAfter) this.toFinal();
    };
    onKeyDown(this, (e) => {
      if (e.repeat) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space' || e.code === 'Escape')
        onInput();
    });
    registerTapTarget(this, { x: 0, y: 0, w: 320, h: 180 }, onInput);
  }

  /** Seconds since CONTINUE (full) or the cut (short). */
  private elapsed(): number {
    return (this.game.loop.time - this.t0) / 1000;
  }

  /** Steps 1-2: S9 layout titled `<EVENT> CHAMPION`, Rio celebrating, `SIX RIVALS BEATEN`. */
  private buildFakeCard(): void {
    const rio = createCharacterSprite(this, 'rio', 18, 176).setDepth(50).play('rio.celebrate');
    const title = new Label(this, 160, 16, championTitle(this.event), {
      scale: 2,
      color: PAL.gold,
      outline: true,
      align: 'center',
    });
    const beaten = new Label(this, 160, 48, 'SIX RIVALS BEATEN', { align: 'center', outline: true });
    const panel = addPanel(this, VIEW.x - 4, VIEW.y - 4, VIEW.w + 8, VIEW.h + 8);
    this.card.push(rio, title, beaten, panel);
    // The fake ending must not spoil a seventh rival.
    const credits = CREDITS.map((line) => line.replace('SEVEN RIVALS', 'SIX RIVALS'));
    credits.forEach((text, i) => {
      const y0 = VIEW.y + VIEW.h + i * (MINI_LINE_HEIGHT + 4);
      const label = new Label(this, 160, y0, text, {
        font: FONT_MINI,
        align: 'center',
        color: i === 0 ? PAL.gold : PAL.white,
        depth: UI_DEPTH + 1,
      });
      label.setVisible(false);
      this.credits.push({ label, y0 });
      this.card.push(label);
    });
  }

  private once(key: string, at: number, t: number, fn: () => void): void {
    if (t >= at && !this.fired.has(key)) {
      this.fired.add(key);
      fn();
    }
  }

  update(time: number): void {
    if (this.leaving) return;
    const t = (time - this.t0) / 1000;
    if (!this.finalShown) this.step(t);
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      if (b && t >= b.until) {
        b.beam.destroy();
        this.beams.splice(i, 1);
      }
    }
  }

  private step(t: number): void {
    const tl = this.tl;
    const c = tl.card;
    if (c) {
      this.scrollCredits(t, c.creditsAt);
      this.once('interrupt', c.interruptAt, t, () => {
        // Step 3: music stops dead, credits freeze, one band glitch (none with reduced flashing).
        this.creditsFrozenAt = c.interruptAt;
        cutMusic();
        playSfx('reveal_sting_1');
        if (!this.reduced) this.startGlitch();
      });
      this.once('glitchEnd', c.interruptAt + c.glitchDur, t, () => this.endGlitch());
      this.once('wait', c.waitAt, t, () => {
        for (const cr of this.credits) cr.label.setVisible(false);
        this.waitLabel = new Label(this, 160, VIEW.y + 16, 'WAIT.', {
          scale: 2,
          align: 'center',
          depth: UI_DEPTH + 2,
        });
      });
      this.once('something', c.somethingAt, t, () => {
        this.somethingLabel = new Label(this, 160, VIEW.y + 44, 'SOMETHING IS ON THE TRACK.', {
          align: 'center',
          depth: UI_DEPTH + 2,
        });
      });
    }
    this.once('cut', tl.cutAt, t, () => this.cut());
    if (t >= tl.cutAt) {
      this.setSky(skyStepAt(tl, t, this.reduced));
      const hush = Math.min(1, (t - tl.cutAt) / tl.hushDur);
      setCrowd(Math.round(0.35 * (1 - hush) * 100) / 100);
    }
    for (const d of tl.drones) {
      this.once(`beam${d.lane}`, d.at, t, () => this.beam(d.lane, d.at));
      this.once(`drone${d.lane}`, d.at + tl.beamLead, t, () => this.landDrone(d.lane, true));
    }
    this.once('zyx', tl.zyxAt, t, () => this.warpZyx(true));
    if (this.zyx) {
      const p = Math.min(1, (t - tl.zyxAt) / tl.warpDur);
      // Warp-in: the sprite appears top-down in 3 whole steps (no flashing).
      const shown = Math.min(48, Math.ceil((Math.floor(p * 3) / 3) * 48));
      this.zyx.setVisible(shown > 0).setCrop(0, 0, 48, p >= 1 ? 48 : Math.max(1, shown));
    }
    const b = bubbleAt(tl, t);
    if (b) this.bubble.show(b.text, laneX(1), feetY(1) - ZYX_HEAD);
    else this.bubble.hide();
    if (t >= tl.finalAt) this.toFinal();
  }

  private scrollCredits(t: number, from: number): void {
    if (this.waitLabel) return;
    const tt = this.creditsFrozenAt ?? t;
    const offset = Math.max(0, Math.floor((tt - from) * SCROLL_PX_PER_S));
    for (const { label, y0 } of this.credits) {
      const y = y0 - offset;
      label.setPosition(160, y);
      label.setVisible(y >= VIEW.y && y + MINI_LINE_HEIGHT <= VIEW.y + VIEW.h);
    }
  }

  /** One extra camera per shifted band draws the same scene 2 px to the right for 0.4 s. */
  private startGlitch(): void {
    const { top, bottom, band, shift } = GLITCH;
    for (let y = top + band; y < bottom; y += band * 2) {
      const cam = this.cameras.add(0, y, 320, band);
      cam.setScroll(-shift, y);
      cam.setBackgroundColor(paletteColor(PAL.ink));
      this.glitchCams.push(cam);
    }
  }

  private endGlitch(): void {
    for (const cam of this.glitchCams) this.cameras.remove(cam);
    this.glitchCams = [];
  }

  /** Step 6: cut to the tier 6 stadium at the start line, Rio in lane 0. */
  private cut(): void {
    this.endGlitch();
    for (const o of this.card) o.destroy();
    this.card = [];
    this.credits = [];
    this.waitLabel?.destroy();
    this.somethingLabel?.destroy();
    this.waitLabel = null;
    this.somethingLabel = null;
    // The short version starts here, so the race music stops dead at the cut.
    if (this.tl.version === 'short') cutMusic();
    setCrowd(0.35);
    createCharacterSprite(this, 'rio', laneX(0), feetY(0)).setDepth(laneDepth(0).runner);
    // The tier 7 stadium is drawn by a second camera whose viewport grows top-down (the sky steps).
    const before = new Set(this.children.list);
    this.stadium7 = createStadium(this, 7, this.event);
    this.stadium7.scrollTo(0);
    this.cameras.main.ignore(this.children.list.filter((o) => !before.has(o)));
    // Runners, beams and UI draw in both cameras; only the tier 6 stadium is hidden from the sky one.
    const sky = this.cameras.add(0, 0, 320, 0);
    sky.ignore(this.stadium6Objs);
    this.skyCam = sky;
    this.skyStep = -1;
  }

  private setSky(step: number): void {
    if (!this.skyCam || step === this.skyStep) return;
    this.skyStep = step;
    this.skyCam.setViewport(0, 0, 320, Math.round((180 * step) / this.tl.skySteps));
  }

  private beam(lane: number, at: number): void {
    const b = createLandingBeam(this, laneX(lane), feetY(lane), {
      reducedFlashing: this.reduced,
    }).setDepth(laneDepth(lane).fx);
    this.beams.push({ beam: b, until: at + this.tl.beamLead + this.tl.beamHold });
  }

  private landDrone(lane: number, sound: boolean): void {
    if (this.drones.has(lane)) return;
    const field = fieldRunners(7)[lane - 2];
    if (!field) return;
    // Every drone lands in the same still pose, perfectly in sync (30.2 step 7).
    const s = createFieldSprite(this, field, laneX(lane), feetY(lane))
      .setDepth(laneDepth(lane).runner)
      .setFrame(LANDING_FRAME);
    this.drones.set(lane, s);
    if (sound) playSfx('land');
  }

  private warpZyx(sound: boolean): void {
    if (this.zyx) return;
    this.zyx = createCharacterSprite(this, 'zyx', laneX(1), feetY(1)).setDepth(laneDepth(1).runner);
    if (sound) playSfx('warp');
  }

  /** Step 9 (also the skip target): everything in place, the final card, the event revealed. */
  private toFinal(): void {
    if (this.finalShown) return;
    this.finalShown = true;
    if (!this.fired.has('cut')) {
      this.fired.add('cut');
      this.cut();
    }
    this.setSky(this.tl.skySteps);
    setCrowd(0);
    for (const b of this.beams) b.beam.destroy();
    this.beams = [];
    for (const d of this.tl.drones) this.landDrone(d.lane, false);
    this.warpZyx(false);
    this.zyx?.setCrop();
    this.bubble.hide();

    const depth = UI_DEPTH + 10;
    addPanel(this, FINAL.x, FINAL.y, FINAL.w, FINAL.h, depth);
    new Label(this, 160, FINAL.y + 6, meet(7).name, {
      scale: 2,
      color: PAL.tealGlow,
      align: 'center',
      depth: depth + 1,
    });
    new Label(this, 160, FINAL.y + 24, 'ZYX UNLOCKED!', {
      color: PAL.gold,
      align: 'center',
      depth: depth + 1,
    });
    // The reveal also opens this event's Gauntlet (isGauntletUnlocked = isRevealed, design 32.5).
    new Label(this, 160, FINAL.y + 35, 'GAUNTLET MODE OPEN', {
      font: FONT_MINI,
      color: PAL.gold,
      align: 'center',
      depth: depth + 1,
    });
    new Label(this, 160, FINAL.y + 46, isTouch() ? 'TAP' : 'PRESS ENTER', {
      font: FONT_MINI,
      color: PAL.lightGrey,
      align: 'center',
      depth: depth + 1,
    });
    cutMusic();
    playSfx('reveal_sting_2');
    this.time.delayedCall(BOSS_DELAY_MS, () => {
      if (!this.leaving) playMusic('boss');
    });
    getApp().records.markRevealed(this.event);
  }

  /** Step 10: the event's ladder, which grows its tier 7 node and moves the cursor to Zyx. */
  private continueToLadder(): void {
    if (this.leaving) return;
    this.leaving = true;
    const app = getApp();
    app.revealDone = this.event;
    app.event = this.event;
    goTo(this, SceneKey.Ladder);
  }
}
