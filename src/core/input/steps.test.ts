import { describe, expect, it } from 'vitest';
import { StepFilter } from './steps.ts';

describe('StepFilter (design 2.2)', () => {
  it('accepts either side first, then only alternation', () => {
    const f = new StepFilter();
    expect(f.down('R', 0, false)).toBe('step');
    f.release('R');
    expect(f.down('L', 100, false)).toBe('step');
    f.release('L');
    expect(f.down('R', 200, false)).toBe('step');
    expect(f.lastSide).toBe('R');
  });

  it('discards auto-repeat', () => {
    const f = new StepFilter();
    expect(f.down('L', 0, false)).toBe('step');
    f.release('L');
    expect(f.down('R', 100, true)).toBe('ignored');
    expect(f.lastSide).toBe('L');
  });

  it('discards a keydown for a side already held (no intervening keyup)', () => {
    const f = new StepFilter();
    expect(f.down('L', 0, false)).toBe('step');
    expect(f.down('R', 100, false)).toBe('step');
    // L released, R still held: a second R keydown (e.g. D while ArrowRight is held) gives nothing.
    f.release('L');
    expect(f.down('L', 200, false)).toBe('step');
    expect(f.down('R', 300, false)).toBe('ignored');
    f.release('R');
    expect(f.down('R', 400, false)).toBe('step');
  });

  it('a held key noted before the race cannot step until released', () => {
    const f = new StepFilter();
    f.noteDown('L');
    expect(f.down('L', 0, false)).toBe('ignored');
    f.release('L');
    expect(f.down('L', 10, false)).toBe('step');
  });

  it('auto-repeat changes nothing', () => {
    const f = new StepFilter();
    expect(f.down('L', 0, true)).toBe('ignored');
    expect(f.lastSide).toBeNull();
    expect(f.down('L', 50, false)).toBe('step');
  });

  it('same-side press is a fumble that keeps lastSide and the step clock', () => {
    const f = new StepFilter();
    expect(f.down('L', 0, false)).toBe('step');
    f.release('L');
    expect(f.down('L', 100, false)).toBe('fumble');
    expect(f.lastSide).toBe('L');
    expect(f.lastStepMs).toBe(0);
  });

  it('enforces the 35 ms minimum interval between valid steps', () => {
    const f = new StepFilter();
    expect(f.down('L', 0, false)).toBe('step');
    expect(f.down('R', 34.9, false)).toBe('ignored');
    f.release('R');
    expect(f.down('R', 35, false)).toBe('step');
  });
});
