import type {
  CountdownBeat,
  EventId,
  FieldRunnerInfo,
  JumpEvent,
  LaneCharacter,
  LaneRunner,
  OpponentId,
  RaceEvent,
  RaceInput,
  RaceMode,
  RaceOptions,
  RaceOutcome,
  RacePhase,
  RaceState,
  RunKeyEvent,
  RunnerAnim,
  RunnerEffect,
  RunnerState,
  Standing,
} from '../index.ts';
import { isJump } from '../bus/bus.ts';
import { boundaryTick, DT_MS, SimClock, ticks } from '../clock/clock.ts';
import { EVENT_COURSE, EVENTS, type EventCourse } from '../events.ts';
import { FIELD_SIZE, fieldSpecAndPlan, planField } from '../field/field.ts';
import { Held, opposite, StepFilter } from '../input/steps.ts';
import { planRival, RivalSim } from '../opponents/ai.ts';
import { mulberry32 } from '../rng/mulberry32.ts';
import { ladderEntry, OPPONENTS, PLAYER, TUNING, WORLD } from '../roster.ts';
import { airTicksTotal, arcHeight, PlayerBody } from '../runner/player.ts';
import { TripState } from './trip.ts';

const INTRO_TICKS = ticks(TUNING.INTRO_MS);
const BEAT_TICKS = ticks(TUNING.COUNT_STEP_MS);
const GO_TEXT_TICKS = ticks(TUNING.GO_TEXT_MS);
const BANNER_TICKS = ticks(TUNING.FALSE_START_BANNER_MS);
const RESULTS_TICKS = ticks(TUNING.RESULTS_DELAY_MS);
const AIR_TICKS = airTicksTotal();
/** Valid steps remembered for the stamina arrow's rate estimate (7 intervals). */
const RATE_WINDOW = 8;
/** Longer than this without a valid step means the current rate is below SUSTAIN_RATE. */
const SUSTAIN_GAP_MS = 1000 / TUNING.SUSTAIN_RATE;
/** Player shows the false start "jolt" (stumble frames) for the start of the banner. */
const JOLT_TICKS = ticks(250);
/** Off-screen completion gives up after this much race time (never reached in practice). */
const OFFSCREEN_LIMIT_TICKS = ticks(120000);
/** After the finish, runners keep the run cycle until they slow below this, then celebrate/lose. */
const SETTLE_BELOW_MPS = 3;
/** Runners walk in from the left edge of the world to the start line during the intro. */
const WALK_FROM_M = -WORLD.START_X_PX / WORLD.PX_PER_M;
/** Tolerance for window edges: wall-to-sim subtraction must not turn an exactly-at-GO press into a false start. */
const EDGE_EPS_MS = 1e-6;

/**
 * The 5 AI runners of a race (lanes 1-5) and the field's lane order, seeded as design 25.3.
 * `vTop` / `vField` override the tuned speeds (headless tuning only).
 */
export function createAi(
  event: EventId,
  opponent: OpponentId,
  seed: number,
  tune: { readonly vTop?: number; readonly vField?: number } = {},
): { ai: RivalSim[]; field: FieldRunnerInfo[] } {
  const entry = ladderEntry(event, opponent);
  if (entry === null) throw new Error(`${opponent} is not on the ${event} ladder`);
  // Named rival: mulberry32(seed), unchanged from v2, so a v2 seed reproduces its plan exactly.
  const rival = new RivalSim(event, opponent, planRival(event, opponent, mulberry32(seed >>> 0), tune.vTop));
  const entries = planField(event, entry.tier, mulberry32((seed ^ TUNING.FIELD_SEED_XOR) >>> 0));
  const field = entries.map((f) => {
    const { spec, plan } = fieldSpecAndPlan(event, entry.tier, f, tune.vField);
    return new RivalSim(event, null, plan, spec, f.lane);
  });
  return { ai: [rival, ...field], field: entries.map((f) => f.info) };
}

/**
 * One race (see index.ts for the contract).
 *
 * Time model: everything runs on integer ticks of 1/120 s counted from `startT`. An input with
 * timestamp t is applied at the first tick boundary at or after its sim time, before that tick is
 * integrated, so results depend only on timestamps, never on how frames chunk the advance() calls.
 * Order at each boundary: phase transitions, then queued inputs, then one integration step.
 */
