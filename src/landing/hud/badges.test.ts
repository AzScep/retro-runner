import { describe, expect, it } from 'vitest';
import { HUD } from '../content/index.ts';
import { BadgeBook, Checklist, countUp, dashBadge, parseSaved, scoreDigits, serialize } from './badges.ts';
import { readKey, writeKey, type KeyValueStore } from './storage.ts';

const points = (id: string) => HUD.list.find((b) => b.id === id)?.points ?? NaN;

describe('BadgeBook', () => {
  it('earns each badge once and sums its points', () => {
    const book = new BadgeBook(HUD.list);
    expect(book.score).toBe(0);
    expect(book.earn('ranDash')?.id).toBe('ranDash');
    expect(book.earn('ranDash')).toBeNull();
    expect(book.earn('secret')?.id).toBe('secret');
    expect(book.score).toBe(points('ranDash') + points('secret'));
    expect(book.count).toBe(2);
    expect(book.ids).toEqual(['ranDash', 'secret']);
  });

  it('is complete with all seven badges', () => {
    const book = new BadgeBook(HUD.list);
    for (const b of HUD.list) book.earn(b.id);
    expect(book.total).toBe(7);
    expect(book.complete).toBe(true);
  });

  it('round-trips through storage text', () => {
    const book = new BadgeBook(HUD.list, ['allCarts', 'reachedEnd']);
    const again = new BadgeBook(HUD.list, parseSaved(serialize(book), HUD.list));
    expect(again.ids).toEqual(['allCarts', 'reachedEnd']);
    expect(again.score).toBe(book.score);
  });
});

describe('parseSaved', () => {
  it('drops malformed, unknown and repeated entries', () => {
    expect(parseSaved(null, HUD.list)).toEqual([]);
    expect(parseSaved('{not json', HUD.list)).toEqual([]);
    expect(parseSaved('{"ranDash":true}', HUD.list)).toEqual([]);
    expect(parseSaved('["ranDash", 7, "zyx", "ranDash", null, "secret"]', HUD.list)).toEqual([
      'ranDash',
      'secret',
    ]);
  });
});

describe('dashBadge', () => {
  it('maps dash events to badges', () => {
    expect(dashBadge({ type: 'start' })).toBe('ranDash');
    expect(dashBadge({ type: 'falseStart' })).toBe('falseStart');
    expect(dashBadge({ type: 'disqualified' })).toBeNull();
    const finish = { type: 'finish', photo: false, youMs: 9000, pipMs: 9500 } as const;
    expect(dashBadge({ ...finish, won: true })).toBe('beatPip');
    expect(dashBadge({ ...finish, won: true, photo: true })).toBe('beatPip');
    expect(dashBadge({ ...finish, won: false, youMs: 9600 })).toBeNull();
  });

  it('earns beatPip for finishing ahead of Pip even when a field runner wins', () => {
    const finish = { type: 'finish', photo: false, youMs: 17_800, pipMs: 18_000 } as const;
    expect(dashBadge({ ...finish, won: false })).toBe('beatPip');
  });
});

describe('score display', () => {
  it('pads to six digits and clamps', () => {
    expect(scoreDigits(0)).toBe('000000');
    expect(scoreDigits(4200)).toBe('004200');
    expect(scoreDigits(-5)).toBe('000000');
    expect(scoreDigits(12_345_678)).toBe('999999');
  });

  it('counts up in whole steps and lands on the target', () => {
    expect(countUp(0, 1000, 0, 600)).toBe(0);
    expect(countUp(0, 1000, 300, 600)).toBe(500);
    expect(countUp(0, 1000, 600, 600)).toBe(1000);
    expect(countUp(0, 1000, 9999, 600)).toBe(1000);
    expect(countUp(200, 1000, 100, 0)).toBe(1000);
  });
});

describe('Checklist', () => {
  it('reports completion exactly once and ignores strangers', () => {
    const carts = new Checklist(['100m', '110mh', '400m']);
    expect(carts.add('100m')).toBe(false);
    expect(carts.add('100m')).toBe(false);
    expect(carts.add('zyx')).toBe(false);
    expect(carts.add('110mh')).toBe(false);
    expect(carts.add('400m')).toBe(true);
    expect(carts.add('400m')).toBe(false);
    expect(carts.count).toBe(3);
  });
});

describe('storage', () => {
  it('reads and writes through a working store', () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
    writeKey('k', 'v', store);
    expect(readKey('k', store)).toBe('v');
  });

  it('works without storage and when storage throws', () => {
    const broken: KeyValueStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(readKey('k', broken)).toBeNull();
    expect(() => writeKey('k', 'v', broken)).not.toThrow();
    expect(readKey('k', null)).toBeNull();
    expect(() => writeKey('k', 'v', null)).not.toThrow();
  });
});
