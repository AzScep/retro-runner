/**
 * Dev-only visual harness for the art layer: `npx vite` then open /tools/art/preview.html?opp=zyx.
 * Drives RaceView with a fake race state (no core simulation needed).
 * v2: &event=110mh jumps every hurdle (rival clean, player clips H3 and hits H6), &event=400m runs
 * the player tired with sweat after 250 m, rings the bell at 300 m and shows Sol's watch glance.
 * &vp / &vr set speeds, &t0 skips ahead in seconds.
 */
import Phaser from 'phaser';
import { EVENTS, hurdlePositions } from '../../src/core/index.ts';
import type {
  EventId,
  Lane,
  OpponentId,
  RaceEvent,
  RaceState,
  RunnerAnim,
  RunnerState,
} from '../../src/core/index.ts';
import {
  createCharacterSprite,
  createStadium,
  iconKey,
  portraitKey,
  RaceView,
  registerArt,
  setCrt,
} from '../../src/art/index.ts';

const params = new URLSearchParams(location.search);
const opp = (params.get('opp') ?? 'kofi') as OpponentId;
const mode = params.get('mode') ?? 'race';
const event = (params.get('event') ?? '100m') as EventId;
const DIST = EVENTS[event].distanceM;
const HURDLES = hurdlePositions(event);
const AIR_S = 0.4;
const PEAK_M = 1.3;

function runner(xM: number, vMps: number, anim: RunnerAnim, extra: Partial<RunnerState> = {}): RunnerState {
  return {
    xM,
    vMps,
    anim,
    runFps: Math.min(25, Math.max(6, 2 * vMps)),
    effect: 'none',
    visible: true,
    finishMs: null,
    airM: 0,
    airPhase: null,
    hurdlesKnocked: [],
    stamina: null,
    ...extra,
  };
}

class Preview extends Phaser.Scene {
  private view: RaceView | null = null;
  private t = 0;
  private p = { x: -2, v: 0 };
  private r = { x: -2, v: 0 };
  private lastStep = 0;
  private fired = new Set<string>();
  /** Takeoff time per lane (s), or null when grounded. */
  private air: Record<Lane, number | null> = { player: null, rival: null };
  private knocked: Record<Lane, boolean[]> = { player: [], rival: [] };

  create(): void {
    registerArt(this);
    if (params.get('crt')) setCrt(this.cameras.main, true);
    if (mode === 'menu') {
      const st = createStadium(this, Number(params.get('tier') ?? 3));
      st.scrollTo(0);
      const ids = ['rio', 'pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7', 'zyx'] as const;
      ids.forEach((id, i) => {
        createCharacterSprite(this, id, 24 + i * 38, 152);
        this.add
          .image(8 + i * 38, 112, portraitKey(id, 16))
          .setOrigin(0)
          .setDepth(100);
      });
      this.add.image(4, 4, portraitKey(opp, 48)).setOrigin(0).setDepth(100);
      this.add
        .image(56, 4, portraitKey(opp, 48, true))
        .setOrigin(0)
        .setDepth(100);
      this.add.image(110, 4, iconKey('trophy')).setOrigin(0).setDepth(100);
      return;
    }
    this.view = new RaceView(this, event, opp, { reducedFlashing: false, screenShake: true });
    (window as unknown as { __tick: (s: number) => void }).__tick = (sec: number) => {
      for (let i = 0; i < Math.round(sec * 60); i++) this.tick(1 / 60);
    };
  }

  update(_time: number, delta: number): void {
    if (!this.view) return;
    if (this.t === 0 && params.get('t0')) {
      const n = Math.round(Number(params.get('t0')) * 60);
      for (let i = 0; i < n; i++) this.tick(1 / 60);
    }
    this.tick(Math.min(0.1, delta / 1000));
  }

