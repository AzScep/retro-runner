import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  beatenEvent,
  bootToTitle,
  eventsToLadder,
  expectButton,
  expectText,
  getState,
  runBot,
  SAVE_KEY,
  SAVE_KEY_V2,
  seedStorage,
  startRace,
  tap,
  titleToEvents,
  titleToLadder,
  v3Save,
  waitForPhase,
  waitForScene,
  waitForScenes,
  waitForState,
  type GameState,
} from './helpers.ts';

/**
 * v3 flows (design 23-38): 6-runner HUD, results medals, hidden tier 7 and the Zyx reveal, the
 * v2 migration skip, Gauntlet runs and the trip flag. Races run in real time, so one page at a time.
 */
test.describe.configure({ mode: 'default', timeout: 120_000 });

const SEED = 20261028;

/** In-page key press (same listener path as a keyboard), for presses that must be close together. */
async function pressInPage(page: Page, codes: readonly string[], gapMs: number): Promise<void> {
  await page.evaluate(
    ([list, gap]) =>
      new Promise<void>((resolve) => {
        let i = 0;
        const next = (): void => {
          const code = (list as string[])[i++];
          if (code === undefined) {
            resolve();
            return;
          }
          window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
          window.setTimeout(next, gap as number);
        };
        next();
      }),
    [codes, gapMs] as const,
  );
}

/** Title -> Event Select -> 100 m card: a pending reveal plays instead of the ladder (30.1.5). */
async function openPendingReveal(page: Page): Promise<GameState> {
  await titleToEvents(page);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  return waitForScene(page, 'Reveal');
}

/** Stages the results card with a synthetic outcome (the hook exposes the Phaser game for this). */
async function stageResults(
  page: Page,
  outcome: Record<string, unknown>,
  record: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ([o, r]) => {
      const game = (
        window.__retroRunner as unknown as {
          game: {
            scene: {
              start(k: string, d: object): void;
              pause(k: string): void;
              getScenes(active: boolean): { sys: { settings: { key: string } } }[];
            };
          };
        }
      ).game;
      // The screen below stops taking keys, as RaceScene does under a real results card.
      for (const sc of game.scene.getScenes(true)) {
        if (sc.sys.settings.key !== 'Results') game.scene.pause(sc.sys.settings.key);
      }
      game.scene.start('Results', { outcome: o, record: r });
    },
    [outcome, record] as const,
  );
  await waitForScenes(page, 'Results');
}

const FIELD_1 = (variant: string, name: string) => ({
  kind: 'field',
  field: { tier: 1, body: 'fKid', variant, name },
});

/** A 2nd place against Kofi in a 6-runner 100 m (synthetic, for the medal row). */
function secondPlaceOutcome(): Record<string, unknown> {
  const s = (lane: number, who: object, name: string, ms: number, place: number) => ({
    lane,
    who,
    name,
    ms,
    place,
  });
  return {
    event: '100m',
    opponent: 'kofi',
    result: 'lose',
    ms: 12700,
    oppMs: 12900,
    marginMs: -200,
    photoFinish: false,
    falseStarts: 0,
    seed: 1,
    hit: null,
    splits: [],
    mode: 'l',
    place: 2,
    fieldSize: 6,
    winMs: 12600,
    standings: [
      s(3, FIELD_1('A', 'DOT'), 'DOT', 12600, 1),
      s(0, { kind: 'player', id: 'rio' }, 'RIO', 12700, 2),
      s(1, { kind: 'rival', id: 'kofi' }, 'KOFI', 12900, 3),
      s(2, FIELD_1('B', 'MILO'), 'MILO', 13000, 4),
      s(4, FIELD_1('C', 'BEA'), 'BEA', 13100, 5),
      s(5, FIELD_1('D', 'NOOR'), 'NOOR', 13200, 6),
    ],
    steps: 120,
    fumbles: 0,
    fumble2: 0,
    trips: 0,
    input: 'k',
  };
}

const RECORD = {
  newPb: false,
  previousPbMs: null,
  unlocked: null,
  unlockedEvent: null,
  becameChampion: false,
  place: 2,
  newBestPlace: null,
  revealPending: false,
};

