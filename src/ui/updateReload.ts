/**
 * When an open page may reload into a newly deployed version (research-mobile 5), pure so it runs
 * under Vitest. main.ts feeds it the live game state once a second after the new service worker
 * takes control.
 *
 * Rules:
 * - Never while the page is hidden: the player is away, and a reload behind their back looks like
 *   a crash when they come back (and on Android it also drops fullscreen).
 * - Never while a race exists, running or paused (the blur and portrait auto-pause included), nor
 *   while its results card is up: App.race stays set until the race scene shuts down.
 * - Never while a Gauntlet run is in progress: the run lives only in memory (App.gauntlet).
 * - Never while a busy scene is running or paused: boot, the reveal, the champion screen, the pause
 *   overlay and the Gauntlet cards.
 * So the reload happens on a menu screen, and the Title then says `UPDATED` once.
 */

/** Scenes that block the reload while they are running or paused (SceneKey values). */
export const UPDATE_BUSY_SCENES: readonly string[] = [
  'Boot',
  'Race',
  'Results',
  'Pause',
  'Gauntlet',
  'Reveal',
  'Champion',
];

export interface UpdateReloadState {
  /** document.visibilityState === 'hidden'. */
  readonly hidden: boolean;
  /** App.race !== null: a race is running, paused or showing its results card. */
  readonly raceExists: boolean;
  /** App.gauntlet !== null: a Gauntlet run is in progress, on a race or between races. */
  readonly gauntletRun: boolean;
  /** Keys of the scenes that are running or paused. */
  readonly scenes: readonly string[];
}

export function canReloadForUpdate(s: UpdateReloadState): boolean {
  if (s.hidden || s.raceExists || s.gauntletRun) return false;
  return !s.scenes.some((key) => UPDATE_BUSY_SCENES.includes(key));
}

/** sessionStorage key set right before an update reload; the Title shows `UPDATED` once. */
export const UPDATED_FLAG_KEY = 'retroRunner.updated';

interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Records that the next load is an update reload. Storage failures only lose the label. */
export function markUpdateReload(storage: FlagStorage | null): void {
  try {
    storage?.setItem(UPDATED_FLAG_KEY, '1');
  } catch {
    // Blocked storage: the reload still happens, without the label.
  }
}

/** True once after an update reload (the flag is cleared on read). */
export function takeUpdateReload(storage: FlagStorage | null): boolean {
  try {
    if (storage?.getItem(UPDATED_FLAG_KEY) !== '1') return false;
    storage.removeItem(UPDATED_FLAG_KEY);
    return true;
  } catch {
    return false;
  }
}

/** window.sessionStorage, or null where it is missing or blocked (and under Node). */
export function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
