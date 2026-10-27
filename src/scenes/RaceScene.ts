import Phaser from 'phaser';
import {
  newSeed,
  Race,
  raceFeed,
  raceInput,
  TUNING,
  type EventId,
  type OpponentId,
  type RaceEvent,
  type RaceMode,
  type RaceOutcome,
  type RaceState,
} from '../core/index.ts';
import { paletteColor, RaceView } from '../art/index.ts';
import { duckMusic, playMusic, playSfx, setCrowd, setQuarterFinal } from '../audio/index.ts';
import { gauntletAfterRace } from '../ui/gauntlet.ts';
import { crowdIntensity, PAL } from '../ui/hudMath.ts';
import { applyCrt, getApp, goTo, onKeyDown, raceMusic, SceneKey, settings, tierOf } from './app.ts';
import type { GauntletData } from './GauntletScene.ts';
import type { HudScene } from './HudScene.ts';
import type { ResultsData } from './ResultsScene.ts';

export interface RaceSceneData {
  readonly event: EventId;
  readonly opponent: OpponentId;
  /** 'g' runs the race as part of App.gauntlet (design 32); default ladder. */
  readonly mode?: RaceMode;
}

const STEP_SFX_MIN_MS = 40;
/** Rival takeoffs and knocks play at half volume (design 20.1). */
const RIVAL_VOLUME = 0.5;
/** Field runners' hurdle knocks: a quarter volume, rate-limited by audio (design 36.1). */
const FIELD_SFX = { volume: 0.25, field: true } as const;
/** `photo_click` for the first 3 finish crossings (31.3). */
const PHOTO_CLICKS = 3;

/**
 * S3 + S4: pre-race walk, countdown and race (design 1.2). Owns the core Race, the art RaceView
 * (world camera), audio cues, pause and auto-pause. The HUD runs in HudScene on a fixed camera.
 *
 * Input: main.ts attaches the keyboard adapter to core's raceInput hub once, the touch layer emits
 * into the same hub, and this scene feeds the hub into Race.input while it runs. Every frame the state and events go out on
 * raceFeed (touch pads, haptics); publish(null, []) on shutdown says no race is on screen.
 */
export class RaceScene extends Phaser.Scene {
  private race!: Race;
  private view!: RaceView;
  private hud!: HudScene;
  private event: EventId = '100m';
  private opponent: OpponentId = 'pip';
  private paused = false;
  private resultShown = false;
  private detach: (() => void)[] = [];
  private lastStepSfx = -Infinity;
  private lastCrowd = -1;
  private mode: RaceMode = 'l';
  private crossings = 0;

  constructor() {
    super(SceneKey.Race);
  }