test('a 6-runner race: meet card, starter bubbles, live place and off-screen leader', async ({ page }) => {
  await bootToTitle(page);
  await titleToLadder(page);
  await startRace(page, SEED);
  const intro = await waitForState(page, (s) => s.hud?.meet != null, 'meet card');
  expect(intro.hud?.meet).toBe('SPORTS DAY | 100M FINAL - VS PIP');
  expect(intro.hud?.place).toBeNull();
  // Ladder races keep the PB line and have no strip.
  expect(intro.texts.some((t) => t.startsWith('PB '))).toBe(true);
  expect(intro.hud?.stripBox).toBeNull();
  expect(intro.race?.runners).toHaveLength(6);
  expect(intro.race?.runners.map((r) => r.kind)).toEqual([
    'player',
    'rival',
    'field',
    'field',
    'field',
    'field',
  ]);
  // The card shows inside the 1.5 s intro walk, never lengthening it (31.1).
  await waitForState(page, (s) => s.hud?.meet === null, 'meet card hidden', 3000);
  const marks = await waitForState(page, (s) => s.race?.countdown === 3, 'beat 3');
  expect(marks.hud?.bubble).toBe('ON YOUR MARKS');
  const set = await waitForState(page, (s) => s.race?.countdown === 1, 'beat 1');
  expect(set.hud?.bubble).toBe('SET');
  const go = await waitForPhase(page, 'running');
  expect(go.hud?.bubble).toBeNull();
  // Standing still: everyone runs away, so the player drops to 6TH and the leader goes off-screen.
  const last = await waitForState(page, (s) => s.hud?.place === '6TH', '6TH', 8000);
  expect(last.race?.livePlace).toBe(6);
  const ahead = await waitForState(page, (s) => s.hud?.leader != null, 'leader indicator', 10_000);
  expect(ahead.hud?.leader).toMatch(/^\d+\.\dM$/);
  expect(ahead.hud?.behind).toBeNull();
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Pause');
});

test('a fresh profile hides tier 7 on the ladder, records and event card; GAUNTLET is locked', async ({
  page,
}) => {
  await bootToTitle(page);
  const events = await titleToEvents(page);
  expectText(events, '0/6');
  const ladder = await eventsToLadder(page, '100m');
  expect(ladder.texts.filter((t) => t === '???')).toHaveLength(5);
  expect(ladder.texts).not.toContain('ZYX');
  expectText(ladder, 'BEST   --');
  expectButton(ladder, 'GAUNTLET');
  // Up from Unit-7's row never reaches tier 7.
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
  expect((await getState(page)).ladderCursor).toBe('unit7');
  // GAUNTLET (right of RACE): locked, with the no-spoiler note.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const note = await waitForState(
    page,
    (s) => s.texts.join(' ').includes('WIN THE NEON CUP FIRST'),
    'locked note',
    3000,
  );
  expect(note.scene).toBe('Ladder');
  // RECORDS: 6 rows and the locked Gauntlet footer.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const rec = await waitForScene(page, 'Records');
  expect(rec.texts.filter((t) => t === '???')).toHaveLength(5);
  expect(rec.texts).not.toContain('ZYX');
  expectText(rec, 'GAUNTLET LOCKED');
});

test('best placings: medal pips, BEST line, records places and the SILVER! row', async ({ page }) => {
  await seedStorage(
    page,
    SAVE_KEY,
    v3Save({
      events: {
        '100m': {
          ...beatenEvent(3, false),
          unlockedTier: 4,
          place: { pip: 1, jess: 1, marco: 1, kofi: 3 },
        },
      },
    }),
  );
  await bootToTitle(page);
  const ladder = await titleToLadder(page);
  expect(ladder.ladderCursor).toBe('kofi');
  expectText(ladder, 'BEST   3RD');
  // A 2nd place now improves the best placing: SILVER! with the medal (28.1).
  await stageResults(page, secondPlaceOutcome(), { ...RECORD, newBestPlace: 2 });
  const res = await getState(page);
  for (const t of ['2ND PLACE', 'SILVER!', 'TO 1ST +0.10', 'DOT', 'MILO', 'BEA', 'NOOR', 'KOFI', 'RIO'])
    expectText(res, t);
  expectButton(res, 'RETRY');
  // Without a new best and ahead of the named rival: AHEAD OF KOFI
  await stageResults(page, secondPlaceOutcome(), RECORD);
  expectText(await getState(page), 'AHEAD OF KOFI');
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Ladder');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const rec = await waitForScene(page, 'Records');
  expect(rec.texts.filter((t) => t === '1ST')).toHaveLength(3);
  expectText(rec, '3RD');
});

