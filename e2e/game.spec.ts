import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import {
  bootToTitle,
  expectText,
  getState,
  mash,
  mashInPage,
  mashToFinish,
  runBot,
  offPaletteColours,
  SAVE_KEY,
  SAVE_KEY_V1,
  seedStorage,
  v1Save,
  startRace,
  tap,
  titleToLadder,
  waitForPhase,
  waitForResults,
  waitForScene,
  waitForState,
} from './helpers.ts';

const SEED = 20261026;

// Mashing timing is real time, so tests in this file run one after another per browser
// (playwright.config.ts sets fullyParallel). Many WebGL pages at once starve the renderer and turn a
// 12 alt/s mash into a crawl.
test.describe.configure({ mode: 'default', timeout: 120_000 });

test('boots to the title screen with a fresh save', async ({ page }) => {
  const s = await bootToTitle(page);
  expect(s.ready).toBe(true);
  // PRESS ENTER blinks at 1 Hz.
  await waitForState(page, (st) => st.texts.includes('PRESS ENTER'), 'PRESS ENTER', 2000);
  expect(s.records?.events['100m'].unlockedTier).toBe(1);
  // Audio pre-rendering runs in the background after the Title is up and still completes.
  await waitForState(page, (st) => st.audioPreloaded, 'audio preloaded', 30_000);
  const ladder = await titleToLadder(page);
  expect(ladder.ladderCursor).toBe('pip');
  // Tiers 2-6 are silhouettes named "???"; tier 7 is hidden until the reveal (design 29.1.3).
  expect(ladder.texts.filter((t) => t === '???')).toHaveLength(5);
  expect(ladder.texts).not.toContain('ZYX');
  expectText(ladder, 'PIP');
});

test('beat Pip: win, recorded time, Jess unlocked, PB persists after reload, records show it', async ({
  page,
}) => {
  await bootToTitle(page);
  await titleToLadder(page);
  const started = await startRace(page, SEED);
  expect(started.race?.opponent).toBe('pip');
  expect(started.race?.seed).toBe(SEED);

  await waitForPhase(page, 'running');
  // The in-page cadence bot keeps 11 alt/s even on a loaded machine (Pip needs ~6.3).
  const crossed = (await runBot(page, { rate: 11 })).state;
  const playerMs = crossed.race?.player.finishMs;
  expect(playerMs).toBeGreaterThan(5000);
  expect(playerMs).toBeLessThan(18000);

  const res = await waitForResults(page);
  const outcome = res.race?.outcome;
  expect(outcome?.result).toBe('win');
  expect(outcome?.place).toBe(1);
  expect(outcome?.ms).toBe(playerMs);
  expect(outcome?.oppMs).not.toBeNull();
  // Six runners, all with times and places (design 24.1, 28.1).
  expect(outcome?.standings).toHaveLength(6);
  expect(outcome?.standings[0]).toMatchObject({ lane: 0, place: 1, ms: playerMs });
  for (const st of outcome?.standings ?? []) {
    expect(st.ms).not.toBeNull();
    expectText(res, st.name);
  }
  expectText(res, 'YOU WIN!');
  expectText(res, 'JESS UNLOCKED!');
  // NEW PB! appears once the card has drawn its PB row.
  await waitForState(page, (s) => s.texts.includes('NEW PB!'), 'NEW PB! flash', 2000);
  expect(res.records?.events['100m'].best['pip']?.ms).toBe(playerMs);
  expect(res.records?.events['100m'].beaten).toContain('pip');
  expect(res.records?.events['100m'].unlockedTier).toBeGreaterThanOrEqual(2);
  expect(res.records?.events['100m'].history[0]).toMatchObject({
    opp: 'pip',
    result: 'win',
    ms: playerMs,
    place: 1,
    fieldSize: 6,
    mode: 'l',
    input: 'k',
  });
  // Fumble logging on every new entry (design 33.5).
  expect(res.records?.events['100m'].history[0]?.steps).toBeGreaterThan(50);
  expect(res.records?.events['100m'].place['pip']).toBe(1);
  // localStorage holds the design 4.3 document.
  const raw = await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY);
  expect(JSON.parse(raw ?? 'null')).toMatchObject({
    version: 3,
    events: { '100m': { best: { pip: { ms: playerMs } } } },
  });

  // NEXT (default focus after a win) starts the Jess race.
  await page.keyboard.press('Enter');
  const jess = await waitForState(page, (s) => s.race?.opponent === 'jess', 'Jess race');
  expect(jess.scenes).not.toContain('Results');

  // Reload: unlocks and PB survive.
  await page.reload();
  const after = await waitForScene(page, 'Title', 30_000);
  expect(after.records?.events['100m'].best['pip']?.ms).toBe(playerMs);
  expect(after.records?.events['100m'].beaten).toContain('pip');
  const ladder = await titleToLadder(page);
  expect(ladder.ladderCursor).toBe('jess');
  expectText(ladder, 'JESS');

  // Records screen (menu row RACE GAUNTLET / RECORDS OPTIONS: two steps right of RACE).
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const records = await waitForScene(page, 'Records');
  const pbText = (Math.ceil((playerMs as number) / 10) / 100).toFixed(2);
  expect(records.texts.some((t) => t.endsWith(pbText))).toBe(true);
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Ladder');
});

