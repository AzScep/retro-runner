import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import {
  activeTapTargets,
  dispatchTap,
  MENU_TAP_MIN,
  MENU_TAP_MIN_SCALE,
  registerTapTarget,
  TAP_SLOP,
} from './tapTargets.ts';

/** The slice of a Phaser scene that tapTargets uses. */
function fakeScene(key: string, index: number) {
  const listeners = new Map<string, () => void>();
  const state = { active: true };
  const scene = {
    sys: { isActive: () => state.active, settings: { key } },
    scene: { getIndex: () => index },
    events: {
      once: (ev: string, fn: () => void) => {
        listeners.set(ev, fn);
      },
    },
  };
  return {
    scene: scene as unknown as Phaser.Scene,
    setActive(v: boolean) {
      state.active = v;
    },
    shutdown() {
      const fn = listeners.get('shutdown');
      listeners.delete('shutdown');
      fn?.();
    },
  };
}

describe('tap targets (design 17.5)', () => {
  it('hits the rectangle under the tap and nothing else', () => {
    const s = fakeScene('A', 0);
    const a = vi.fn();
    const b = vi.fn();
    registerTapTarget(s.scene, { x: 0, y: 0, w: 20, h: 20 }, a);
    registerTapTarget(s.scene, { x: 40, y: 0, w: 20, h: 20 }, b);
    expect(dispatchTap(10, 10)).toBe(true);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(dispatchTap(50, 19)).toBe(true);
    expect(b).toHaveBeenCalledTimes(1);
    expect(dispatchTap(30, 100)).toBe(false);
    s.shutdown();
  });

  it('reaches the nearest target within the slop, but never past it', () => {
    const s = fakeScene('A', 0);
    const a = vi.fn();
    const b = vi.fn();
    registerTapTarget(s.scene, { x: 0, y: 0, w: 20, h: 20 }, a);
    registerTapTarget(s.scene, { x: 26, y: 0, w: 20, h: 20 }, b);
    // Gap 20-26: x 22 is nearer a, x 25 nearer b.
    dispatchTap(22, 10);
    dispatchTap(25, 10);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(dispatchTap(20 + 26 + TAP_SLOP + 1, 10)).toBe(false);
    s.shutdown();
  });

  it('removes targets on scene shutdown and via the returned function', () => {
    const s = fakeScene('A', 0);
    const a = vi.fn();
    const off = registerTapTarget(s.scene, { x: 0, y: 0, w: 20, h: 20 }, a);
    registerTapTarget(s.scene, { x: 100, y: 0, w: 20, h: 20 }, a);
    off();
    expect(dispatchTap(5, 5)).toBe(false);
    expect(activeTapTargets()).toHaveLength(1);
    s.shutdown();
    expect(dispatchTap(105, 5)).toBe(false);
    expect(activeTapTargets()).toHaveLength(0);
    // A restarted scene registers again and gets a fresh shutdown hook.
    registerTapTarget(s.scene, { x: 0, y: 0, w: 20, h: 20 }, a);
    expect(dispatchTap(5, 5)).toBe(true);
    s.shutdown();
    expect(activeTapTargets()).toHaveLength(0);
  });

  it('ignores paused scenes and lets the topmost running scene win', () => {
    const below = fakeScene('Race', 1);
    const above = fakeScene('Pause', 5);
    const low = vi.fn();
    const high = vi.fn();
    registerTapTarget(below.scene, { x: 0, y: 0, w: 320, h: 180 }, low);
    registerTapTarget(above.scene, { x: 100, y: 50, w: 40, h: 20 }, high);
    dispatchTap(110, 60);
    expect(high).toHaveBeenCalledTimes(1);
    expect(low).not.toHaveBeenCalled();
    dispatchTap(10, 10);
    expect(low).toHaveBeenCalledTimes(1);
    below.setActive(false);
    expect(dispatchTap(10, 10)).toBe(false);
    above.setActive(false);
    expect(dispatchTap(110, 60)).toBe(false);
    below.shutdown();
    above.shutdown();
  });

  it('gives a tap under two targets of one scene to the later one (dialog over list)', () => {
    const s = fakeScene('Options', 0);
    const row = vi.fn();
    const yes = vi.fn();
    registerTapTarget(s.scene, { x: 0, y: 40, w: 300, h: 20 }, row);
    const off = registerTapTarget(s.scene, { x: 100, y: 40, w: 40, h: 20 }, yes);
    dispatchTap(110, 50);
    expect(yes).toHaveBeenCalledTimes(1);
    expect(row).not.toHaveBeenCalled();
    off();
    dispatchTap(110, 50);
    expect(row).toHaveBeenCalledTimes(1);
    s.shutdown();
  });

  it('rounds rectangles to whole game pixels', () => {
    const s = fakeScene('A', 0);
    registerTapTarget(s.scene, { x: 0.4, y: 1.6, w: 19.6, h: 20.2 }, () => {});
    expect(activeTapTargets()[0]?.rect).toEqual({ x: 0, y: 2, w: 20, h: 20 });
    s.shutdown();
  });

  it('menu rows reach 44 CSS px on phones in landscape (17.5.2)', () => {
    // CSS px per game px measured on phones: Pixel 7 Chrome tab, 667x375, iPhone 15 Home Screen app,
    // Pixel 7 fullscreen. Each is at or above the scale where MENU_TAP_MIN is 44 CSS px.
    for (const gp of [2.0, 375 / 180, 372 / 180, 412 / 180]) {
      expect(gp).toBeGreaterThanOrEqual(MENU_TAP_MIN_SCALE);
      expect(MENU_TAP_MIN * gp).toBeGreaterThanOrEqual(44);
    }
    expect(MENU_TAP_MIN_SCALE).toBeLessThan(1.84);
  });

  it('stacked MENU_TAP_MIN rows touch without overlapping: every point has one owner', () => {
    const s = fakeScene('Pause', 0);
    const hits = [vi.fn(), vi.fn(), vi.fn()];
    hits.forEach((fn, i) =>
      registerTapTarget(s.scene, { x: 100, y: 60 + i * MENU_TAP_MIN, w: 120, h: MENU_TAP_MIN }, fn),
    );
    const rects = activeTapTargets().map((t) => t.rect);
    for (let i = 1; i < rects.length; i++) {
      const above = rects[i - 1]!;
      expect(rects[i]!.y).toBe(above.y + above.h);
    }
    // Just inside the second row's top edge goes to the second row, not the first.
    dispatchTap(150, 60 + MENU_TAP_MIN + 0.5);
    expect(hits[1]).toHaveBeenCalledTimes(1);
    expect(hits[0]).not.toHaveBeenCalled();
    s.shutdown();
  });
});
