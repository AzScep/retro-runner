import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';

/**
 * The /welcome/ landing page (src/landing/README.md): boot log, score HUD and its seven badges,
 * the hero dash vs Pip, the sections' badge hunts, the ??? rival and the PLAY links. A plain DOM
 * page with no test hook, so everything here reads the DOM and localStorage the visitor has.
 */

const URL = '/welcome/';
const BADGES_KEY = 'retro-runner.landing.badges';
const BOOTED_KEY = 'retro-runner.landing.booted';
/** Tier 7 must stay a surprise (design 30): none of these may ever be visible on the page. */
const SPOILER = /ZYX|ALIEN|GALACTIC/i;

// The dash races in real time, so tests in this file run one after another per browser.
test.describe.configure({ mode: 'default', timeout: 90_000 });

/** Marks the boot log as seen before the first load, so it never covers the page. */
async function skipBoot(page: Page): Promise<void> {
  await page.addInitScript((k) => localStorage.setItem(k, '1'), BOOTED_KEY);
}

/** Collects console errors and uncaught page errors from here on. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function open(page: Page): Promise<void> {
  await page.goto(URL);
  await expect(page.locator('h1')).toBeVisible();
}

async function earned(page: Page): Promise<string[]> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), BADGES_KEY);
  return raw === null ? [] : (JSON.parse(raw) as string[]);
}

async function expectBadge(page: Page, id: string): Promise<void> {
  await expect.poll(() => earned(page), { message: `badge ${id} earned` }).toContain(id);
}

async function expectNoSpoiler(page: Page): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  expect(text.match(SPOILER), 'tier 7 must never be named on the page').toBeNull();
  expect(await page.title()).not.toMatch(SPOILER);
}

/** Scrolls the dash on screen with nothing focused, so Enter belongs to it. */
async function dashInView(page: Page): Promise<void> {
  await page
    .locator('.rr-dash__stage')
    .evaluate((s) => s.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const dash = (page: Page) => page.locator('.rr-dash');

/** Enter starts the dash (retried while the in-view observer catches up after a scroll). */
async function startDash(page: Page): Promise<void> {
  await dashInView(page);
  await expect(async () => {
    await page.keyboard.press('Enter');
    await expect(dash(page)).toHaveAttribute('data-mode', 'live', { timeout: 500 });
  }).toPass({ timeout: 5000 });
}

/**
 * Waits for the starter's GO! in the dash log, then dispatches alternating Left/Right keydown and
 * keyup pairs on window (where core attachKeyboard listens, capture phase) every `gapMs` until the
 * result card is up. In page, so the cadence holds on a loaded machine.
 */
async function raceToFinish(page: Page, gapMs = 45): Promise<void> {
  await page.evaluate(
    (gap) =>
      new Promise<void>((resolve, reject) => {
        const root = document.querySelector('.rr-dash') as HTMLElement;
        const sawGo = () =>
          [...root.querySelectorAll('.rr-dash__log li')].some((li) => li.textContent === 'GO!');
        let i = 0;
        let last = 0;
        const t0 = performance.now();
        const timer = window.setInterval(() => {
          if (root.dataset['mode'] === 'result') {
            window.clearInterval(timer);
            resolve();
            return;
          }
          if (performance.now() - t0 > 60_000) {
            window.clearInterval(timer);
            reject(new Error(`dash never finished: mode ${root.dataset['mode']}`));
            return;
          }
          if (!sawGo() || performance.now() - last < gap) return;
          last = performance.now();
          const code = i++ % 2 === 0 ? 'ArrowLeft' : 'ArrowRight';
          window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
          window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
        }, 4);
      }),
    gapMs,
  );
}

/** Content that pokes out past the viewport, unless an in-viewport ancestor clips it. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    const clipRight = (el: Element): number => {
      let right = Infinity;
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox !== 'visible') right = Math.min(right, a.getBoundingClientRect().right);
      }
      return right;
    };
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      // Visually hidden text (.sr-only) is a 1 px box by design.
      if (r.width <= 1 || r.height <= 1 || el.closest('.sr-only')) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.position === 'fixed') continue;
      const right = Math.min(r.right, clipRight(el));
      if (right > vw + 0.5 || r.left < -0.5) {
        out.push(
          `${el.tagName.toLowerCase()}.${el.className} [${Math.round(r.left)}, ${Math.round(right)}] > ${vw}`,
        );
      }
    }
    return out;
  });
}

/** Walks the page top to bottom so every lazy section and its art is built. */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.max(200, innerHeight / 2);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 40));
    }
  });
}

