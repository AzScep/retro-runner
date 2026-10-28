import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultSettings, settings } from './fields.ts';

describe('defaultSettings (OS reduced motion)', () => {
  it('keeps the design defaults when the OS does not ask for reduced motion', () => {
    expect(defaultSettings(false)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.screenShake).toBe(true);
    expect(DEFAULT_SETTINGS.reducedFlashing).toBe(false);
  });

  it('turns reduced flashing on and screen shake off under prefers-reduced-motion', () => {
    expect(defaultSettings(true)).toEqual({ ...DEFAULT_SETTINGS, reducedFlashing: true, screenShake: false });
  });

  it('never overrides what a stored save says', () => {
    const stored = { ...DEFAULT_SETTINGS, reducedFlashing: false, screenShake: true };
    expect(settings(stored)).toEqual(stored);
  });
});
