import { describe, expect, it } from 'vitest';
import type { HistoryEntry, KeyValueStorage, OpponentId, RaceOutcome, RaceResult } from '../index.ts';
import { browserStorage, CORRUPT_KEY, RecordsStore, SAVE_KEY } from '../index.ts';

class MemStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  failWrites = false;
  failReads = false;
  getItem(key: string): string | null {
    if (this.failReads) throw new Error('SecurityError');
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const AT = new Date('2026-10-26T20:15:03.120Z');

function outcome(
  opponent: OpponentId,
  result: RaceResult,
  ms: number | null,
  oppMs: number | null = 15000,
): RaceOutcome {
  return {
    opponent,
    result,
    ms,
    oppMs,
    marginMs: ms !== null && oppMs !== null ? ms - oppMs : null,
    photoFinish: ms !== null && ms === oppMs,
    falseStarts: 0,
    seed: 1849302231,
  };
}

const stored = (s: MemStorage): Record<string, unknown> => JSON.parse(s.map.get(SAVE_KEY) ?? 'null');

describe('RecordsStore load (design 4.3)', () => {
  it('starts fresh: only Pip unlocked, default settings with crt off', () => {
    const store = RecordsStore.load(new MemStorage());
    expect(store.persistent).toBe(true);
    expect(store.data).toEqual({
      version: 1,
      unlockedTier: 1,
      beaten: [],
      champion: false,
      best: {},
      history: [],
      settings: { volume: 8, muted: false, reducedFlashing: false, screenShake: true, crt: false },
    });
    expect(store.isUnlocked('pip')).toBe(true);
    expect(store.isUnlocked('jess')).toBe(false);
  });

  it('round-trips the design 4.3 example document', () => {
    const s = new MemStorage();
    const doc = {
      version: 1,
      unlockedTier: 3,
      beaten: ['pip', 'jess'],
      champion: false,
      best: {
        pip: { ms: 12840, at: '2026-10-26T20:15:03.120Z' },
        jess: { ms: 13410, at: '2026-10-26T20:21:44.007Z' },
      },
      history: [
        {
          opp: 'marco',
          result: 'lose',
          ms: 13920,
          oppMs: 13580,
          falseStarts: 1,
          seed: 1849302231,
          at: '2026-10-26T20:30:12.551Z',
        },
      ],
      settings: { volume: 8, muted: false, reducedFlashing: false, screenShake: true },
    };
    s.map.set(SAVE_KEY, JSON.stringify(doc));
    const store = RecordsStore.load(s);
    expect(store.data).toEqual({ ...doc, settings: { ...doc.settings, crt: false } });
    expect(store.bestMs('jess')).toBe(13410);
    expect(store.isBeaten('jess')).toBe(true);
    expect(store.isUnlocked('marco')).toBe(true);
    expect(store.isUnlocked('kofi')).toBe(false);
  });

  it('backs up unparseable JSON to the corrupt key and starts a fresh save', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY, 'not json');
    const store = RecordsStore.load(s);
    expect(s.map.get(CORRUPT_KEY)).toBe('not json');
    expect(store.data.unlockedTier).toBe(1);
    expect(stored(s)).toMatchObject({ version: 1, unlockedTier: 1 });
  });

  it.each(['{"version":2}', '[]', '42', 'null', '{"unlockedTier":3}'])('treats %s as corrupt', (raw) => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY, raw);
    RecordsStore.load(s);
    expect(s.map.get(CORRUPT_KEY)).toBe(raw);
  });

  it('repairs a v1 document field by field: range checks, unknown ids, bad history, bad settings', () => {
    const s = new MemStorage();
    s.map.set(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        unlockedTier: 99,
        beaten: ['pip', 'pip', 'bogus', 'kofi'],
        champion: true,
        best: {
          pip: { ms: 4999, at: '2026-10-26T20:15:03.120Z' },
          jess: { ms: 30001, at: '2026-10-26T20:15:03.120Z' },
          marco: { ms: 13000.5, at: '2026-10-26T20:15:03.120Z' },
          kofi: { ms: 12500, at: 'yesterday' },
          valentina: { ms: 11800, at: '2026-10-26T20:15:03Z' },
          bogus: { ms: 10000, at: '2026-10-26T20:15:03Z' },
        },
        history: [
          {
            opp: 'pip',
            result: 'win',
            ms: 17000,
            oppMs: 18000,
            falseStarts: 0,
            seed: 1,
            at: AT.toISOString(),
          },
          { opp: 'pip', result: 'dq', ms: 17000, oppMs: null, falseStarts: 2, seed: 1, at: AT.toISOString() },
          { opp: 'pip', result: 'dq', ms: null, oppMs: null, falseStarts: 2, seed: 1, at: AT.toISOString() },
          {
            opp: 'pip',
            result: 'dnf',
            ms: null,
            oppMs: 18000,
            falseStarts: 0,
            seed: 1,
            at: AT.toISOString(),
          },
          { opp: 'pip', result: 'meh', ms: null, oppMs: null, falseStarts: 0, seed: 1, at: AT.toISOString() },
          'junk',
        ],
        settings: { volume: 11, muted: 'yes', reducedFlashing: true, crt: true },
      }),
    );
    const d = RecordsStore.load(s).data;
    expect(s.map.has(CORRUPT_KEY)).toBe(false);
    expect(d.unlockedTier).toBe(5); // stored 99 invalid -> 1, raised to tier after Kofi
    expect(d.beaten).toEqual(['pip', 'kofi']);
    expect(d.champion).toBe(false); // Zyx never beaten
    expect(Object.keys(d.best)).toEqual(['valentina']);
    expect(d.history.map((h) => h.result)).toEqual(['win', 'dq', 'dnf']);
    expect(d.settings).toEqual({
      volume: 8,
      muted: false,
      reducedFlashing: true,
      screenShake: true,
      crt: true,
    });
  });

  it('truncates a stored history longer than 50', () => {
    const s = new MemStorage();
    const entry = {
      opp: 'pip',
      result: 'lose',
      ms: 19000,
      oppMs: 18000,
      falseStarts: 0,
      seed: 1,
      at: AT.toISOString(),
    };
    s.map.set(SAVE_KEY, JSON.stringify({ version: 1, history: Array.from({ length: 80 }, () => entry) }));
    expect(RecordsStore.load(s).data.history).toHaveLength(50);
  });
});

