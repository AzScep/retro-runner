import type {
  CountdownBeat,
  OpponentId,
  RaceEvent,
  RaceOptions,
  RaceOutcome,
  RacePhase,
  RaceState,
  RunKeyEvent,
  RunnerAnim,
  RunnerEffect,
  RunnerState,
} from '../index.ts';
import { boundaryTick, DT_MS, SimClock, ticks } from '../clock/clock.ts';
import { opposite, StepFilter } from '../input/steps.ts';
import { planRival, RivalSim } from '../opponents/ai.ts';
import { mulberry32 } from '../rng/mulberry32.ts';
import { TUNING, WORLD } from '../roster.ts';
import { PlayerBody } from '../runner/player.ts';

const INTRO_TICKS = ticks(TUNING.INTRO_MS);
const BEAT_TICKS = ticks(TUNING.COUNT_STEP_MS);
const GO_TEXT_TICKS = ticks(TUNING.GO_TEXT_MS);
const BANNER_TICKS = ticks(TUNING.FALSE_START_BANNER_MS);
const RESULTS_TICKS = ticks(TUNING.RESULTS_DELAY_MS);
const DNF_TICKS = ticks(WORLD.DNF_MS);
/** Player shows the false start "jolt" (stumble frames) for the start of the banner. */
const JOLT_TICKS = ticks(250);
/** Off-screen opponent completion gives up after this much race time (never reached in practice). */
const OFFSCREEN_LIMIT_TICKS = ticks(120000);
/** After the finish, runners keep the run cycle until they slow below this, then celebrate/lose. */
const SETTLE_BELOW_MPS = 3;
/** Runners walk in from the left edge of the world to the start line during the intro. */
const WALK_FROM_M = -WORLD.START_X_PX / WORLD.PX_PER_M;
/** Tolerance for window edges: wall-to-sim subtraction must not turn an exactly-at-GO press into a false start. */
const EDGE_EPS_MS = 1e-6;

/**
 * One race (see index.ts for the contract).
 *
 * Time model: everything runs on integer ticks of 1/120 s counted from `startT`. An input with
 * timestamp t is applied at the first tick boundary at or after its sim time, before that tick is
 * integrated, so results depend only on timestamps, never on how frames chunk the advance() calls.
 * Order at each boundary: phase transitions, then queued inputs, then one integration step.
 */
export class Race {
  private readonly opponent: OpponentId;
  private readonly seed: number;
  private readonly clock: SimClock;
  private readonly countRng: () => number;
  private readonly filter = new StepFilter();
  private readonly player = new PlayerBody();
  private readonly rival: RivalSim;

  private tick = 0;
  private lastNow: number;
  private queue: RunKeyEvent[] = [];
  private pending: RaceEvent[] = [];

  private phase: RacePhase = 'intro';
  private phaseTick = 0;
  /** Start tick of the current countdown attempt ("3" appears). */
  private countTick = 0;
  /** GO tick of the current attempt; race ms 0. */
  private goTick = Number.POSITIVE_INFINITY;
  private falseStarts = 0;
  private resultTick: number | null = null;
  private outcome: RaceOutcome | null = null;
  private dq = false;
  private dnf = false;

  constructor(opts: RaceOptions) {
    this.opponent = opts.opponent;
    this.seed = opts.seed >>> 0;
    this.clock = new SimClock(opts.startT);
    this.lastNow = opts.startT;
    // Separate streams so the number of countdown attempts never changes the rival's draws.
    this.rival = new RivalSim(opts.opponent, planRival(opts.opponent, mulberry32(this.seed)));
    this.countRng = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
  }

  input(e: RunKeyEvent): void {
    if (this.clock.isFrozenAt(e.t)) {
      // Paused or in the GET SET freeze: never a step or a false start, only held tracking.
      this.trackHeld(e);
      return;
    }
    // Keep the queue sorted by timestamp (stable for equal t).
    let i = this.queue.length;
    while (i > 0 && (this.queue[i - 1]?.t ?? 0) > e.t) i--;
    this.queue.splice(i, 0, e);
  }

