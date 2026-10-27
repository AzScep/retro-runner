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
  airM: number;
  hurdlesKnocked: boolean[];
  stamina: number | null;
}

export interface Outcome {
  event: EventId;
  hit: number | null;
  splits: number[];
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
    event: EventId;
    nextHurdleS: number | null;
    nextHurdleIndex: number | null;
    splits: number[];
    staminaDraining: boolean;
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
    event: EventId;
    layout: 'keyboard' | 'touchBars' | 'touchCanvas';
    tip: string | null;
    gauge: { visible: boolean; pipX: number; label: boolean };
    stamina: { fill: number; color: number; arrow: 'up' | 'down' | null } | null;
    popup: string | null;
    split: string | null;
    knockedTicks: number;
    speedMeter: { x: number; y: number };
    timer: string;
    kmh: number;
    lit: number;
    keys: { L: string; R: string; U: string };
    mash: boolean;
    fumbles: number;
    countdown: string | null;
    banner: string | null;
    offscreen: string | null;
  } | null;
  texts: string[];
  records: SaveV2 | null;
  persistent: boolean | null;
  ladderCursor: string | null;
  event: EventId | null;
  modality: { modality: 'keyboard' | 'touch'; padsOverCanvas: boolean };
  taps: { scene: string; rect: { x: number; y: number; w: number; h: number } }[];
}

export type EventId = '100m' | '110mh' | '400m';

export interface HistoryV2 {
  opp: string;
  result: string;
  ms: number | null;
  oppMs: number | null;
  falseStarts: number;
  hit?: number;
  splits?: number[];
}

export interface EventRecordsV2 {
  unlockedTier: number;
  beaten: string[];
  champion: boolean;
  best: Record<string, { ms: number; at: string; hit?: number; splits?: number[] } | undefined>;
  history: HistoryV2[];
}

/** Structural copy of core's SaveData v2 (design 16.2). */
export interface SaveV2 {
  version: 2;
  lastEvent: EventId;
  seenEvents: EventId[];
  hints: { addToHomeScreen: boolean };
  settings: {
    volume: number;
    muted: boolean;
    reducedFlashing: boolean;
    screenShake: boolean;
    crt: boolean;
    haptics: boolean;
  };
  events: Record<EventId, EventRecordsV2>;
}

interface Hook {
  getState(): GameState;
  getRace(): Pick<GameState, 'race' | 'hud'>;
  seed(n: number): void;
  clearRecords(): void;
  tap(x: number, y: number): boolean;
  setModality(patch: { modality?: 'keyboard' | 'touch'; padsOverCanvas?: boolean }): void;
  paletteCheck(): Promise<{ distinct: number; offPalette: string[] }>;
}

declare global {
  interface Window {
    __retroRunner?: Hook;
  }
}

export const SAVE_KEY = 'retroRunner.save.v2';
export const SAVE_KEY_V1 = 'retroRunner.save.v1';
export const EVENT_ORDER: readonly EventId[] = ['100m', '110mh', '400m'];

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

/** Title -> Event Select (S10). */
export async function titleToEvents(page: Page): Promise<GameState> {
  await page.keyboard.press('Enter');
  return waitForScene(page, 'Events');
}