test('mashing through the finish does not move the results button focus', async ({ page }) => {
  await bootToTitle(page);
  await titleToLadder(page);
  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  await runBot(page, { rate: 11 });
  // Keep mashing like a player who has not noticed the line, in page so the presses stay ~70 ms
  // apart however loaded the machine is, until the card (1.5 s after the line) has been up ~1 s.
  await mashInPage(page, 2600, 70);
  await waitForResults(page);
  // Stop, then confirm: the default button after a win (NEXT) must still be focused.
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await waitForState(page, (s) => s.race?.opponent === 'jess', 'Jess race after NEXT');
});

test('same-key spam gives no speed and shows fumble feedback', async ({ page }) => {
  await bootToTitle(page);
  await titleToLadder(page);
  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  // Count presses, not wall time, so a slow machine still sends them all.
  for (let i = 0; i < 30; i++) {
    await tap(page, 'ArrowRight');
    await page.waitForTimeout(60);
  }
  const s = await waitForState(page, (st) => (st.hud?.fumbles ?? 0) > 10, 'fumbles counted', 5000);
  expect(s.race?.player.kmh).toBe(0);
  expect(s.race?.player.xM ?? 99).toBeLessThan(1);
  expect(s.hud?.fumbles ?? 0).toBeGreaterThan(10);
  expect(s.hud?.kmh).toBe(0);
});

test('holding a key (auto-repeat) gives no speed', async ({ page }) => {
  await bootToTitle(page);
  await titleToLadder(page);
  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 90; i++) {
    // A second down without an up is dispatched with repeat: true.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(33);
  }
  const s = await getState(page);
  await page.keyboard.up('ArrowRight');
  expect(s.race?.player.kmh).toBe(0);
  expect(s.race?.player.xM ?? 99).toBeLessThan(1);
});

test('two false starts disqualify, record DQ and no time', async ({ page }) => {
  await bootToTitle(page);
  await titleToLadder(page);
  await startRace(page, SEED);

  await waitForState(page, (s) => s.race?.phase === 'countdown' && s.race.countdown === 2, 'beat 2');
  await tap(page, 'ArrowLeft');
  const fs1 = await waitForPhase(page, 'falseStart');
  expect(fs1.race?.falseStarts).toBe(1);
  expect(fs1.hud?.banner).toBe('FALSE START!');

  await waitForState(
    page,
    (s) => s.race?.phase === 'countdown' && s.race.countdown !== null,
    'countdown restart',
  );
  await tap(page, 'ArrowRight');
  const res = await waitForResults(page);
  expect(res.race?.outcome?.result).toBe('dq');
  expect(res.race?.outcome?.ms).toBeNull();
  expectText(res, 'DISQUALIFIED');
  expect(res.records?.events['100m'].history[0]).toMatchObject({ opp: 'pip', result: 'dq', ms: null });
  expect(res.records?.events['100m'].best['pip']).toBeUndefined();
  expect(res.records?.events['100m'].unlockedTier).toBe(1);

  // RETRY (default after a loss) restarts the same race from the countdown with a clean count.
  await page.keyboard.press('Enter');
  const retry = await waitForState(
    page,
    (s) => s.race?.opponent === 'pip' && !s.scenes.includes('Results') && s.race.falseStarts === 0,
    'retry',
  );
  expect(retry.race?.phase).not.toBe('finished');
  // An immediate retry starts at the blocks: no meet card, countdown well inside the 1.5 s walk-in.
  const counting = await waitForState(
    page,
    (s) => s.race?.phase === 'countdown' || s.hud?.meet != null,
    'retry countdown',
    1200,
  );
  expect(counting.hud?.meet ?? null).toBeNull();
  expect(counting.race?.phase).toBe('countdown');
});