/**
 * Presses `key` `times` with the real keyboard and says whether the page let the browser have it:
 * no listener called preventDefault, and (on Chromium) the page really scrolled. WebKit under
 * Playwright never scrolls on arrow keys, even on a blank page, so there only the first holds.
 */
async function arrowsScroll(page: Page, key: 'ArrowDown' | 'ArrowUp', times: number, browserName: string) {
  await page.evaluate((k) => {
    const w = window as unknown as { __prevented: boolean };
    w.__prevented = false;
    window.addEventListener('keydown', (e) => {
      if (e.key === k && e.defaultPrevented) w.__prevented = true;
    });
  }, key);
  // Smooth scrolling: start from a page at rest, not one still gliding from the last press.
  const y = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = -1;
        const check = () => {
          if (window.scrollY === last) resolve(last);
          else {
            last = window.scrollY;
            setTimeout(check, 150);
          }
        };
        check();
      }),
  );
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
  expect(await page.evaluate(() => (window as unknown as { __prevented: boolean }).__prevented)).toBe(false);
  if (browserName !== 'chromium') return;
  const moved = () => page.evaluate((y0) => window.scrollY - y0, y);
  if (key === 'ArrowDown') await expect.poll(moved).toBeGreaterThan(0);
  else await expect.poll(moved).toBeLessThan(0);
}

