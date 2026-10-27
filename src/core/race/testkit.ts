// Test helpers for driving a Race headlessly (imported only by *.test.ts files).
import type { EventId, OpponentId, RaceEvent, RaceInput, RaceState, RunKeyEvent, Side } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { Race } from './race.ts';

export const START_T = 1000;

/** Advance one tick at a time until GO is processed; returns the wall time of GO. */
export function runToGo(race: Race, log: RaceEvent[] = [], startT = START_T): number {
  for (let k = 1; k < 2000; k++) {
    const events = race.advance(startT + k * DT_MS);
    log.push(...events);
    if (events.some((e) => e.type === 'beat' && e.beat === 'go')) return startT + (k - 1) * DT_MS;
  }
  throw new Error('GO never came');
}

/** Alternating presses L, R, L... starting at `from`, one every `periodMs`, each held `holdMs`. */
export function alternate(from: number, periodMs: number, count: number, holdMs = 20): RunKeyEvent[] {
  const out: RunKeyEvent[] = [];
  for (let i = 0; i < count; i++) {
    const side: Side = i % 2 === 0 ? 'L' : 'R';
    const t = from + i * periodMs;
    out.push({ kind: 'down', side, t, repeat: false });
    out.push({ kind: 'up', side, t: t + holdMs, repeat: false });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function down(side: Side, t: number, repeat = false): RunKeyEvent {
  return { kind: 'down', side, t, repeat };
}

export function up(side: Side, t: number): RunKeyEvent {
  return { kind: 'up', side, t, repeat: false };
}

/** A jump press at `t` held `holdMs` (down, then up). */
export function jumpPress(t: number, holdMs = 20): RaceInput[] {
  return [
    { kind: 'down', action: 'jump', t, repeat: false },
    { kind: 'up', action: 'jump', t: t + holdMs, repeat: false },
  ];
}

/** Merge input lists by timestamp (stable). */
export function merge(...lists: readonly (readonly RaceInput[])[]): RaceInput[] {
  return lists.flat().sort((a, b) => a.t - b.t);
}

/**
 * Feed `presses` and advance in frames of the given sizes (cycled) until `untilWall`.
 * Each event is delivered in the frame whose time window contains it, like a browser would.
 */
export function play(
  race: Race,
  presses: readonly RaceInput[],
  fromWall: number,
  untilWall: number,
  frameMs: readonly number[] = [1000 / 60],
): RaceEvent[] {
  const log: RaceEvent[] = [];
  let now = fromWall;
  let i = 0;
  let f = 0;
  while (now < untilWall) {
    now = Math.min(untilWall, now + (frameMs[f++ % frameMs.length] ?? 16));
    while (i < presses.length && (presses[i]?.t ?? Infinity) <= now) race.input(presses[i++] as RaceInput);
    log.push(...race.advance(now));
  }
  return log;
}

/** Full race: intro, countdown, then `presses(goWall)` until `forMs` after GO. */
export function runRace(
  opponent: OpponentId,
  seed: number,
  presses: (goWall: number) => RaceInput[],
  forMs = 32000,
  frameMs?: readonly number[],
  event: EventId = '100m',
): { race: Race; log: RaceEvent[]; goWall: number } {
  const race = new Race({ event, opponent, seed, startT: START_T });
  const log: RaceEvent[] = [];
  const goWall = runToGo(race, log);
  log.push(...play(race, presses(goWall), goWall, goWall + forMs, frameMs));
  return { race, log, goWall };
}

export interface DriveOptions {
  /** Alternation rate in alt/s, or a function of race ms and current stamina (1 outside the 400 m). */
  readonly rate: number | ((ms: number, stamina: number) => number);
  /** Press jump (once per hurdle) on the first tick where state.nextHurdleS <= jumpS; null: never. */
  readonly jumpS?: number | null;
  /** Which hurdle indices to jump (default: all). */
  readonly jumpAt?: (index: number) => boolean;
  /** Race ms of the first step. */
  readonly firstMs?: number;
  /** Stop after this much race time even without an outcome. */
  readonly untilMs?: number;
  /** Called after every tick with the current state. */
  readonly onTick?: (state: RaceState) => void;
}

/**
 * Reactive headless driver from GO: alternating presses at the given rate (each held 10 ms) and
 * optional timed jumps, advancing one tick at a time. Stops at the outcome.
 */
export function drive(race: Race, goWall: number, opts: DriveOptions): RaceEvent[] {
  const rate = typeof opts.rate === 'number' ? (): number => opts.rate as number : opts.rate;
  const log: RaceEvent[] = [];
  let next = goWall + (opts.firstMs ?? 5);
  let side: Side = 'L';
  let jumped = -1;
  const until = opts.untilMs ?? 100000;
  for (let k = 1; k * DT_MS <= until; k++) {
    const now = goWall + k * DT_MS;
    while (next <= now) {
      race.input({ kind: 'down', side, t: next, repeat: false });
      race.input({ kind: 'up', side, t: next + 10, repeat: false });
      side = side === 'L' ? 'R' : 'L';
      next += 1000 / rate(next - goWall, race.state.player.stamina ?? 1);
    }
    log.push(...race.advance(now));
    const st = race.state;
    opts.onTick?.(st);
    const jumpS = opts.jumpS ?? null;
    const i = st.nextHurdleIndex;
    const wanted = i !== null && (opts.jumpAt?.(i) ?? true);
    if (jumpS !== null && wanted && i > jumped && st.nextHurdleS !== null && st.nextHurdleS <= jumpS) {
      jumped = i;
      race.input({ kind: 'down', action: 'jump', t: now, repeat: false });
      race.input({ kind: 'up', action: 'jump', t: now + 5, repeat: false });
    }
    if (st.outcome !== null) break;
  }
  return log;
}

/** New race of `event` against `opponent`, advanced to GO. */
export function startRace(
  event: EventId,
  opponent: OpponentId,
  seed = 7,
): { race: Race; goWall: number; log: RaceEvent[] } {
  const race = new Race({ event, opponent, seed, startT: START_T });
  const log: RaceEvent[] = [];
  const goWall = runToGo(race, log);
  return { race, goWall, log };
}
