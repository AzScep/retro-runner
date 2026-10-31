import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.ts';
import { touchDriver, type Point, type TouchDriver } from './touchHelpers.ts';

/**
 * The /welcome/ hero dash on a phone (src/landing/minigame): a tap starts it and alternating taps
 * on the left and right halves of the race run it. Runs in the mobile projects (Pixel 7 landscape
 * with trusted CDP touches, iPhone 15 landscape with synthetic pointer events).
 */

const BADGES_KEY = 'retro-runner.landing.badges';
const BOOTED_KEY = 'retro-runner.landing.booted';

test.describe.configure({ mode: 'default', timeout: 90_000 });

async function earned(page: Page): Promise<string[]> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), BADGES_KEY);
  return raw === null ? [] : (JSON.parse(raw) as string[]);
}

/** Centres of the stage's left and right halves, in viewport px. */
async function pads(page: Page): Promise<{ L: Point; R: Point }> {
  const box = await page.locator('.rr-dash__stage').boundingBox();
  if (!box) throw new Error('dash stage not visible');
  const y = box.y + box.height / 2;
  return { L: { x: box.x + box.width / 4, y }, R: { x: box.x + (box.width * 3) / 4, y } };
}

/** Taps left, right, left... until the result card is up, starting once the starter says GO!. */
async function tapToFinish(page: Page, touch: TouchDriver): Promise<void> {
  const log = page.locator('.rr-dash__log');
  await expect(log).toContainText('GO!', { timeout: 20_000 });
  const p = await pads(page);
  const deadline = Date.now() + 60_000;
  let i = 0;
  while (Date.now() < deadline) {
    if (i % 8 === 0 && (await page.locator('.rr-dash').getAttribute('data-mode')) === 'result') return;
    await touch.tap(i++ % 2 === 0 ? p.L : p.R);
    await page.waitForTimeout(30);
  }
  throw new Error('dash never finished');
}

test.describe('landing touch', () => {
  test.beforeEach(({ hasTouch }) => {
    test.skip(!hasTouch, 'touch projects only');
  });

  test('a tap starts the dash and alternating taps on the halves run it to the result', async ({
    page,
    browserName,
  }) => {
    await page.addInitScript((k) => localStorage.setItem(k, '1'), BOOTED_KEY);
    await page.goto('/welcome/');
    await expect(page.locator('h1')).toBeVisible();
    const dash = page.locator('.rr-dash');
    // A touch visitor gets the tap copy.
    await expect(page.locator('.rr-dash__cmd')).toHaveText('TAP TO RACE');
    await page
      .locator('.rr-dash__stage')
      .evaluate((s) => s.scrollIntoView({ block: 'center', behavior: 'instant' }));

    await expect(async () => {
      await page.locator('.rr-dash__go').tap({ timeout: 1000 });
      await expect(dash).toHaveAttribute('data-mode', 'live', { timeout: 500 });
    }).toPass({ timeout: 5000 });
    await expect(dash).toHaveAttribute('data-modality', 'touch');
    await expect.poll(() => earned(page)).toContain('ranDash');

    const touch = await touchDriver(page, browserName);
    // Records the furthest the page moved while the race was live. After the finish the result
    // card scrolls itself into view on purpose, so only the live race counts.
    await page.evaluate(() => {
      const w = window as unknown as { __liveScroll: number };
      const y0 = window.scrollY;
      const dash = document.querySelector('.rr-dash');
      w.__liveScroll = 0;
      addEventListener('scroll', () => {
        if (dash?.getAttribute('data-mode') === 'live')
          w.__liveScroll = Math.max(w.__liveScroll, Math.abs(window.scrollY - y0));
      });
    });
    await tapToFinish(page, touch);
    // The pads never scrolled the page.
    expect(await page.evaluate(() => (window as unknown as { __liveScroll: number }).__liveScroll)).toBe(0);

    const card = page.locator('.rr-dash__card');
    await expect(card).toBeVisible();
    await expect(card.locator('.rr-dash__table tr')).toHaveCount(6);
    // The player's own time, not a DNF: the taps really ran the race.
    await expect(card.locator('tr.is-you td').nth(2)).toHaveText(/^\d+\.\d\d$/);
    await expect.poll(() => earned(page)).toContain('beatPip');
    // Touch gets the RUN AGAIN button and no keyboard hint.
    await expect(card.getByRole('button', { name: 'RUN AGAIN' })).toBeVisible();
    await expect(card.locator('.rr-dash__hint')).toHaveCount(0);
  });
});
