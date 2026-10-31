import { describe, expect, it } from 'vitest';
import * as content from './index.ts';

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'function')
    return strings((value as (a: string, b: string) => unknown)('12.34', '12.35'));
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const { PAGE_META, ...display } = content;
const all = strings(content);
const shown = strings(display).filter((s) => s !== '../');

describe('landing copy', () => {
  it('never spoils tier 7 (design 30)', () => {
    for (const s of all) expect(s).not.toMatch(/zyx|alien|galactic|mothership|saucer|orbit|warp/i);
    expect(content.RIVALS.rivals.map((r) => r.id)).not.toContain('zyx');
    expect(content.STORY.beats.map((b) => b.tier)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('uses no em dash', () => {
    for (const s of all) expect(s).not.toContain(String.fromCharCode(0x2014));
  });

  it('keeps pixel-font lines short', () => {
    for (const s of shown) expect(s.length, s).toBeLessThanOrEqual(70);
    const titles = [
      content.HERO.headline,
      ...[content.STORY, content.MECHANICS, content.RIVALS, content.MODES].map((x) => x.heading.title),
    ];
    for (const t of titles) expect(t.length, t).toBeLessThanOrEqual(28);
  });

  it('fits the meta text to search snippet lengths', () => {
    expect(PAGE_META.title.length).toBeLessThanOrEqual(60);
    expect(PAGE_META.description.length).toBeLessThanOrEqual(160);
    expect(PAGE_META.ogDescription.length).toBeLessThanOrEqual(200);
  });

  it('takes rival lines from the game data', () => {
    const pip = content.RIVALS.rivals.find((r) => r.id === 'pip');
    expect(pip?.eventsLine).toBe('100M / HURDLES / 400M');
    expect(pip?.appearances.map((a) => a.target)).toEqual(['18.00', '22.00', '1:12.00']);
    const sol = content.RIVALS.rivals.find((r) => r.id === 'sol');
    expect(sol?.eventsLine).toBe('400M');
    expect(content.STORY.beats[4]?.rivals).toEqual(['VALENTINA', 'SOL']);
  });
});
