import { describe, expect, it } from 'vitest';
import { dashKeyAction, padSide, TouchPads, type DashKeyFacts } from './input.ts';

describe('padSide', () => {
  it('splits the race area into a left and a right pad', () => {
    expect(padSide(0, 320)).toBe('L');
    expect(padSide(159.9, 320)).toBe('L');
    expect(padSide(160, 320)).toBe('R');
    expect(padSide(319, 320)).toBe('R');
  });
});

describe('TouchPads', () => {
  it('sends one touch down and up per tap', () => {
    const p = new TouchPads();
    expect(p.down(1, 'L', 10)).toEqual({ kind: 'down', side: 'L', t: 10, repeat: false, source: 't' });
    expect(p.up(1, 20)).toEqual({ kind: 'up', side: 'L', t: 20, repeat: false, source: 't' });
  });

  it('counts two fingers on one pad as one held press (core held rule)', () => {
    const p = new TouchPads();
    expect(p.down(1, 'R', 10)).not.toBeNull();
    expect(p.down(2, 'R', 15)).toBeNull();
    expect(p.up(1, 20)).toBeNull();
    expect(p.holds('R')).toBe(true);
    expect(p.up(2, 25)?.kind).toBe('up');
    expect(p.holds('R')).toBe(false);
  });

  it('ignores unknown and repeated pointers, and forgets all on clear', () => {
    const p = new TouchPads();
    expect(p.up(9, 5)).toBeNull();
    p.down(1, 'L', 10);
    expect(p.down(1, 'L', 11)).toBeNull();
    p.clear();
    expect(p.holds('L')).toBe(false);
    expect(p.up(1, 20)).toBeNull();
  });
});

describe('dashKeyAction', () => {
  const base: DashKeyFacts = {
    key: 'Enter',
    repeat: false,
    modified: false,
    mode: 'ready',
    inView: true,
    focusFree: true,
  };

  it('starts on Enter, resumes on Enter, pauses on Esc and retries on R', () => {
    expect(dashKeyAction(base)).toBe('start');
    expect(dashKeyAction({ ...base, mode: 'paused' })).toBe('resume');
    expect(dashKeyAction({ ...base, key: 'Escape', mode: 'live' })).toBe('pause');
    expect(dashKeyAction({ ...base, key: 'r', mode: 'result' })).toBe('retry');
    expect(dashKeyAction({ ...base, key: 'R', mode: 'result' })).toBe('retry');
  });

  it('leaves keys to the page when the dash is off screen or focus is elsewhere', () => {
    expect(dashKeyAction({ ...base, inView: false })).toBeNull();
    expect(dashKeyAction({ ...base, focusFree: false })).toBeNull();
    expect(dashKeyAction({ ...base, modified: true })).toBeNull();
    expect(dashKeyAction({ ...base, repeat: true })).toBeNull();
  });

  it('does nothing for keys outside their mode', () => {
    expect(dashKeyAction({ ...base, mode: 'live' })).toBeNull();
    expect(dashKeyAction({ ...base, mode: 'result' })).toBeNull();
    expect(dashKeyAction({ ...base, key: 'r', mode: 'live' })).toBeNull();
    expect(dashKeyAction({ ...base, key: 'Escape', mode: 'ready' })).toBeNull();
    expect(dashKeyAction({ ...base, key: 'ArrowLeft' })).toBeNull();
  });
});
