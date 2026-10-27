// Test helpers for driving a Race headlessly (imported only by *.test.ts files).
import type { OpponentId, RaceEvent, RunKeyEvent, Side } from '../index.ts';
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

/**
 * Feed `presses` and advance in frames of the given sizes (cycled) until `untilWall`.
 * Each event is delivered in the frame whose time window contains it, like a browser would.
 */
export function play(
  race: Race,
  presses: readonly RunKeyEvent[],
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
    while (i < presses.length && (presses[i]?.t ?? Infinity) <= now) race.input(presses[i++] as RunKeyEvent);
    log.push(...race.advance(now));
  }
  return log;
}

/** Full race: intro, countdown, then `presses(goWall)` until `forMs` after GO. */
export function runRace(
  opponent: OpponentId,
  seed: number,
  presses: (goWall: number) => RunKeyEvent[],
  forMs = 32000,
  frameMs?: readonly number[],
): { race: Race; log: RaceEvent[]; goWall: number } {
  const race = new Race({ opponent, seed, startT: START_T });
  const log: RaceEvent[] = [];
  const goWall = runToGo(race, log);
  log.push(...play(race, presses(goWall), goWall, goWall + forMs, frameMs));
  return { race, log, goWall };
}