  private tick(dt: number): void {
    if (!this.view) return;
    this.t += dt;
    const events: RaceEvent[] = [];
    let pa: RunnerAnim = 'run';
    let ra: RunnerAnim = 'run';
    const speedP = Number(params.get('vp') ?? 10.5);
    const speedR = Number(params.get('vr') ?? 10.8);
    if (this.t < 1.5) {
      pa = ra = 'walk';
      this.p.x = this.r.x = -1.5 + this.t;
    } else if (this.t < 2.5) {
      pa = ra = this.t < 2 ? 'ready1' : 'ready2';
    } else {
      this.p.v += (speedP - this.p.v) * dt;
      this.r.v += (speedR - this.r.v) * dt * 1.5;
      this.p.x += this.p.v * dt;
      this.r.x += this.r.v * dt;
      if (this.t - this.lastStep > 0.09) {
        this.lastStep = this.t;
        events.push({ type: 'step', side: 'L' });
      }
    }
    const once = (k: string, cond: boolean, e: RaceEvent) => {
      if (cond && !this.fired.has(k)) {
        this.fired.add(k);
        events.push(e);
      }
    };
    once('flash', this.r.x > 70, { type: 'quirk', name: 'flashbulb' });
    once('warpOut', opp === 'zyx' && this.r.x > 30, { type: 'quirk', name: 'warpOut' });
    once('coast', opp === 'marco' && this.r.x > 30, { type: 'quirk', name: 'coast' });
    let visible = true;
    if (opp === 'zyx' && this.r.x > 30 && !this.fired.has('warpIn')) {
      visible = false;
      if (this.t > 0 && (this as unknown as { w?: number }).w === undefined)
        (this as unknown as { w?: number }).w = this.t;
      if (this.t - ((this as unknown as { w: number }).w ?? 0) > 0.25) {
        this.r.x += 5;
        once('warpIn', true, { type: 'quirk', name: 'warpIn' });
        visible = true;
      }
    }
    once('finish', this.p.x >= DIST, { type: 'playerFinish', ms: 11000 });
    if (this.p.x >= DIST + 2) pa = this.p.x > DIST + 12 ? 'celebrate' : 'run';
    else if (this.p.x >= DIST - 2) pa = 'lean';
    if (this.r.x >= DIST - 2 && this.r.x < DIST + 2) ra = 'lean';
    if (this.r.x > DIST + 12) ra = 'lose';
    if (this.p.x > DIST + 10) this.p.v = Math.max(0, this.p.v - 8 * dt);
    if (this.r.x > DIST + 10) this.r.v = Math.max(0, this.r.v - 8 * dt);

    // Hurdles: take off 0.2 s before each hurdle (clean); the player is late at H3 and never jumps H6.
    const airOf = (lane: Lane, x: number, v: number): { airM: number; airPhase: number | null } => {
      const t0 = this.air[lane];
      if (t0 === null) {
        const next = HURDLES.findIndex((h) => h > x);
        const h = HURDLES[next];
        const late = lane === 'player' && next === 2 ? 0.13 : 0;
        const skip = lane === 'player' && next === 5;
        if (h !== undefined && !skip && v > 1 && (h - x) / v <= 0.2 - late) {
          this.air[lane] = this.t;
          events.push({ type: 'jump', lane });
        }
        return { airM: 0, airPhase: null };
      }
      const s = (this.t - t0) / AIR_S;
      if (s >= 1) {
        this.air[lane] = null;
        events.push({ type: 'land', lane });
        return { airM: 0, airPhase: null };
      }
      return { airM: 4 * PEAK_M * s * (1 - s), airPhase: s };
    };
    const pAir = airOf('player', this.p.x, this.p.v);
    const rAir = airOf('rival', this.r.x, this.r.v);
    HURDLES.forEach((h, i) => {
      for (const [lane, x, a] of [
        ['player', this.p.x, pAir],
        ['rival', this.r.x, rAir],
      ] as const) {
        once(`h${lane}${i}`, x >= h, {
          type: a.airM >= 1 ? 'hurdleClear' : a.airM > 0 ? 'hurdleClip' : 'hurdleHit',
          lane,
          index: i,
        });
        if (x >= h && a.airM < 1) this.knocked[lane][i] = true;
      }
    });
    if (pAir.airPhase !== null && pa === 'run') pa = 'hurdle';
    if (rAir.airPhase !== null && ra === 'run') ra = 'hurdle';
    // 400 m: fatigue after 250 m, bell at 300 m, Sol glances at his watch at 200 m.
    let stamina: number | null = null;
    if (event === '400m') {
      stamina = Math.max(0, 1 - this.p.x / 330);
      if (stamina < 0.3 && pa === 'run') pa = 'tired';
      once('bell', this.p.x >= 300, { type: 'bell' });
    }
    let effect: RunnerState['effect'] = 'none';
    if (opp === 'unit7' && this.r.x > 50 && this.r.x < 85) effect = 'overclock';
    if (opp === 'unit7' && this.r.x >= 85 && this.r.x < 92) effect = 'overheat';
    if (opp === 'pip' && this.r.x > 80 && this.r.x < 88) effect = 'wave';
    if (opp === 'pip' && this.r.x > 45 && this.r.x < 50) ra = 'stumble';
    const state = {
      opponent: opp,
      seed: 1,
      phase: 'running',
      countdown: null,
      raceMs: 0,
      falseStarts: 0,
      paused: false,
      expectedSide: null,
      idleMs: 0,
      event,
      player: runner(this.p.x, this.p.v, pa, { ...pAir, hurdlesKnocked: this.knocked.player, stamina }),
      rival: runner(this.r.x, this.r.v, ra, {
        effect: opp === 'sol' && this.r.x > 200 && this.r.x < 205 ? 'watch' : effect,
        visible,
        ...rAir,
        hurdlesKnocked: this.knocked.rival,
      }),
      outcome: null,
    } as RaceState;
    (window as unknown as { __art: unknown }).__art = { p: this.p, r: this.r, sx: this.view.rivalScreenX() };
    this.view.update(state, events);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: 320,
  height: 180,
  pixelArt: true,
  backgroundColor: '#0b0b14',
  scale: { mode: Phaser.Scale.NONE, zoom: Number(params.get('zoom') ?? 2) },
  scene: Preview,
});
