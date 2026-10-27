import { expect, test } from './fixtures.ts';
import {
  bootToTitle,
  eventsToLadder,
  expectButton,
  expectText,
  expectWrappedText,
  getState,
  runBot,
  SAVE_KEY,
  SAVE_KEY_V1,
  SAVE_KEY_V2,
  seedStorage,
  startRace,
  tap,
  titleToEvents,
  titleToLadder,
  v1Save,
  waitForPhase,
  waitForResults,
  waitForScene,
  waitForState,
  type GameState,
} from './helpers.ts';

const SEED = 20261027;

// Races run in real time; keep one page per worker busy at a time (see game.spec.ts).
test.describe.configure({ mode: 'default', timeout: 180_000 });

const KOFI_BEATEN = ['pip', 'jess', 'marco', 'kofi'];
const PBS = { pip: 14000, jess: 13500, marco: 13000, kofi: 12500 };

/** v1 save with the 100 m beaten up to Kofi: migration unlocks hurdles and the 400 m (12.2, 16.4). */
function kofiSave(): string {
  return v1Save(KOFI_BEATEN, { best: PBS, settings: { volume: 5, muted: true } });
}

function hudTimes(s: GameState): string[] {
  return s.texts.filter((t) => /^\d+:\d\d\.\d\d$/.test(t));
}

test('a fresh profile shows 100 m unlocked and both other events locked', async ({ page }) => {
  await bootToTitle(page);
  const s = await titleToEvents(page);
  expectText(s, 'SELECT EVENT');
  expectWrappedText(s, 'BEAT MARCO IN 100M');
  expectWrappedText(s, 'BEAT KOFI IN 100M');
  expectWrappedText(s, 'OR MARCO IN HURDLES');
  // Before the reveal the event card counts 6 rivals (29.3.1).
  expectText(s, '0/6');
  // A locked card does not open.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  expect((await getState(page)).scene).toBe('Events');
  // Esc goes back to the title.
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Title');
});

test('beating Marco in the 100 m unlocks hurdles with NEW EVENT and a NEW! badge until opened', async ({
  page,
}) => {
  await seedStorage(page, SAVE_KEY_V1, v1Save(['pip', 'jess'], { best: { pip: 14000, jess: 13500 } }));
  await bootToTitle(page);
  const ladder = await titleToLadder(page);
  expect(ladder.ladderCursor).toBe('marco');
  await startRace(page, SEED);
  await waitForPhase(page, 'running');
  await runBot(page, { rate: 12 });
  const res = await waitForResults(page);
  expect(res.race?.outcome?.result).toBe('win');
  expectText(res, 'KOFI UNLOCKED!');
  expectText(res, 'NEW EVENT:');
  expectText(res, '110M HURDLES');
  expect(res.records?.seenEvents).not.toContain('110mh');

  // MAP -> ladder -> Esc -> event select: hurdles unlocked, not yet seen (NEW! badge).
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Ladder');
  await page.keyboard.press('Escape');
  const events = await waitForScene(page, 'Events');
  expect(events.texts.join(' ')).not.toContain('BEAT MARCO IN 100M');
  expectWrappedText(events, 'BEAT KOFI IN 100M');
  // Opening the hurdles ladder marks it seen and makes it the last event (18.3.4).
  const hurdles = await eventsToLadder(page, '110mh');
  expectText(hurdles, '110M HURDLES');
  expect(hurdles.ladderCursor).toBe('pip');
  expect(hurdles.records?.seenEvents).toContain('110mh');
  expect(hurdles.records?.lastEvent).toBe('110mh');
  // Hurdles ladder starts at Pip with its own targets (15.6).
  expectText(hurdles, 'TARGET 22.00');
});

