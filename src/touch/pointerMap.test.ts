import { describe, expect, it } from 'vitest';
import { PointerMap } from './pointerMap.ts';

const NOW = 10_000;

describe('PointerMap', () => {
  it('maps a tap to down then up with the event stamps', () => {
    const m = new PointerMap();
    expect(m.down(1, 'L', 9990, NOW)).toEqual({
      events: [{ kind: 'down', side: 'L', t: 9990, repeat: false }],
      blocked: false,
    });
    expect(m.release(1, 9995, NOW)).toEqual([{ kind: 'up', side: 'L', t: 9995, repeat: false }]);
  });

  it('maps the jump control to a jump action', () => {
    const m = new PointerMap();
    expect(m.down(4, 'jump', 9000, NOW).events).toEqual([
      { kind: 'down', action: 'jump', t: 9000, repeat: false },
    ]);
    expect(m.release(4, 9100, NOW)).toEqual([{ kind: 'up', action: 'jump', t: 9100, repeat: false }]);
  });

  it('a second finger on a held side emits nothing and reports blocked', () => {
    const m = new PointerMap();
    m.down(1, 'L', 9000, NOW);
    expect(m.down(2, 'L', 9050, NOW)).toEqual({ events: [], blocked: true });
    expect(m.held('L')).toBe(2);
    // Lifting the second finger keeps the side held: no up.
    expect(m.release(2, 9100, NOW)).toEqual([]);
    expect(m.release(1, 9150, NOW)).toEqual([{ kind: 'up', side: 'L', t: 9150, repeat: false }]);
    expect(m.held('L')).toBe(0);
  });

  it('two thumbs on different sides are independent', () => {
    const m = new PointerMap();
    expect(m.down(1, 'R', 9000, NOW).events).toHaveLength(1);
    expect(m.down(2, 'L', 9040, NOW).events).toEqual([{ kind: 'down', side: 'L', t: 9040, repeat: false }]);
    expect(m.release(1, 9080, NOW)).toEqual([{ kind: 'up', side: 'R', t: 9080, repeat: false }]);
  });

  it('pointerup, then pointercancel and lostpointercapture for the same finger are no-ops', () => {
    const m = new PointerMap();
    m.down(1, 'R', 9000, NOW);
    expect(m.release(1, 9010, NOW)).toHaveLength(1);
    expect(m.release(1, 9011, NOW)).toEqual([]);
    expect(m.release(1, 9012, NOW)).toEqual([]);
  });

  it('cancel releases the side so the next press steps', () => {
    const m = new PointerMap();
    m.down(1, 'L', 9000, NOW);
    expect(m.release(1, 9010, NOW)).toEqual([{ kind: 'up', side: 'L', t: 9010, repeat: false }]);
    expect(m.down(2, 'L', 9100, NOW).blocked).toBe(false);
  });

  it('a repeated down for a tracked pointer is ignored (no double count)', () => {
    const m = new PointerMap();
    m.down(1, 'L', 9000, NOW);
    expect(m.down(1, 'L', 9010, NOW)).toEqual({ events: [], blocked: false });
    expect(m.held('L')).toBe(1);
  });

  it('the finger keeps its control while it moves (release reports the landing control)', () => {
    const m = new PointerMap();
    m.down(7, 'L', 9000, NOW);
    expect(m.release(7, 9100, NOW)).toEqual([{ kind: 'up', side: 'L', t: 9100, repeat: false }]);
    expect(m.held('R')).toBe(0);
  });

  it('releaseAll emits one up per held control and forgets every finger', () => {
    const m = new PointerMap();
    m.down(1, 'L', 9000, NOW);
    m.down(2, 'L', 9001, NOW);
    m.down(3, 'jump', 9002, NOW);
    expect(m.releaseAll(9500, NOW)).toEqual([
      { kind: 'up', side: 'L', t: 9500, repeat: false },
      { kind: 'up', action: 'jump', t: 9500, repeat: false },
    ]);
    expect(m.active).toBe(false);
    expect(m.release(1, 9600, NOW)).toEqual([]);
    expect(m.releaseAll(9700, NOW)).toEqual([]);
  });

  it('falls back to now for future or stale stamps, and never goes backwards', () => {
    const m = new PointerMap();
    expect(m.down(1, 'L', NOW + 5, NOW).events[0]?.t).toBe(NOW);
    expect(m.release(1, 0, NOW + 20)).toEqual([{ kind: 'up', side: 'L', t: NOW + 20, repeat: false }]);
    // Valid but earlier than the last emitted stamp: clamped up.
    expect(m.down(2, 'R', NOW + 10, NOW + 30).events[0]?.t).toBe(NOW + 20);
    expect(m.release(2, Number.NaN, NOW + 40)[0]?.t).toBe(NOW + 40);
  });

  it('keeps sub-ms precision of valid stamps', () => {
    const m = new PointerMap();
    expect(m.down(1, 'L', 9999.25, NOW).events[0]?.t).toBe(9999.25);
  });
});
