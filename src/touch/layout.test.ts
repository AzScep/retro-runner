import { describe, expect, it } from 'vitest';
import { computeLayout, NO_INSETS, toGamePx, type LayoutInput, type Rect } from './layout.ts';

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Pixel 7 Chrome tab (Playwright descriptor): 863x360, 2 CSS px per game px, 111 px bars.
const pixel7: LayoutInput = {
  viewW: 863,
  viewH: 360,
  insets: NO_INSETS,
  canvas: { x: 111.5, y: 0, w: 640, h: 360 },
  gamePx: 2,
  hurdles: false,
};

// 16:9 tablet: canvas fills the screen, no bars.
const tablet: LayoutInput = {
  viewW: 1280,
  viewH: 720,
  insets: NO_INSETS,
  canvas: { x: 0, y: 0, w: 1280, h: 720 },
  gamePx: 4,
  hurdles: false,
};

// iPhone 15 Home Screen app: the notch insets eat most of the bars.
const iphoneApp: LayoutInput = {
  viewW: 852,
  viewH: 393,
  insets: { top: 0, right: 59, bottom: 21, left: 59 },
  canvas: { x: 95, y: 0, w: 661.33, h: 372 },
  gamePx: 372 / 180,
  hurdles: false,
};

// iPad (gen 7) landscape Home Screen app: 4:3, so the bars are above and below the canvas.
const ipad: LayoutInput = {
  viewW: 1080,
  viewH: 810,
  insets: { top: 0, right: 0, bottom: 20, left: 0 },
  canvas: { x: 0, y: 95, w: 1080, h: 607.5 },
  gamePx: 1080 / 320,
  hurdles: false,
};

