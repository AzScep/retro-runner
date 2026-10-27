import { describe, expect, it } from 'vitest';
import {
  crowdIntensity,
  flashHz,
  flashOn,
  formatLadderTotal,
  gapLabel,
  integerZoom,
  ladderNodeY,
  litSegments,
  offscreenSide,
  padClock,
  progressMarkerX,
  segmentColorIndex,
} from './hudMath.ts';
import { menuAction } from './keys.ts';
import { MenuModel } from './menuModel.ts';
import {
  MINI_CHARSET,
  MINI_GLYPHS,
  MINI_HEIGHT,
  miniTextWidth,
  normaliseMini,
  wrapMini,
} from './miniFont.ts';

describe('mini font', () => {
  it('has rectangular 7-row glyphs drawn only with # and .', () => {
    for (const [ch, rows] of Object.entries(MINI_GLYPHS)) {
      expect(rows, ch).toHaveLength(MINI_HEIGHT);
      const w = rows[0]?.length ?? 0;
      expect(w, ch).toBeGreaterThan(0);
      expect(w, ch).toBeLessThanOrEqual(5);
      for (const r of rows) {
        expect(r.length, ch).toBe(w);
        expect(r, ch).toMatch(/^[#.]+$/);
      }
      expect(rows.join('').includes('#'), ch).toBe(true);
    }
  });

  it('covers every character the UI draws with it', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:!?-+/\'"()%<>= ') {
      expect(MINI_CHARSET.includes(ch), ch).toBe(true);
    }
  });

  it('keeps digits the same width so time columns line up', () => {
    const widths = new Set([...'0123456789'].map((d) => MINI_GLYPHS[d]?.[0]?.length));
    expect(widths.size).toBe(1);
  });

  it('uppercases and replaces unknown characters', () => {
    expect(normaliseMini('Pip waves~')).toBe('PIP WAVES?');
  });

  it('measures and wraps text', () => {
    expect(miniTextWidth('')).toBe(0);
    expect(miniTextWidth('A')).toBe(5);
    expect(miniTextWidth('AA')).toBe(11);
    expect(miniTextWidth('A A')).toBe(15);
    const lines = wrapMini('Disciplined. Watch his late kick.', 152);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(miniTextWidth(l)).toBeLessThanOrEqual(152);
    expect(lines.join(' ')).toBe('DISCIPLINED. WATCH HIS LATE KICK.');
  });
});

describe('speed meter', () => {
  it('lights ceil(10 v / V_MAX) segments, clamped', () => {
    expect(litSegments(0)).toBe(0);
    expect(litSegments(-1)).toBe(0);
    expect(litSegments(0.01)).toBe(1);
    expect(litSegments(1.25)).toBe(1);
    expect(litSegments(1.26)).toBe(2);
    expect(litSegments(6.25)).toBe(5);
    expect(litSegments(12.5)).toBe(10);
    expect(litSegments(20)).toBe(10);
  });

  it('colours segments 1-5 green, 6-8 yellow, 9-10 red', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(segmentColorIndex)).toEqual([
      26, 26, 26, 26, 26, 22, 22, 22, 18, 18,
    ]);
  });
});

describe('progress bar and off-screen arrow', () => {
  it('maps 0-100 m onto x 40-280 in whole pixels', () => {
    expect(progressMarkerX(-3)).toBe(40);
    expect(progressMarkerX(0)).toBe(40);
    expect(progressMarkerX(50)).toBe(160);
    expect(progressMarkerX(100)).toBe(280);
    expect(progressMarkerX(115)).toBe(280);
    expect(Number.isInteger(progressMarkerX(33.333))).toBe(true);
  });

  it('detects the off-screen side and labels the gap', () => {
    expect(offscreenSide(-1, 320)).toBe('left');
    expect(offscreenSide(0, 320)).toBeNull();
    expect(offscreenSide(319, 320)).toBeNull();
    expect(offscreenSide(320, 320)).toBe('right');
    expect(gapLabel(4.23)).toBe('4.2M');
    expect(gapLabel(-1.06)).toBe('1.1M');
  });
});

describe('flashing limits (design 6.5)', () => {
  it('caps rates at 3 Hz, or 1 Hz with reduced flashing', () => {
    expect(flashHz(2, false)).toBe(2);
    expect(flashHz(8, false)).toBe(3);
    expect(flashHz(2, true)).toBe(1);
  });

  it('produces a square wave with the requested period', () => {
    expect(flashOn(0, 2)).toBe(true);
    expect(flashOn(249, 2)).toBe(true);
    expect(flashOn(250, 2)).toBe(false);
    expect(flashOn(500, 2)).toBe(true);
    let toggles = 0;
    let prev = flashOn(0, 2);
    for (let t = 1; t <= 1000; t++) {
      const on = flashOn(t, 2);
      if (on !== prev) toggles++;
      prev = on;
    }
    expect(toggles).toBe(4); // 2 full cycles in one second
  });
});