describe('RecordsStore storage failures (design 4.3.3)', () => {
  it('null storage: in memory, persistent false, everything still works', () => {
    const store = RecordsStore.load(null);
    expect(store.persistent).toBe(false);
    expect(store.record(outcome('pip', 'win', 17000, 18000), AT).newPb).toBe(true);
    expect(store.bestMs('pip')).toBe(17000);
  });

  it('a throwing read falls back to memory without throwing', () => {
    const s = new MemStorage();
    s.failReads = true;
    const store = RecordsStore.load(s);
    expect(store.persistent).toBe(false);
    expect(store.data.unlockedTier).toBe(1);
  });

  it('a throwing write keeps the data in memory and flips persistent', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    s.failWrites = true;
    expect(() => store.record(outcome('pip', 'win', 17000, 18000), AT)).not.toThrow();
    expect(() => store.updateSettings({ muted: true })).not.toThrow();
    expect(store.persistent).toBe(false);
    expect(store.data.settings.muted).toBe(true);
    expect(store.bestMs('pip')).toBe(17000);
  });

  it('browserStorage() returns null in Node', () => {
    expect(browserStorage()).toBeNull();
  });
});

describe('RecordsStore.record (design 4.2, 1.3)', () => {
  it('saves immediately with the history entry first', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    store.record(outcome('pip', 'lose', 19000, 18000), AT);
    store.record(outcome('pip', 'win', 17500, 18000), new Date('2026-10-26T21:00:00.000Z'));
    const h = (stored(s).history as HistoryEntry[]).map((e) => e.ms);
    expect(h).toEqual([17500, 19000]);
    expect(store.recent('pip', 3).map((e) => e.ms)).toEqual([17500, 19000]);
    expect(store.recent('jess', 3)).toEqual([]);
  });

  it('PB: first time counts, slower never overwrites, a loss can set a PB, DQ and DNF never do', () => {
    const store = RecordsStore.load(new MemStorage());
    expect(store.record(outcome('pip', 'lose', 19000, 18000), AT)).toMatchObject({
      newPb: true,
      previousPbMs: null,
    });
    expect(store.record(outcome('pip', 'lose', 19500, 18000), AT)).toMatchObject({
      newPb: false,
      previousPbMs: 19000,
    });
    expect(store.bestMs('pip')).toBe(19000);
    expect(store.record(outcome('pip', 'dq', null, null), AT).newPb).toBe(false);
    expect(store.record(outcome('pip', 'dnf', null, 18000), AT).newPb).toBe(false);
    expect(store.record(outcome('pip', 'win', 17000, 18000), AT)).toMatchObject({
      newPb: true,
      previousPbMs: 19000,
    });
    expect(store.data.best.pip).toEqual({ ms: 17000, at: AT.toISOString() });
  });

  it('logs DQ and DNF in history with the right nulls', () => {
    const store = RecordsStore.load(new MemStorage());
    store.record(outcome('pip', 'dnf', null, 18000), AT);
    store.record(outcome('pip', 'dq', null, null), AT);
    expect(store.data.history.map((h) => [h.result, h.ms, h.oppMs])).toEqual([
      ['dq', null, null],
      ['dnf', null, 18000],
    ]);
  });

  it('first win unlocks the next tier; losing and repeat wins unlock nothing', () => {
    const store = RecordsStore.load(new MemStorage());
    expect(store.record(outcome('pip', 'lose', 19000, 18000), AT).unlocked).toBeNull();
    expect(store.isUnlocked('jess')).toBe(false);
    expect(store.record(outcome('pip', 'win', 17000, 18000), AT).unlocked).toBe('jess');
    expect(store.isUnlocked('jess')).toBe(true);
    expect(store.isBeaten('pip')).toBe(true);
    expect(store.record(outcome('pip', 'win', 16900, 18000), AT).unlocked).toBeNull();
    store.record(outcome('jess', 'lose', 16000, 15000), AT);
    expect(store.data.unlockedTier).toBe(2);
  });

  it('a photo finish is a win and unlocks', () => {
    const store = RecordsStore.load(new MemStorage());
    expect(store.record(outcome('pip', 'win', 18000, 18000), AT).unlocked).toBe('jess');
  });

  it('champion only on the first win vs Zyx; ladder total once all 7 have a PB', () => {
    const store = RecordsStore.load(new MemStorage());
    const ids: OpponentId[] = ['pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7'];
    ids.forEach((id, i) => {
      store.record(outcome(id, 'win', 10000 + i, 20000), AT);
      expect(store.ladderTotalMs()).toBeNull();
    });
    expect(store.isUnlocked('zyx')).toBe(true);
    const first = store.record(outcome('zyx', 'win', 10300, 10400), AT);
    expect(first).toMatchObject({ becameChampion: true, unlocked: null });
    expect(store.data.champion).toBe(true);
    expect(store.record(outcome('zyx', 'win', 10200, 10400), AT).becameChampion).toBe(false);
    expect(store.ladderTotalMs()).toBe(10000 + 10001 + 10002 + 10003 + 10004 + 10005 + 10200);
  });

  it('caps history at 50, newest first', () => {
    const store = RecordsStore.load(new MemStorage());
    for (let i = 0; i < 60; i++) store.record(outcome('pip', 'lose', 19000 + i, 18000), AT);
    expect(store.data.history).toHaveLength(50);
    expect(store.data.history[0]?.ms).toBe(19059);
    expect(store.data.history[49]?.ms).toBe(19010);
  });
});

describe('RecordsStore settings and reset', () => {
  it('validates and persists settings changes', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    store.updateSettings({ volume: 14, crt: true });
    expect(store.data.settings).toMatchObject({ volume: 10, crt: true });
    store.updateSettings({ volume: -2.4, muted: true });
    expect(store.data.settings).toMatchObject({ volume: 0, muted: true });
    expect(RecordsStore.load(s).data.settings).toEqual(store.data.settings);
  });

  it('reset clears records but keeps settings', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    store.updateSettings({ volume: 3 });
    store.record(outcome('pip', 'win', 17000, 18000), AT);
    store.reset();
    expect(store.data).toMatchObject({ unlockedTier: 1, beaten: [], best: {}, history: [] });
    expect(store.data.settings.volume).toBe(3);
    const reloaded = RecordsStore.load(s);
    expect(reloaded.bestMs('pip')).toBeNull();
    expect(reloaded.data.settings.volume).toBe(3);
  });
});
