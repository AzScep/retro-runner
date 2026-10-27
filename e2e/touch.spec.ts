import { expect, test, type Page } from '@playwright/test';
import { getState, waitForScene, waitForState, type GameState } from './helpers.ts';
import {
  controlCenter,
  gamePoint,
  seedSave,
  touchDriver,
  v2Save,
  type Point,
  type TouchDriver,
} from './touchHelpers.ts';

/**
 * Touch controls (design 17, 22 "Touch"). Runs in the mobile projects (Pixel 7 landscape on
 * Chromium with trusted CDP multi-touch, iPhone 15 landscape on WebKit with synthetic pointer
 * events); the desktop block runs in the desktop projects and proves they are unaffected.
 */

/** The v2 race fields this spec needs, read loosely so it does not depend on helpers' types. */
interface RaceSnap {
  readonly event?: string;
  readonly phase: string;
  readonly paused: boolean;
  readonly expectedSide: 'L' | 'R' | null;
  readonly falseStarts: number;
  readonly nextHurdleS?: number | null;
  readonly player: { readonly vMps: number; readonly finishMs: number | null };
  readonly outcome: {
    readonly result: string;
    readonly ms: number | null;
    readonly hit?: number | null;
  } | null;
}
interface TapTargetSnap {
  readonly scene: string;
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

type RaceSnapLite = Pick<RaceSnap, 'expectedSide' | 'player' | 'outcome'>;

const race = (s: GameState): RaceSnap | null => s.race as unknown as RaceSnap | null;

async function tapTargets(page: Page): Promise<TapTargetSnap[]> {
  const s = (await getState(page)) as unknown as { taps?: TapTargetSnap[] };
  if (!s.taps) throw new Error('test hook exposes no taps');
  return s.taps;
}

/** Taps the centre of the scene's tap target that contains game point (gx, gy), or the nearest one. */
async function tapGame(page: Page, touch: TouchDriver, gx: number, gy: number): Promise<void> {
  await touch.tap(await gamePoint(page, gx, gy));
}

/** Taps the first live target of `scene` matching `pick` (default: the first). */
async function tapTarget(
  page: Page,
  touch: TouchDriver,
  scene: string,
  pick: (r: TapTargetSnap['rect']) => boolean = () => true,
): Promise<void> {
  const t = (await tapTargets(page)).find((x) => x.scene === scene && pick(x.rect));
  if (!t) throw new Error(`no tap target in ${scene}: ${JSON.stringify(await tapTargets(page))}`);
  await tapGame(page, touch, t.rect.x + t.rect.w / 2, t.rect.y + t.rect.h / 2);
}

/** Taps until the scene changes (list items select on the first tap and confirm on the second). */
async function tapUntilScene(page: Page, tap: () => Promise<void>, scene: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await tap();
    try {
      await waitForScene(page, scene, 1500);
      return;
    } catch {
      // Selected but not confirmed yet: tap again.
    }
  }
  await waitForScene(page, scene, 1000);
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__retroRunner !== undefined, null, { timeout: 20_000 });
  await waitForScene(page, 'Title', 30_000);
}