test.describe('landing page', () => {
  test('loads with no console errors, the h1 and the PLAY CTA', async ({ page }) => {
    const errors = watchErrors(page);
    await skipBoot(page);
    await open(page);
    await expect(page.locator('h1')).toHaveText('RETRO RUNNER');
    const cta = page.locator('#top a.rr-btn', { hasText: 'PLAY NOW' });
    await expect(cta).toBeVisible();
    await scrollThrough(page);
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
    await expectNoSpoiler(page);
  });

  test('boot log shows on the first visit, a key skips it, and a second visit has none', async ({ page }) => {
    // A frozen clock holds the log on screen, so only the key can be what clears it.
    await page.clock.install();
    await page.goto(URL);
    const boot = page.locator('.rr-boot');
    await expect(boot).toHaveCount(1);
    await page.clock.runFor(400);
    await expect(boot).toContainText('RETRO RUNNER BIOS');
    await expectNoSpoiler(page);
    await page.keyboard.press('Shift');
    await expect(boot).toHaveCount(0);

    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    await page.clock.runFor(400);
    await expect(boot).toHaveCount(0);
  });

  for (const size of [
    { width: 360, height: 740 },
    { width: 1280, height: 800 },
  ]) {
    test(`no horizontal scroll at ${size.width} px wide`, async ({ page }) => {
      await page.setViewportSize(size);
      await skipBoot(page);
      await open(page);
      await scrollThrough(page);
      // Open what the sections can open, so wide content is measured too.
      for (const t of await page.locator('.mech__toggle').all()) await t.click();
      await page.locator('.rr-status__toggle').click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
      await page.evaluate(() => window.scrollTo({ left: 500, behavior: 'instant' }));
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
      expect(await overflowing(page)).toEqual([]);
    });
  }

  test('arrow keys scroll the page while the dash is not racing', async ({ page, browserName }) => {
    await skipBoot(page);
    await open(page);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await arrowsScroll(page, 'ArrowDown', 6, browserName);
    await arrowsScroll(page, 'ArrowUp', 3, browserName);
    // Left/Right are run keys only during a race: outside one they are never swallowed.
    const prevented = await page.evaluate(() => {
      const e = new KeyboardEvent('keydown', {
        code: 'ArrowLeft',
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(false);
  });

  test('Enter starts the dash, alternating Left/Right wins it: result card, ranDash and beatPip', async ({
    page,
    browserName,
  }) => {
    await skipBoot(page);
    await open(page);
    await startDash(page);
    await expectBadge(page, 'ranDash');
    await expect(page.locator('.rr-toast').first()).toContainText('OFF THE BLOCKS');
    // A live race on screen owns the run keys.
    const prevented = await page.evaluate(() => {
      const e = new KeyboardEvent('keyup', {
        code: 'ArrowLeft',
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);

    await raceToFinish(page);
    const card = page.locator('.rr-dash__card');
    await expect(card).toBeVisible();
    await expect(card.locator('.rr-dash__out')).toHaveText('RACE.EXE COMPLETE');
    await expect(card.locator('.rr-dash__table tr')).toHaveCount(6);
    await expect(card.locator('tr.is-you')).toHaveCount(1);
    await expect(card.locator('a.rr-btn')).toHaveAttribute('href', '../');
    await expect(card.getByRole('button', { name: 'RUN AGAIN' })).toBeVisible();
    await expectBadge(page, 'beatPip');
    const ids = await earned(page);
    expect(ids).toEqual(expect.arrayContaining(['ranDash', 'beatPip']));
    expect(ids).not.toContain('falseStart');
    await expect(page.locator('.rr-status__toggle .rr-status__count')).toHaveText('2/7');
    // Beating Pip moves Rio up the story ladder.
    await expect(page.locator('.story__node.rr-ladder__node--beaten')).toHaveCount(1);
    // After the race the arrows scroll again.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await arrowsScroll(page, 'ArrowDown', 4, browserName);
    await expectNoSpoiler(page);
  });

  test('a press during the countdown is a false start and earns falseStart', async ({ page }) => {
    await skipBoot(page);
    await open(page);
    await startDash(page);
    const big = page.locator('.rr-dash__big');
    await expect(big).toHaveText(/^[321]$/, { timeout: 15_000 });
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.rr-dash__log')).toContainText('FALSE START!');
    await expectBadge(page, 'falseStart');
    expect(await earned(page)).not.toContain('beatPip');
  });

  test('loading all three cartridges earns allCarts', async ({ page }) => {
    await skipBoot(page);
    await open(page);
    const toggles = page.locator('.mech__toggle');
    await expect(toggles).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const t = toggles.nth(i);
      await t.click();
      await expect(t).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`#${await t.getAttribute('aria-controls')}`)).toBeVisible();
      if (i < 2) expect(await earned(page)).not.toContain('allCarts');
    }
    await expectBadge(page, 'allCarts');
    // Ejecting and loading again earns nothing new.
    await toggles.first().click();
    await toggles.first().click();
    expect((await earned(page)).filter((id) => id === 'allCarts')).toHaveLength(1);
  });

  test('viewing every rival earns allRivals', async ({ page }) => {
    await skipBoot(page);
    await open(page);
    const rivals = page.locator('.rr-rival:not(.rr-rival--locked)');
    await expect(rivals).toHaveCount(7);
    const count = page.locator('.rivals__count');
    await expect(count).toHaveText('SCOUTED 1/7');
    // Pip is pre-scouted; the rest one by one.
    for (let i = 1; i < 7; i++) {
      const r = rivals.nth(i);
      await r.click();
      await expect(r).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.rivals__panel .rivals__side').nth(1).locator('.rivals__name')).toHaveText(
        (await r.locator('.rr-rival__name').textContent()) ?? '',
      );
      if (i < 6) expect(await earned(page)).not.toContain('allRivals');
      await expectNoSpoiler(page);
    }
    await expect(count).toHaveText('SCOUTED 7/7');
    await expectBadge(page, 'allRivals');
  });

  test('poking ??? earns secret and never names tier 7, anywhere on the page', async ({ page }) => {
    await skipBoot(page);
    await open(page);
    await expectNoSpoiler(page);
    const mystery = page.locator('.rr-rival--locked');
    await expect(mystery.locator('.rr-rival__name')).toHaveText('???');
    for (let i = 0; i < 4; i++) {
      await mystery.click();
      await expect(page.locator('.rivals__log .rr-log__line')).toHaveCount(i + 1);
      await expectNoSpoiler(page);
      if (i < 3) expect(await earned(page)).not.toContain('secret');
    }
    await expectBadge(page, 'secret');
    await expect(page.locator('.rr-toast').last()).toContainText('WHAT WAS THAT?');
    await expectNoSpoiler(page);

    // Every story node, including the locked ??? meet.
    for (const pick of await page.locator('.story__pick').all()) {
      await pick.click();
      await expectNoSpoiler(page);
    }
    // The badge list (the secret badge is now named) and the end of the page.
    await page.locator('.rr-status__toggle').click();
    await expect(page.locator('#rr-badge-list')).toBeVisible();
    await expectNoSpoiler(page);
    await page.keyboard.press('Escape');
    await scrollThrough(page);
    await expectNoSpoiler(page);
    // Image alt text and labels are page text too.
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll('[alt], [aria-label], [title]')]
        .map(
          (e) =>
            `${e.getAttribute('alt') ?? ''} ${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`,
        )
        .join(' '),
    );
    expect(labels.match(SPOILER)).toBeNull();
  });

  test('reaching the end earns reachedEnd, and the countdown ends without redirecting', async ({ page }) => {
    await skipBoot(page);
    await open(page);
    expect(await earned(page)).not.toContain('reachedEnd');
    await page
      .locator('#continue')
      .evaluate((s) => s.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await expectBadge(page, 'reachedEnd');
    const number = page.locator('.rr-countdown__number');
    await expect(number).toHaveText('0', { timeout: 15_000 });
    await expect(page.locator('.finale__game-over')).toHaveText('GAME OVER');
    await page.waitForTimeout(1500);
    expect(new globalThis.URL(page.url()).pathname).toBe('/welcome/');
    await expect(page.locator('#continue a.rr-btn')).toBeVisible();
  });

  test('earned badges and the score survive a reload', async ({ page }) => {
    await skipBoot(page);
    await open(page);
    for (const t of await page.locator('.mech__toggle').all()) await t.click();
    await expectBadge(page, 'allCarts');
    await expect(page.locator('.rr-hud__value')).toHaveText('001000');

    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    expect(await earned(page)).toEqual(['allCarts']);
    await expect(page.locator('.rr-hud__value')).toHaveText('001000');
    await expect(page.locator('.rr-status__toggle .rr-status__count')).toHaveText('1/7');
    await page.locator('.rr-status__toggle').click();
    const rows = page.locator('.rr-badge-list__row');
    await expect(rows).toHaveCount(7);
    await expect(page.locator('.rr-badge-list__row.is-earned')).toHaveCount(1);
    await expect(page.locator('.rr-badge-list__row.is-earned')).toContainText('CART COLLECTOR');
    // A reload does not toast what was already earned.
    await expect(page.locator('.rr-toast')).toHaveCount(0);
  });

  test('every PLAY link resolves to the game root', async ({ page, baseURL }) => {
    await skipBoot(page);
    await open(page);
    const root = new globalThis.URL('/', baseURL).href;
    const hrefs = await page
      .locator('a.rr-btn')
      .evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    for (const h of hrefs) expect(h).toBe(root);
    const res = await page.request.get(root);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('<div id="app"');
  });

  test('sound is off by default and no AudioContext exists before the toggle is pressed', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
        __audioContexts: number;
      };
      w.__audioContexts = 0;
      const Orig = w.AudioContext ?? w.webkitAudioContext;
      if (!Orig) return;
      class Counted extends Orig {
        constructor(opts?: AudioContextOptions) {
          super(opts);
          w.__audioContexts++;
        }
      }
      w.AudioContext = Counted;
      w.webkitAudioContext = Counted;
    });
    await skipBoot(page);
    await open(page);
    const contexts = () =>
      page.evaluate(() => (window as unknown as { __audioContexts: number }).__audioContexts);
    const toggle = page.locator('button.rr-sound');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // Gestures, a dash start, a cartridge and the M key inside the dash do not start audio.
    await page.locator('.mech__toggle').first().click();
    await startDash(page);
    await page.keyboard.press('m');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(500);
    expect(await contexts()).toBe(0);
    const scripts = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => /\.js(\?|$)/.test(n)),
    );

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(contexts, { timeout: 10_000 }).toBeGreaterThan(0);
    // The audio code is its own chunk, fetched only on the press.
    const after = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((n) => /\.js(\?|$)/.test(n)),
    );
    expect(after.length).toBeGreaterThan(scripts.length);
  });
});
