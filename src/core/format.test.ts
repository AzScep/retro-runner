import { describe, expect, it } from 'vitest';
import { formatLadderTotal, formatMargin, formatTime, toKmh } from './index.ts';

describe('formatTime (design 4.1)', () => {
  it('rounds up to the next hundredth', () => {
    expect(formatTime(11841)).toBe('11.85');
    expect(formatTime(11840)).toBe('11.84');
    expect(formatTime(11849)).toBe('11.85');
    expect(formatTime(11850)).toBe('11.85');
  });

  it('pads seconds to two digits and handles null', () => {
    expect(formatTime(0)).toBe('00.00');
    expect(formatTime(5300)).toBe('05.30');
    expect(formatTime(null)).toBe('--.--');
  });

  it('switches to M:SS.hh from 60.00 s (design 14.4), deciding on the rounded-up value', () => {
    expect(formatTime(59990)).toBe('59.99');
    expect(formatTime(59991)).toBe('1:00.00');
    expect(formatTime(60000)).toBe('1:00.00');
    expect(formatTime(64370)).toBe('1:04.37');
    expect(formatTime(64361)).toBe('1:04.37');
    expect(formatTime(72000)).toBe('1:12.00');
    expect(formatTime(90000)).toBe('1:30.00');
    expect(formatTime(100000)).toBe('1:40.00');
  });

  it('ignores float noise from tick-based clocks', () => {
    expect(formatTime((12 * 1000) / 120)).toBe('00.10');
  });
});

describe('formatLadderTotal (design 16.5)', () => {
  it('always uses M:SS.hh with the same round-up rule', () => {
    expect(formatLadderTotal(84100)).toBe('1:24.10');
    expect(formatLadderTotal(391620)).toBe('6:31.62');
    expect(formatLadderTotal(391611)).toBe('6:31.62');
    expect(formatLadderTotal(70000)).toBe('1:10.00');
    expect(formatLadderTotal(59990)).toBe('0:59.99');
    expect(formatLadderTotal(null)).toBe('-:--.--');
  });
});

describe('formatMargin', () => {
  it('is signed with the same ceil rule on the magnitude', () => {
    expect(formatMargin(-760)).toBe('-0.76');
    expect(formatMargin(310)).toBe('+0.31');
    expect(formatMargin(-761)).toBe('-0.77');
    expect(formatMargin(0)).toBe('+0.00');
    expect(formatMargin(12345)).toBe('+12.35');
  });
});

describe('toKmh', () => {
  it('converts m/s to rounded km/h', () => {
    expect(toKmh(12.5)).toBe(45);
    expect(toKmh(10)).toBe(36);
    expect(toKmh(0)).toBe(0);
  });
});