/** Title -> Event Select -> event card -> Ladder -> RACE, all by tap. Returns at the race start. */
async function tapToRace(page: Page, touch: TouchDriver, eventIndex: 0 | 1 | 2, seed: number): Promise<void> {
  await tapUntilScene(page, () => tapTarget(page, touch, 'Title', (r) => r.w >= 200), 'Events');
  const cardX = [8, 112, 216][eventIndex] ?? 8;
  await tapUntilScene(
    page,
    () => tapTarget(page, touch, 'Events', (r) => r.x <= cardX + 48 && r.x + r.w >= cardX + 48 && r.y < 100),
    'Ladder',
  );
  await page.evaluate((n) => window.__retroRunner?.seed(n), seed);
  await waitForState(
    page,
    (s) =>
      ((s as unknown as { taps?: TapTargetSnap[] }).taps ?? []).some(
        (t) => t.scene === 'Ladder' && t.rect.x >= 124,
      ),
    'Ladder menu row',
  );
  // Touch menu (17.5.6): BACK RACE / RECORDS OPTIONS in reading order; one tap confirms a button.
  const row = (await tapTargets(page))
    .filter((t) => t.scene === 'Ladder' && t.rect.x >= 124 && t.rect.y >= 120)
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const raceBtn = row.length >= 4 ? row[1] : row[0];
  if (!raceBtn) throw new Error('no Ladder menu row');
  await tapGame(page, touch, raceBtn.rect.x + raceBtn.rect.w / 2, raceBtn.rect.y + raceBtn.rect.h / 2);
  await waitForState(page, (s) => race(s) !== null, 'race to start');
}

async function waitRunning(page: Page): Promise<void> {
  await waitForState(page, (s) => race(s)?.phase === 'running', 'GO', 20_000);
}

/**
 * Alternating thumb taps on the run zones, following the expected side, until the player finishes.
 * Paced at one tap per `gapMs` of wall time (round trips count towards the gap), with a light state
 * read every few taps, so a loaded machine still runs a race well inside the 30 s DNF limit.
 */
async function touchMashToFinish(page: Page, touch: TouchDriver, gapMs = 40): Promise<number> {
  const at = { L: await controlCenter(page, 'L'), R: await controlCenter(page, 'R') };
  const peek = (): Promise<{ side: 'L' | 'R' | null; done: boolean }> =>
    page.evaluate(() => {
      const r = window.__retroRunner?.getState().race as unknown as RaceSnapLite | null;
      return { side: r?.expectedSide ?? null, done: !r || r.player.finishMs !== null || r.outcome !== null };
    });
  let next: 'L' | 'R' = 'L';
  const deadline = Date.now() + 45_000;
  let lastTap = 0;
  for (let i = 0; Date.now() < deadline; i++) {
    if (i % 6 === 0) {
      const p = await peek();
      if (p.done) return i;
      next = p.side ?? next;
    }
    const wait = lastTap + gapMs - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    lastTap = Date.now();
    await touch.tap(at[next]);
    next = next === 'L' ? 'R' : 'L';
  }
  throw new Error(`touchMash: no finish: ${JSON.stringify((await getState(page)).race)}`);
}

/**
 * In-page bot: alternating taps every 50 ms on the run zones and a JUMP tap when the next hurdle is
 * 0.2 s away, timed by the page's own clock (no Playwright round trips in the jump window).
 */
async function botRace(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const hook = window.__retroRunner;
        if (!hook) return reject(new Error('no hook'));
        let pid = 50_000;
        const tap = (c: string): void => {
          const el = document.querySelector(`[data-touch="${c}"]`);
          if (!el) throw new Error(`no ${c}`);
          const r = el.getBoundingClientRect();
          const init = (type: string): PointerEvent =>
            new PointerEvent(type, {
              pointerId: pid,
              pointerType: 'touch',
              bubbles: true,
              cancelable: true,
              clientX: r.x + r.width / 2,
              clientY: r.y + r.height / 2,
            });
          el.dispatchEvent(init('pointerdown'));
          el.dispatchEvent(init('pointerup'));
          pid++;
        };
        let next: 'L' | 'R' = 'L';
        let lastStep = 0;
        let lastJump = -1e9;
        const started = performance.now();
        const timer = setInterval(() => {
          try {
            const s = hook.getState().race as unknown as RaceSnap | null;
            if (
              !s ||
              s.player.finishMs !== null ||
              s.outcome !== null ||
              performance.now() - started > 60_000
            ) {
              clearInterval(timer);
              resolve();
              return;
            }
            if (s.phase !== 'running') return;
            const now = performance.now();
            const h = s.nextHurdleS ?? null;
            if (h !== null && h <= 0.21 && h > 0.1 && now - lastJump > 450) {
              tap('jump');
              lastJump = now;
            }
            if (now - lastStep >= 50) {
              next = s.expectedSide ?? next;
              tap(next);
              next = next === 'L' ? 'R' : 'L';
              lastStep = now;
            }
          } catch (e) {
            clearInterval(timer);
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        }, 5);
      }),
  );
}