export class Race {
  private readonly event: EventId;
  private readonly course: EventCourse;
  private readonly dnfTicks: number;
  private readonly opponent: OpponentId;
  private readonly seed: number;
  private readonly mode: RaceMode;
  private readonly clock: SimClock;
  private readonly countRng: () => number;
  private readonly filter = new StepFilter();
  private readonly jumpHeld = new Held();
  private readonly player: PlayerBody;
  /** Lanes 1-5: named rival, then the field in lane order. */
  private readonly ai: readonly RivalSim[];
  private readonly who: readonly LaneCharacter[];
  private readonly names: readonly string[];
  private readonly trip: TripState;
  /** Race ms of the last RATE_WINDOW valid steps (stamina arrow). */
  private recentSteps: number[] = [];

  private tick = 0;
  private lastNow: number;
  private queue: RaceInput[] = [];
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

  // Fumble logging (design 33.5).
  private steps = 0;
  private fumbles = 0;
  private fumble2 = 0;
  /** True while the last classified press was a fumble (rule C streak). */
  private fumbleStreak = false;
  private lastFumbleMs = Number.NEGATIVE_INFINITY;
  private sawKeys = false;
  private sawTouch = false;

  // Live place and finish order.
  private livePlace: number | null = null;
  /** Finish ms of on-screen crossings, in crossing order. */
  private crossings: number[] = [];
  /** Per AI lane (index = lane - 1): crossing already noted. */
  private readonly aiCrossed: boolean[] = [];

  constructor(opts: RaceOptions) {
    this.event = opts.event;
    this.course = EVENT_COURSE[opts.event];
    this.dnfTicks = ticks(EVENTS[opts.event].dnfMs);
    this.opponent = opts.opponent;
    this.seed = opts.seed >>> 0;
    this.mode = opts.mode ?? 'l';
    this.clock = new SimClock(opts.startT);
    this.lastNow = opts.startT;
    this.player = new PlayerBody(opts.event);
    this.trip = new TripState(opts.trip ?? TUNING.TRIP_ENABLED);
    // Separate streams so the number of countdown attempts never changes the AI draws.
    const { ai, field: fieldInfo } = createAi(opts.event, opts.opponent, this.seed);
    this.ai = ai;
    this.countRng = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
    this.who = [
      { kind: 'player', id: PLAYER.id },
      { kind: 'rival', id: opts.opponent },
      ...fieldInfo.map((info): LaneCharacter => ({ kind: 'field', field: info })),
    ];
    this.names = [PLAYER.name, OPPONENTS[opts.opponent].name, ...fieldInfo.map((f) => f.name)];
  }

  input(e: RaceInput): void {
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
    const p = this.player;
    const h = p.hurdleX[p.nextHurdle];
    const states: RunnerState[] = [this.playerState(alpha), ...this.ai.map((r) => this.aiState(r, alpha))];
    const runners: LaneRunner[] = states.map((state, lane) => ({
      lane,
      who: this.who[lane] as LaneCharacter,
      name: this.names[lane] ?? '',
      state,
    }));
    return {
      event: this.event,
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
      player: states[0] as RunnerState,
      rival: states[1] as RunnerState,
      outcome: this.outcome,
      nextHurdleS: h === undefined || p.v < 1 ? null : (h - p.x) / p.v,
      nextHurdleIndex: h === undefined ? null : p.nextHurdle,
      splits: [...p.splits],
      staminaDraining: this.staminaDraining(raceMs),
      mode: this.mode,
      runners,
      livePlace: this.livePlace,
      leaderLane: this.leaderLane(),
      trip: this.trip.phase,
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
        if (k - this.goTick >= this.dnfTicks) this.finishDnf(out);
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
      if (isJump(e)) this.jumpInput(e, s, out);
      else if (e.kind === 'up') this.filter.release(e.side);
      else this.keyDown(e, s, out);
    }
  }

  /** Inside the countdown window or the running race, before the player finished or DNF'd. */
  private live(s: number): boolean {
    const countStartMs = this.countTick * DT_MS - EDGE_EPS_MS;
    return (
      (this.phase === 'countdown' || this.phase === 'running') &&
      s >= countStartMs &&
      this.player.finishMs === null &&
      !this.dnf
    );
  }