test('hurdles: clean jumps beat no jumps, record hit, and show CLEAN RACE / HURDLES HIT', async ({
  page,
}) => {
  await seedStorage(page, SAVE_KEY_V1, kofiSave());
  await bootToTitle(page);
  await titleToLadder(page, '110mh');

  // First hurdles race: the intro shows the keyboard tip.
  await startRace(page, SEED);
  const intro = await waitForState(page, (s) => s.hud?.tip !== null && s.hud?.tip !== undefined, 'tip');
  expect(intro.hud?.tip).toBe('UP TO JUMP');
  await waitForPhase(page, 'running');
  await runBot(page, { rate: 10, jumps: 'clean' });
  const cleanRes = await waitForResults(page);
  const co = cleanRes.race?.outcome;
  expect(co?.event).toBe('110mh');
  // Takeoffs are sampled every few ms in page; under heavy load a frame can slip past the 192 ms
  // clean window, so allow a couple of clips. The exact window is unit-tested in core.
  expect(co?.hit).toBeLessThanOrEqual(2);
  // Design 13.3: 10 alt/s, all clean, ~14.5 s (a clip costs ~0.4 s).
  expect(co?.ms ?? 0).toBeGreaterThan(13_000);
  expect(co?.ms ?? 99_999).toBeLessThan(17_500);
  expectText(cleanRes, co?.hit === 0 ? 'CLEAN RACE!' : `HIT ${co?.hit}/10`);
  expect(cleanRes.records?.events['110mh'].history[0]?.hit).toBe(co?.hit);

  // RETRY, never jump: every hurdle knocked, much slower, still under the 40 s cap.
  await page.evaluate((n) => window.__retroRunner?.seed(n), SEED);
  await page.keyboard.press('KeyR');
  await waitForState(
    page,
    (s) => !s.scenes.includes('Results') && s.race?.phase === 'running',
    'retry running',
  );
  // Not the first race any more: no JUMP label.
  const g = await waitForState(page, (s) => s.hud?.gauge.visible === true, 'gauge', 5000).catch(() => null);
  const none = await runBot(page, { rate: 10, jumps: 'none' });
  expect(g?.hud?.gauge.label ?? false).toBe(false);
  expect(none.state.race?.player.hurdlesKnocked.filter(Boolean).length).toBe(10);
  const noneRes = await waitForResults(page);
  const no = noneRes.race?.outcome;
  expect(no?.hit).toBe(10);
  expect(no?.ms ?? 0).toBeGreaterThan((co?.ms ?? 0) + 5000);
  expect(no?.ms ?? 99_999).toBeLessThan(40_000);
  expectText(noneRes, 'HIT 10/10');
  expect(noneRes.hud?.knockedTicks).toBe(10);
});

test('jump is a false start in the hurdles only', async ({ page }) => {
  await seedStorage(page, SAVE_KEY_V1, kofiSave());
  await bootToTitle(page);
  // 100 m: Up during the countdown does nothing.
  await titleToLadder(page, '100m');
  await startRace(page, SEED);
  await waitForState(page, (s) => s.race?.phase === 'countdown' && s.race.countdown === 2, 'beat 2');
  await tap(page, 'ArrowUp');
  await page.waitForTimeout(300);
  const s100 = await getState(page);
  expect(s100.race?.falseStarts).toBe(0);
  expect(s100.race?.phase).not.toBe('falseStart');
  // Quit to the map, back to event select, open hurdles.
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Pause');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitForScene(page, 'Ladder');
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Events');
  await eventsToLadder(page, '110mh');
  await startRace(page, SEED);
  await waitForState(page, (s) => s.race?.phase === 'countdown' && s.race.countdown === 2, 'beat 2');
  await tap(page, 'ArrowUp');
  const fs = await waitForPhase(page, 'falseStart');
  expect(fs.race?.falseStarts).toBe(1);
  expect(fs.hud?.banner).toBe('FALSE START!');
});

