/**
 * Gauntlet run rules for the UI (design 32), pure so they run under Vitest.
 *
 * A run races tiers 1-7 of one event back to back. Only won races add their time; the run ends on
 * any place other than 1st, a DQ, a DNF or ABANDON RUN, and is cleared by winning tier 7.
 */
import { formatLadderTotal, type EventId, type RaceOutcome } from '../core/index.ts';

export const GAUNTLET_TIERS = 7;

export interface GauntletRun {
  readonly event: EventId;
  /** Tier of the race being run (1-7). */
  readonly tier: number;
  /** Race ms of the tiers won so far, in order. */
  readonly times: readonly number[];
}

export function newGauntletRun(event: EventId): GauntletRun {
  return { event, tier: 1, times: [] };
}

/** What follows a Gauntlet race (design 32.2): the next race, the end of the run, or a clear. */
export type GauntletStep =
  | { readonly kind: 'between'; readonly run: GauntletRun }
  | { readonly kind: 'clear'; readonly run: GauntletRun }
  | { readonly kind: 'over'; readonly run: GauntletRun };

/** Applies a race outcome to the run. `run` is the run before the race. */
export function gauntletAfterRace(run: GauntletRun, outcome: RaceOutcome): GauntletStep {
  if (outcome.place !== 1 || outcome.ms === null) return { kind: 'over', run };
  const times = [...run.times, outcome.ms];
  if (run.tier >= GAUNTLET_TIERS) return { kind: 'clear', run: { ...run, times } };
  return { kind: 'between', run: { ...run, tier: run.tier + 1, times } };
}

export function gauntletTotal(times: readonly number[]): number {
  return times.reduce((a, b) => a + b, 0);
}

/** HUD strip (design 32.3): `3/7  TOTAL 1:02.37`; the live race time is added to the won races. */
export function gauntletStrip(run: GauntletRun, liveMs: number): string {
  return `${run.tier}/${GAUNTLET_TIERS}  TOTAL ${formatLadderTotal(gauntletTotal(run.times) + liveMs)}`;
}

/** `FURTHEST 4/7` (design 32.5). */
export function furthestText(furthest: number): string {
  return `FURTHEST ${furthest}/${GAUNTLET_TIERS}`;
}
