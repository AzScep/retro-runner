/**
 * Menu copy and small menu rules for Event Select (S10), the Ladder Map (S2) and Records (S6),
 * pure so tests can check the wording rules and that every line fits its panel.
 *
 * v3 wording rule (design 1.3, 24.1): only 1st place unlocks, so conditions say "finish 1st" or
 * "win", never "beat"; and they name only what the player can already see on the ladder (a rival's
 * name once unlocked, else its tier's meet, which every rival card shows).
 */

/** Key hints in keyboard mode (touch shows BACK buttons instead). */
export const EVENTS_HELP = 'ARROWS: CHOOSE   ENTER: OPEN   ESC: BACK';
export const LADDER_HELP = 'UP/DOWN: RIVAL   LEFT/RIGHT: MENU   ENTER: GO   ESC: BACK';

/** Ladder card goal while nothing in the event is won yet (replaces the flavour line). */
export const LADDER_GOAL: readonly string[] = ['6 RUNNERS. FINISH 1ST', 'TO UNLOCK THE NEXT RIVAL'];

/** The tier below a locked rival: its name if the player has unlocked it, and its meet. */
export interface PreviousTier {
  readonly name: string;
  readonly unlocked: boolean;
  readonly meet: string;
}

/** Ladder card lines for a locked rival: what wins it, naming only what the player has seen. */
export function ladderLockLines(prev: PreviousTier | null): readonly string[] {
  if (prev === null) return [];
  return [prev.unlocked ? `FINISH 1ST VS ${prev.name}` : `FINISH 1ST AT ${prev.meet}`, 'TO UNLOCK'];
}

/**
 * Progress toward the ladder total (16.5: a PB against all 7 rivals, from any placing) while it is
 * not set. Before the reveal it counts the 6 visible rivals and never mentions a 7th (29.1.3).
 */
export function ladderTotalProgress(pbs: number, revealed: boolean): string {
  return revealed ? `SET A PB VS ALL 7: ${pbs}/7` : `PBS SET ${pbs}/6`;
}

/** Short form for the event card under `TOTAL --`. */
export function ladderTotalProgressShort(pbs: number, revealed: boolean): string {
  return `PBS ${pbs}/${revealed ? 7 : 6}`;
}

/** The GAUNTLET button wears a NEW! badge from the reveal until the first run ends (design 32.1). */
export function gauntletIsNew(unlocked: boolean, runs: number): boolean {
  return unlocked && runs === 0;
}

/**
 * HAPTICS is listed only where vibration is real (design 17.7: Android phones): the Vibration API
 * and a coarse primary pointer. Desktop Chromium has navigator.vibrate but no motor.
 */
export function hapticsAvailable(env: {
  readonly vibrate: boolean;
  readonly coarsePointer: boolean;
}): boolean {
  return env.vibrate && env.coarsePointer;
}