test('400 m: paced running beats flat out, splits are recorded, times show M:SS.hh', async ({ page }) => {
  await seedStorage(page, SAVE_KEY_V1, kofiSave());
  await bootToTitle(page);
  const ladder = await titleToLadder(page, '400m');
  expectText(ladder, 'TARGET 1:12.00');
  expectText(ladder, '400 METRES');

  // Flat out from GO: stamina empties early, the runner fades.
  await startRace(page, SEED);
  const intro = await waitForState(page, (s) => (s.hud?.tip ?? null) !== null, 'tip');
  expect(intro.hud?.tip).toBe('WATCH STAMINA. STEADY BEATS FAST.');
  await waitForPhase(page, 'running');
  const running = await getState(page);
  expect(running.hud?.stamina?.fill).toBe(56);
  const flat = await runBot(page, { rate: 14, timeoutMs: 100_000 });
  expect(flat.emptyAtM).not.toBeNull();
  expect(flat.emptyAtM ?? 999).toBeLessThan(200);
  const flatRes = await waitForResults(page);
  const fo = flatRes.race?.outcome;
  expect(fo?.event).toBe('400m');
  expect(fo?.splits).toHaveLength(3);
  // Design 14.2: flat out finishes near 60 s.
  expect(fo?.ms ?? 0).toBeGreaterThan(54_000);

  // RETRY at an even ~8 alt/s: stamina never empties and the time is better (~52 s).
  await page.evaluate((n) => window.__retroRunner?.seed(n), SEED);
  await page.keyboard.press('KeyR');
  await waitForState(
    page,
    (s) => !s.scenes.includes('Results') && s.race?.phase === 'running',
    'retry running',
  );
  const paced = await runBot(page, { rate: 8, timeoutMs: 100_000 });
  expect(paced.minStamina ?? 0).toBeGreaterThan(0.02);
  const pacedRes = await waitForResults(page);
  const po = pacedRes.race?.outcome;
  expect(po?.ms ?? 99_999).toBeLessThan(fo?.ms ?? 0);
  expect(po?.ms ?? 99_999).toBeLessThan(56_000);

  // Splits: three increasing values, on the results card and in the history entry.
  const splits = po?.splits ?? [];
  expect(splits).toHaveLength(3);
  expect(splits[0] ?? 0).toBeLessThan(splits[1] ?? 0);
  expect(splits[1] ?? 0).toBeLessThan(splits[2] ?? 0);
  expect(pacedRes.records?.events['400m'].history[0]?.splits).toEqual(splits);
  // Splits on 3 lines in the results card's right column (28.1).
  for (const m of ['100 ', '200 ', '300 ']) expect(pacedRes.texts.some((t) => t.startsWith(m))).toBe(true);
  // A time of 60 s or more shows as M:SS.hh (14.4): the flat-out run on the HUD and the results card.
  if ((fo?.ms ?? 0) >= 60_000) expect(flat.longTimer ?? '').toMatch(/^1:0\d\.\d\d$/);
  expect(hudTimes(pacedRes).length + hudTimes(flatRes).length).toBeGreaterThan(0);

  // Records 400M tab: Enter on Pip's row shows the PB race splits.
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Ladder');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const rec = await waitForScene(page, 'Records');
  expectText(rec, '400M');
  await page.keyboard.press('Enter');
  const withSplits = await waitForState(
    page,
    (s) => s.texts.some((t) => t.startsWith('PB SPLITS')),
    'PB splits footer',
    3000,
  );
  expect(withSplits.texts.find((t) => t.startsWith('PB SPLITS'))).toContain('100 ');
});

test('records has a tab per event, a HIT column for hurdles and lock text for a locked event', async ({
  page,
}) => {
  await seedStorage(page, SAVE_KEY_V1, v1Save(['pip', 'jess', 'marco'], { best: { pip: 14000 } }));
  await bootToTitle(page);
  await titleToLadder(page, '100m');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const r100 = await waitForScene(page, 'Records');
  for (const t of ['100M', 'HURDLES', '400M', 'PB', 'TARGET', 'LAST 3']) expectText(r100, t);
  expect(r100.texts).not.toContain('HIT');
  expectText(r100, '14.00');
  await page.keyboard.press('ArrowRight');
  const rh = await waitForState(page, (s) => s.texts.includes('HIT'), 'hurdles tab');
  expectText(rh, '22.00');
  await page.keyboard.press('ArrowRight');
  const r400 = await waitForState(page, (s) => s.texts.includes('BEAT KOFI IN 100M'), '400 m tab (locked)');
  expectText(r400, 'OR MARCO IN HURDLES');
  await page.keyboard.press('Escape');
  await waitForScene(page, 'Ladder');
});