/** Event Select -> that event's Ladder: Left to the first card, Right to the event, Enter. */
export async function eventsToLadder(page: Page, event: EventId = '100m'): Promise<GameState> {
  for (let i = 0; i < EVENT_ORDER.length; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < EVENT_ORDER.indexOf(event); i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  return waitForState(page, (s) => s.scene === 'Ladder' && s.event === event, `ladder of ${event}`);
}

/** Title -> Events -> Ladder (RACE is focused and the cursor is on the highest unlocked rival). */
export async function titleToLadder(page: Page, event: EventId = '100m'): Promise<GameState> {
  await titleToEvents(page);
  return eventsToLadder(page, event);
}

/** Writes `value` to localStorage[key] before the first load only (a reload keeps what the game saved). */
export async function seedStorage(page: Page, key: string, value: string): Promise<void> {
  await page.addInitScript(
    ([k, v]) => {
      if (!sessionStorage.getItem('rr-seeded')) {
        sessionStorage.setItem('rr-seeded', '1');
        localStorage.setItem(k as string, v as string);
      }
    },
    [key, value],
  );
}

const AT = '2026-10-26T20:15:03.120Z';

/** A valid v1 document (design 4.3) with `beaten` rivals beaten, a PB against each and the next unlocked. */
export function v1Save(
  beaten: readonly string[],
  opts: { best?: Record<string, number>; settings?: Partial<SaveV2['settings']>; champion?: boolean } = {},
): string {
  const best: Record<string, { ms: number; at: string }> = {};
  for (const [id, ms] of Object.entries(opts.best ?? {})) best[id] = { ms, at: AT };
  return JSON.stringify({
    version: 1,
    unlockedTier: Math.min(7, beaten.length + 1),
    beaten,
    champion: opts.champion ?? false,
    best,
    history: beaten.map((opp) => ({
      opp,
      result: 'win',
      ms: best[opp]?.ms ?? 15000,
      oppMs: 18000,
      falseStarts: 0,
      seed: 7,
      at: AT,
    })),
    settings: {
      volume: 8,
      muted: false,
      reducedFlashing: false,
      screenShake: true,
      crt: false,
      ...opts.settings,
    },
  });
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

/** Text that may wrap over several lines (for example a locked card's unlock text). */
export function expectWrappedText(state: GameState, text: string): void {
  expect(state.texts.join(' '), `visible texts should include ${text}`).toContain(text);
}

/** A ButtonRow label: drawn as ` LABEL ` or, focused, `[LABEL]`. */
export function expectButton(state: GameState, label: string): void {
  const buttons = state.texts.map((t) => t.replace(/[[\]]/g, '').trim());
  expect(buttons, `visible buttons should include ${label}`).toContain(label);
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

export interface BotOptions {
  /** Alternations per second (valid steps per second). */
  rate: number;
  /** Hurdles: 'clean' takes off ~0.2 s before each hurdle (design 13.2 sweet spot), 'none' never jumps. */
  jumps?: 'clean' | 'none';
  /** 400 m: drop to `rate2` once stamina falls below `below` (sprint then ease off). */
  ease?: { below: number; rate2: number };
  timeoutMs?: number;
}

export interface BotResult {
  state: GameState;
  minStamina: number | null;
  /** Player x (m) when stamina first hit 0, else null. */
  emptyAtM: number | null;
  /** Highest HUD timer text seen at or after 60 s, if any. */
  longTimer: string | null;
}

/**
 * A precise in-page runner for timing-sensitive tests: dispatches keydown/keyup pairs on window
 * (the same listener path as a real keyboard: core's attachKeyboard on window, capture phase) at a
 * fixed rate on the side the race expects, and in the hurdles presses ArrowUp once per hurdle when
 * `nextHurdleS` first drops to 0.20 s. Runs until the player crosses the line.
 */
export async function runBot(page: Page, opts: BotOptions): Promise<BotResult> {
  return page.evaluate(
    (o) =>
      new Promise<BotResult>((resolve, reject) => {
        const hook = window.__retroRunner;
        if (!hook) {
          reject(new Error('test hook missing'));
          return;
        }
        const press = (code: string): void => {
          window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
        };
        let next: 'L' | 'R' = 'L';
        let rate = o.rate;
        let lastStep = 0;
        let jumpedFor = -1;
        let minStamina: number | null = null;
        let emptyAtM: number | null = null;
        let longTimer: string | null = null;
        const started = performance.now();
        const timer = window.setInterval(() => {
          const s = hook.getRace();
          const r = s.race;
          if (!r) return;
          const p = r.player;
          if (p.finishMs !== null || r.phase === 'finished') {
            window.clearInterval(timer);
            resolve({ state: hook.getState(), minStamina, emptyAtM, longTimer });
            return;
          }
          if (performance.now() - started > (o.timeoutMs ?? 120_000)) {
            window.clearInterval(timer);
            reject(new Error(`bot timed out: ${JSON.stringify(r)}`));
            return;
          }
          if (r.phase !== 'running') return;
          if (p.stamina !== null) {
            minStamina = minStamina === null ? p.stamina : Math.min(minStamina, p.stamina);
            // Regen runs every tick, so an empty meter reads a hair above 0 between steps.
            if (p.stamina <= 0.02 && emptyAtM === null) emptyAtM = p.xM;
            if (o.ease && p.stamina < o.ease.below) rate = o.ease.rate2;
          }
          if (s.hud && r.raceMs >= 60_000) longTimer = s.hud.timer;
          const now = performance.now();
          if (
            o.jumps === 'clean' &&
            r.nextHurdleIndex !== null &&
            r.nextHurdleS !== null &&
            r.nextHurdleS <= 0.2 &&
            p.airM === 0 &&
            jumpedFor !== r.nextHurdleIndex
          ) {
            jumpedFor = r.nextHurdleIndex;
            press('ArrowUp');
          }
          // Keep the cadence exact on average: advance by whole periods, and only resync after a
          // stall (a catch-up burst could break the 35 ms minimum step interval).
          const period = 1000 / rate;
          if (now - lastStep >= period) {
            lastStep = now - lastStep > 2 * period ? now : lastStep + period;
            next = r.expectedSide ?? next;
            press(next === 'L' ? 'ArrowLeft' : 'ArrowRight');
            next = next === 'L' ? 'R' : 'L';
          }
        }, 4);
      }),
    opts,
  );
}

/**
 * Alternating Left/Right presses dispatched in page every `gapMs` for `durationMs`, so the spacing
 * holds on a loaded machine (Playwright key round trips can stall for hundreds of ms).
 */
export async function mashInPage(page: Page, durationMs: number, gapMs: number): Promise<void> {
  await page.evaluate(
    ([dur, gap]) =>
      new Promise<void>((resolve) => {
        let i = 0;
        const t0 = performance.now();
        const timer = window.setInterval(() => {
          const code = i++ % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
          window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
          if (performance.now() - t0 >= (dur as number)) {
            window.clearInterval(timer);
            resolve();
          }
        }, gap as number);
      }),
    [durationMs, gapMs],
  );
}
