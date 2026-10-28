import { describe, expect, it } from 'vitest';
import { EVENT_IDS } from '../core/index.ts';
import { miniTextWidth } from './miniFont.ts';
import { recordsHeaders } from './recordsLayout.ts';

describe('records headers (design 18.7, 29.2.1)', () => {
  it('labels every column, the status column as BEST, with no two headers touching', () => {
    for (const event of EVENT_IDS) {
      const heads = recordsHeaders(event);
      expect(heads.map((h) => h.text)).toEqual(
        event === '110mh'
          ? ['RIVAL', 'BEST', 'PB', 'HIT', 'TARGET', 'LAST 3']
          : ['RIVAL', 'BEST', 'PB', 'TARGET', 'LAST 3'],
      );
      const spans = heads.map((h) => {
        const w = miniTextWidth(h.text);
        const x0 = h.align === 'left' ? h.x : h.x - w / 2;
        return [x0, x0 + w] as const;
      });
      for (let i = 1; i < spans.length; i++) {
        expect(
          (spans[i]?.[0] ?? 0) - (spans[i - 1]?.[1] ?? 0),
          `${event} ${heads[i]?.text}`,
        ).toBeGreaterThanOrEqual(3);
      }
      expect(spans.at(-1)?.[1] ?? 0).toBeLessThanOrEqual(316);
    }
  });
});