test.describe('touch', () => {
  test.beforeEach(async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'touch projects only');
    await seedSave(page, v2Save());
    await boot(page);
  });

  test('starts in touch modality with gestures suppressed and no page scroll or zoom', async ({
    page,
    browserName,
  }) => {
    const facts = await page.evaluate(() => ({
      input: document.documentElement.dataset['input'],
      touchAction: getComputedStyle(document.documentElement).touchAction,
      viewport: document.querySelector('meta[name="viewport"]')?.getAttribute('content'),
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href'),
      fullscreenButton: (() => {
        const b = document.querySelector('.fullscreen-toggle');
        return b ? getComputedStyle(b).display : 'none';
      })(),
    }));
    expect(facts.input).toBe('touch');
    expect(facts.touchAction).toBe('none');
    expect(facts.viewport).toContain('viewport-fit=cover');
    expect(facts.manifest).toBe('./manifest.webmanifest');
    expect(facts.fullscreenButton).toBe('none');
    if (browserName === 'chromium') {
      // A real swipe, a pinch and a double tap leave the page unscrolled and unzoomed.
      const cdp = await page.context().newCDPSession(page);
      const send = (
        type: 'touchStart' | 'touchMove' | 'touchEnd',
        touchPoints: { id: number; x: number; y: number }[],
      ): Promise<unknown> => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
      await send('touchStart', [{ id: 1, x: 400, y: 300 }]);
      for (let y = 290; y > 40; y -= 25) await send('touchMove', [{ id: 1, x: 400, y }]);
      await send('touchEnd', []);
      await send('touchStart', [
        { id: 1, x: 380, y: 180 },
        { id: 2, x: 420, y: 180 },
      ]);
      await send('touchMove', [
        { id: 1, x: 200, y: 180 },
        { id: 2, x: 600, y: 180 },
      ]);
      await send('touchEnd', []);
      for (let i = 0; i < 2; i++) {
        await send('touchStart', [{ id: 3, x: 430, y: 200 }]);
        await send('touchEnd', []);
      }
    }
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scale: window.visualViewport?.scale ?? 1,
      selection: window.getSelection()?.toString() ?? '',
    }));
    expect(after).toEqual({ scrollX: 0, scrollY: 0, scale: 1, selection: '' });
  });

  test('menu taps navigate title -> event select -> ladder -> race; pads sit in the side bars', async ({
    page,
    browserName,
  }) => {
    const touch = await touchDriver(page, browserName);
    await tapToRace(page, touch, 0, 7);
    // Android: tap to start entered fullscreen (design 17.6); iPhone has no element fullscreen.
    const fullscreen = await page.evaluate(() => document.fullscreenElement !== null);
    expect(fullscreen).toBe(browserName === 'chromium');
    expect(await page.locator('.touch-root').getAttribute('data-pads')).toBe('bars');
    const pads = page.locator('[data-pad="L"], [data-pad="R"]');
    await expect(pads.first()).toBeVisible();
    await expect(page.locator('[data-pad="jump"]')).toBeHidden();
    await expect(page.locator('[data-touch="jump"]')).toBeHidden();
    const canvas = await page.locator('#app canvas').boundingBox();
    const padL = await page.locator('[data-pad="L"]').boundingBox();
    expect(canvas && padL && padL.x + padL.width <= canvas.x).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`${browserName}-race-bars.png`) });
  });

  test('alternating taps run and finish a 100 m race with a recorded time', async ({ page, browserName }) => {
    test.setTimeout(90_000);
    const touch = await touchDriver(page, browserName);
    await tapToRace(page, touch, 0, 11);
    await waitRunning(page);
    const taps = await touchMashToFinish(page, touch);
    expect(taps).toBeGreaterThan(40);
    const done = await waitForState(page, (x) => x.scenes.includes('Results'), 'results', 10_000);
    expect(race(done)?.player.finishMs).toBeGreaterThan(5000);
    const ms = race(done)?.outcome?.ms ?? null;
    expect(ms).not.toBeNull();
    const records = done.records as unknown as {
      events: Record<string, { history: { ms: number | null }[] }>;
    } | null;
    expect(records?.events['100m']?.history.at(-1)?.ms).toBe(ms);
    // Pads hide once the player has crossed, and the result buttons take taps.
    await expect(page.locator('[data-pad="L"]')).toBeHidden();
  });

  test('a second finger on a held side gives no step, no fumble and flashes held-blocked', async ({
    page,
    browserName,
  }) => {
    const touch = await touchDriver(page, browserName);
    await tapToRace(page, touch, 0, 12);
    await waitRunning(page);
    const L = await controlCenter(page, 'L');
    const R = await controlCenter(page, 'R');
    // First step on the left with finger 1, which stays down.
    await touch.down(1, L);
    await waitForState(page, (s) => race(s)?.expectedSide === 'R', 'left step');
    const fumbles = (await getState(page)).hud?.fumbles ?? 0;
    // Record every pad state change: the held-blocked flash lasts only 4 frames.
    await page.evaluate(() => {
      const pad = document.querySelector('[data-pad="L"]');
      const w = window as unknown as { __padStates: string[] };
      w.__padStates = [];
      if (pad)
        new MutationObserver(() => w.__padStates.push(pad.getAttribute('data-state') ?? '')).observe(pad, {
          attributeFilter: ['data-state'],
        });
    });
    // Finger 2 drums the held left side: nothing at all.
    for (let i = 0; i < 6; i++) {
      await touch.down(2, { x: L.x + 10, y: L.y - 10 });
      await touch.up(2);
      await page.waitForTimeout(50);
    }
    const seen = await page.evaluate(() => (window as unknown as { __padStates: string[] }).__padStates);
    expect(seen).toContain('blocked');
    let s = await getState(page);
    expect(race(s)?.expectedSide).toBe('R');
    expect(s.hud?.fumbles ?? 0).toBe(fumbles);
    // A right step still works, and lifting finger 1 lets the left step again.
    await touch.tap(R);
    await waitForState(page, (x) => race(x)?.expectedSide === 'L', 'right step');
    await touch.up(1);
    await touch.tap(L);
    s = await waitForState(page, (x) => race(x)?.expectedSide === 'R', 'left step after lift');
    expect(s.hud?.fumbles ?? 0).toBe(fumbles);
  });

  test('a thumb sliding from the left zone into the right gives no right step; cancel releases', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'needs trusted touches with pointer capture (CDP)');
    const touch = await touchDriver(page, browserName);
    await tapToRace(page, touch, 0, 17);
    await waitRunning(page);
    const L = await controlCenter(page, 'L');
    const R = await controlCenter(page, 'R');
    await touch.down(1, L);
    await waitForState(page, (s) => race(s)?.expectedSide === 'R', 'left step');
    for (let x = L.x; x <= R.x; x += 40) await touch.move(1, { x, y: L.y });
    await touch.move(1, R);
    await touch.up(1);
    await page.waitForTimeout(150);
    expect(race(await getState(page))?.expectedSide).toBe('R');
    // A cancelled finger releases its side: hold R, cancel, then L and R still step normally.
    await touch.down(2, R);
    await waitForState(page, (s) => race(s)?.expectedSide === 'L', 'right step');
    await touch.cancel(2);
    await touch.tap(L);
    await waitForState(page, (s) => race(s)?.expectedSide === 'R', 'left step after cancel');
    await touch.tap(R);
    await waitForState(page, (s) => race(s)?.expectedSide === 'L', 'right step after cancel');
  });

  test('touching a run zone in the countdown is a false start, the top strip is not', async ({
    page,
    browserName,
  }) => {
    const touch = await touchDriver(page, browserName);
    await tapToRace(page, touch, 0, 13);
    await waitForState(page, (s) => race(s)?.phase === 'countdown', 'countdown');
    // Top strip (above the zones, left of the pause button).
    const vp = page.viewportSize();
    await touch.tap({ x: (vp?.width ?? 800) * 0.3, y: (vp?.height ?? 360) * 0.1 });
    await page.waitForTimeout(100);
    expect(race(await getState(page))?.falseStarts).toBe(0);
    await touch.tap(await controlCenter(page, 'L'));
    await waitForState(page, (s) => (race(s)?.falseStarts ?? 0) === 1, 'false start');
  });

  test('the JUMP zone clears hurdles in a hurdles race', async ({ page, browserName }) => {
    test.setTimeout(90_000);
    const touch = await touchDriver(page, browserName);
    await tapToRace(page, touch, 1, 21);
    const s0 = await getState(page);
    expect(race(s0)?.event).toBe('110mh');
    await expect(page.locator('[data-touch="jump"]')).toBeVisible();
    const jumpPad = await page.locator('[data-pad="jump"]').boundingBox();
    const rightPad = await page.locator('[data-pad="R"]').boundingBox();
    expect(jumpPad && rightPad && jumpPad.y + jumpPad.height < rightPad.y).toBe(true);
    await waitRunning(page);
    await botRace(page);
    const done = await waitForState(page, (x) => race(x)?.outcome != null, 'hurdles result', 15_000);
    const hit = race(done)?.outcome?.hit ?? 10;
    // Without a jump every hurdle is a HIT; good jump timing clears most of them.
    expect(hit).toBeLessThanOrEqual(5);
  });

  test('the pause button pauses; RESUME by tap', async ({ page, browserName }) => {
    const touch = await touchDriver(page, browserName);
    await tapToRace(page, touch, 0, 14);
    await waitRunning(page);
    await expect(page.locator('[data-touch="pause"]')).toBeVisible();
    await touch.tap(await controlCenter(page, 'pause'));
    await waitForState(page, (s) => race(s)?.paused === true && s.scenes.includes('Pause'), 'paused');
    await expect(page.locator('[data-touch="pause"]')).toBeHidden();
    // The zones are off while paused, so the pause menu takes the taps.
    await expect(page.locator('[data-touch="L"]')).toBeHidden();
    const resume = (await tapTargets(page))
      .filter((t) => t.scene === 'Pause')
      .sort((a, b) => a.rect.y - b.rect.y)[0];
    if (!resume) throw new Error('no Pause targets');
    await tapGame(page, touch, resume.rect.x + resume.rect.w / 2, resume.rect.y + resume.rect.h / 2);
    await waitForState(page, (s) => race(s)?.paused === false, 'resumed');
    await expect(page.locator('[data-touch="L"]')).toBeVisible();
  });

  test('portrait shows the rotate prompt and pauses; landscape shows the pause menu', async ({
    page,
    browserName,
  }) => {
    const touch = await touchDriver(page, browserName);
    await tapToRace(page, touch, 0, 15);
    await waitRunning(page);
    const land = page.viewportSize();
    if (!land) throw new Error('no viewport');
    // Android tap to start entered fullscreen; a fullscreen window cannot be resized.
    await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
    await page.setViewportSize({ width: land.height, height: land.width });
    await expect(page.locator('.touch-rotate')).toBeVisible();
    await expect(page.locator('.touch-rotate')).toContainText('ROTATE YOUR DEVICE');
    await waitForState(page, (s) => race(s)?.paused === true, 'auto-pause');
    await page.screenshot({ path: test.info().outputPath(`${browserName}-rotate.png`) });
    await page.setViewportSize(land);
    await expect(page.locator('.touch-rotate')).toBeHidden();
    const s = await getState(page);
    expect(race(s)?.paused).toBe(true);
    expect(s.scenes).toContain('Pause');
  });

  test('pads go over the canvas at 16:9 tablet size; a key hides them and a touch shows them', async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 1024, height: 576 });
    const touch = await touchDriver(page, browserName);
    await tapToRace(page, touch, 0, 16);
    await waitRunning(page);
    expect(await page.locator('.touch-root').getAttribute('data-pads')).toBe('canvas');
    const canvas = await page.locator('#app canvas').boundingBox();
    const padL = await page.locator('[data-pad="L"]').boundingBox();
    if (!canvas || !padL) throw new Error('missing boxes');
    expect(Math.abs(padL.x - (canvas.x + (6 * canvas.width) / 320))).toBeLessThan(2);
    expect(Math.abs(padL.y - (canvas.y + (118 * canvas.height) / 180))).toBeLessThan(2);
    await page.screenshot({ path: test.info().outputPath(`${browserName}-race-tablet.png`) });
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('[data-pad="L"]')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.dataset['input'])).toBe('keyboard');
    // A touch anywhere brings them back (the first touch only switches modality).
    await touch.tap({ x: canvas.x + canvas.width / 2, y: canvas.y + 10 });
    await expect(page.locator('[data-pad="L"]')).toBeVisible();
  });
});

