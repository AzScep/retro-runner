import type { EventId } from '../index.ts';
import { simulateRivalFinish } from '../opponents/ai.ts';
import { createAi } from '../race/race.ts';
import { LADDERS } from '../roster.ts';

// Headless field tuning sweep (design 25.5): the 5 AI runners of a race with no player (pressure
// excluded, as 3.1), many seeded races per event and tier. Runners never interact without a player,
// so each one is simulated on its own.

/** The seeds of every tuning sweep (same as the v2 V_TOP sweep). */
export function sweepSeeds(n = 1000): number[] {
  return Array.from({ length: n }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0);
}

export interface RaceTimes {
  /** Named rival ms. */
  readonly rival: number;
  /** Field ms, index = lane - 2. */
  readonly field: readonly number[];
}

export function raceTimes(
  event: EventId,
  tier: number,
  seed: number,
  tune: { readonly vTop?: number; readonly vField?: number } = {},
): RaceTimes {
  const entry = LADDERS[event][tier - 1];
  if (entry === undefined) throw new Error(`no tier ${tier} in ${event}`);
  const { ai } = createAi(event, entry.id, seed, tune);
  const ms = ai.map((r) => simulateRivalFinish(r) ?? Number.POSITIVE_INFINITY);
  return { rival: ms[0] ?? Number.POSITIVE_INFINITY, field: ms.slice(1) };
}

export interface SweepStats {
  readonly races: number;
  /** Winning time (fastest of the 5 AI): median, p10, p90 in ms. */
  readonly medianWin: number;
  readonly p10Win: number;
  readonly p90Win: number;
  /** Share of races the named rival wins (a dead heat with the field counts for the rival). */
  readonly rivalShare: number;
  /** Fastest single field-runner finish of the sweep. */
  readonly fastestField: number;
  readonly rivalMean: number;
  /** Median of all single field-runner finishes. */
  readonly fieldMedian: number;
  /** Win share per field lane 2-5. */
  readonly laneShare: readonly number[];
}

/** Nearest-rank percentile of a sorted array. */
function pct(sorted: readonly number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i] ?? Number.NaN;
}

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  const a = sorted[Math.floor((n - 1) / 2)] ?? Number.NaN;
  const b = sorted[Math.ceil((n - 1) / 2)] ?? Number.NaN;
  return (a + b) / 2;
}

export function stats(times: readonly RaceTimes[]): SweepStats {
  const wins: number[] = [];
  const fieldAll: number[] = [];
  const laneWins = [0, 0, 0, 0];
  let rivalWins = 0;
  let rivalSum = 0;
  for (const t of times) {
    const fieldMin = Math.min(...t.field);
    wins.push(Math.min(t.rival, fieldMin));
    rivalSum += t.rival;
    fieldAll.push(...t.field);
    if (t.rival <= fieldMin) rivalWins += 1;
    else laneWins[t.field.indexOf(fieldMin)] = (laneWins[t.field.indexOf(fieldMin)] ?? 0) + 1;
  }
  wins.sort((a, b) => a - b);
  fieldAll.sort((a, b) => a - b);
  const n = times.length;
  return {
    races: n,
    medianWin: median(wins),
    p10Win: pct(wins, 0.1),
    p90Win: pct(wins, 0.9),
    rivalShare: rivalWins / n,
    fastestField: fieldAll[0] ?? Number.NaN,
    rivalMean: rivalSum / n,
    fieldMedian: median(fieldAll),
    laneShare: laneWins.map((w) => w / n),
  };
}

export function sweep(
  event: EventId,
  tier: number,
  seeds: readonly number[] = sweepSeeds(),
  tune: { readonly vTop?: number; readonly vField?: number } = {},
): SweepStats {
  return stats(seeds.map((seed) => raceTimes(event, tier, seed, tune)));
}