  advance(now: number): RaceEvent[] {
    const out = this.pending;
    this.pending = [];
    if (now > this.lastNow) this.lastNow = now;
    const target = this.clock.targetTick(this.lastNow, this.tick);
    while (this.tick < target) {
      this.boundary(out);
      this.integrate(out);
      this.tick += 1;
    }
    return out;
  }

  pause(now: number): void {
    if (this.clock.paused) return;
    // advance() hands over and clears `pending`; keep what it produced for the next advance().
    this.pending = this.advance(now);
    this.clock.pause(Math.max(now, this.lastNow));
    // Inputs stamped after the pause instant only update held state.
    for (const e of this.queue) this.trackHeld(e);
    this.queue = [];
  }

  resume(now: number): void {
    if (!this.clock.paused) return;
    this.clock.resume(now, TUNING.RESUME_FREEZE_MS);
    if (now > this.lastNow) this.lastNow = now;
  }

  get state(): RaceState {
    const alpha = this.clock.alpha(this.lastNow, this.tick);
    const running = this.tick >= this.goTick;
    const raceMs = running ? (this.tick - this.goTick) * DT_MS : 0;
    return {
      opponent: this.opponent,
      seed: this.seed,
      phase: this.phase,
      countdown: this.beat(),
      raceMs,
      falseStarts: this.falseStarts,
      paused: this.clock.paused,
      getSet: this.clock.inFreeze(this.lastNow),
      timerMs: this.timerMs(alpha),
      expectedSide: this.filter.lastSide === null ? null : opposite(this.filter.lastSide),
      idleMs: this.idleMs(),
      player: this.playerState(alpha),
      rival: this.rivalState(alpha),
      outcome: this.outcome,
    };
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  private boundary(out: RaceEvent[]): void {
    const k = this.tick;
    switch (this.phase) {
      case 'intro':
        if (k >= INTRO_TICKS) {
          out.push({ type: 'introDone' });
          this.startCountdown(out);
        }
        break;
      case 'countdown':
        if (k >= this.goTick) {
          this.phase = 'running';
          this.phaseTick = k;
          out.push({ type: 'beat', beat: 'go' });
        } else if (k === this.countTick + BEAT_TICKS) {
          out.push({ type: 'beat', beat: 2 });
        } else if (k === this.countTick + 2 * BEAT_TICKS) {
          out.push({ type: 'beat', beat: 1 });
        }
        break;
      case 'falseStart':
        if (k >= this.phaseTick + BANNER_TICKS) this.startCountdown(out);
        break;
      case 'running':
        if (k - this.goTick >= DNF_TICKS) this.finishDnf(out);
        break;
      case 'finished':
        break;
    }
    if (this.resultTick !== null && k >= this.resultTick && this.outcome !== null) {
      this.resultTick = null;
      out.push({ type: 'resultReady', outcome: this.outcome });
    }
    this.drainInputs(out);
  }

  private startCountdown(out: RaceEvent[]): void {
    this.phase = 'countdown';
    this.phaseTick = this.tick;
    this.countTick = this.tick;
    const one = TUNING.COUNT_STEP_MS + this.countRng() * TUNING.COUNT_ONE_JITTER_MS;
    this.goTick = this.tick + 2 * BEAT_TICKS + ticks(one);
    out.push({ type: 'beat', beat: 3 });
  }

  private drainInputs(out: RaceEvent[]): void {
    while (this.queue.length > 0) {
      const e = this.queue[0];
      if (e === undefined) break;
      const s = this.clock.simMs(e.t);
      // Late arrivals (boundary already passed) apply now; future ones wait.
      if (boundaryTick(s) > this.tick) break;
      this.queue.shift();
      if (e.kind === 'up') this.filter.release(e.side);
      else this.keyDown(e, s, out);
    }
  }

  private keyDown(e: RunKeyEvent, s: number, out: RaceEvent[]): void {
    // Director decision: auto-repeat never does anything in any phase (not a step, not a false start).
    if (e.repeat) return;
    const countStartMs = this.countTick * DT_MS - EDGE_EPS_MS;
    const goMs = this.goTick * DT_MS - EDGE_EPS_MS;
    const live =
      (this.phase === 'countdown' || this.phase === 'running') &&
      s >= countStartMs &&
      this.player.finishMs === null &&
      !this.dnf;
    if (!live) {
      this.filter.noteDown(e.side);
      return;
    }
    if (s < goMs) {
      // A fresh keydown in the window is a false start; a key held since before "3" is not.
      this.filter.noteDown(e.side);
      this.falseStart(out);
      return;
    }
    const verdict = this.filter.down(e.side, Math.max(0, s - this.goTick * DT_MS), e.repeat);
    if (verdict === 'step') {
      this.player.impulse();
      out.push({ type: 'step', side: e.side });
    } else if (verdict === 'fumble') {
      out.push({ type: 'fumble', side: e.side });
    }
  }

  private falseStart(out: RaceEvent[]): void {
    this.falseStarts += 1;
    // A false start detected at the GO boundary itself undoes GO.
    this.goTick = Number.POSITIVE_INFINITY;
    out.push({ type: 'falseStart', count: this.falseStarts });
    if (this.falseStarts >= TUNING.FALSE_STARTS_TO_DQ) {
      this.dq = true;
      this.phase = 'finished';
      this.phaseTick = this.tick;
      this.outcome = {
        opponent: this.opponent,
        result: 'dq',
        ms: null,
        oppMs: null,
        marginMs: null,
        photoFinish: false,
        falseStarts: this.falseStarts,
        seed: this.seed,
      };
      out.push({ type: 'disqualified' });
      out.push({ type: 'resultReady', outcome: this.outcome });
      return;
    }
    this.phase = 'falseStart';
    this.phaseTick = this.tick;
  }

  /** One fixed step of both bodies, from the current tick to the next. */
  private integrate(out: RaceEvent[]): void {
    if (this.tick < this.goTick || this.dq) return;
    const t0 = (this.tick - this.goTick) * DT_MS;
    const playerX = this.player.x;
    const crossed = this.player.step(t0, this.playerIdle(t0));
    this.rival.step(t0, playerX, out);
    if (crossed) this.finishPlayer(out);
  }

  private playerIdle(t0: number): number {
    return t0 - (this.filter.lastStepMs ?? 0);
  }

  private finishPlayer(out: RaceEvent[]): void {
    const ms = this.player.finishMs ?? 0;
    out.push({ type: 'playerFinish', ms });
    const oppMs = this.rival.finishMs ?? this.completeRivalOffscreen(this.tick + 1);
    const win = oppMs === null || ms <= oppMs;
    this.setOutcome(win ? 'win' : 'lose', ms, oppMs);
    this.resultTick = this.tick + 1 + RESULTS_TICKS;
  }

  private finishDnf(out: RaceEvent[]): void {
    this.dnf = true;
    this.player.finishable = false;
    out.push({ type: 'dnf' });
    const oppMs = this.rival.finishMs ?? this.completeRivalOffscreen(this.tick);
    this.setOutcome('dnf', null, oppMs);
    this.resultTick = this.tick;
  }

  private setOutcome(result: RaceOutcome['result'], ms: number | null, oppMs: number | null): void {
    this.phase = 'finished';
    this.phaseTick = this.tick;
    this.outcome = {
      opponent: this.opponent,
      result,
      ms,
      oppMs,
      marginMs: ms !== null && oppMs !== null ? ms - oppMs : null,
      photoFinish: ms !== null && ms === oppMs,
      falseStarts: this.falseStarts,
      seed: this.seed,
    };
  }

  /**
   * Design 1.4.3: run the rest of the race on copies to get the rival's exact time. Player input is
   * ignored from here on, so the copies evolve exactly like the live bodies will.
   */
  private completeRivalOffscreen(fromTick: number): number | null {
    const p = this.player.clone();
    const r = this.rival.clone();
    for (let k = fromTick; k - this.goTick < OFFSCREEN_LIMIT_TICKS && r.finishMs === null; k++) {
      const t0 = (k - this.goTick) * DT_MS;
      const px = p.x;
      p.step(t0, this.playerIdle(t0));
      r.step(t0, px, null);
    }
    return r.finishMs;
  }

  // -------------------------------------------------------------------------
  // View state
  // -------------------------------------------------------------------------

  private trackHeld(e: RunKeyEvent): void {
    if (e.kind === 'up') this.filter.release(e.side);
    else if (!e.repeat) this.filter.noteDown(e.side);
  }

  private beat(): CountdownBeat {
    if (this.phase === 'countdown') {
      const k = this.tick - this.countTick;
      return k < BEAT_TICKS ? 3 : k < 2 * BEAT_TICKS ? 2 : 1;
    }
    if (this.phase === 'running' && this.tick - this.goTick < GO_TEXT_TICKS) return 'go';
    return null;
  }

  private timerMs(alpha: number): number {
    if (this.player.finishMs !== null) return this.player.finishMs;
    if (this.dnf) return WORLD.DNF_MS;
    if (this.tick < this.goTick || this.dq) return 0;
    return Math.max(0, (this.tick - 1 + alpha - this.goTick) * DT_MS);
  }

  private idleMs(): number {
    if (this.phase !== 'running') return 0;
    return Math.max(0, this.playerIdle((this.tick - this.goTick) * DT_MS));
  }

  /** Shared anims before GO. */
  private preRaceAnim(isPlayer: boolean): RunnerAnim | null {
    switch (this.phase) {
      case 'intro':
        return 'walk';
      case 'countdown':
        return this.beat() === 1 ? 'ready2' : 'ready1';
      case 'falseStart':
        return isPlayer && this.tick - this.phaseTick < JOLT_TICKS ? 'stumble' : 'ready1';
      default:
        if (this.dq) return isPlayer ? 'lose' : 'idle';
        return null;
    }
  }

  private walkX(alpha: number): number {
    const f = Math.min(1, Math.max(0, (this.tick - 1 + alpha) / INTRO_TICKS));
    return WALK_FROM_M * (1 - f);
  }

  private moving(x: number, v: number, crossed: boolean, settled: RunnerAnim): RunnerAnim {
    if (x >= TUNING.LEAN_FROM_M && x < TUNING.LEAN_TO_M) return 'lean';
    if (crossed) return v < SETTLE_BELOW_MPS ? settled : 'run';
    return v < TUNING.READY_BELOW_MPS ? 'ready2' : 'run';
  }

  private playerState(alpha: number): RunnerState {
    const b = this.player;
    const pre = this.preRaceAnim(true);
    const xM = this.phase === 'intro' ? this.walkX(alpha) : b.xPrev + (b.x - b.xPrev) * alpha;
    let anim: RunnerAnim;
    if (pre !== null) anim = pre;
    else if (this.dnf) anim = 'lose';
    else {
      const won = this.outcome?.result === 'win';
      anim = this.moving(b.x, b.v, b.finishMs !== null, won ? 'celebrate' : 'lose');
    }
    return runner(xM, this.phase === 'intro' ? 0 : b.v, anim, 'none', true, b.finishMs);
  }

  private rivalState(alpha: number): RunnerState {
    const r = this.rival;
    const pre = this.preRaceAnim(false);
    const xM = this.phase === 'intro' ? this.walkX(alpha) : r.xPrev + (r.x - r.xPrev) * alpha;
    let anim: RunnerAnim;
    if (pre !== null) anim = pre;
    else if (r.tripping) anim = 'stumble';
    else {
      // Rival celebrates unless the player won; before the outcome exists the rival crossed first.
      const rivalLost = this.outcome?.result === 'win';
      anim = this.moving(r.x, r.v, r.finishMs !== null, rivalLost ? 'lose' : 'celebrate');
    }
    const effect: RunnerEffect = this.phase === 'running' || this.phase === 'finished' ? r.effect : 'none';
    return runner(xM, this.phase === 'intro' ? 0 : r.v, anim, effect, r.visible, r.finishMs);
  }
}

function runner(
  xM: number,
  vMps: number,
  anim: RunnerAnim,
  effect: RunnerEffect,
  visible: boolean,
  finishMs: number | null,
): RunnerState {
  return {
    xM,
    vMps,
    anim,
    runFps: Math.min(25, Math.max(6, 2 * vMps)),
    effect,
    visible,
    finishMs,
  };
}
