import { describe, expect, it } from 'vitest';
import { formatMargin, formatTime, toKmh } from './index.ts';

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

  it('formats ladder totals of 100 s or more', () => {
    expect(formatTime(100000)).toBe('100.00');
    expect(formatTime(92401)).toBe('92.41');
  });

  it('ignores float noise from tick-based clocks', () => {
    expect(formatTime((12 * 1000) / 120)).toBe('00.10');
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