test('winning the championship: CHAMPIONSHIP WON! offers only CONTINUE, which starts the reveal', async ({
  page,
}) => {
  await seedStorage(page, SAVE_KEY, v3Save({ events: { '100m': beatenEvent(6, false) } }));
  await bootToTitle(page);
  // The seeded save already has tier 6 beaten, so the ladder would replay the reveal: stage the card
  // from the event select instead.
  await titleToEvents(page);
  const outcome = {
    ...secondPlaceOutcome(),
    opponent: 'unit7',
    result: 'win',
    place: 1,
    ms: 10900,
    winMs: 10900,
  };
  await stageResults(page, outcome, { ...RECORD, place: 1, revealPending: true });
  const res = await getState(page);
  expectText(res, 'CHAMPIONSHIP WON!');
  expectButton(res, 'CONTINUE');
  expect(res.texts.map((t) => t.replace(/[[\]]/g, '').trim())).not.toContain('RETRY');
  // Esc and R do nothing here; Enter continues.
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(200);
  expect((await getState(page)).scenes).toContain('Results');
  await page.keyboard.press('Enter');
  const reveal = await waitForScene(page, 'Reveal');
  expectText(reveal, 'SIX RIVALS BEATEN');
});

test('the full reveal plays once, the second event plays the short one, a reload replays it', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await seedStorage(
    page,
    SAVE_KEY,
    v3Save({ events: { '100m': beatenEvent(6, false), '110mh': beatenEvent(6, false) } }),
  );
  await bootToTitle(page);
  const events = await titleToEvents(page);
  expectText(events, '6/6');
  // Opening the ladder with a pending reveal plays it first (30.1.5).
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  const card = await waitForScene(page, 'Reveal');
  const t0 = Date.now();
  expectText(card, '100M CHAMPION');
  expectText(card, 'SIX RIVALS BEATEN');
  await waitForState(page, (s) => s.texts.includes('WAIT.'), 'WAIT.', 8000);
  await waitForState(page, (s) => s.texts.includes('SOMETHING IS ON THE TRACK.'), 'second line', 4000);
  await waitForState(page, (s) => s.texts.includes('CUTE TROPHY.'), 'first bubble', 8000);
  await waitForState(page, (s) => s.texts.includes('NOW RUN WITH US.'), 'second bubble', 4000);
  const final = await waitForState(page, (s) => s.texts.includes('ZYX UNLOCKED!'), 'final card', 6000);
  expect(Date.now() - t0).toBeGreaterThan(11_500);
  expectText(final, 'GALACTIC MEET');
  expect(final.records?.events['100m'].revealed).toBe(true);
  expect(final.records?.hints.revealSeen).toBe(true);
  await page.keyboard.press('Enter');
  const ladder = await waitForState(page, (s) => s.scene === 'Ladder' && s.texts.includes('ZYX'), 'tier 7');
  expect(ladder.ladderCursor).toBe('zyx');
  await page.keyboard.press('Escape');
  const after = await waitForScene(page, 'Events');
  expectText(after, '6/7');

  // Hurdles: the short version (no fake card); a reload mid-reveal replays it on the next visit.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const short = await waitForScene(page, 'Reveal');
  expect(short.texts).not.toContain('SIX RIVALS BEATEN');
  await page.waitForTimeout(800);
  await page.reload();
  await waitForScene(page, 'Title', 30_000);
  expect((await getState(page)).records?.events['110mh'].revealed).toBe(false);
  await titleToEvents(page);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Reveal');
  const t1 = Date.now();
  await waitForState(page, (s) => s.texts.includes('AGAIN?'), 'short bubble', 6000);
  await waitForState(page, (s) => s.texts.includes('ZYX UNLOCKED!'), 'short final', 8000);
  const dt = Date.now() - t1;
  expect(dt).toBeGreaterThan(5000);
  expect(dt).toBeLessThan(9000);
  await page.keyboard.press('Enter');
  await waitForState(
    page,
    (s) => s.scene === 'Ladder' && s.event === '110mh' && s.texts.includes('ZYX'),
    'hurdles tier 7',
  );
  // Never twice in the same event.
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Events');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  expect((await getState(page)).scene).toBe('Ladder');
});

