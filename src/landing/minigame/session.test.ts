import { describe, expect, it } from 'vitest';
import { EVENTS, TUNING, type RaceInput, type Side } from '../../core/index.ts';
import type { LandingCue } from '../audio/index.ts';
import type { DashEvent } from './index.ts';
import { DashSession, finishEvent, STEP_CUE_MIN_MS } from './session.ts';

const FRAME_MS = 1000 / 60;
const T0 = 1000;

function setup() {
  const events: DashEvent[] = [];
  const cues: LandingCue[] = [];
  const s = new DashSession({ onEvent: (e) => events.push(e), cue: (c) => cues.push(c), seed: () => 7 });
  return { s, events, cues };
}

function key(kind: 'down' | 'up', side: Side, t: number): RaceInput {
  return { kind, side, t, repeat: false, source: 'k' };
}

/** Advances frame by frame until `until` returns true; returns the time reached. */
function runUntil(s: DashSession, from: number, until: () => boolean, maxMs = 60000): number {
  let t = from;
  while (!until()) {
    t += FRAME_MS;
    s.advance(t);
    if (t - from > maxMs) throw new Error('condition never met');
  }
  return t;
}

/** Alternating key presses every `periodMs` from `from` until the result shows. */
function mashToResult(s: DashSession, from: number, periodMs: number): number {
  let t = from;
  let i = 0;
  let next = from;
  while (s.mode !== 'result') {
    t += FRAME_MS;
    while (next <= t) {
      const side: Side = i++ % 2 === 0 ? 'L' : 'R';
      s.input(key('down', side, next));
      s.input(key('up', side, next + 20));
      next += periodMs;
    }
    s.advance(t);
    if (t - from > 60000) throw new Error('no result');
  }
  return t;
}

const goTime = (s: DashSession, from: number) => runUntil(s, from, () => s.state?.phase === 'running');

