import Phaser from 'phaser';
import {
  attachKeyboard,
  newSeed,
  OPPONENTS,
  Race,
  type OpponentId,
  type RaceEvent,
  type RaceOutcome,
  type RaceState,
} from '../core/index.ts';
import { paletteColor, RaceView } from '../art/index.ts';
import { duckMusic, playMusic, playSfx, setCrowd } from '../audio/index.ts';
import { crowdIntensity, PAL } from '../ui/hudMath.ts';
import { applyCrt, getApp, onKeyDown, SceneKey, settings } from './app.ts';
import type { HudScene } from './HudScene.ts';
import type { ResultsData } from './ResultsScene.ts';

export interface RaceSceneData {
  readonly opponent: OpponentId;
}

const STEP_SFX_MIN_MS = 40;

/**
 * S3 + S4: pre-race walk, countdown and race (design 1.2). Owns the core Race, the art RaceView
 * (world camera), audio cues, pause and auto-pause. The HUD runs in HudScene on a fixed camera.
 */
export class RaceScene extends Phaser.Scene {
  private race!: Race;
  private view!: RaceView;
  private hud!: HudScene;
  private opponent: OpponentId = 'pip';
  private paused = false;
  private resultShown = false;
  private detachKeys: (() => void) | null = null;
  private lastStepSfx = -Infinity;
  private lastCrowd = -1;

  constructor() {
    super(SceneKey.Race);
  }

  create(data: RaceSceneData): void {
    const app = getApp();
    const s = settings();
    this.opponent = data.opponent;
    this.paused = false;
    this.resultShown = false;
    this.lastStepSfx = -Infinity;
    this.lastCrowd = -1;
    const tier = OPPONENTS[this.opponent].tier;
    const seed = app.pendingSeed ?? newSeed();
    app.pendingSeed = null;

    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.view = new RaceView(this, this.opponent, {
      reducedFlashing: s.reducedFlashing,
      // Reduced flashing also disables screen shake (design 6.5).
      screenShake: s.screenShake && !s.reducedFlashing,
    });
    this.race = new Race({ opponent: this.opponent, seed, startT: performance.now() });
    app.race = this.race;
    this.detachKeys = attachKeyboard(window, (e) => this.race.input(e));

    this.scene.launch(SceneKey.Hud, { opponent: this.opponent });
    this.hud = this.scene.get(SceneKey.Hud) as HudScene;

    playMusic(tier === 7 ? 'boss' : 'race', tier);
    duckMusic(false);

    // Esc pauses (Backspace is menus-only, design 8). Space/Enter do nothing during S4 (8.3).
    onKeyDown(this, (e) => {
      if (e.code === 'Escape' && !e.repeat) this.pauseRace();
    });

    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('blur', this.onBlur);
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.detachKeys?.();
      this.detachKeys = null;
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

  /** Esc, window blur or hidden tab during S3/S4 (design 8.4, 8.5). */
  pauseRace(): void {
    if (this.paused || this.resultShown || !this.sys.isActive()) return;
    const st = this.race.state;
    if (st.phase === 'finished') return;
    this.race.pause(performance.now());
    this.paused = true;
    setCrowd(0);
    this.scene.pause(SceneKey.Race);
    this.scene.pause(SceneKey.Hud);
    this.scene.launch(SceneKey.Pause, { opponent: this.opponent });
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
    this.hud.onFrame(state, events, this.view.rivalScreenX());
    this.playCues(events, now);
    if (state.phase !== 'intro') {
      const c = Math.round(crowdIntensity(Math.max(state.player.xM, state.rival.xM)) * 100) / 100;
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
            playSfx('beep_go');
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
        case 'quirk':
          if (ev.name === 'warpOut' || ev.name === 'warpIn') playSfx('warp');
          else if (ev.name === 'overheat') playSfx('overheat');
          else if (ev.name === 'flashbulb' && !s.reducedFlashing) playSfx('flashbulb');
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
    const record = app.records.record(outcome, new Date());
    if (record.unlocked) app.ladderCursor = record.unlocked;
    if (record.becameChampion) app.championPending = true;
    const data: ResultsData = { outcome, record };
    this.scene.launch(SceneKey.Results, data);
  }
}
