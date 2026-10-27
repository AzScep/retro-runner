import { test as base } from '@playwright/test';

/**
 * Shared Playwright fixture: every page is silent. Chromium also runs with --mute-audio
 * (playwright.config.ts); WebKit has no such flag, so before the game loads, AudioContext is wrapped
 * so its `destination` is a GainNode at gain 0 in front of the real output. The game's own volume
 * and mute settings are untouched (tests read them from the save, not from the speakers).
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Orig = w.AudioContext ?? w.webkitAudioContext;
      if (!Orig) return;
      class SilentAudioContext extends Orig {
        constructor(opts?: AudioContextOptions) {
          super(opts);
          const silent = this.createGain();
          silent.gain.value = 0;
          silent.connect(super.destination);
          Object.defineProperty(this, 'destination', { value: silent, configurable: true });
        }
      }
      w.AudioContext = SilentAudioContext;
      w.webkitAudioContext = SilentAudioContext;
    });
    await use(page);
  },
});

export { expect } from '@playwright/test';