  /** Before GO (the false start window, given live()). */
  private beforeGo(s: number): boolean {
    return s < this.goTick * DT_MS - EDGE_EPS_MS;
  }

  /**
   * Design 13.2 / 13.4: jumps exist only in the hurdles. A fresh press in the countdown window is a
   * false start; after GO it takes off when grounded and unlocked, otherwise it is silently ignored
   * (also while tripping, 33.2).
   */
  private jumpInput(e: JumpEvent, s: number, out: RaceEvent[]): void {
    if (e.kind === 'up') {
      this.jumpHeld.up();
      return;
    }
    if (e.repeat) return;
    const wasHeld = this.jumpHeld.held;
    this.jumpHeld.down();
    if (this.event !== '110mh' || !this.live(s)) return;
    if (this.beforeGo(s)) {
      this.falseStart(out);
      return;
    }
    if (wasHeld || this.trip.active || !this.player.canJump()) return;
    this.player.jump();
    out.push({ type: 'jump', lane: 0 });
  }

  private keyDown(e: RunKeyEvent, s: number, out: RaceEvent[]): void {
    // Director decision: auto-repeat never does anything in any phase (not a step, not a false start).
    if (e.repeat) return;
    if (!this.live(s)) {
      this.filter.noteDown(e.side);
      return;
    }
    if (this.beforeGo(s)) {
      // A fresh keydown in the window is a false start; a key held since before "3" is not.
      this.filter.noteDown(e.side);
      this.falseStart(out);
      return;
    }
    const source = e.source ?? 'k';
    if (source === 'k') this.sawKeys = true;
    else this.sawTouch = true;
    if (this.trip.active) {
      // Design 33.2: ignored for impulse and fumbles while tripping; held tracking continues.
      this.filter.noteDown(e.side);
      return;
    }
    const ms = Math.max(0, s - this.goTick * DT_MS);
    const verdict = this.filter.down(e.side, ms, e.repeat);
    if (verdict === 'step') {
      const airborne = this.player.airborne;
      this.player.impulse(ms, out);
      this.recentSteps = [...this.recentSteps.slice(1 - RATE_WINDOW), ms];
      this.steps += 1;
      this.fumbleStreak = false;
      out.push(airborne ? { type: 'step', side: e.side, airborne: true } : { type: 'step', side: e.side });
    } else if (verdict === 'fumble') {
      out.push({ type: 'fumble', side: e.side });
      const trip = this.fumble(ms, source);
      if (trip !== null) out.push(trip);
    }
  }

  /**
   * Design 33.1 rule C and 33.5 logging: a fumble right after a fumble (no valid step between),
   * within TRIP_WINDOW, is a pair. Pairs are counted from any source even with the flag off; only a
   * pair completed by a key trips, and only with the flag on. A counted pair ends the streak.
   */
  private fumble(ms: number, source: 'k' | 't'): RaceEvent | null {
    this.fumbles += 1;
    const pair = this.fumbleStreak && ms - this.lastFumbleMs <= TUNING.TRIP_WINDOW_MS;
    if (pair) {
      this.fumble2 += 1;
      this.fumbleStreak = false;
      this.lastFumbleMs = Number.NEGATIVE_INFINITY;
      return source === 'k' ? this.trip.trigger(this.player) : null;
    }
    this.fumbleStreak = true;
    this.lastFumbleMs = ms;
    return null;
  }

  private falseStart(out: RaceEvent[]): void {
    this.falseStarts += 1;
    // A false start detected at the GO boundary itself undoes GO.
    this.goTick = Number.POSITIVE_INFINITY;
    out.push({ type: 'falseStart', count: this.falseStarts });
    if (this.falseStarts >= TUNING.FALSE_STARTS_TO_DQ) {
      this.dq = true;
      const outcome = this.setOutcome('dq', null);
      out.push({ type: 'disqualified' });
      out.push({ type: 'resultReady', outcome });
      return;
    }
    this.phase = 'falseStart';
    this.phaseTick = this.tick;
  }