  create(data: RaceSceneData): void {
    const app = getApp();
    const s = settings();
    this.event = data.event;
    this.opponent = data.opponent;
    this.mode = data.mode === 'g' && app.gauntlet !== null ? 'g' : 'l';
    if (this.mode === 'l') app.gauntlet = null;
    app.event = data.event;
    this.paused = false;
    this.resultShown = false;
    this.lastStepSfx = -Infinity;
    this.lastCrowd = -1;
    this.crossings = 0;
    const seed = app.pendingSeed ?? newSeed();
    app.pendingSeed = null;
    // First race of the event (no history) shows the pre-race tip (design 18.5).
    const firstRace = app.records.data.events[this.event].history.length === 0;
    // Meet card (31.1): the long card on the first race of a tier in a session, short on retries.
    const tier = tierOf(this.event, this.opponent);
    const meetKey = `${this.event}:${tier}`;
    const meetMs = app.meetsSeen.has(meetKey) ? TUNING.MEET_CARD_SHOW_RETRY_MS : TUNING.MEET_CARD_SHOW_MS;
    app.meetsSeen.add(meetKey);

    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.view = new RaceView(this, this.event, this.opponent, {
      reducedFlashing: s.reducedFlashing,
      // Reduced flashing also disables screen shake (design 6.5).
      screenShake: s.screenShake && !s.reducedFlashing,
    });
    this.race = new Race({
      event: this.event,
      opponent: this.opponent,
      seed,
      startT: performance.now(),
      mode: this.mode,
      ...(app.tripOverride !== null ? { trip: app.tripOverride } : {}),
    });
    app.race = this.race;
    // main.ts attaches the keyboard to raceInput once at app start; touch emits into the same hub.
    this.detach = [raceInput.subscribe((e) => this.race.input(e))];

    this.scene.launch(SceneKey.Hud, {
      event: this.event,
      opponent: this.opponent,
      firstRace,
      meetMs,
      gauntlet: this.mode === 'g' ? app.gauntlet : null,
    });
    this.hud = this.scene.get(SceneKey.Hud) as HudScene;

    // Gauntlet (32.4): one `gauntlet` track runs on through tiers 1-6 (repeat calls do not restart
    // it); audio crossfades tier 7 to the boss track.
    const music = raceMusic(this.event, this.opponent);
    if (this.mode === 'g') playMusic('gauntlet', tier);
    else playMusic(music.id, music.tier);
    // A retry keeps the quarter track playing, so the final-100 layer must be reset every start.
    if (this.event === '400m') setQuarterFinal(false);
    duckMusic(false);

    // Esc pauses (Backspace is menus-only, design 8); the touch pause button dispatches a synthetic
    // Escape. Space/Enter do nothing during S4 (8.3).
    onKeyDown(this, (e) => {
      if ((e.code === 'Escape' || e.key === 'Escape') && !e.repeat) this.pauseRace();
    });

    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('blur', this.onBlur);
      document.removeEventListener('visibilitychange', this.onVisibility);
      for (const off of this.detach) off();
      this.detach = [];
      raceFeed.publish(null, []);
      this.view.destroy();
      if (getApp().race === this.race) getApp().race = null;
      setCrowd(0);
      duckMusic(false);
    });
  }

  private readonly onBlur = (): void => this.pauseRace();
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.pauseRace();
  };

  get raceState(): RaceState {
    return this.race.state;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get raceEvent(): EventId {
    return this.event;
  }

  get raceMode(): RaceMode {
    return this.mode;
  }

  /** Esc, the touch pause button, window blur or hidden tab during S3/S4 (design 8.4, 8.5). */
  pauseRace(): void {
    if (this.paused || this.resultShown || !this.sys.isActive()) return;
    const st = this.race.state;
    if (st.phase === 'finished') return;
    this.race.pause(performance.now());
    this.paused = true;
    // Pads and haptics see the paused state while the simulation is frozen.
    raceFeed.publish(this.race.state, []);
    setCrowd(0);
    this.scene.pause(SceneKey.Race);
    this.scene.pause(SceneKey.Hud);
    this.scene.launch(SceneKey.Pause, { event: this.event, opponent: this.opponent, mode: this.mode });
  }

  /** Called by PauseScene: RESUME (or Esc). */
  resumeRace(): void {
    if (!this.paused) return;
    this.race.resume(performance.now());
    this.paused = false;
    this.lastCrowd = -1;
    this.scene.stop(SceneKey.Pause);
    this.scene.resume(SceneKey.Hud);
    this.scene.resume(SceneKey.Race);
  }

  update(): void {
    if (this.paused) return;
    const now = performance.now();
    const events = this.race.advance(now);
    const state = this.race.state;
    this.view.update(state, events);
    this.hud.onFrame(state, events, this.view);
    raceFeed.publish(state, events);
    this.playCues(events, now);
    if (state.phase !== 'intro') {
      const lead = Math.max(...state.runners.map((r) => r.state.xM));
      const c = Math.round(crowdIntensity(lead, this.event) * 100) / 100;
      if (c !== this.lastCrowd) {
        this.lastCrowd = c;
        setCrowd(c);
      }
    }
    for (const ev of events) if (ev.type === 'resultReady') this.showResults(ev.outcome);
  }

  private playCues(events: readonly RaceEvent[], now: number): void {
    const s = settings();
    const hadFalseStart = events.some((e) => e.type === 'falseStart');
    for (const ev of events) {
      switch (ev.type) {
        case 'introDone':
          duckMusic(true); // Music ducks during the countdown (design 7.1).
          break;
        case 'beat':
          if (ev.beat === 'go') {
            // The starter's pistol layers over the GO beep (36.1).
            playSfx('beep_go');
            playSfx('pistol');
            duckMusic(false);
          } else {
            playSfx('beep_count');
          }
          break;
        case 'step':
          if (now - this.lastStepSfx >= STEP_SFX_MIN_MS) {
            this.lastStepSfx = now;
            playSfx(ev.side === 'L' ? 'step_l' : 'step_r');
          }
          break;
        case 'fumble':
          playSfx('fumble');
          break;
        case 'falseStart':
          playSfx('false_start');
          break;
        case 'disqualified':
          if (!hadFalseStart) playSfx('false_start');
          break;
        case 'playerFinish':
          playSfx('finish');
          break;
        case 'runnerFinish':
          if (this.crossings < PHOTO_CLICKS) playSfx('photo_click');
          this.crossings++;
          break;
        case 'trip':
          playSfx('trip_thud');
          break;
        case 'quirk':
          if (ev.name === 'warpOut' || ev.name === 'warpIn') playSfx('warp');
          else if (ev.name === 'overheat') playSfx('overheat');
          else if (ev.name === 'flashbulb' && !s.reducedFlashing) playSfx('flashbulb');
          break;
        // v2 (design 20.1).
        // Field runners have no step or jump SFX (36.1).
        case 'jump':
          if (ev.lane === 0) playSfx('jump');
          else if (ev.lane === 1) playSfx('jump', { volume: RIVAL_VOLUME });
          break;
        case 'land':
          if (ev.lane === 0) playSfx('land');
          break;
        case 'hurdleClip':
        case 'hurdleHit': {
          const id = ev.type === 'hurdleClip' ? 'hurdle_clip' : 'hurdle_hit';
          playSfx(id, ev.lane === 0 ? {} : ev.lane === 1 ? { volume: RIVAL_VOLUME } : FIELD_SFX);
          break;
        }
        case 'split':
          playSfx('split');
          break;
        case 'bell':
          // The quarter track crossfades to its final-100 render at 300 m (design 20.2).
          playSfx('bell');
          setQuarterFinal(true);
          break;
        case 'staminaLow':
          playSfx('stamina_low');
          break;
        case 'staminaEmpty':
          playSfx('stamina_empty');
          break;
        default:
          break;
      }
    }
  }

  private showResults(outcome: RaceOutcome): void {
    if (this.resultShown) return;
    this.resultShown = true;
    const app = getApp();
    const at = new Date();
    const record = app.records.record(outcome, at);
    if (record.unlocked) app.ladderCursor[outcome.event] = record.unlocked;
    if (record.becameChampion) app.championPending = outcome.event;
    const run = app.gauntlet;
    if (this.mode === 'g' && run !== null) {
      // Gauntlet (32.2): S11 cards replace the results card; a run end is saved at once (34.4.5).
      const step = gauntletAfterRace(run, outcome);
      app.gauntlet = step.kind === 'between' ? step.run : null;
      const end =
        step.kind === 'between'
          ? null
          : app.records.recordGauntletEnd(
              outcome.event,
              { cleared: step.kind === 'clear', furthest: step.run.times.length, times: step.run.times },
              at,
            );
      const data: GauntletData = {
        kind: step.kind,
        event: outcome.event,
        run: step.run,
        outcome,
        end,
        overRace: true,
      };
      this.scene.launch(SceneKey.Gauntlet, data);
      return;
    }
    const data: ResultsData = { outcome, record };
    this.scene.launch(SceneKey.Results, data);
  }

  /** PauseScene: ABANDON RUN ends the Gauntlet as a loss at the current tier (32.4). */
  abandonRun(): void {
    const app = getApp();
    const run = app.gauntlet;
    if (this.mode !== 'g' || run === null) return;
    app.gauntlet = null;
    const end = app.records.recordGauntletEnd(
      this.event,
      { cleared: false, furthest: run.times.length, times: run.times },
      new Date(),
    );
    const data: GauntletData = { kind: 'over', event: this.event, run, outcome: null, end, overRace: false };
    goTo(this, SceneKey.Gauntlet, data);
  }
}
