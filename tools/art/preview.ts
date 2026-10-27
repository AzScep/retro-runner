/**
 * Dev-only visual harness for the art layer: `npx vite` then open /tools/art/preview.html?opp=zyx.
 * Drives RaceView with a fake race state (no core simulation needed).
 * v2: &event=110mh jumps every hurdle (rival clean, player clips H3 and hits H6), &event=400m runs
 * the player tired with sweat after 250 m, rings the bell at 300 m and shows Sol's watch glance.
 * &vp / &vr set speeds, &t0 skips ahead in seconds.
 * v3: 6 lanes (player, the named rival, the tier's 4 field runners at slightly different paces) with
 * per-lane hurdles (60 in 110mh), the starter, judges and photo camera; &trip=1 trips Rio at 40 m.
 * window.__perf() returns { frames, p50, p99, max } of frame intervals (ms) since load.
 */
import Phaser from 'phaser';
import { EVENTS, fieldRunners, hurdlePositions, ladderEntry } from '../../src/core/index.ts';
import type {
  EventId,
  LaneRunner,
  OpponentId,
  RaceEvent,
  RaceState,
  RunnerAnim,
  RunnerState,
} from '../../src/core/index.ts';
import {
  createCharacterSprite,
  createFieldSprite,
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
  /** Field lanes 2-5: positions and speeds. */
  private f = [0, 1, 2, 3].map(() => ({ x: -2, v: 0 }));
  private lastStep = 0;
  private fired = new Set<string>();
  /** Takeoff time per lane (s), or null when grounded. */
  private air: (number | null)[] = [null, null, null, null, null, null];
  private knocked: boolean[][] = [[], [], [], [], [], []];
  private intervals: number[] = [];
  private tripT: number | undefined;
  private lastT = 0;

  create(): void {
    registerArt(this);
    this.warmShaders();
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
    (window as unknown as { __perf: () => unknown }).__perf = () => {
      const v = [...this.intervals].sort((a, b) => a - b);
      const q = (k: number) => v[Math.min(v.length - 1, Math.floor(k * v.length))] ?? 0;
      return { frames: v.length, p50: q(0.5), p99: q(0.99), max: v[v.length - 1] ?? 0 };
    };
  }

  /**
   * Like BootScene.warmShaders: one batch each of 1, 2 and 3 textures (main page, field page, a
   * canvas texture standing in for the font) under a cover on the first frame, so the frame-time
   * probe never measures a shader link the game has already done at boot.
   */
  private warmShaders(): void {
    const sep = () => this.add.graphics().fillStyle(0x0b0b14).fillRect(0, 0, 1, 1);
    const font = this.textures.createCanvas('preview.warm', 2, 2);
    const field = fieldRunners(1)[0]!;
    const objs: Phaser.GameObjects.GameObject[] = [
      this.add.image(0, 0, iconKey('trophy')).setOrigin(0),
      sep(),
      this.add.image(0, 0, iconKey('trophy')).setOrigin(0),
      createFieldSprite(this, field, 8, 8).setDepth(0),
      sep(),
      this.add.image(0, 0, iconKey('trophy')).setOrigin(0),
      createFieldSprite(this, field, 8, 8).setDepth(0),
      ...(font ? [this.add.image(0, 0, 'preview.warm').setOrigin(0)] : []),
      this.add.graphics().fillStyle(0x0b0b14).fillRect(0, 0, 320, 180),
    ];
    objs.forEach((o, i) => (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(1000 + i));
    this.game.events.once('postrender', () => {
      for (const o of objs) o.destroy();
    });
  }

  update(time: number, delta: number): void {
    if (!this.view) return;
    if (this.lastT) this.intervals.push(time - this.lastT);
    this.lastT = time;
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
    const fa: RunnerAnim[] = ['run', 'run', 'run', 'run'];
    if (this.t < 1.5) {
      pa = ra = 'walk';
      fa.fill('walk');
      this.p.x = this.r.x = -1.5 + this.t;
      for (const f of this.f) f.x = -1.5 + this.t;
    } else if (this.t < 2.5) {
      pa = ra = this.t < 2 ? 'ready1' : 'ready2';
      fa.fill(pa);
      if (this.t - dt < 1.5) events.push({ type: 'beat', beat: 3 });
      if (this.t >= 2 && this.t - dt < 2) events.push({ type: 'beat', beat: 1 });
    } else {
      if (this.t - dt < 2.5) events.push({ type: 'beat', beat: 'go' });
      this.p.v += (speedP - this.p.v) * dt;
      this.r.v += (speedR - this.r.v) * dt * 1.5;
      this.p.x += this.p.v * dt;
      this.r.x += this.r.v * dt;
      this.f.forEach((f, i) => {
        f.v += (speedR - 0.25 - i * 0.12 - f.v) * dt * 1.4;
        f.x += f.v * dt;
      });
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
    if (!params.get('noflash')) once('flash', this.r.x > 70, { type: 'quirk', name: 'flashbulb' });
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

    // Hurdles: take off 0.2 s before each hurdle (clean); the player is late at H3 and never jumps H6,
    // field lane 3 never jumps H4 (a HIT with the stumble frames).
    const airOf = (lane: number, x: number, v: number): { airM: number; airPhase: number | null } => {
      const t0 = this.air[lane] ?? null;
      if (t0 === null) {
        const next = HURDLES.findIndex((h) => h > x);
        const h = HURDLES[next];
        const late = lane === 0 && next === 2 ? 0.13 : 0;
        const skip = (lane === 0 && next === 5) || (lane === 3 && next === 3);
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
    const xs = [this.p.x, this.r.x, ...this.f.map((f) => f.x)];
    const vs = [this.p.v, this.r.v, ...this.f.map((f) => f.v)];
    const airs = xs.map((x, lane) => airOf(lane, x, vs[lane] as number));
    HURDLES.forEach((h, i) => {
      xs.forEach((x, lane) => {
        const a = airs[lane]!;
        const k = `h${lane}-${i}`;
        if (x >= h && !this.fired.has(k) && a.airM < 1) this.knocked[lane]![i] = true;
        once(k, x >= h, {
          type: a.airM >= 1 ? 'hurdleClear' : a.airM > 0 ? 'hurdleClip' : 'hurdleHit',
          lane,
          index: i,
        });
      });
    });
    const pAir = airs[0]!;
    const rAir = airs[1]!;
    if (pAir.airPhase !== null && pa === 'run') pa = 'hurdle';
    if (rAir.airPhase !== null && ra === 'run') ra = 'hurdle';
    fa.forEach((a, i) => {
      if (airs[i + 2]!.airPhase !== null && a === 'run') fa[i] = 'hurdle';
      const x = xs[i + 2]!;
      if (x >= DIST - 2 && x < DIST + 2) fa[i] = 'lean';
      else if (x > DIST + 12) fa[i] = i === 0 ? 'celebrate' : 'lose';
      if (x > DIST + 10) this.f[i]!.v = Math.max(0, this.f[i]!.v - 8 * dt);
    });
    // Trip (design 33.2): fall 0.25 s, lie 0.4 s, get up 0.25 s.
    if (params.get('trip') && this.p.x >= 40) {
      const k = this.tripT ?? (this.tripT = this.t);
      if (k === this.t) events.push({ type: 'trip' });
      const e = this.t - k;
      if (e < 0.25) pa = 'fall';
      else if (e < 0.65) pa = 'lie';
      else if (e < 0.9) pa = 'getup';
      if (e < 0.65) this.p.v = Math.max(0, this.p.v - 40 * dt);
    }
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
    const tier = ladderEntry(event, opp)?.tier ?? 1;
    const field = fieldRunners(tier);
    const player = runner(this.p.x, this.p.v, pa, { ...pAir, hurdlesKnocked: this.knocked[0]!, stamina });
    const rival = runner(this.r.x, this.r.v, ra, {
      effect: opp === 'sol' && this.r.x > 200 && this.r.x < 205 ? 'watch' : effect,
      visible,
      ...rAir,
      hurdlesKnocked: this.knocked[1]!,
    });
    const runners: LaneRunner[] = [
      { lane: 0, who: { kind: 'player', id: 'rio' }, name: 'RIO', state: player },
      { lane: 1, who: { kind: 'rival', id: opp }, name: opp.toUpperCase(), state: rival },
      ...field.map((info, i): LaneRunner => ({
        lane: i + 2,
        who: { kind: 'field', field: info },
        name: info.name,
        state: runner(xs[i + 2]!, vs[i + 2]!, fa[i]!, {
          ...airs[i + 2]!,
          hurdlesKnocked: this.knocked[i + 2]!,
        }),
      })),
    ];
    const state = {
      opponent: opp,
      seed: 1,
      phase: this.t < 1.5 ? 'intro' : this.t < 2.5 ? 'countdown' : 'running',
      countdown: null,
      raceMs: 0,
      falseStarts: 0,
      paused: false,
      expectedSide: null,
      idleMs: 0,
      event,
      player,
      rival,
      runners,
      outcome: null,
    } as unknown as RaceState;
    (window as unknown as { __art: unknown }).__art = { p: this.p, r: this.r, sx: this.view.rivalScreenX() };
    this.view.update(state, events);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: 320,
  height: 180,
  pixelArt: true,
  backgroundColor: '#0b0b14',
  scale: { mode: Phaser.Scale.NONE, zoom: Number(params.get('zoom') ?? 2) },
  scene: Preview,
});
(window as unknown as { __game: Phaser.Game }).__game = game;
