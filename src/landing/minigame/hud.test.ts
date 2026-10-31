import { describe, expect, it } from 'vitest';
import { TUNING } from '../../core/index.ts';
import {
  ALTERNATE_AFTER_FUMBLES,
  fitStage,
  MASH_IDLE_MS,
  MIN_VIEW_W,
  ordinal,
  PlaceHold,
  promptFor,
  starterCall,
} from './hud.ts';

describe('promptFor', () => {
  const base = { running: true, idleMs: 0, fumblesSinceStep: 0, reducedMotion: false };

  it('shows nothing before GO or while stepping well', () => {
    expect(promptFor({ ...base, running: false, idleMs: 5000 })).toBeNull();
    expect(promptFor(base)).toBeNull();
  });

  it('pulses MASH! at 2 Hz after the idle time, steady under reduced motion', () => {
    expect(promptFor({ ...base, idleMs: MASH_IDLE_MS })).toBe('mash');
    expect(promptFor({ ...base, idleMs: MASH_IDLE_MS + 300 })).toBeNull();
    expect(promptFor({ ...base, idleMs: MASH_IDLE_MS + 500 })).toBe('mash');
    expect(promptFor({ ...base, idleMs: MASH_IDLE_MS + 300, reducedMotion: true })).toBe('mash');
  });

  it('asks to ALTERNATE! after repeated same-side presses, over MASH!', () => {
    const f = { ...base, fumblesSinceStep: ALTERNATE_AFTER_FUMBLES };
    expect(promptFor(f)).toBe('alternate');
    expect(promptFor({ ...f, idleMs: 5000 })).toBe('alternate');
    expect(promptFor({ ...base, fumblesSinceStep: 1 })).toBeNull();
  });
});

describe('starterCall', () => {
  it('calls the marks on 3 and 2 and SET on 1, in the countdown only', () => {
    expect(starterCall('countdown', 3)).toBe('marks');
    expect(starterCall('countdown', 2)).toBe('marks');
    expect(starterCall('countdown', 1)).toBe('set');
    expect(starterCall('running', 'go')).toBeNull();
    expect(starterCall('intro', null)).toBeNull();
    expect(starterCall('falseStart', null)).toBeNull();
  });
});

describe('ordinal', () => {
  it('labels places 1-6', () => {
    expect([1, 2, 3, 4, 6].map(ordinal)).toEqual(['1ST', '2ND', '3RD', '4TH', '6TH']);
  });
});

describe('PlaceHold', () => {
  const HOLD = TUNING.POSITION_HOLD_MS;

  it('shows the first place at once and holds changes', () => {
    const h = new PlaceHold();
    expect(h.update(null, 0, false)).toBeNull();
    expect(h.update(3, 10, false)).toBe(3);
    expect(h.update(2, 20, false)).toBe(3);
    expect(h.update(2, 20 + HOLD - 1, false)).toBe(3);
    expect(h.update(2, 20 + HOLD, false)).toBe(2);
  });

  it('freezes on the crossing', () => {
    const h = new PlaceHold();
    h.update(2, 0, false);
    expect(h.update(1, 5, true)).toBe(1);
    expect(h.update(4, 10000, false)).toBe(1);
  });
});

describe('fitStage', () => {
  it('uses whole device pixels per art pixel', () => {
    for (const [w, dpr] of [
      [328, 3],
      [343, 2],
      [700, 1],
      [700, 2],
      [1000, 1.5],
    ] as const) {
      const f = fitStage(w, 600, dpr);
      expect(Number.isInteger(f.scale)).toBe(true);
      expect(f.viewW).toBeGreaterThanOrEqual(MIN_VIEW_W);
      expect(f.viewW).toBeLessThanOrEqual(320);
      expect(f.cssW).toBeLessThanOrEqual(w);
      expect(f.cssW * dpr).toBe(f.viewW * f.scale);
    }
  });

  it('shows the full view at 2x on a desktop column', () => {
    expect(fitStage(700, 600, 1)).toMatchObject({ scale: 2, viewW: 320, cssW: 640, cssH: 360 });
  });

  it('crops a phone strip rather than shrinking the sprites', () => {
    // 360 px phone at 3x: 984 device px fit 4x at 246 art px rather than 3x at 320.
    expect(fitStage(328, 600, 3)).toMatchObject({ scale: 4, viewW: 246, cssW: 328, cssH: 240 });
  });

  it('respects the height limit (landscape phones)', () => {
    const f = fitStage(700, 225, 3);
    expect(f.cssH).toBeLessThanOrEqual(225);
    expect(f.scale).toBe(3);
  });

  it('never goes below 1x even in a tiny host', () => {
    expect(fitStage(100, 50, 1)).toMatchObject({ scale: 1, viewW: 100 });
  });
});