describe('DashSession', () => {
  it('runs the real 100 m against Pip and reports the start', () => {
    const { s, events } = setup();
    expect(s.mode).toBe('ready');
    expect(s.state).toBeNull();
    expect(s.start(T0)).toBe(true);
    expect(s.mode).toBe('live');
    expect(s.state?.event).toBe('100m');
    expect(s.state?.opponent).toBe('pip');
    expect(s.state?.runners).toHaveLength(6);
    expect(events).toEqual([{ type: 'start' }]);
    // A second start while live is ignored.
    expect(s.start(T0 + 10)).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('drops inputs before the first start', () => {
    const { s } = setup();
    s.input(key('down', 'L', T0));
    expect(s.state).toBeNull();
  });

  it('cues the countdown beats and GO', () => {
    const { s, cues } = setup();
    s.start(T0);
    goTime(s, T0);
    expect(cues).toEqual(['countdown', 'countdown', 'countdown', 'go']);
  });

  it('turns a fresh press in the countdown into a false start, and a second into a DQ', () => {
    const { s, events, cues } = setup();
    s.start(T0);
    let t = runUntil(s, T0, () => s.state?.phase === 'countdown');
    s.input(key('down', 'L', t + 1));
    s.input(key('up', 'L', t + 30));
    t = runUntil(s, t, () => s.state?.phase === 'falseStart');
    expect(events.map((e) => e.type)).toEqual(['start', 'falseStart']);
    expect(cues).toContain('falseStart');
    t = runUntil(s, t, () => s.state?.phase === 'countdown');
    s.input(key('down', 'R', t + 1));
    runUntil(s, t, () => s.mode === 'result');
    expect(events.map((e) => e.type)).toEqual(['start', 'falseStart', 'falseStart', 'disqualified']);
    expect(s.outcome?.result).toBe('dq');
  });

  it('reports a fast race as a win with both times, and stops taking input after it', () => {
    const { s, events, cues } = setup();
    s.start(T0);
    const go = goTime(s, T0);
    mashToResult(s, go, 70);
    const finish = events.at(-1);
    expect(finish?.type).toBe('finish');
    if (finish?.type !== 'finish') return;
    expect(finish.won).toBe(true);
    expect(finish.youMs).toBe(s.outcome?.ms);
    expect(finish.youMs).toBeLessThan(finish.pipMs);
    expect(finish.pipMs).toBe(s.outcome?.oppMs);
    expect(cues).toContain('win');
    expect(cues).not.toContain('lose');
    expect(s.capturing).toBe(false);
    const steps = s.outcome?.steps;
    s.input(key('down', 'L', 999999));
    expect(s.outcome?.steps).toBe(steps);
  });

  it('reports no running as a DNF loss at the cap', () => {
    const { s, events, cues } = setup();
    s.start(T0);
    const go = goTime(s, T0);
    runUntil(s, go, () => s.mode === 'result');
    expect(events.at(-1)).toEqual({
      type: 'finish',
      won: false,
      photo: false,
      youMs: EVENTS['100m'].dnfMs,
      pipMs: s.outcome?.oppMs,
    });
    expect(cues).toContain('lose');
  });

  it('throttles step cues', () => {
    const { s, cues } = setup();
    s.start(T0);
    const go = goTime(s, T0);
    // Five valid steps 36 ms apart handled in one (long) frame: one cue.
    for (let i = 0; i < 5; i++) {
      const side: Side = i % 2 === 0 ? 'L' : 'R';
      s.input(key('down', side, go + 1 + i * 36));
      s.input(key('up', side, go + 20 + i * 36));
    }
    s.advance(go + 200);
    expect(cues.filter((c) => c === 'step')).toHaveLength(1);
    s.input(key('down', 'R', go + 201));
    s.advance(go + 200 + STEP_CUE_MIN_MS);
    expect(cues.filter((c) => c === 'step')).toHaveLength(2);
  });

  it('pauses and resumes a live race, but not one already across the line', () => {
    const { s } = setup();
    s.start(T0);
    const go = goTime(s, T0);
    expect(s.pause(go + 100)).toBe(true);
    expect(s.mode).toBe('paused');
    expect(s.capturing).toBe(false);
    expect(s.advance(go + 5000)).toEqual([]);
    expect(s.resume(go + 5000)).toBe(true);
    expect(s.state?.getSet).toBe(true);
    expect(s.mode).toBe('live');

    const fast = setup().s;
    fast.start(T0);
    const g = goTime(fast, T0);
    let t = g;
    let i = 0;
    while (fast.state?.player.finishMs === null) {
      t += FRAME_MS;
      const side: Side = i++ % 2 === 0 ? 'L' : 'R';
      fast.input(key('down', side, t - 1));
      fast.input(key('up', side, t - 0.5));
      fast.advance(t);
    }
    expect(fast.pause(t)).toBe(false);
  });

  it('releases a detached source so its held side can step again', () => {
    const { s } = setup();
    s.start(T0);
    const go = goTime(s, T0);
    // L held by the keyboard when it is detached; its keyup never arrives.
    s.input(key('down', 'L', go + 10));
    s.advance(go + 50);
    s.release('k', go + 60);
    s.input(key('down', 'R', go + 100));
    s.input(key('up', 'R', go + 120));
    s.input(key('down', 'L', go + 200));
    s.advance(go + 300);
    // L, R, then L again (only because the release lifted it), so R is next. Without the
    // release the second L would be a held side and L would still be expected.
    expect(s.state?.expectedSide).toBe('R');
  });

  it('retries from the blocks with a fresh race', () => {
    const { s, events } = setup();
    s.start(T0);
    runUntil(s, goTime(s, T0), () => s.mode === 'result');
    const t = 100000;
    expect(s.start(t)).toBe(true);
    expect(events.filter((e) => e.type === 'start')).toHaveLength(2);
    expect(s.outcome).toBeNull();
    const firstBeat = runUntil(s, t, () => s.state?.phase === 'countdown');
    expect(firstBeat - t).toBeLessThan(TUNING.INTRO_MS);
  });
});

describe('finishEvent', () => {
  it('passes the photo flag through and uses 1st place as the win', () => {
    const { s } = setup();
    s.start(T0);
    mashToResult(s, goTime(s, T0), 70);
    const o = s.outcome;
    if (o === null) throw new Error('no outcome');
    expect(finishEvent({ ...o, photoFinish: true }).photo).toBe(true);
    expect(finishEvent({ ...o, result: 'lose', place: 2 }).won).toBe(false);
  });
});
