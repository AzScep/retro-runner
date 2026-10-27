import { expect, type Page } from '@playwright/test';

/**
 * Structural copy of the test hook types (src/scenes/testHook.ts). Kept local so the e2e
 * TypeScript project does not pull Vite-only source files into its type graph.
 */
export interface RunnerSnap {
  xM: number;
  vMps: number;
  kmh: number;
  anim: string;
  visible: boolean;
  finishMs: number | null;
}

export interface Outcome {
  opponent: string;
  result: 'win' | 'lose' | 'dq' | 'dnf';
  ms: number | null;
  oppMs: number | null;
  marginMs: number | null;
  photoFinish: boolean;
  falseStarts: number;
  seed: number;
}

export interface GameState {
  ready: boolean;
  bootError: string | null;
  audioPreloaded: boolean;
  scene: string | null;
  scenes: string[];
  race: {
    opponent: string;
    seed: number;
    phase: 'intro' | 'countdown' | 'falseStart' | 'running' | 'finished';
    countdown: 3 | 2 | 1 | 'go' | null;
    raceMs: number;
    falseStarts: number;
    paused: boolean;
    expectedSide: 'L' | 'R' | null;
    idleMs: number;
    player: RunnerSnap;
    rival: RunnerSnap;
    outcome: Outcome | null;
  } | null;
  hud: {
    timer: string;
    kmh: number;
    lit: number;
    keys: { L: string; R: string };
    mash: boolean;
    fumbles: number;
    countdown: string | null;
    banner: string | null;
    offscreen: string | null;
  } | null;
  texts: string[];
  records: {
    version: 1;
    unlockedTier: number;
    beaten: string[];
    champion: boolean;
    best: Record<string, { ms: number; at: string } | undefined>;
    history: { opp: string; result: string; ms: number | null; oppMs: number | null; falseStarts: number }[];
    settings: {
      volume: number;
      muted: boolean;
      reducedFlashing: boolean;
      screenShake: boolean;
      crt: boolean;
    };
  } | null;
  persistent: boolean | null;
  ladderCursor: string | null;
}

interface Hook {
  getState(): GameState;
  seed(n: number): void;
  clearRecords(): void;
  paletteCheck(): Promise<{ distinct: number; offPalette: string[] }>;
}

declare global {
  interface Window {
    __retroRunner?: Hook;
  }
}

export const SAVE_KEY = 'retroRunner.save.v1';

export async function getState(page: Page): Promise<GameState> {
  return page.evaluate(() => {
    const hook = window.__retroRunner;
    if (!hook) throw new Error('test hook missing: build with VITE_TEST_HOOKS=1');
    return hook.getState();
  });
}

/** Polls the game state until `pred` holds (evaluated in Node), failing with the last state. */
export async function waitForState(
  page: Page,
  pred: (s: GameState) => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<GameState> {
  const deadline = Date.now() + timeoutMs;
  let last: GameState | null = null;
  while (Date.now() < deadline) {
    last = await getState(page);
    if (last.bootError) throw new Error(`boot failed: ${last.bootError}`);
    if (pred(last)) return last;
    await page.waitForTimeout(15);
  }
  throw new Error(`timed out waiting for ${what}; last state: ${JSON.stringify(last, null, 1)}`);
}

export async function waitForScene(page: Page, key: string, timeoutMs = 20_000): Promise<GameState> {
  return waitForState(page, (s) => s.scene === key, `scene ${key}`, timeoutMs);
}

/** Loads the game and waits for the Title screen. */
export async function bootToTitle(page: Page): Promise<GameState> {
  await page.goto('/');
  await page.waitForFunction(() => window.__retroRunner !== undefined, null, { timeout: 20_000 });
  return waitForScene(page, 'Title', 30_000);
}

/** Title -> Ladder (RACE is focused and the cursor is on the highest unlocked rival). */
export async function titleToLadder(page: Page): Promise<GameState> {
  await page.keyboard.press('Enter');
  return waitForScene(page, 'Ladder');
}

/** From the Ladder Map with RACE focused: start a race with a fixed seed. */
export async function startRace(page: Page, seed: number): Promise<GameState> {
  await page.evaluate((n) => window.__retroRunner?.seed(n), seed);
  await page.keyboard.press('Enter');
  return waitForState(page, (s) => s.race !== null && s.scenes.includes('Hud'), 'race to start');
}

export async function waitForPhase(page: Page, phase: string, timeoutMs = 20_000): Promise<GameState> {
  return waitForState(page, (s) => s.race?.phase === phase, `race phase ${phase}`, timeoutMs);
}

/** One full key tap with real keydown/keyup events. */
export async function tap(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.keyboard.up(key);
}

/**
 * Mashes like a player watching the key prompt: always presses the side the race expects next
 * (`expectedSide`), with a gap above the 35 ms minimum step interval (design 2.2.5). If a press is
 * lost (for example two events delivered back to back on a loaded machine), the next press goes
 * to the same side again instead of turning into a fumble. Stops when `until` holds.
 * Returns the last state and the highest km/h seen.
 */
export async function mash(
  page: Page,
  until: (s: GameState) => boolean,
  keys: readonly [string, string] = ['ArrowLeft', 'ArrowRight'],
  gapMs = 40,
  timeoutMs = 40_000,
): Promise<{ state: GameState; maxKmh: number }> {
  const deadline = Date.now() + timeoutMs;
  let maxKmh = 0;
  let next: 'L' | 'R' = 'L';
  let i = 0;
  while (Date.now() < deadline) {
    // Re-sync with the key prompt every few presses (a state read is a round trip).
    if (i % 4 === 0) {
      const s = await getState(page);
      maxKmh = Math.max(maxKmh, s.race?.player.kmh ?? 0);
      if (until(s)) return { state: s, maxKmh };
      next = s.race?.expectedSide ?? next;
    }
    await tap(page, next === 'R' ? keys[1] : keys[0]);
    next = next === 'L' ? 'R' : 'L';
    i++;
    await page.waitForTimeout(gapMs);
  }
  throw new Error('mash: condition never met');
}

/** Mashes until the player crosses the line. Returns the state after the crossing. */
export async function mashToFinish(
  page: Page,
  keys: readonly [string, string] = ['ArrowLeft', 'ArrowRight'],
  gapMs = 40,
): Promise<GameState> {
  const r = await mash(
    page,
    (s) => (s.race?.player.finishMs ?? null) !== null || s.race?.phase === 'finished',
    keys,
    gapMs,
  );
  return r.state;
}

export async function waitForResults(page: Page): Promise<GameState> {
  return waitForState(page, (s) => s.scenes.includes('Results'), 'results card', 10_000);
}

export function expectText(state: GameState, text: string): void {
  expect(state.texts, `visible texts should include ${text}`).toContain(text);
}

/** Colours on the current frame that are outside the 42-colour master palette. */
export async function offPaletteColours(page: Page): Promise<string[]> {
  const r = await page.evaluate(() => {
    const hook = window.__retroRunner;
    if (!hook) throw new Error('test hook missing');
    return hook.paletteCheck();
  });
  expect(r.distinct).toBeGreaterThan(1);
  return r.offPalette;
}