test.describe('iPhone Add to Home Screen hint', () => {
  test('appears once after the first tap and never again after OK', async ({
    page,
    browserName,
    hasTouch,
  }) => {
    test.skip(!hasTouch || browserName !== 'webkit', 'iPhone Safari only');
    await seedSave(page, v2Save({ hintSeen: false }));
    await boot(page);
    const touch = await touchDriver(page, browserName);
    await tapTarget(page, touch, 'Title', (r) => r.w >= 200);
    const ok = page.locator('[data-touch="hint-ok"]');
    await expect(ok).toBeVisible();
    await expect(page.locator('.touch-hint')).toContainText('ADD TO HOME SCREEN');
    await page.screenshot({ path: test.info().outputPath(`${browserName}-hint.png`) });
    const box = await ok.boundingBox();
    expect(box && box.width >= 44 && box.height >= 44).toBe(true);
    await touch.tap(await centre(page, '[data-touch="hint-ok"]'));
    await expect(ok).toBeHidden();
    const saved = await page.evaluate(() => localStorage.getItem('retroRunner.save.v2'));
    expect(JSON.parse(saved ?? '{}').hints?.addToHomeScreen).toBe(true);
    await page.reload();
    await waitForScene(page, 'Title', 30_000);
    await tapTarget(page, touch, 'Title', (r) => r.w >= 200);
    await page.waitForTimeout(300);
    await expect(ok).toBeHidden();
  });
});

async function centre(page: Page, selector: string): Promise<Point> {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} not visible`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe('desktop', () => {
  test('keyboard modality: no touch controls, the fullscreen button and keyboard flow as before', async ({
    page,
    hasTouch,
  }) => {
    test.skip(hasTouch, 'desktop projects only');
    await boot(page);
    expect(await page.evaluate(() => document.documentElement.dataset['input'])).toBe('keyboard');
    await expect(page.locator('[data-touch="L"]')).toBeHidden();
    await expect(page.locator('[data-touch="pause"]')).toBeHidden();
    await expect(page.locator('.touch-rotate')).toBeHidden();
    await page.mouse.move(200, 200);
    await expect(page.locator('.fullscreen-toggle')).toBeVisible();
    // Mouse clicks on the canvas never navigate menus.
    await page.mouse.click(640, 360);
    await page.waitForTimeout(200);
    expect((await getState(page)).scene).toBe('Title');
    await page.keyboard.press('Enter');
    await waitForScene(page, 'Events');
  });
});