describe('time text', () => {
  it('pads the HUD clock to SS.hh', () => {
    expect(padClock('5.00')).toBe('05.00');
    expect(padClock('11.85')).toBe('11.85');
    expect(padClock('--.--')).toBe('--.--');
  });

  it('formats the ladder total as SSS.hh rounding up', () => {
    expect(formatLadderTotal(null)).toBe('---.--');
    expect(formatLadderTotal(92341)).toBe('092.35');
    expect(formatLadderTotal(100000)).toBe('100.00');
  });
});

describe('integer zoom', () => {
  it('picks the largest whole device-pixel factor and centres the canvas', () => {
    const z = integerZoom(1300, 760, 1, 320, 180);
    expect(z.factor).toBe(4);
    expect(z.cssWidth).toBe(1280);
    expect(z.cssHeight).toBe(720);
    expect(z.cssLeft).toBe(10);
    expect(z.cssTop).toBe(20);
  });

  it('works in device pixels at fractional DPR', () => {
    const z = integerZoom(1280, 720, 1.25, 320, 180);
    expect(z.factor).toBe(5); // 1600x900 device px
    expect(z.cssWidth * 1.25).toBe(1600);
    expect(Number.isInteger(z.cssLeft * 1.25)).toBe(true);
  });

  it('never goes below 1x', () => {
    expect(integerZoom(100, 50, 1, 320, 180).factor).toBe(1);
  });
});

describe('ladder layout', () => {
  it('places nodes 22 px apart from Pip at y = 156', () => {
    expect(ladderNodeY(1)).toBe(156);
    expect(ladderNodeY(2)).toBe(134);
    expect(ladderNodeY(7)).toBe(24);
  });
});

describe('crowd intensity', () => {
  it('rises over the last 20 m', () => {
    expect(crowdIntensity(0)).toBeCloseTo(0.35);
    expect(crowdIntensity(80)).toBeCloseTo(0.35);
    expect(crowdIntensity(90)).toBeCloseTo(0.675);
    expect(crowdIntensity(100)).toBe(1);
    expect(crowdIntensity(120)).toBe(1);
  });
});

describe('menu keys', () => {
  it('maps arrows, WASD, confirm, back and retry by event.code', () => {
    expect(menuAction('ArrowUp', false)).toBe('up');
    expect(menuAction('KeyW', false)).toBe('up');
    expect(menuAction('KeyS', false)).toBe('down');
    expect(menuAction('KeyA', false)).toBe('left');
    expect(menuAction('KeyD', false)).toBe('right');
    expect(menuAction('Enter', false)).toBe('confirm');
    expect(menuAction('Space', false)).toBe('confirm');
    expect(menuAction('Escape', false)).toBe('back');
    expect(menuAction('Backspace', false)).toBe('back');
    expect(menuAction('KeyR', false)).toBe('retry');
    expect(menuAction('KeyQ', false)).toBeNull();
  });

  it('ignores auto-repeat except for directions', () => {
    expect(menuAction('ArrowDown', true)).toBe('down');
    expect(menuAction('Enter', true)).toBeNull();
    expect(menuAction('Escape', true)).toBeNull();
    expect(menuAction('KeyR', true)).toBeNull();
  });
});

describe('MenuModel', () => {
  const items = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B', enabled: false },
    { id: 'c', label: 'C' },
  ] as const;

  it('skips disabled items and wraps', () => {
    const m = new MenuModel([...items]);
    expect(m.focused?.id).toBe('a');
    expect(m.move(1)).toBe(true);
    expect(m.focused?.id).toBe('c');
    expect(m.move(1)).toBe(true);
    expect(m.focused?.id).toBe('a');
    expect(m.move(-1)).toBe(true);
    expect(m.focused?.id).toBe('c');
  });

  it('honours the initial focus only when enabled', () => {
    expect(new MenuModel([...items], 'c').focused?.id).toBe('c');
    expect(new MenuModel([...items], 'b').focused?.id).toBe('a');
  });

  it('moves focus off an item that gets disabled', () => {
    const m = new MenuModel([...items], 'c');
    m.setEnabled('c', false);
    expect(m.focused?.id).toBe('a');
    m.setEnabled('b', true);
    expect(m.focus('b')).toBe(true);
    expect(m.focused?.id).toBe('b');
  });

  it('does not wrap when wrap is off', () => {
    const m = new MenuModel([...items], 'c', false);
    expect(m.move(1)).toBe(false);
    expect(m.focused?.id).toBe('c');
  });
});