  /** One fixed step of every body, from the current tick to the next. */
  private integrate(out: RaceEvent[]): void {
    if (this.tick < this.goTick || this.dq) return;
    const t0 = (this.tick - this.goTick) * DT_MS;
    const playerX = this.player.x;
    const tripEvent = this.trip.beforeStep(this.player, this.filter, t0);
    if (tripEvent !== null) out.push(tripEvent);
    const crossed = this.player.step(t0, this.playerIdle(t0), out);
    const landedTrip = this.trip.afterStep(this.player);
    if (landedTrip !== null) out.push(landedTrip);
    const [rival, ...field] = this.ai;
    rival?.step(t0, playerX, out);
    for (const f of field) f.step(t0, null, out);
    if (crossed) this.finishPlayer(out);
    this.noteCrossings(crossed, out);
    this.updatePlace(out);
  }

  /** Collect this tick's on-screen crossings and fire 'closeFinish' when 2nd crosses within the margin. */
  private noteCrossings(playerCrossed: boolean, out: RaceEvent[]): void {
    const prev = this.crossings.length;
    if (playerCrossed && this.player.finishMs !== null) this.crossings.push(this.player.finishMs);
    this.ai.forEach((r, i) => {
      if (r.finishMs === null || this.aiCrossed[i] === true) return;
      this.aiCrossed[i] = true;
      this.crossings.push(r.finishMs);
    });
    if (prev < 2 && this.crossings.length >= 2) {
      const [a, b] = [...this.crossings].sort((x, y) => x - y);
      if (a !== undefined && b !== undefined && b - a <= TUNING.PHOTO_MARGIN_MS)
        out.push({ type: 'closeFinish' });
    }
  }

  private updatePlace(out: RaceEvent[]): void {
    if (this.dq || this.dnf) {
      // No place after a DQ or DNF (27.2 rule 5); the HUD hides the label.
      this.livePlace = null;
      return;
    }
    const place = this.outcome?.place ?? this.rawPlace();
    if (place !== null && place !== this.livePlace) {
      this.livePlace = place;
      out.push({ type: 'placeChange', place });
    }
  }

  /** Design 27.2 rule 1: runners ahead of the player, by finish ms, then by true distance. */
  private rawPlace(): number {
    const p = this.player;
    let ahead = 0;
    for (const r of this.ai) {
      if (r.finishMs !== null) ahead += p.finishMs === null || r.finishMs < p.finishMs ? 1 : 0;
      else if (p.finishMs === null && r.x > p.x) ahead += 1;
    }
    return ahead + 1;
  }

  private leaderLane(): number {
    let best = 0;
    let bestMs = this.player.finishMs ?? Number.POSITIVE_INFINITY;
    let bestX = this.player.x;
    this.ai.forEach((r, i) => {
      const ms = r.finishMs ?? Number.POSITIVE_INFINITY;
      if (ms < bestMs || (ms === bestMs && ms === Number.POSITIVE_INFINITY && r.x > bestX)) {
        best = i + 1;
        bestMs = ms;
        bestX = r.x;
      }
    });
    return best;
  }

  private playerIdle(t0: number): number {
    return t0 - (this.filter.lastStepMs ?? 0);
  }

  private finishPlayer(out: RaceEvent[]): void {
    const ms = this.player.finishMs ?? 0;
    out.push({ type: 'playerFinish', ms });
    out.push({ type: 'runnerFinish', lane: 0, ms });
    this.setOutcome('placed', this.completeOffscreen(this.tick + 1));
    this.resultTick = this.tick + 1 + RESULTS_TICKS;
  }

  private finishDnf(out: RaceEvent[]): void {
    this.dnf = true;
    this.player.finishable = false;
    out.push({ type: 'dnf' });
    this.setOutcome('dnf', this.completeOffscreen(this.tick));
    this.resultTick = this.tick;
  }

