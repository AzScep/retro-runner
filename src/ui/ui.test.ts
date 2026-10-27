import { describe, expect, it } from 'vitest';
import {
  cleanZone,
  crowdIntensity,
  flashHz,
  flashOn,
  gapLabel,
  gaugeOffset,
  gaugeVisible,
  fitZoom,
  jumpReady,
  ladderNodeY,
  litSegments,
  offscreenSide,
  ovalDot,
  padClock,
  PAL,
  progressMarkerX,
  progressTickMarks,
  segmentColorIndex,
  staminaColorIndex,
  staminaFillW,
  staminaLabelColor,
  sustainTickOffset,
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

  it('scales the bar to the event distance (design 18.4)', () => {
    expect(progressMarkerX(55, 110)).toBe(160);
    expect(progressMarkerX(110, 110)).toBe(280);
    expect(progressMarkerX(100, 400)).toBe(100);
    expect(progressMarkerX(400, 400)).toBe(280);
  });

  it('puts ticks at the hurdles in hurdles and at 100/200/300 m in the 400 m', () => {
    expect(progressTickMarks('100m')).toEqual([]);
    const h = progressTickMarks('110mh');
    expect(h).toHaveLength(10);
    expect(h[0]).toBeCloseTo(13.72);
    expect(h[9]).toBeCloseTo(95.98);
    expect(progressTickMarks('400m')).toEqual([100, 200, 300]);
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
});

describe('fit zoom', () => {
  it('fills the limiting dimension at a fractional factor and centres the canvas', () => {
    // 1366x657: height limits, 657 / 180 = 3.65x.
    const z = fitZoom(1366, 657, 1, 320, 180);
    expect(z.factor).toBeCloseTo(3.65, 5);
    expect(z.cssWidth).toBe(1168);
    expect(z.cssHeight).toBe(657);
    expect(z.cssLeft).toBe(99);
    expect(z.cssTop).toBe(0);
  });

  it('fills the width in a tall window', () => {
    const z = fitZoom(1000, 700, 1, 320, 180);
    expect(z.cssWidth).toBe(1000);
    expect(z.cssHeight).toBe(562);
    expect(z.cssTop).toBe(69);
  });

  it('snaps size and offset to whole device pixels at fractional DPR', () => {
    const z = fitZoom(1283, 731, 1.25, 320, 180);
    for (const v of [z.cssWidth, z.cssHeight, z.cssLeft, z.cssTop]) {
      expect(Number.isInteger(Math.round(v * 1.25 * 1e6) / 1e6)).toBe(true);
    }
    expect(z.cssWidth * 1.25).toBeLessThanOrEqual(Math.floor(1283 * 1.25));
    expect(z.cssHeight * 1.25).toBeLessThanOrEqual(Math.floor(731 * 1.25));
  });

  it('keeps an exact whole multiple when the window allows it', () => {
    const z = fitZoom(1280, 720, 1, 320, 180);
    expect(z.factor).toBe(4);
    expect(z.cssWidth).toBe(1280);
    expect(z.cssLeft).toBe(0);
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

  it('uses the last 20 m of the hurdles and the last 100 m of the 400 m', () => {
    expect(crowdIntensity(90, '110mh')).toBeCloseTo(0.35);
    expect(crowdIntensity(100, '110mh')).toBeCloseTo(0.675);
    expect(crowdIntensity(110, '110mh')).toBe(1);
    expect(crowdIntensity(300, '400m')).toBeCloseTo(0.35);
    expect(crowdIntensity(350, '400m')).toBeCloseTo(0.675);
    expect(crowdIntensity(400, '400m')).toBe(1);
  });
});

describe('oval lap icon (design 14.3, 18.4)', () => {
  it('starts and finishes at the bottom right, back straight on top, home straight on the bottom', () => {
    const start = ovalDot(0);
    const finish = ovalDot(400);
    expect(start).toEqual(finish);
    expect(start).toEqual({ x: 23, y: 13 });
    // Halfway round the first bend: the right end of the oval.
    expect(ovalDot(50)).toEqual({ x: 29, y: 7 });
    // Back straight on the top edge, moving right to left.
    expect(ovalDot(100).y).toBe(1);
    expect(ovalDot(150)).toEqual({ x: 15, y: 1 });
    expect(ovalDot(199).x).toBeLessThan(ovalDot(101).x);
    // Second bend reaches the left end.
    expect(ovalDot(250)).toEqual({ x: 1, y: 7 });
    // Home straight on the bottom, left to right.
    expect(ovalDot(350)).toEqual({ x: 15, y: 13 });
    for (let m = 0; m <= 400; m += 5) {
      const d = ovalDot(m);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + 2).toBeLessThanOrEqual(32);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y + 2).toBeLessThanOrEqual(16);
    }
  });
});

describe('jump gauge (design 18.4)', () => {
  it('maps 0-1 s onto the track and clamps', () => {
    expect(gaugeOffset(0, 78)).toBe(0);
    expect(gaugeOffset(1, 78)).toBe(78);
    expect(gaugeOffset(2, 78)).toBe(78);
    expect(gaugeOffset(-1, 78)).toBe(0);
    expect(gaugeOffset(0.5, 78)).toBe(39);
  });

  it('draws the clean window 0.104-0.296 s as a fixed zone', () => {
    expect(cleanZone(78)).toEqual({ x: 8, w: 15 });
    expect(cleanZone(54)).toEqual({ x: 6, w: 10 });
  });

  it('shows the gauge only with a hurdle ahead at 1 m/s or more, and lights Up within 1 s', () => {
    expect(gaugeVisible(null, 10)).toBe(false);
    expect(gaugeVisible(0.5, 0.5)).toBe(false);
    expect(gaugeVisible(0.5, 1)).toBe(true);
    expect(jumpReady(null)).toBe(false);
    expect(jumpReady(1.2)).toBe(false);
    expect(jumpReady(1)).toBe(true);
  });
});

describe('stamina meter (design 18.4)', () => {
  it('colours green above 60, gold 30-60, red below 30', () => {
    expect(staminaColorIndex(1)).toBe(PAL.green);
    expect(staminaColorIndex(0.61)).toBe(PAL.green);
    expect(staminaColorIndex(0.6)).toBe(PAL.gold);
    expect(staminaColorIndex(0.3)).toBe(PAL.gold);
    expect(staminaColorIndex(0.29)).toBe(PAL.redLight);
  });

  it('fills whole pixels of the 56 px bar', () => {
    expect(staminaFillW(1)).toBe(56);
    expect(staminaFillW(0)).toBe(0);
    expect(staminaFillW(0.5)).toBe(28);
    expect(staminaFillW(1.2)).toBe(56);
  });

  it('flashes the label at 1 Hz below 30, steady red with reduced flashing', () => {
    expect(staminaLabelColor(0.5, 0, false)).toBe(PAL.white);
    expect(staminaLabelColor(0.2, 0, false)).toBe(PAL.redLight);
    expect(staminaLabelColor(0.2, 500, false)).toBe(PAL.white);
    expect(staminaLabelColor(0.2, 1000, false)).toBe(PAL.redLight);
    expect(staminaLabelColor(0.2, 500, true)).toBe(PAL.redLight);
  });

  it('puts the sustain tick 34 px into the speed segments', () => {
    expect(sustainTickOffset()).toBe(34);
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
