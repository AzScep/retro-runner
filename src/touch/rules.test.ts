import { describe, expect, it } from 'vitest';
import type { RaceEvent } from '../core/index.ts';
import { hapticPattern, PULSE } from './haptics.ts';
import { initialModality, nextModality } from './modality.ts';
import { PadStates, type PadRaceState } from './padState.ts';
import { isAndroid, wantsHomeScreenHint, type PlatformFacts } from './platform.ts';

describe('modality', () => {
  it('starts from the coarse pointer query, overridable with ?touch=', () => {
    expect(initialModality(true, '')).toBe('touch');
    expect(initialModality(false, '')).toBe('keyboard');
    expect(initialModality(false, '?touch=1')).toBe('touch');
    expect(initialModality(true, '?a=b&touch=0')).toBe('keyboard');
  });

  it('touch and pen presses switch to touch; mouse changes nothing', () => {
    expect(nextModality('keyboard', { kind: 'pointer', pointerType: 'touch' })).toBe('touch');
    expect(nextModality('keyboard', { kind: 'pointer', pointerType: 'pen' })).toBe('touch');
    expect(nextModality('keyboard', { kind: 'pointer', pointerType: 'mouse' })).toBe('keyboard');
    expect(nextModality('touch', { kind: 'pointer', pointerType: 'mouse' })).toBe('touch');
  });

  it('run, jump and menu keys switch to keyboard; M, F and synthetic keys do not', () => {
    for (const code of ['ArrowLeft', 'KeyD', 'ArrowUp', 'KeyW', 'Enter', 'Space', 'Escape']) {
      expect(nextModality('touch', { kind: 'key', code, trusted: true })).toBe('keyboard');
    }
    expect(nextModality('touch', { kind: 'key', code: 'KeyM', trusted: true })).toBe('touch');
    expect(nextModality('touch', { kind: 'key', code: 'KeyF', trusted: true })).toBe('touch');
    expect(nextModality('touch', { kind: 'key', code: 'Escape', trusted: false })).toBe('touch');
  });
});

const race = (patch: Partial<PadRaceState> = {}): PadRaceState => ({
  phase: 'running',
  paused: false,
  expectedSide: 'R',
  idleMs: 0,
  nextHurdleS: null,
  event: '100m',
  outcome: null,
  player: { finishMs: null },
  ...patch,
});
const none = (): number => 0;

describe('PadStates', () => {
  it('hides the pads with no race, while paused and once the player has finished', () => {
    const p = new PadStates();
    expect(p.frame(null, [], none, false).live).toBe(false);
    expect(p.frame(race({ paused: true }), [], none, false).live).toBe(false);
    expect(p.frame(race({ player: { finishMs: 11840 } }), [], none, false).live).toBe(false);
  });

  it('dim before GO, both bright before the first step, then the expected side', () => {
    const p = new PadStates();
    expect(p.frame(race({ phase: 'countdown' }), [], none, false).pads).toMatchObject({
      L: 'idle',
      R: 'idle',
    });
    expect(p.frame(race({ expectedSide: null }), [], none, false).pads).toMatchObject({
      L: 'expected',
      R: 'expected',
    });
    expect(p.frame(race(), [], none, false).pads).toMatchObject({ L: 'idle', R: 'expected' });
    // Reduced flashing keeps both bright.
    expect(p.frame(race(), [], none, true).pads).toMatchObject({ L: 'expected', R: 'expected' });
  });

  it('pulses both pads at 2 Hz after 0.5 s without a step (1 Hz with reduced flashing)', () => {
    const p = new PadStates();
    expect(p.frame(race({ idleMs: 500 }), [], none, false).pads.L).toBe('expected');
    expect(p.frame(race({ idleMs: 750 }), [], none, false).pads.L).toBe('idle');
    expect(p.frame(race({ idleMs: 1000 }), [], none, false).pads.R).toBe('expected');
    expect(p.frame(race({ idleMs: 750 }), [], none, true).pads.L).toBe('idle');
    expect(p.frame(race({ idleMs: 1000 }), [], none, true).pads.L).toBe('expected');
  });

  it('pressed while a finger is down', () => {
    const p = new PadStates();
    const held = (c: string): number => (c === 'L' ? 1 : 0);
    expect(p.frame(race(), [], held, false).pads).toMatchObject({ L: 'pressed', R: 'expected' });
  });

  it('jump is ready when the next hurdle is within 1.0 s, and exists only in hurdles', () => {
    const p = new PadStates();
    const h = race({ event: '110mh', nextHurdleS: 1.2 });
    expect(p.frame(h, [], none, false)).toMatchObject({ hurdles: true, pads: { jump: 'idle' } });
    expect(p.frame({ ...h, nextHurdleS: 1.0 }, [], none, false).pads.jump).toBe('ready');
    expect(p.frame(race(), [], none, false).hurdles).toBe(false);
  });

  it('held-blocked and fumble flash for 4 frames, fumble wins and shakes 2 game px', () => {
    const p = new PadStates();
    const held = (c: string): number => (c === 'L' ? 2 : 0);
    p.flashBlocked('L');
    const fumble: RaceEvent[] = [{ type: 'fumble', side: 'R' }];
    const f1 = p.frame(race(), fumble, held, false);
    expect(f1.pads).toMatchObject({ L: 'blocked', R: 'fumble' });
    expect(Math.abs(f1.shake.R)).toBe(2);
    expect(f1.shake.L).toBe(0);
    // A re-render inside a pointer handler does not age the flashes.
    expect(p.frame(race(), [], held, false, false).pads.L).toBe('blocked');
    p.frame(race(), [], held, false);
    p.frame(race(), [], held, false);
    expect(p.frame(race(), [], held, false).pads).toMatchObject({ L: 'blocked', R: 'fumble' });
    expect(p.frame(race(), [], held, false).pads).toMatchObject({ L: 'pressed', R: 'expected' });
  });
});

describe('haptics', () => {
  it('pulses on fumble, false start and a player hurdle hit; never on steps', () => {
    expect(hapticPattern([{ type: 'step', side: 'L' }])).toBeNull();
    expect(hapticPattern([{ type: 'fumble', side: 'L' }])).toEqual(PULSE.fumble);
    expect(hapticPattern([{ type: 'falseStart', count: 1 }])).toEqual(PULSE.falseStart);
    expect(hapticPattern([{ type: 'hurdleHit', lane: 'player', index: 2 }])).toEqual(PULSE.hurdleHit);
    expect(hapticPattern([{ type: 'hurdleHit', lane: 'rival', index: 2 }])).toBeNull();
    expect(
      hapticPattern([
        { type: 'fumble', side: 'L' },
        { type: 'hurdleHit', lane: 'player', index: 0 },
      ]),
    ).toEqual(PULSE.hurdleHit);
  });
});

describe('platform', () => {
  const iphoneTab: PlatformFacts = {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    coarse: true,
    anyTouch: true,
    canRequestFullscreen: false,
    standalone: false,
  };
  it('shows the Add to Home Screen hint only in iPhone Safari tabs', () => {
    expect(wantsHomeScreenHint(iphoneTab)).toBe(true);
    expect(wantsHomeScreenHint({ ...iphoneTab, standalone: true })).toBe(false);
    expect(wantsHomeScreenHint({ ...iphoneTab, canRequestFullscreen: true })).toBe(false);
    expect(wantsHomeScreenHint({ ...iphoneTab, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)' })).toBe(
      false,
    );
  });
  it('detects Android', () => {
    expect(isAndroid({ ...iphoneTab, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)' })).toBe(true);
    expect(isAndroid(iphoneTab)).toBe(false);
  });
});