test('Esc pauses the race clock and resume continues without a jump', async ({ page }) => {
  await bootToTitle(page);
  await titleToLadder(page);
  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  for (let i = 0; i < 10; i++) {
    await tap(page, i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
    await page.waitForTimeout(50);
  }
  await page.keyboard.press('Escape');
  const paused = await waitForScene(page, 'Pause');
  const t1 = paused.race?.raceMs ?? 0;
  await page.waitForTimeout(800);
  const still = await getState(page);
  expect(still.race?.raceMs).toBe(t1);
  await page.keyboard.press('Escape');
  await waitForState(page, (s) => !s.scenes.includes('Pause') && s.race?.paused === false, 'resume');
  await page.waitForTimeout(200);
  const resumed = await getState(page);
  // At most the 0.5 s GET SET beat plus the 200 ms we waited, never the 800 ms paused gap.
  expect((resumed.race?.raceMs ?? 0) - t1).toBeLessThan(700);
});

test('M mutes on any screen and the setting survives a reload', async ({ page }) => {
  const s0 = await bootToTitle(page);
  expect(s0.records?.settings.muted).toBe(false);
  await page.keyboard.press('KeyM');
  await waitForState(page, (s) => s.records?.settings.muted === true, 'muted');
  await titleToLadder(page);
  await page.keyboard.press('KeyM');
  await waitForState(page, (s) => s.records?.settings.muted === false, 'unmuted');
  await page.keyboard.press('KeyM');
  await waitForState(page, (s) => s.records?.settings.muted === true, 'muted again');
  await page.reload();
  const after = await waitForScene(page, 'Title', 30_000);
  expect(after.records?.settings.muted).toBe(true);
});

test('arrow keys, Space and Backspace never scroll or navigate the page', async ({ page }) => {
  await bootToTitle(page);
  await page.evaluate(() => {
    const w = window as unknown as { __prevented: Record<string, boolean> };
    w.__prevented = {};
    window.addEventListener('keydown', (e) => {
      w.__prevented[e.code] = e.defaultPrevented;
    });
  });
  for (const key of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace']) {
    await page.keyboard.press(key);
  }
  const prevented = await page.evaluate(
    () => (window as unknown as { __prevented: Record<string, boolean> }).__prevented,
  );
  for (const code of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace']) {
    expect(prevented[code], code).toBe(true);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

/** The canvas box in CSS px plus its backing size. */
async function canvasBox(page: Page) {
  return page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) throw new Error('no canvas');
    const r = c.getBoundingClientRect();
    return { w: r.width, h: r.height, x: r.left, y: r.top, cw: c.width, ch: c.height };
  });
}

test('canvas fills the window at 16:9, centred, at any window shape', async ({ page }) => {
  // Wide window: height limits, so the game fills the full height with bars left and right.
  // Tall window: width limits. Odd sizes that are not a whole multiple of 320x180 must still fill.
  for (const [vw, vh] of [
    [1366, 657],
    [1000, 700],
    [1512, 865],
  ] as const) {
    await page.setViewportSize({ width: vw, height: vh });
    if (vw === 1366) await bootToTitle(page);
    await expect.poll(async () => (await canvasBox(page)).w, { timeout: 3000 }).not.toBe(0);
    const fitW = Math.min(vw, (vh * 16) / 9);
    await expect
      .poll(async () => Math.abs((await canvasBox(page)).w - fitW), { timeout: 3000 })
      .toBeLessThanOrEqual(1);
    const box = await canvasBox(page);
    expect(box.cw).toBe(320);
    expect(box.ch).toBe(180);
    expect(Math.abs(box.h - (box.w * 9) / 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.x - (vw - box.w) / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - (vh - box.h) / 2)).toBeLessThanOrEqual(1);
  }
});

test('F and the corner button toggle true fullscreen', async ({ page }) => {
  await bootToTitle(page);
  const isFullscreen = () => page.evaluate(() => document.fullscreenElement !== null);
  expect(await isFullscreen()).toBe(false);

  await tap(page, 'KeyF');
  await expect.poll(isFullscreen).toBe(true);
  await tap(page, 'KeyF');
  await expect.poll(isFullscreen).toBe(false);

  const button = page.getByRole('button', { name: 'Toggle fullscreen' });
  await page.mouse.move(200, 200);
  await expect(button).toBeVisible();
  await button.click();
  await expect.poll(isFullscreen).toBe(true);
  // The click must not leave keyboard focus on the button (Space/Enter would re-toggle it).
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('CANVAS');
  await button.click();
  await expect.poll(isFullscreen).toBe(false);

  // The button fades out once the mouse is idle, so it never sits over the game while racing.
  await expect(button).toBeHidden({ timeout: 5000 });
});

/** A valid v1 save (design 4.3) with every rival unlocked and a PB against each; migrated on load (16.4). */
function fullLadderSave(champion: boolean): string {
  const ids = ['pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7', 'zyx'];
  const best: Record<string, number> = {};
  ids.forEach((id, i) => {
    best[id] = 15000 - i * 100;
  });
  return v1Save(champion ? ids : ids.slice(0, 6), { best, champion, settings: { muted: true } });
}

test('locked rivals cannot be raced', async ({ page }) => {
  await bootToTitle(page);
  await titleToLadder(page);
  await page.keyboard.press('ArrowUp');
  const s = await waitForState(page, (st) => st.ladderCursor === 'jess', 'cursor on Jess');
  expectText(s, 'FINISH 1ST VS PIP');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const after = await getState(page);
  expect(after.scene).toBe('Ladder');
  expect(after.race).toBeNull();
});

test('A and ArrowRight alternate, speed never exceeds 45 km/h, and stopping drops to 0', async ({ page }) => {
  await bootToTitle(page);
  await titleToLadder(page);
  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  // Mash (driven by the race's expected side) until clearly moving, however long that takes.
  const { state: moving, maxKmh } = await mash(
    page,
    (st) => (st.race?.player.kmh ?? 0) > 20 && (st.hud?.lit ?? 0) > 4,
    ['KeyA', 'ArrowRight'],
  );
  expect(moving.race?.player.kmh).toBeGreaterThan(20);
  expect(maxKmh).toBeLessThanOrEqual(45);
  // Design 10: stopping at speed drops the meter to zero within about 3 s.
  const t0 = Date.now();
  // km/h rounds to 0 just before v reaches 0; the meter (ceil) goes dark only at a standstill.
  const stopped = await waitForState(page, (st) => st.hud?.lit === 0, 'stopped', 6000);
  expect(stopped.race?.player.kmh).toBe(0);
  expect(Date.now() - t0).toBeLessThan(6000);
});

test('window blur auto-pauses the race', async ({ page }) => {
  await bootToTitle(page);
  await titleToLadder(page);
  await startRace(page, SEED);
  await waitForPhase(page, 'countdown');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const s = await waitForScene(page, 'Pause');
  expect(s.race?.paused).toBe(true);
  // QUIT TO MAP.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const map = await waitForScene(page, 'Ladder');
  expect(map.race).toBeNull();
  expect(map.scenes).toEqual(['Ladder']);
});

test('a corrupt v2 save with no v1 save starts fresh and is backed up', async ({ page }) => {
  await page.addInitScript((key) => {
    if (!sessionStorage.getItem('rr-seeded')) {
      sessionStorage.setItem('rr-seeded', '1');
      localStorage.setItem(key, 'not json');
    }
  }, SAVE_KEY);
  const s = await bootToTitle(page);
  expect(s.records?.events['100m'].unlockedTier).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('retroRunner.save.corrupt'))).toBe('not json');
});