test('a v1 save migrates through v2 to v3: PBs, history, settings kept, v1 untouched, no v2 written', async ({
  page,
}) => {
  const v1 = kofiSave();
  await seedStorage(page, SAVE_KEY_V1, v1);
  const s = await bootToTitle(page);
  const r = s.records;
  expect(r?.version).toBe(3);
  expect(r?.events['100m'].best['kofi']?.ms).toBe(PBS.kofi);
  expect(r?.events['100m'].best['pip']?.ms).toBe(PBS.pip);
  expect(r?.events['100m'].beaten).toEqual(KOFI_BEATEN);
  expect(r?.events['100m'].history).toHaveLength(4);
  expect(r?.events['110mh'].beaten).toEqual([]);
  expect(r?.seenEvents).toEqual(['100m']);
  expect(r?.settings).toMatchObject({ volume: 5, muted: true, haptics: true });
  // Migrated wins are 1st places; no reveal is pending below tier 6 (34.4).
  expect(r?.events['100m'].place).toEqual({ pip: 1, jess: 1, marco: 1, kofi: 1 });
  expect(r?.events['100m'].revealed).toBe(false);
  expect(r?.events['100m'].history[0]).toMatchObject({ place: 1, fieldSize: 2, mode: 'l' });
  const stored = await page.evaluate(
    ([k3, k2, k1]) => ({
      v3: localStorage.getItem(k3 as string),
      v2: localStorage.getItem(k2 as string),
      v1: localStorage.getItem(k1 as string),
    }),
    [SAVE_KEY, SAVE_KEY_V2, SAVE_KEY_V1],
  );
  expect(stored.v1).toBe(v1);
  expect(stored.v2).toBeNull();
  expect(JSON.parse(stored.v3 ?? 'null')).toMatchObject({ version: 3, lastEvent: '100m' });

  const events = await titleToEvents(page);
  expect(events.texts.join(' ')).not.toContain('BEAT MARCO IN');
  expect(events.texts.join(' ')).not.toContain('BEAT KOFI IN');
  expectText(events, '4/6');

  // Corrupting v3 backs it up and re-migrates from v1 on reload (38, records v3).
  await page.evaluate((k) => localStorage.setItem(k, 'not json'), SAVE_KEY);
  await page.reload();
  const again = await waitForScene(page, 'Title', 30_000);
  expect(again.records?.events['100m'].best['kofi']?.ms).toBe(PBS.kofi);
  expect(await page.evaluate(() => localStorage.getItem('retroRunner.save.corrupt'))).toBe('not json');
});

test('touch modality: every menu is reachable by tap, with BACK items and touch copy', async ({ page }) => {
  await seedStorage(page, SAVE_KEY_V1, kofiSave());
  await bootToTitle(page);
  await page.evaluate(() => window.__retroRunner?.setModality({ modality: 'touch', padsOverCanvas: true }));
  const title = await waitForState(page, (s) => s.texts.includes('TAP TO START'), 'TAP TO START', 3000);
  expect(title.texts).not.toContain('M');
  const tapAt = (x: number, y: number) =>
    page.evaluate(([a, b]) => window.__retroRunner?.tap(a as number, b as number), [x, y]);

  // Tap the speaker (mute toggle), then anywhere to start.
  const muted = title.records?.settings.muted;
  await tapAt(306, 10);
  await waitForState(page, (s) => s.records?.settings.muted === !muted, 'mute toggled by tap');
  await tapAt(160, 90);
  const ev = await waitForScene(page, 'Events');
  expectButton(ev, 'BACK');
  // Tap targets of a screen never overlap (17.5.2).
  const rects = ev.taps.filter((t) => t.scene === 'Events').map((t) => t.rect);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      if (!a || !b) continue;
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(false);
    }
  }
  // First tap selects the hurdles card, second opens it.
  await tapAt(160, 90);
  await page.waitForTimeout(100);
  expect((await getState(page)).scene).toBe('Events');
  await tapAt(160, 90);
  const ladder = await waitForState(
    page,
    (s) => s.scene === 'Ladder' && s.event === '110mh',
    'hurdles ladder',
  );
  expectButton(ladder, 'BACK');
  // RACE button (top line, BACK RACE GAUNTLET) starts the race; the HUD uses the touch layout.
  const race = ladder.taps.find(
    (t) =>
      t.scene === 'Ladder' &&
      t.rect.y >= 128 &&
      t.rect.y < 140 &&
      t.rect.x <= 204 &&
      t.rect.x + t.rect.w > 204,
  );
  expect(race).toBeDefined();
  if (race) await tapAt(race.rect.x + race.rect.w / 2, race.rect.y + 10);
  const st = await waitForState(page, (s) => s.hud !== null, 'hud');
  expect(st.hud?.layout).toBe('touchCanvas');
  expect(st.hud?.speedMeter).toEqual({ x: 118, y: 165 });
  expect(st.hud?.keys).toEqual({ L: 'hidden', R: 'hidden', U: 'hidden' });
  const tip = await waitForState(page, (s) => (s.hud?.tip ?? null) !== null, 'tip');
  expect(tip.hud?.tip).toBe('TAP JUMP');
  // The touch pause button dispatches a synthetic Escape (contract); pause items are tap targets.
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true })),
  );
  const paused = await waitForScene(page, 'Pause');
  const quit = paused.taps.filter((t) => t.scene === 'Pause').sort((a, b) => b.rect.y - a.rect.y)[0];
  expect(quit).toBeDefined();
  if (quit) await tapAt(quit.rect.x + 20, quit.rect.y + 10);
  await waitForScene(page, 'Ladder');
});