test('the reveal skips to the final card only after 1 s and marks the event revealed', async ({ page }) => {
  await seedStorage(page, SAVE_KEY, v3Save({ events: { '100m': beatenEvent(6, false) } }));
  await bootToTitle(page);
  await openPendingReveal(page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  const early = await getState(page);
  expect(early.texts).not.toContain('ZYX UNLOCKED!');
  expect(early.records?.events['100m'].revealed).toBe(false);
  await page.waitForTimeout(1000);
  await page.keyboard.press('Space');
  const skipped = await waitForState(
    page,
    (s) => s.texts.includes('ZYX UNLOCKED!'),
    'skipped to final',
    1500,
  );
  expect(skipped.records?.events['100m'].revealed).toBe(true);
  await page.keyboard.press('Enter');
  await waitForState(page, (s) => s.scene === 'Ladder' && s.ladderCursor === 'zyx', 'ladder at Zyx');
});

/** A v2 document (design 16.2) with the 100 m won up to UNIT-7 (Zyx unlocked). */
function v2ZyxUnlocked(): string {
  const fresh = { unlockedTier: 1, beaten: [], champion: false, best: {}, history: [] };
  const beaten = ['pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7'];
  return JSON.stringify({
    version: 2,
    lastEvent: '100m',
    seenEvents: ['100m', '110mh', '400m'],
    hints: { addToHomeScreen: true },
    settings: {
      volume: 8,
      muted: true,
      reducedFlashing: false,
      screenShake: true,
      crt: false,
      haptics: true,
    },
    events: {
      '100m': {
        unlockedTier: 7,
        beaten,
        champion: false,
        best: {},
        history: [
          {
            opp: 'unit7',
            result: 'win',
            ms: 10900,
            oppMs: 11000,
            falseStarts: 0,
            seed: 3,
            at: '2026-10-01T10:00:00.000Z',
          },
          {
            opp: 'zyx',
            result: 'lose',
            ms: 10700,
            oppMs: 10400,
            falseStarts: 0,
            seed: 4,
            at: '2026-10-01T10:01:00.000Z',
          },
        ],
      },
      '110mh': fresh,
      '400m': fresh,
    },
  });
}

test('a v2 save with Zyx unlocked migrates to v3 and never plays the reveal', async ({ page }) => {
  const v2 = v2ZyxUnlocked();
  await seedStorage(page, SAVE_KEY_V2, v2);
  const title = await bootToTitle(page);
  const r = title.records;
  expect(r?.version).toBe(3);
  expect(r?.events['100m'].revealed).toBe(true);
  expect(r?.hints.revealSeen).toBe(true);
  expect(r?.events['100m'].place).toEqual({ pip: 1, jess: 1, marco: 1, kofi: 1, valentina: 1, unit7: 1 });
  // Old losses carry no medal (23.2.6).
  expect(r?.events['100m'].place['zyx']).toBeUndefined();
  expect(r?.events['100m'].history.find((h) => h.opp === 'zyx')).toMatchObject({ place: 2, fieldSize: 2 });
  expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY_V2)).toBe(v2);
  const ladder = await titleToLadder(page);
  expect(ladder.scene).toBe('Ladder');
  expectText(ladder, 'ZYX');
  expect(ladder.ladderCursor).toBe('zyx');
});

/** Ladder (RACE focused) -> GAUNTLET -> intro card. */
async function openGauntlet(page: Page): Promise<GameState> {
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  return waitForState(
    page,
    (s) => s.scene === 'Gauntlet' && s.texts.includes('GAUNTLET') && s.texts.includes('100 METRES'),
    'intro',
  );
}

