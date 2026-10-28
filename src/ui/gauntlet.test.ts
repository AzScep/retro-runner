import { describe, expect, it } from 'vitest';
import { gauntletQuitLine, showBestFurthest } from './gauntlet.ts';

describe('Gauntlet over card (design 32.2)', () => {
  it('names the meet the player quit before, fitting the 256 px panel', () => {
    expect(gauntletQuitLine('SCHOOL CHAMPS')).toBe('QUIT BEFORE SCHOOL CHAMPS');
    // The longest meet name, at 8 px per glyph with 8 px of padding each side.
    expect(gauntletQuitLine('GALACTIC MEET').length * 8).toBeLessThanOrEqual(256 - 16);
  });

  it('shows the best furthest only when this run did not set it', () => {
    expect(showBestFurthest(true)).toBe(false);
    expect(showBestFurthest(false)).toBe(true);
  });
});