describe('computeLayout', () => {
  it('puts the pads in wide side bars, bottom aligned 8 px above the bottom inset', () => {
    const l = computeLayout(pixel7);
    expect(l.padsOverCanvas).toBe(false);
    expect(l.pads.L.w).toBe(104); // bar 111.5 - 8, rounded
    expect(l.pads.L.y + l.pads.L.h).toBe(352);
    expect(l.pads.L.x + l.pads.L.w).toBeLessThanOrEqual(111.5);
    expect(l.pads.R.x).toBeGreaterThanOrEqual(751);
    expect(l.pads.jump).toBeNull();
    expect(l.zones.jump).toBeNull();
  });

  it('puts the pads over the canvas at the design positions without bars', () => {
    const l = computeLayout(tablet);
    expect(l.padsOverCanvas).toBe(true);
    expect(l.pads.L).toEqual({ x: 24, y: 472, w: 256, h: 192 });
    expect(l.pads.R).toEqual({ x: 1000, y: 472, w: 256, h: 192 });
  });

  it('notch insets: pads use the side bars including the insets, never the track', () => {
    const l = computeLayout(iphoneApp);
    expect(l.placement).toBe('insetBars');
    expect(l.padsOverCanvas).toBe(false);
    // Left bar 12-95, right bar 756-840: pads 75 px wide (bar 83 - 8), centred, off the canvas.
    expect(l.pads.L).toEqual({ x: 16, y: 308, w: 75, h: 56 });
    expect(l.pads.L.x + l.pads.L.w).toBeLessThanOrEqual(95);
    expect(l.pads.R.x).toBeGreaterThanOrEqual(757);
    expect(l.pads.R.x + l.pads.R.w).toBeLessThanOrEqual(852 - 12);
    // Bottom aligned 8 px above the home indicator inset.
    expect(l.pads.R.y + l.pads.R.h).toBe(393 - 21 - 8);
    // The zones reach out to the pads (12 px from the screen edge), so the whole pad is live.
    expect(inside(l.pads.L, l.zones.L)).toBe(true);
    expect(inside(l.pads.R, l.zones.R)).toBe(true);
  });

  it('notch insets in hurdles: the jump pad stays over the canvas, clear of the island', () => {
    const l = computeLayout({ ...iphoneApp, hurdles: true });
    expect(l.jumpOverCanvas).toBe(true);
    const gp = 372 / 180;
    expect(l.pads.jump).toEqual({
      x: Math.round(95 + 250 * gp),
      y: Math.round(62 * gp),
      w: Math.round(64 * gp),
      h: Math.round(40 * gp),
    });
    expect(l.zones.R.y).toBe(Math.round(393 * 0.58));
    // The RIGHT pad no longer covers the track where the player's next hurdles appear.
    expect(l.pads.R.x).toBeGreaterThanOrEqual(95 + 661);
  });

  it('4:3 iPad: pads in the bar under the canvas, in line with the over-canvas corners', () => {
    const l = computeLayout(ipad);
    expect(l.placement).toBe('bottomBar');
    expect(l.padsOverCanvas).toBe(false);
    const canvasBottom = 95 + 607.5;
    // Bar 790 - 702.5 = 87.5: pads 71 tall (bar - 2 x 8, whole px), 64:48.
    for (const pad of [l.pads.L, l.pads.R]) {
      expect(pad.y).toBeGreaterThanOrEqual(canvasBottom);
      expect(pad.y + pad.h).toBe(810 - 20 - 8);
      expect(pad.h).toBeGreaterThanOrEqual(44);
    }
    expect(l.pads.L.x).toBe(Math.round((6 * 1080) / 320));
    expect(l.pads.R.x + l.pads.R.w).toBe(Math.round((314 * 1080) / 320));
    const h = computeLayout({ ...ipad, hurdles: true });
    expect(h.jumpOverCanvas).toBe(true);
    expect(h.pads.jump?.y).toBe(Math.round(95 + 62 * (1080 / 320)));
  });

  it('zones are halves below the top strip, inside edge margins and the bottom inset', () => {
    const l = computeLayout(tablet);
    expect(l.zones.L.x).toBe(12);
    expect(l.zones.L.y).toBe(Math.round(720 * 0.22));
    expect(l.zones.L.y + l.zones.L.h).toBe(720);
    expect(l.zones.L.x + l.zones.L.w).toBe(l.zones.R.x);
    expect(l.zones.R.x + l.zones.R.w).toBe(1280 - 12);
    // With safe-area insets and the pads inside them, the zones start 12 px inside the insets.
    const notch = computeLayout({ ...iphoneApp, canvas: { x: 59, y: 0, w: 734, h: 413 }, viewH: 434 });
    expect(notch.placement).toBe('canvas');
    expect(notch.zones.L.x).toBe(59 + 12);
    expect(notch.zones.R.x + notch.zones.R.w).toBe(852 - 59 - 12);
    expect(notch.zones.L.y + notch.zones.L.h).toBe(434 - 21);
  });

  it('every pad sits inside the zone it names and never under the insets', () => {
    for (const base of [pixel7, tablet, iphoneApp, ipad]) {
      for (const hurdles of [false, true]) {
        const l = computeLayout({ ...base, hurdles });
        // insetBars pads may use the side insets (down to the 12 px edge margin), never the bottom one.
        const side = l.placement === 'insetBars';
        const safe: Rect = {
          x: side ? 12 : base.insets.left,
          y: base.insets.top,
          w: base.viewW - (side ? 24 : base.insets.left + base.insets.right),
          h: base.viewH - base.insets.top - base.insets.bottom,
        };
        for (const pad of [l.pads.L, l.pads.R, l.pads.jump]) if (pad) expect(inside(pad, safe)).toBe(true);
        expect(inside(l.pause, safe)).toBe(true);
        // The pause button never lands in a side inset (rounded corners, the island).
        expect(l.pause.x).toBeGreaterThanOrEqual(base.insets.left);
        expect(l.pause.x + l.pause.w).toBeLessThanOrEqual(base.viewW - base.insets.right);
        if (l.padsOverCanvas || base === pixel7) {
          // Over the canvas the pads are inside their zones; in bars only the edge margin may differ.
          expect(l.pads.R.y).toBeGreaterThanOrEqual(l.zones.R.y);
        }
        if (hurdles) {
          expect(l.zones.jump).not.toBeNull();
          expect(l.pads.jump).not.toBeNull();
          const jz = l.zones.jump as Rect;
          const jp = l.pads.jump as Rect;
          expect(jp.y).toBeGreaterThanOrEqual(jz.y);
          expect(jp.y + jp.h).toBeLessThanOrEqual(jz.y + jz.h);
          expect(jz.y + jz.h).toBe(l.zones.R.y);
          expect(overlaps(jz, l.zones.R)).toBe(false);
        }
      }
    }
  });

  it('hurdles over the canvas split JUMP and RIGHT at 58 % of the height', () => {
    const l = computeLayout({ ...tablet, hurdles: true });
    expect(l.zones.jump?.y).toBe(Math.round(720 * 0.22));
    expect(l.zones.R.y).toBe(Math.round(720 * 0.58));
    expect(l.pads.jump).toEqual({ x: 1000, y: 248, w: 256, h: 160 });
  });

  it('hurdles in bars: jump pad above the right pad with an 8 px gap, split in the gap', () => {
    const l = computeLayout({ ...pixel7, hurdles: true });
    const jp = l.pads.jump as Rect;
    expect(jp.x).toBe(l.pads.R.x);
    expect(l.pads.R.y - (jp.y + jp.h)).toBe(8);
    expect(l.zones.R.y).toBe(l.pads.R.y - 4);
  });

  it('every tappable thing is at least 44 CSS px, even on a tiny canvas', () => {
    const tiny: LayoutInput = {
      viewW: 568,
      viewH: 320,
      insets: NO_INSETS,
      canvas: { x: 0, y: 0, w: 568, h: 320 },
      gamePx: 0.5,
      hurdles: true,
    };
    const l = computeLayout(tiny);
    for (const z of [l.zones.L, l.zones.R, l.zones.jump as Rect, l.pause]) {
      expect(z.w).toBeGreaterThanOrEqual(44);
      expect(z.h).toBeGreaterThanOrEqual(44);
    }
    expect(l.pads.L.h).toBeGreaterThanOrEqual(44);
  });

  it('pause sits top right: in the right bar with bars, at game (300, 18) over the canvas', () => {
    const bars = computeLayout(pixel7);
    expect(bars.pause.x).toBeGreaterThanOrEqual(751);
    expect(bars.pause.y).toBe(8);
    expect(bars.pause.w).toBe(44);
    const over = computeLayout(tablet);
    expect(over.pause).toEqual({ x: 1232 - 32, y: 104 - 32, w: 64, h: 64 });
    expect(over.pauseIcon).toBe(64);
    // The pause button stays in the top strip, clear of the run zones.
    expect(over.pause.y + over.pause.h).toBeLessThanOrEqual(over.zones.R.y);
  });
});

describe('toGamePx', () => {
  const canvas = { x: 100, y: 10, w: 640, h: 360 };
  it('maps viewport px to game px', () => {
    expect(toGamePx(100, 10, canvas, 320, 180)).toEqual({ x: 0, y: 0 });
    expect(toGamePx(420, 190, canvas, 320, 180)).toEqual({ x: 160, y: 90 });
  });
  it('rejects points outside the canvas', () => {
    expect(toGamePx(99, 50, canvas, 320, 180)).toBeNull();
    expect(toGamePx(740, 50, canvas, 320, 180)).toBeNull();
    expect(toGamePx(200, 371, canvas, 320, 180)).toBeNull();
  });
});