test('Gauntlet: a won race leads to the next meet, ABANDON RUN ends it and records the run', async ({
  page,
}) => {
  await seedStorage(page, SAVE_KEY, v3Save({ events: { '100m': beatenEvent(6, true) }, revealSeen: true }));
  await bootToTitle(page);
  await titleToLadder(page);
  const intro = await openGauntlet(page);
  expectText(intro, 'FURTHEST 0/7');
  expectButton(intro, 'START');
  await page.evaluate((n) => window.__retroRunner?.seed(n), SEED);
  await page.keyboard.press('Enter');
  const race1 = await waitForState(page, (s) => s.race?.mode === 'g' && s.hud !== null, 'race 1');
  expect(race1.race?.opponent).toBe('pip');
  expect(race1.gauntlet?.tier).toBe(1);
  const meet1 = await waitForState(page, (s) => s.hud?.meet != null, 'meet card');
  expect(meet1.hud?.meet).toBe('SPORTS DAY | MEET 1 OF 7 - VS PIP');
  expect(meet1.hud?.strip).toBe('1/7  TOTAL 0:00.00');
  // The strip replaces the PB line: no PB, and it clears the timer (x <= 215) and the finish flag
  // above the progress bar (y >= 16).
  expect(meet1.texts.some((t) => t.startsWith('PB '))).toBe(false);
  const box = meet1.hud?.stripBox;
  expect(box).not.toBeNull();
  expect(box?.x ?? 0).toBeGreaterThan(215);
  expect((box?.x ?? 0) + (box?.w ?? 999)).toBeLessThanOrEqual(316);
  expect(box?.y).toBe(4);
  expect((box?.y ?? 99) + (box?.h ?? 99)).toBeLessThan(16);
  await waitForPhase(page, 'running');
  await runBot(page, { rate: 11 });
  const between = await waitForState(page, (s) => s.texts.includes('MEET 1 WON!'), 'between card', 6000);
  expectText(between, 'NEXT: SCHOOL CHAMPS');
  expect(between.gauntlet?.tier).toBe(2);
  expect(between.records?.events['100m'].history[0]).toMatchObject({ mode: 'g', place: 1 });
  // Auto-advance after 3 s.
  const race2 = await waitForState(
    page,
    (s) => s.race?.opponent === 'jess' && s.race.mode === 'g',
    'race 2',
    6000,
  );
  expect(race2.scenes).not.toContain('Gauntlet');
  await waitForState(page, (s) => (s.hud?.strip ?? '').startsWith('2/7  TOTAL '), 'strip 2/7', 3000);
  // Pause: RESUME and ABANDON RUN only.
  await page.keyboard.press('Escape');
  const paused = await waitForScene(page, 'Pause');
  expectText(paused, 'RESUME');
  expectText(paused, 'ABANDON RUN');
  expect(paused.texts).not.toContain('RESTART');
  expect(paused.texts).not.toContain('QUIT TO MAP');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const over = await waitForState(page, (s) => s.texts.includes('GAUNTLET OVER'), 'over card');
  expectText(over, 'ABANDONED AT SCHOOL CHAMPS');
  expectText(over, 'FURTHEST 1/7');
  expectText(over, 'NEW FURTHEST!');
  expect(over.records?.events['100m'].gauntlet).toMatchObject({
    runs: 1,
    clears: 0,
    furthest: 1,
    best: null,
  });
  expect(over.gauntlet).toBeNull();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Ladder');
});

test('Gauntlet: a DQ ends the run; NEW RUN restarts at meet 1', async ({ page }) => {
  await seedStorage(page, SAVE_KEY, v3Save({ events: { '100m': beatenEvent(6, true) }, revealSeen: true }));
  await bootToTitle(page);
  await titleToLadder(page);
  await openGauntlet(page);
  await page.keyboard.press('Enter');
  await waitForState(page, (s) => s.race?.phase === 'countdown' && s.race.countdown === 2, 'beat 2');
  await tap(page, 'ArrowLeft');
  await waitForPhase(page, 'falseStart');
  await waitForState(page, (s) => s.race?.phase === 'countdown' && s.race.countdown !== null, 'restart');
  await tap(page, 'ArrowRight');
  const over = await waitForState(page, (s) => s.texts.includes('GAUNTLET OVER'), 'over card');
  expectText(over, 'OUT AT SPORTS DAY - DQ');
  expectText(over, 'FURTHEST 0/7');
  expect(over.records?.events['100m'].gauntlet).toMatchObject({ runs: 1, furthest: 0 });
  expect(over.scenes).not.toContain('Results');
  await page.keyboard.press('Enter');
  const again = await waitForState(
    page,
    (s) => s.race?.mode === 'g' && s.race.falseStarts === 0 && !s.scenes.includes('Gauntlet'),
    'new run',
  );
  expect(again.gauntlet).toMatchObject({ tier: 1, times: [] });
});