  /**
   * Design 24.1 / 34: places by ascending ms, equal ms share the better place, the player first
   * among equal times; player DQ/DNF last without a place. `aiMs` are lanes 1-5 (null: DQ).
   */
  private setOutcome(kind: 'placed' | 'dnf' | 'dq', aiMs: readonly (number | null)[] | null): RaceOutcome {
    this.phase = 'finished';
    this.phaseTick = this.tick;
    const ms = kind === 'placed' ? this.player.finishMs : null;
    const all: (number | null)[] = [ms, ...(aiMs ?? this.ai.map(() => null))];
    const standings = rankStandings(
      all.map((t, lane) => ({
        lane,
        who: this.who[lane] as LaneCharacter,
        name: this.names[lane] ?? '',
        ms: t,
      })),
    );
    const place = standings.find((s) => s.lane === 0)?.place ?? null;
    const timed = all.filter((t): t is number => t !== null);
    const winMs = timed.length > 0 ? Math.min(...timed) : null;
    const oppMs = all[1] ?? null;
    const result = kind === 'placed' ? (place === 1 ? 'win' : 'lose') : kind;
    this.outcome = {
      event: this.event,
      opponent: this.opponent,
      result,
      ms,
      oppMs,
      marginMs: ms !== null && oppMs !== null ? ms - oppMs : null,
      photoFinish: ms !== null && place === 1 && all.slice(1).some((t) => t === ms),
      falseStarts: this.falseStarts,
      seed: this.seed,
      hit: this.event === '110mh' ? this.player.hit : null,
      splits: [...this.player.splits],
      mode: this.mode,
      place,
      fieldSize: FIELD_SIZE,
      winMs,
      standings,
      steps: this.steps,
      fumbles: this.fumbles,
      fumble2: this.fumble2,
      trips: this.trip.count,
      input: this.sawTouch ? (this.sawKeys ? 'm' : 't') : 'k',
    };
    return this.outcome;
  }

  /**
   * Design 1.4.3 / 24.1: run the rest of the race on copies to get every AI runner's exact time.
   * Player input is ignored from here on, so the copies evolve exactly like the live bodies will.
   */
  private completeOffscreen(fromTick: number): (number | null)[] {
    const p = this.player.clone();
    const trip = this.trip.clone();
    const filter = this.filter.clone();
    const ai = this.ai.map((r) => r.clone());
    for (
      let k = fromTick;
      k - this.goTick < OFFSCREEN_LIMIT_TICKS && ai.some((r) => r.finishMs === null);
      k++
    ) {
      const t0 = (k - this.goTick) * DT_MS;
      const px = p.x;
      trip.beforeStep(p, filter, t0);
      p.step(t0, t0 - (filter.lastStepMs ?? 0), null);
      trip.afterStep(p);
      const [rival, ...field] = ai;
      rival?.step(t0, px, null);
      for (const f of field) if (f.finishMs === null) f.step(t0, null, null);
    }
    return ai.map((r) => r.finishMs);
  }

  // -------------------------------------------------------------------------
  // View state
  // -------------------------------------------------------------------------

  private trackHeld(e: RaceInput): void {
    if (isJump(e)) {
      if (e.kind === 'up') this.jumpHeld.up();
      else if (!e.repeat) this.jumpHeld.down();
    } else if (e.kind === 'up') this.filter.release(e.side);
    else if (!e.repeat) this.filter.noteDown(e.side);
  }