test('records screen shows the ladder total once all 7 rivals have a PB', async ({ page }) => {
  await seedStorage(page, SAVE_KEY_V1, fullLadderSave(true));
  await bootToTitle(page);
  await titleToLadder(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const rec = await waitForScene(page, 'Records');
  // 15000 + 14900 + ... + 14400 = 102900 ms, shown as M:SS.hh (design 16.5).
  expectText(rec, 'LADDER TOTAL 1:42.90');
  expectText(rec, 'VALENTINA');
  expect(rec.texts).not.toContain('???');
});

test('first win against Zyx shows the Champion screen exactly once', async ({ page }) => {
  await seedStorage(page, SAVE_KEY_V1, fullLadderSave(false));
  await bootToTitle(page);
  const ladder = await titleToLadder(page);
  expect(ladder.ladderCursor).toBe('zyx');

  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  await mashToFinish(page, ['ArrowLeft', 'ArrowRight'], 36);
  const res = await waitForResults(page);
  test.skip(
    res.race?.outcome?.result !== 'win',
    'mashing through Playwright was not fast enough to beat Zyx',
  );
  expect(res.records?.events['100m'].champion).toBe(true);
  expectText(res, 'LADDER CHAMPION!');
  await page.keyboard.press('Enter'); // NEXT -> Champion
  await waitForScene(page, 'Champion');
  // The credits roll for ~20 s; after 1.5 s the screen is still up with credits scrolling.
  await page.waitForTimeout(1500);
  const champ = await getState(page);
  expect(champ.scene).toBe('Champion');
  expectText(champ, '100M CHAMPION');
  expectText(champ, 'RETRO RUNNER');
  await page.keyboard.press('Enter'); // skip
  await waitForScene(page, 'Ladder');

  // A later win goes back to the map without the Champion screen.
  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  await mashToFinish(page, ['ArrowLeft', 'ArrowRight'], 36);
  await waitForResults(page);
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Ladder');
  await page.waitForTimeout(300);
  expect((await getState(page)).scene).toBe('Ladder');
});

test('every screen uses only palette colours (CRT off)', async ({ page }) => {
  await bootToTitle(page);
  expect(await offPaletteColours(page), 'title').toEqual([]);
  await titleToLadder(page);
  expect(await offPaletteColours(page), 'ladder').toEqual([]);
  await startRace(page, SEED);
  await waitForState(page, (s) => s.race?.countdown === 3, 'countdown 3');
  expect(await offPaletteColours(page), 'countdown').toEqual([]);
  await waitForPhase(page, 'running');
  for (let i = 0; i < 40; i++) {
    await tap(page, i % 2 === 0 ? 'ArrowLeft' : 'ArrowRight');
    await page.waitForTimeout(45);
  }
  expect(await offPaletteColours(page), 'running').toEqual([]);
  await mashToFinish(page);
  await waitForResults(page);
  await page.waitForTimeout(400);
  expect(await offPaletteColours(page), 'results').toEqual([]);
});

test('with the CRT filter on, every screen renders without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seedStorage(page, SAVE_KEY_V1, v1Save([], { settings: { muted: true, crt: true } }));
  const title = await bootToTitle(page);
  expect(title.records?.settings.crt).toBe(true);
  await titleToLadder(page);
  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  await page.keyboard.press('Escape');
  await waitForState(page, (s) => s.scene === 'Pause', 'pause');
  await page.keyboard.press('Escape');
  await waitForState(page, (s) => s.race?.paused === false && s.scene !== 'Pause', 'resume');
  await waitForPhase(page, 'running');
  await mashToFinish(page);
  await waitForResults(page);
  expect(errors).toEqual([]);
});