test('Gauntlet: winning meet 7 clears the run and records the total and the 7 times', async ({ page }) => {
  await seedStorage(page, SAVE_KEY, v3Save({ events: { '100m': beatenEvent(6, true) }, revealSeen: true }));
  await bootToTitle(page);
  await titleToLadder(page);
  const won = [16010, 13420, 12280, 11690, 10990, 10560];
  await page.evaluate((n) => window.__retroRunner?.seed(n), SEED);
  await page.evaluate((t) => window.__retroRunner?.startGauntletRace(7, t), won);
  const race = await waitForState(page, (s) => s.race?.opponent === 'zyx' && s.race.mode === 'g', 'meet 7');
  expect(race.hud?.meet ?? (await waitForState(page, (s) => s.hud?.meet != null, 'meet')).hud?.meet).toBe(
    'GALACTIC MEET | MEET 7 OF 7 - VS ZYX',
  );
  await waitForPhase(page, 'running');
  await runBot(page, { rate: 14 });
  const end = await waitForState(page, (s) => s.scenes.includes('Gauntlet'), 'Gauntlet card', 6000);
  test.skip(end.race?.outcome?.place !== 1, 'the bot did not win meet 7');
  const clear = await waitForState(page, (s) => s.texts.includes('GAUNTLET CLEAR!'), 'clear card');
  expectText(clear, 'NEW BEST!');
  const g = clear.records?.events['100m'].gauntlet;
  expect(g?.clears).toBe(1);
  expect(g?.furthest).toBe(7);
  expect(g?.best?.times).toHaveLength(7);
  expect(g?.best?.times.slice(0, 6)).toEqual(won);
  expect(g?.best?.ms).toBe((g?.best?.times ?? []).reduce((a, b) => a + b, 0));
  // MAP, then Records shows the Gauntlet line. The first Zyx win in this event also earns the
  // champion screen (Gauntlet races count as normal races, 32.4), which Enter skips.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const map = await waitForState(page, (s) => s.scene === 'Ladder' || s.scene === 'Champion', 'map');
  if (map.scene === 'Champion') {
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Ladder');
  }
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const rec = await waitForScene(page, 'Records');
  expect(rec.texts.some((t) => t.startsWith('GAUNTLET BEST ') && t.endsWith('FURTHEST 7/7'))).toBe(true);
});

test('the trip is off by default: two fumbles in a row only fumble; the test flag turns it on', async ({
  page,
}) => {
  await bootToTitle(page);
  await titleToLadder(page);
  expect((await getState(page)).tripEnabled).toBe(false);
  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  // A valid step, then two fumbles 60 ms apart (rule C, 33.1).
  await pressInPage(page, ['ArrowLeft', 'ArrowLeft', 'ArrowLeft'], 60);
  const off = await waitForState(page, (s) => (s.hud?.fumbles ?? 0) >= 2, 'two fumbles', 3000);
  await page.waitForTimeout(300);
  const still = await getState(page);
  expect(still.race?.trip).toBe('none');
  expect(still.hud?.trip).toBe(false);
  expect(off.race?.player.anim).not.toBe('fall');

  // Flag on: the same presses trip Rio (fall, TRIP! popup).
  await page.evaluate(() => window.__retroRunner?.setTrip(true));
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Pause');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  // RESTART builds a new race: wait for its intro before waiting for GO.
  await waitForState(page, (s) => s.race?.phase === 'intro' && !s.scenes.includes('Pause'), 'restart');
  await waitForPhase(page, 'running');
  await pressInPage(page, ['ArrowLeft', 'ArrowLeft', 'ArrowLeft'], 60);
  const tripped = await waitForState(
    page,
    (s) => s.race?.trip === 'fall' || s.race?.trip === 'lie',
    'trip',
    3000,
  );
  expect(tripped.hud?.trip).toBe(true);
  await waitForState(page, (s) => s.race?.trip === 'none', 'back up', 3000);
  await page.evaluate(() => window.__retroRunner?.setTrip(null));
});

test('every v3 screen uses only palette colours', async ({ page }) => {
  await seedStorage(page, SAVE_KEY, v3Save({ events: { '100m': beatenEvent(6, false) } }));
  await bootToTitle(page);
  await openPendingReveal(page);
  const check = async (what: string): Promise<void> => {
    const r = await page.evaluate(() => window.__retroRunner?.paletteCheck());
    expect(r?.offPalette ?? ['no hook'], what).toEqual([]);
  };
  await check('fake champion card');
  await page.waitForTimeout(1100);
  await page.keyboard.press('Enter');
  await waitForState(page, (s) => s.texts.includes('ZYX UNLOCKED!'), 'final card', 2000);
  await check('reveal final card');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Ladder');
  await page.waitForTimeout(700);
  await check('ladder with tier 7');
  await openGauntlet(page);
  await check('gauntlet intro');
  await page.keyboard.press('Enter');
  await waitForState(page, (s) => s.hud?.meet != null, 'meet card');
  await check('meet card');
  await waitForState(page, (s) => s.hud?.bubble != null, 'bubble');
  await check('starter bubble');
});