  /**
   * 400 m stamina arrow: net draining while the current step rate is above SUSTAIN_RATE, measured
   * over the last 7 step intervals, and the last step is recent enough for that rate to hold.
   */
  private staminaDraining(raceMs: number): boolean {
    const p = this.player;
    if (p.stamina === null || this.phase !== 'running' || p.finishMs !== null) return false;
    const n = this.recentSteps.length;
    const first = this.recentSteps[0];
    const last = this.recentSteps[n - 1];
    if (n < 2 || first === undefined || last === undefined || last <= first) return false;
    if (raceMs - last > SUSTAIN_GAP_MS) return false;
    return ((n - 1) * 1000) / (last - first) > TUNING.SUSTAIN_RATE;
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
    if (this.dnf) return EVENTS[this.event].dnfMs;
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

  private moving(x: number, v: number, crossed: boolean, settled: RunnerAnim, run: RunnerAnim): RunnerAnim {
    if (x >= this.course.leanFromM && x < this.course.leanToM) return 'lean';
    if (crossed) return v < SETTLE_BELOW_MPS ? settled : run;
    return v < TUNING.READY_BELOW_MPS ? 'ready2' : run;
  }

  /** Winning time known so far: the outcome's, else the earliest crossing on screen. */
  private winnerMs(): number | null {
    if (this.outcome !== null) return this.outcome.winMs;
    return this.crossings.length > 0 ? Math.min(...this.crossings) : null;
  }

  private playerState(alpha: number): RunnerState {
    const b = this.player;
    const pre = this.preRaceAnim(true);
    const xM = this.phase === 'intro' ? this.walkX(alpha) : b.xPrev + (b.x - b.xPrev) * alpha;
    const tired = b.stamina !== null && b.stamina < TUNING.S_FATIGUE;
    let anim: RunnerAnim;
    if (pre !== null) anim = pre;
    else if (b.airborne || b.landedThisTick) anim = 'hurdle';
    else if (this.trip.phase !== 'none') anim = this.trip.phase;
    else if (b.stumbleTicks > 0) anim = 'stumble';
    else if (this.dnf) anim = 'lose';
    else {
      // Design 24.1: celebrate on 1st, idle on 2nd-3rd, lose on 4th-6th.
      const place = this.outcome?.place ?? null;
      const settled: RunnerAnim = place === 1 ? 'celebrate' : place !== null && place <= 3 ? 'idle' : 'lose';
      anim = this.moving(b.x, b.v, b.finishMs !== null, settled, tired ? 'tired' : 'run');
    }
    const sweat = tired && this.phase === 'running' && b.finishMs === null;
    return {
      ...runner(xM, this.phase === 'intro' ? 0 : b.v, anim, sweat ? 'sweat' : 'none', true, b.finishMs),
      ...air(b, alpha),
      hurdlesKnocked: [...b.knocked],
      stamina: b.stamina,
    };
  }

  private aiState(r: RivalSim, alpha: number): RunnerState {
    const pre = this.preRaceAnim(false);
    const xM = this.phase === 'intro' ? this.walkX(alpha) : r.xPrev + (r.x - r.xPrev) * alpha;
    let anim: RunnerAnim;
    if (pre !== null) anim = pre;
    else if (r.airTicks !== null || r.landedThisTick) anim = 'hurdle';
    else if (r.tripping) anim = 'stumble';
    else {
      // The winner (any runner, dead heats included) celebrates; everyone else loses (24.1).
      const won = r.finishMs !== null && r.finishMs === this.winnerMs();
      anim = this.moving(r.x, r.v, r.finishMs !== null, won ? 'celebrate' : 'lose', 'run');
    }
    const effect: RunnerEffect = this.phase === 'running' || this.phase === 'finished' ? r.effect : 'none';
    return {
      ...runner(xM, this.phase === 'intro' ? 0 : r.v, anim, effect, r.visible, r.finishMs),
      ...air(r, alpha),
      hurdlesKnocked: [...r.knocked],
      stamina: null,
    };
  }
}

/** Standings with shared places (competition ranking); null ms last without a place. */
export function rankStandings(
  rows: readonly { lane: number; who: LaneCharacter; name: string; ms: number | null }[],
): Standing[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.ms === null || b.ms === null) {
      if (a.ms !== b.ms) return a.ms === null ? 1 : -1;
      // DQ: AI rows (no times) in lane order, player last.
      if (a.lane === 0 || b.lane === 0) return a.lane === 0 ? 1 : -1;
      return a.lane - b.lane;
    }
    return a.ms - b.ms || (a.lane === 0 ? -1 : b.lane === 0 ? 1 : a.lane - b.lane);
  });
  return sorted.map((row, i) => {
    if (row.ms === null) return { ...row, place: null };
    const firstEqual = sorted.findIndex((o) => o.ms === row.ms);
    return { ...row, place: (firstEqual < 0 ? i : firstEqual) + 1 };
  });
}

/**
 * Arc state for rendering, one tick behind the sim like xM: the first airborne tick renders from
 * s = 0, and the tick that landed still renders the last 1/48 of the arc.
 */
function air(
  body: { readonly airTicks: number | null; readonly landedThisTick: boolean },
  alpha: number,
): { airM: number; airPhase: number | null } {
  const done = body.airTicks ?? (body.landedThisTick ? AIR_TICKS : null);
  if (done === null) return { airM: 0, airPhase: null };
  const s = Math.min(1, Math.max(0, (done - 1 + alpha) / AIR_TICKS));
  return { airM: arcHeight(s), airPhase: s };
}

function runner(
  xM: number,
  vMps: number,
  anim: RunnerAnim,
  effect: RunnerEffect,
  visible: boolean,
  finishMs: number | null,
): Omit<RunnerState, 'airM' | 'airPhase' | 'hurdlesKnocked' | 'stamina'> {
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
