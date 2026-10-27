import { describe, expect, it } from 'vitest';
import type {
  EventId,
  HistoryEntry,
  KeyValueStorage,
  OpponentId,
  RaceOutcome,
  RaceResult,
  SaveData,
} from '../index.ts';
import {
  browserStorage,
  CORRUPT_KEY,
  LADDERS,
  RecordsStore,
  SAVE_KEY,
  SAVE_KEY_V1,
  SAVE_KEY_V2,
} from '../index.ts';

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
const ISO = AT.toISOString();

function outcome(
  opponent: OpponentId,
  result: RaceResult,
  ms: number | null,
  oppMs: number | null = 15000,
  extra: Partial<RaceOutcome> = {},
): RaceOutcome {
  const event = extra.event ?? '100m';
  return {
    event,
    opponent,
    result,
    ms,
    oppMs,
    marginMs: ms !== null && oppMs !== null ? ms - oppMs : null,
    photoFinish: ms !== null && ms === oppMs,
    falseStarts: 0,
    seed: 1849302231,
    hit: event === '110mh' ? 0 : null,
    splits: [],
    mode: 'l',
    place: result === 'win' ? 1 : result === 'lose' ? 2 : null,
    fieldSize: 6,
    winMs: result === 'dq' ? null : result === 'win' ? ms : oppMs,
    standings: [],
    steps: 100,
    fumbles: 2,
    fumble2: 0,
    trips: 0,
    input: 'k',
    ...extra,
  };
}

const stored = (s: MemStorage): SaveData => JSON.parse(s.map.get(SAVE_KEY) ?? 'null') as SaveData;

/** The design 4.3 example document: a real v1 save as shipped. */
const V1_DOC = {
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

/** A v1 save with unlocks up to Kofi (acceptance 22: migration unlocks hurdles and 400 m). */
const V1_TO_KOFI = {
  ...V1_DOC,
  unlockedTier: 5,
  beaten: ['pip', 'jess', 'marco', 'kofi'],
  settings: { volume: 4, muted: true, reducedFlashing: true, screenShake: false, crt: true },
};

/** The design 16.2 example document. */
const V2_DOC = {
  version: 2,
  lastEvent: '110mh',
  seenEvents: ['100m', '110mh'],
  hints: { addToHomeScreen: false },
  settings: { volume: 8, muted: false, reducedFlashing: false, screenShake: true, crt: false, haptics: true },
  events: {
    '100m': {
      unlockedTier: 5,
      beaten: ['pip', 'jess', 'marco', 'kofi'],
      champion: false,
      best: { pip: { ms: 12840, at: '2026-10-26T20:15:03.120Z' } },
      history: [
        {
          opp: 'kofi',
          result: 'win',
          ms: 12410,
          oppMs: 12620,
          falseStarts: 0,
          seed: 1849302231,
          at: '2026-10-27T18:02:11.004Z',
        },
      ],
    },
    '110mh': {
      unlockedTier: 2,
      beaten: ['pip'],
      champion: false,
      best: { pip: { ms: 17920, at: '2026-10-27T18:10:40.300Z' } },
      history: [
        {
          opp: 'pip',
          result: 'win',
          ms: 17920,
          oppMs: 22140,
          falseStarts: 0,
          seed: 99120,
          at: '2026-10-27T18:10:40.300Z',
          hit: 2,
        },
      ],
    },
    '400m': {
      unlockedTier: 1,
      beaten: [],
      champion: false,
      best: {},
      history: [
        {
          opp: 'pip',
          result: 'lose',
          ms: 74530,
          oppMs: 71980,
          falseStarts: 0,
          seed: 7,
          at: '2026-10-27T18:20:00.000Z',
          splits: [15120, 33800, 53410],
        },
      ],
    },
  },
};

const FRESH_EVENT = {
  unlockedTier: 1,
  beaten: [],
  champion: false,
  best: {},
  history: [],
  revealed: false,
  place: {},
  gauntlet: { runs: 0, clears: 0, furthest: 0, best: null },
};

/** v3 fields a migrated 2-runner history entry gains (design 34.4). */
const MIGRATED = { fieldSize: 2, mode: 'l' } as const;
const migratedEntry = (h: Omit<HistoryEntry, 'place' | 'fieldSize' | 'winMs' | 'mode'>): HistoryEntry => ({
  ...h,
  ...MIGRATED,
  place: h.result === 'win' ? 1 : h.result === 'lose' ? 2 : null,
  winMs: h.result === 'win' ? h.ms : h.result === 'dq' ? null : h.oppMs,
});

/** The v3 migration of V2_DOC (design 34.4): Kofi beaten in the 100 m, no tier 6 win anywhere. */
const V2_DOC_MIGRATED: SaveData = {
  version: 3,
  lastEvent: '110mh',
  seenEvents: ['100m', '110mh'],
  hints: { addToHomeScreen: false, revealSeen: false },
  settings: V2_DOC.settings,
  events: {
    '100m': {
      ...(V2_DOC.events['100m'] as unknown as SaveData['events']['100m']),
      history: V2_DOC.events['100m'].history.map((h) => migratedEntry(h as unknown as HistoryEntry)),
      revealed: false,
      place: { pip: 1, jess: 1, marco: 1, kofi: 1 },
      gauntlet: FRESH_EVENT.gauntlet,
    },
    '110mh': {
      ...(V2_DOC.events['110mh'] as unknown as SaveData['events']['110mh']),
      history: V2_DOC.events['110mh'].history.map((h) => migratedEntry(h as unknown as HistoryEntry)),
      revealed: false,
      place: { pip: 1 },
      gauntlet: FRESH_EVENT.gauntlet,
    },
    '400m': {
      ...(V2_DOC.events['400m'] as unknown as SaveData['events']['400m']),
      history: V2_DOC.events['400m'].history.map((h) => migratedEntry(h as unknown as HistoryEntry)),
      revealed: false,
      place: {},
      gauntlet: FRESH_EVENT.gauntlet,
    },
  },
};

describe('RecordsStore load v3 and v2 migration (design 34.4, with the v2 rules of 16.2-16.4)', () => {
  it('starts fresh: 100 m only, Pip unlocked, default settings with crt off and haptics on', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    expect(store.persistent).toBe(true);
    expect(store.data).toEqual({
      version: 3,
      lastEvent: '100m',
      seenEvents: ['100m'],
      hints: { addToHomeScreen: false, revealSeen: false },
      settings: {
        volume: 8,
        muted: false,
        reducedFlashing: false,
        screenShake: true,
        crt: false,
        haptics: true,
      },
      events: { '100m': FRESH_EVENT, '110mh': FRESH_EVENT, '400m': FRESH_EVENT },
    });
    expect(store.isEventUnlocked('100m')).toBe(true);
    expect(store.isEventUnlocked('110mh')).toBe(false);
    expect(store.isEventUnlocked('400m')).toBe(false);
    expect(store.isUnlocked('100m', 'pip')).toBe(true);
    expect(store.isUnlocked('100m', 'jess')).toBe(false);
    // Pip is tier 1 of every ladder, but a locked event unlocks no rival.
    expect(store.isUnlocked('110mh', 'pip')).toBe(false);
    expect(s.map.size).toBe(0);
  });

  it('migrates the design 16.2 example v2 document, writes v3 at once and leaves the v2 key untouched', () => {
    const s = new MemStorage();
    const rawV2 = JSON.stringify(V2_DOC);
    s.map.set(SAVE_KEY_V2, rawV2);
    const store = RecordsStore.load(s);
    expect(store.data).toEqual(V2_DOC_MIGRATED);
    expect(stored(s)).toEqual(V2_DOC_MIGRATED);
    expect(s.map.get(SAVE_KEY_V2)).toBe(rawV2);
    // Round-trips through v3 validation unchanged, and migration runs once.
    s.map.set(SAVE_KEY_V2, JSON.stringify({ ...V2_DOC, events: {} }));
    expect(RecordsStore.load(s).data).toEqual(V2_DOC_MIGRATED);
    expect(store.bestMs('110mh', 'pip')).toBe(17920);
    expect(store.isEventUnlocked('110mh')).toBe(true);
    expect(store.isEventUnlocked('400m')).toBe(true); // Kofi beaten in the 100 m
    expect(store.recent('400m', 'pip', 3)[0]?.splits).toEqual([15120, 33800, 53410]);
    expect(s.map.has(CORRUPT_KEY)).toBe(false);
  });

  it('a valid v3 wins over v2 and v1; a valid v2 wins over v1', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY, JSON.stringify(V2_DOC_MIGRATED));
    s.map.set(SAVE_KEY_V2, JSON.stringify({ ...V2_DOC, events: {} }));
    s.map.set(SAVE_KEY_V1, JSON.stringify({ ...V1_DOC, beaten: [] }));
    expect(RecordsStore.load(s).data.events['100m'].beaten).toEqual(['pip', 'jess', 'marco', 'kofi']);
    s.map.delete(SAVE_KEY);
    s.map.set(SAVE_KEY_V2, JSON.stringify(V2_DOC));
    s.map.set(SAVE_KEY_V1, JSON.stringify({ ...V1_DOC, beaten: [] }));
    expect(RecordsStore.load(s).data.events['100m'].beaten).toEqual(['pip', 'jess', 'marco', 'kofi']);
  });

  it('repairs a v2 document field by field (design 16.3) before migrating it', () => {
    const s = new MemStorage();
    s.map.set(
      SAVE_KEY_V2,
      JSON.stringify({
        version: 2,
        lastEvent: '400m', // locked after repair: falls back to 100m
        seenEvents: ['110mh', 'bogus', '110mh'],
        hints: { addToHomeScreen: 'yes' },
        settings: { volume: 3, haptics: 'no' },
        events: {
          '100m': {
            unlockedTier: 2,
            beaten: ['sol', 'jess', 'pip', 'jess'], // Sol is not on the 100 m ladder
            champion: true,
            best: {
              pip: { ms: 4999, at: ISO },
              jess: { ms: 13000, at: ISO, hit: 3, splits: [1, 2, 3] },
              sol: { ms: 13000, at: ISO },
            },
            history: [
              {
                opp: 'pip',
                result: 'win',
                ms: 17000,
                oppMs: 18000,
                falseStarts: 0,
                seed: 1,
                at: ISO,
                hit: 1,
              },
              { opp: 'sol', result: 'win', ms: 17000, oppMs: 18000, falseStarts: 0, seed: 1, at: ISO },
            ],
          },
          '110mh': {
            unlockedTier: 9,
            beaten: ['pip'],
            best: {
              pip: { ms: 7999, at: ISO },
              jess: { ms: 18000, at: ISO, hit: 11 },
              marco: { ms: 18000, at: ISO, hit: 4 },
            },
            history: [
              { opp: 'pip', result: 'win', ms: 17920, oppMs: 22140, falseStarts: 0, seed: 1, at: ISO },
              {
                opp: 'pip',
                result: 'win',
                ms: 17920,
                oppMs: 22140,
                falseStarts: 0,
                seed: 1,
                at: ISO,
                hit: 11,
              },
              { opp: 'pip', result: 'dq', ms: null, oppMs: null, falseStarts: 2, seed: 1, at: ISO, hit: 0 },
              {
                opp: 'pip',
                result: 'lose',
                ms: 40001,
                oppMs: 22140,
                falseStarts: 0,
                seed: 1,
                at: ISO,
                hit: 0,
              },
            ],
          },
          '400m': {
            beaten: ['valentina', 'sol'],
            best: {
              pip: { ms: 39999, at: ISO },
              jess: { ms: 70000, at: ISO, splits: [15000, 30000] },
              sol: { ms: 54000, at: ISO, splits: [13500, 27000, 40500] },
            },
            history: [
              {
                opp: 'pip',
                result: 'lose',
                ms: 74530,
                oppMs: 7,
                falseStarts: 0,
                seed: 1,
                at: ISO,
                splits: [],
              },
              { opp: 'pip', result: 'lose', ms: 74530, oppMs: 7, falseStarts: 0, seed: 1, at: ISO },
              {
                opp: 'pip',
                result: 'lose',
                ms: 50000,
                oppMs: 7,
                falseStarts: 0,
                seed: 1,
                at: ISO,
                splits: [15000, 33000, 50000], // not below ms
              },
              {
                opp: 'pip',
                result: 'lose',
                ms: 74530,
                oppMs: 7,
                falseStarts: 0,
                seed: 1,
                at: ISO,
                splits: [2, 1],
              },
              {
                opp: 'pip',
                result: 'dnf',
                ms: null,
                oppMs: 7,
                falseStarts: 0,
                seed: 1,
                at: ISO,
                splits: [20000],
              },
              {
                opp: 'pip',
                result: 'dq',
                ms: null,
                oppMs: null,
                falseStarts: 2,
                seed: 1,
                at: ISO,
                splits: [1],
              },
              {
                opp: 'pip',
                result: 'dq',
                ms: null,
                oppMs: null,
                falseStarts: 2,
                seed: 1,
                at: ISO,
                splits: [],
              },
            ],
          },
          '200m': FRESH_EVENT,
        },
      }),
    );
    const d = RecordsStore.load(s).data;
    expect(s.map.has(CORRUPT_KEY)).toBe(false);
    expect(Object.keys(d.events)).toEqual(['100m', '110mh', '400m']);
    const e100 = d.events['100m'];
    expect(e100.beaten).toEqual(['pip', 'jess']);
    expect(e100.unlockedTier).toBe(3);
    expect(e100.champion).toBe(false);
    expect(e100.best).toEqual({ jess: { ms: 13000, at: ISO } }); // extras stripped outside their event
    expect(e100.history).toEqual([
      {
        opp: 'pip',
        result: 'win',
        ms: 17000,
        oppMs: 18000,
        falseStarts: 0,
        seed: 1,
        at: ISO,
        place: 1,
        winMs: 17000,
        ...MIGRATED,
      },
    ]);
    const eh = d.events['110mh'];
    expect(eh.unlockedTier).toBe(2);
    expect(eh.champion).toBe(false);
    expect(eh.best).toEqual({ jess: { ms: 18000, at: ISO }, marco: { ms: 18000, at: ISO, hit: 4 } });
    expect(eh.history.map((h) => [h.result, h.hit])).toEqual([['dq', 0]]);
    const e4 = d.events['400m'];
    expect(e4.beaten).toEqual(['sol']);
    expect(e4.unlockedTier).toBe(6);
    expect(e4.best).toEqual({
      jess: { ms: 70000, at: ISO },
      sol: { ms: 54000, at: ISO, splits: [13500, 27000, 40500] },
    });
    expect(e4.history.map((h) => [h.result, h.splits])).toEqual([
      ['lose', []],
      ['dnf', [20000]],
      ['dq', []],
    ]);
    expect(d.lastEvent).toBe('100m');
    expect(d.seenEvents).toEqual(['100m', '110mh']);
    expect(d.hints).toEqual({ addToHomeScreen: false, revealSeen: false });
    expect(d.settings).toMatchObject({ volume: 3, haptics: true });
  });

  it('a missing or non-object events block becomes three fresh events', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY, JSON.stringify({ version: 3, events: [] }));
    expect(RecordsStore.load(s).data.events).toEqual({
      '100m': FRESH_EVENT,
      '110mh': FRESH_EVENT,
      '400m': FRESH_EVENT,
    });
    s.map.delete(SAVE_KEY);
    s.map.set(SAVE_KEY_V2, JSON.stringify({ version: 2, events: [] }));
    expect(RecordsStore.load(s).data.events).toEqual({
      '100m': FRESH_EVENT,
      '110mh': FRESH_EVENT,
      '400m': FRESH_EVENT,
    });
  });

  it('truncates each event history to 50', () => {
    const s = new MemStorage();
    const entry = { opp: 'pip', result: 'lose', ms: 19000, oppMs: 18000, falseStarts: 0, seed: 1, at: ISO };
    s.map.set(
      SAVE_KEY_V2,
      JSON.stringify({
        version: 2,
        events: {
          '100m': { history: Array.from({ length: 80 }, () => entry) },
          '110mh': { history: Array.from({ length: 60 }, () => ({ ...entry, hit: 0 })) },
        },
      }),
    );
    const d = RecordsStore.load(s).data;
    expect(d.events['100m'].history).toHaveLength(50);
    expect(d.events['110mh'].history).toHaveLength(50);
    const v3 = { ...entry, place: 2, fieldSize: 6, winMs: 18000, mode: 'l' };
    s.map.set(SAVE_KEY, JSON.stringify({ version: 3, events: { '100m': { history: Array(70).fill(v3) } } }));
    expect(RecordsStore.load(s).data.events['100m'].history).toHaveLength(50);
  });
});

describe('RecordsStore migration from v1 (design 16.4)', () => {
  it('migrates a real v1 document via v2, writes v3 only and leaves the v1 key untouched', () => {
    const s = new MemStorage();
    const rawV1 = JSON.stringify(V1_DOC);
    s.map.set(SAVE_KEY_V1, rawV1);
    const store = RecordsStore.load(s);
    const { version: _v, settings, ...v1Records } = V1_DOC;
    expect(store.data).toEqual({
      version: 3,
      lastEvent: '100m',
      seenEvents: ['100m'],
      hints: { addToHomeScreen: false, revealSeen: false },
      settings: { ...settings, crt: false, haptics: true },
      events: {
        '100m': {
          ...v1Records,
          history: v1Records.history.map((h) => migratedEntry(h as unknown as HistoryEntry)),
          revealed: false,
          place: { pip: 1, jess: 1 },
          gauntlet: FRESH_EVENT.gauntlet,
        },
        '110mh': FRESH_EVENT,
        '400m': FRESH_EVENT,
      },
    });
    expect(stored(s)).toEqual(store.data);
    expect(s.map.get(SAVE_KEY_V1)).toBe(rawV1);
    expect(s.map.has(SAVE_KEY_V2)).toBe(false);
    expect(s.map.has(CORRUPT_KEY)).toBe(false);
    // Migration runs once: the next load uses v3 even if v1 changes.
    s.map.set(SAVE_KEY_V1, JSON.stringify({ ...V1_DOC, beaten: [] }));
    expect(RecordsStore.load(s).data.events['100m'].beaten).toEqual(['pip', 'jess']);
  });

  it('a v1 save up to Kofi unlocks hurdles and 400 m at once, shown as NEW (unseen)', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY_V1, JSON.stringify(V1_TO_KOFI));
    const store = RecordsStore.load(s);
    expect(store.isEventUnlocked('110mh')).toBe(true);
    expect(store.isEventUnlocked('400m')).toBe(true);
    expect(store.data.seenEvents).toEqual(['100m']);
    expect(store.data.settings).toEqual({
      volume: 4,
      muted: true,
      reducedFlashing: true,
      screenShake: false,
      crt: true,
      haptics: true,
    });
    expect(store.isUnlocked('100m', 'valentina')).toBe(true);
    expect(store.isUnlocked('110mh', 'pip')).toBe(true);
    expect(store.isUnlocked('110mh', 'jess')).toBe(false);
  });

  it('a migrated champion keeps champion: true (no second 100 m S9) and skips the reveal', () => {
    const s = new MemStorage();
    const all = LADDERS['100m'].map((e) => e.id);
    s.map.set(SAVE_KEY_V1, JSON.stringify({ ...V1_DOC, unlockedTier: 7, beaten: all, champion: true }));
    const store = RecordsStore.load(s);
    expect(store.data.events['100m'].champion).toBe(true);
    expect(store.isRevealed('100m')).toBe(true);
    expect(store.revealSeen()).toBe(true);
    expect(store.isUnlocked('100m', 'zyx')).toBe(true);
    store.record(outcome('zyx', 'win', 10300, 10400), AT);
    expect(store.record(outcome('zyx', 'win', 10200, 10400), AT).becameChampion).toBe(false);
  });

  it('applies v1 field repair before migrating', () => {
    const s = new MemStorage();
    s.map.set(
      SAVE_KEY_V1,
      JSON.stringify({
        version: 1,
        unlockedTier: 99,
        beaten: ['pip', 'pip', 'bogus', 'kofi'],
        champion: true,
        best: {
          pip: { ms: 4999, at: ISO },
          jess: { ms: 30001, at: ISO },
          marco: { ms: 13000.5, at: ISO },
          kofi: { ms: 12500, at: 'yesterday' },
          valentina: { ms: 11800, at: '2026-10-26T20:15:03Z' },
          bogus: { ms: 10000, at: ISO },
        },
        history: [
          { opp: 'pip', result: 'win', ms: 17000, oppMs: 18000, falseStarts: 0, seed: 1, at: ISO },
          { opp: 'pip', result: 'dq', ms: 17000, oppMs: null, falseStarts: 2, seed: 1, at: ISO },
          { opp: 'pip', result: 'dq', ms: null, oppMs: null, falseStarts: 2, seed: 1, at: ISO },
          { opp: 'pip', result: 'dnf', ms: null, oppMs: 18000, falseStarts: 0, seed: 1, at: ISO },
          { opp: 'pip', result: 'meh', ms: null, oppMs: null, falseStarts: 0, seed: 1, at: ISO },
          'junk',
        ],
        settings: { volume: 11, muted: 'yes', reducedFlashing: true, crt: true },
      }),
    );
    const d = RecordsStore.load(s).data;
    expect(s.map.has(CORRUPT_KEY)).toBe(false);
    const e = d.events['100m'];
    expect(e.unlockedTier).toBe(5); // stored 99 invalid -> 1, raised to the tier after Kofi
    expect(e.beaten).toEqual(['pip', 'kofi']);
    expect(e.champion).toBe(false); // Zyx never beaten
    expect(Object.keys(e.best)).toEqual(['valentina']);
    expect(e.history.map((h) => [h.result, h.place, h.winMs])).toEqual([
      ['win', 1, 17000],
      ['dq', null, null],
      ['dnf', null, 18000],
    ]);
    expect(d.settings).toEqual({
      volume: 8,
      muted: false,
      reducedFlashing: true,
      screenShake: true,
      crt: true,
      haptics: true,
    });
  });

  it.each(['not json', '{"version":2}', '[]', '42', 'null'])(
    'corrupt v3 (%s) plus a valid v2: backs v3 up to the corrupt key and re-migrates from v2 (acceptance 38)',
    (raw) => {
      const s = new MemStorage();
      s.map.set(SAVE_KEY, raw);
      s.map.set(SAVE_KEY_V2, JSON.stringify(V2_DOC));
      const store = RecordsStore.load(s);
      expect(s.map.get(CORRUPT_KEY)).toBe(raw);
      expect(store.data).toEqual(V2_DOC_MIGRATED);
      expect(stored(s).version).toBe(3);
      expect(s.map.get(SAVE_KEY_V2)).toBe(JSON.stringify(V2_DOC));
    },
  );

  it.each(['not json', '{"version":3}', '[]', '42', 'null'])(
    'corrupt v2 (%s) plus a valid v1: backs v2 up to the corrupt key and re-migrates from v1',
    (raw) => {
      const s = new MemStorage();
      s.map.set(SAVE_KEY_V2, raw);
      s.map.set(SAVE_KEY_V1, JSON.stringify(V1_TO_KOFI));
      const store = RecordsStore.load(s);
      expect(s.map.get(CORRUPT_KEY)).toBe(raw);
      expect(store.data.events['100m'].beaten).toEqual(['pip', 'jess', 'marco', 'kofi']);
      expect(stored(s).version).toBe(3);
      expect(s.map.get(SAVE_KEY_V2)).toBe(raw);
      expect(s.map.get(SAVE_KEY_V1)).toBe(JSON.stringify(V1_TO_KOFI));
    },
  );

  it('corrupt v3 and corrupt v2: the newest corrupt document is the one backed up', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY, 'v3 junk');
    s.map.set(SAVE_KEY_V2, 'v2 junk');
    s.map.set(SAVE_KEY_V1, JSON.stringify(V1_DOC));
    const store = RecordsStore.load(s);
    expect(s.map.get(CORRUPT_KEY)).toBe('v3 junk');
    expect(store.data.events['100m'].beaten).toEqual(['pip', 'jess']);
  });

  it('a v2 document under the v3 key is corrupt (version !== 3)', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY, JSON.stringify(V2_DOC));
    RecordsStore.load(s);
    expect(s.map.get(CORRUPT_KEY)).toBe(JSON.stringify(V2_DOC));
  });

  it('a v1 document under the v2 key is corrupt (version !== 2)', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY_V2, JSON.stringify(V1_DOC));
    RecordsStore.load(s);
    expect(s.map.get(CORRUPT_KEY)).toBe(JSON.stringify(V1_DOC));
  });

  it('corrupt v1 alone: backed up, fresh v3 written', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY_V1, '{"unlockedTier":3}');
    const store = RecordsStore.load(s);
    expect(s.map.get(CORRUPT_KEY)).toBe('{"unlockedTier":3}');
    expect(store.data.events['100m']).toEqual(FRESH_EVENT);
    expect(stored(s)).toEqual(store.data);
    expect(s.map.get(SAVE_KEY_V1)).toBe('{"unlockedTier":3}');
  });

  it('corrupt v3 and nothing older: backed up, fresh v3 written', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY, 'not json');
    const store = RecordsStore.load(s);
    expect(s.map.get(CORRUPT_KEY)).toBe('not json');
    expect(stored(s)).toEqual(store.data);
    expect(store.data.events['100m']).toEqual(FRESH_EVENT);
  });

  it('a failed v3 write keeps the migration in memory; the next load migrates again (34.4.3)', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY_V1, JSON.stringify(V1_TO_KOFI));
    s.failWrites = true;
    const store = RecordsStore.load(s);
    expect(store.persistent).toBe(false);
    expect(store.isEventUnlocked('400m')).toBe(true);
    expect(s.map.has(SAVE_KEY)).toBe(false);
    s.failWrites = false;
    const again = RecordsStore.load(s);
    expect(again.persistent).toBe(true);
    expect(again.data.events['100m'].beaten).toEqual(['pip', 'jess', 'marco', 'kofi']);
  });
});

describe('RecordsStore storage failures (design 4.3.3)', () => {
  it('null storage: in memory, persistent false, everything still works', () => {
    const store = RecordsStore.load(null);
    expect(store.persistent).toBe(false);
    expect(store.record(outcome('pip', 'win', 17000, 18000), AT).newPb).toBe(true);
    expect(store.bestMs('100m', 'pip')).toBe(17000);
  });

  it('a throwing read falls back to memory without throwing', () => {
    const s = new MemStorage();
    s.failReads = true;
    const store = RecordsStore.load(s);
    expect(store.persistent).toBe(false);
    expect(store.data.events['100m'].unlockedTier).toBe(1);
  });

  it('a throwing write keeps the data in memory and flips persistent', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    s.failWrites = true;
    expect(() => store.record(outcome('pip', 'win', 17000, 18000), AT)).not.toThrow();
    expect(() => store.updateSettings({ muted: true })).not.toThrow();
    expect(store.persistent).toBe(false);
    expect(store.data.settings.muted).toBe(true);
    expect(store.bestMs('100m', 'pip')).toBe(17000);
  });

  it('browserStorage() returns null in Node', () => {
    expect(browserStorage()).toBeNull();
  });
});

describe('RecordsStore.record (design 4.2, 1.3, 16.5)', () => {
  it('saves immediately with the history entry first, per event', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    store.record(outcome('pip', 'lose', 19000, 18000), AT);
    store.record(outcome('pip', 'win', 17500, 18000), new Date('2026-10-26T21:00:00.000Z'));
    const h = (stored(s).events['100m'].history as HistoryEntry[]).map((e) => e.ms);
    expect(h).toEqual([17500, 19000]);
    expect(store.recent('100m', 'pip', 3).map((e) => e.ms)).toEqual([17500, 19000]);
    expect(store.recent('100m', 'jess', 3)).toEqual([]);
    expect(store.recent('110mh', 'pip', 3)).toEqual([]);
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
    expect(store.bestMs('100m', 'pip')).toBe(19000);
    expect(store.record(outcome('pip', 'dq', null, null), AT).newPb).toBe(false);
    expect(store.record(outcome('pip', 'dnf', null, 18000), AT).newPb).toBe(false);
    expect(store.record(outcome('pip', 'win', 17000, 18000), AT)).toMatchObject({
      newPb: true,
      previousPbMs: 19000,
    });
    expect(store.best('100m', 'pip')).toEqual({ ms: 17000, at: ISO });
  });

  it('PB ranges are per event: a 400 m time is a valid 400 m PB', () => {
    const store = RecordsStore.load(new MemStorage());
    const o = outcome('pip', 'lose', 74530, 71980, { event: '400m', splits: [15120, 33800, 53410] });
    expect(store.record(o, AT).newPb).toBe(true);
    expect(store.bestMs('400m', 'pip')).toBe(74530);
  });

  it('hurdles: history and PB carry hit; a time with knocked hurdles is a valid PB', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    store.record(outcome('pip', 'win', 17920, 22140, { event: '110mh', hit: 2 }), AT);
    store.record(outcome('pip', 'lose', 23000, 22140, { event: '110mh', hit: 0 }), AT);
    store.record(outcome('pip', 'dq', null, null, { event: '110mh', hit: 0 }), AT);
    expect(store.best('110mh', 'pip')).toEqual({ ms: 17920, at: ISO, hit: 2 });
    expect(store.data.events['110mh'].history.map((h) => [h.result, h.hit])).toEqual([
      ['dq', 0],
      ['lose', 0],
      ['win', 2],
    ]);
    expect(store.data.events['110mh'].history[0]).not.toHaveProperty('splits');
    // Round-trips through validation.
    expect(RecordsStore.load(s).data).toEqual(store.data);
  });

  it('400 m: history carries the splits reached (DQ empty); the PB stores all three', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    const splits = [15120, 33800, 53410];
    store.record(outcome('pip', 'dnf', null, 71980, { event: '400m', splits: [20000, 45000] }), AT);
    store.record(outcome('pip', 'dq', null, null, { event: '400m' }), AT);
    store.record(outcome('pip', 'lose', 74530, 71980, { event: '400m', splits }), AT);
    expect(store.best('400m', 'pip')).toEqual({ ms: 74530, at: ISO, splits });
    expect(store.data.events['400m'].history.map((h) => [h.result, h.splits])).toEqual([
      ['lose', splits],
      ['dq', []],
      ['dnf', [20000, 45000]],
    ]);
    expect(store.data.events['400m'].history[0]).not.toHaveProperty('hit');
    expect(RecordsStore.load(s).data).toEqual(store.data);
  });

  it('100 m entries carry neither hit nor splits', () => {
    const store = RecordsStore.load(new MemStorage());
    store.record(outcome('pip', 'win', 17000, 18000), AT);
    expect(store.data.events['100m'].history[0]).toEqual({
      opp: 'pip',
      result: 'win',
      ms: 17000,
      oppMs: 18000,
      falseStarts: 0,
      seed: 1849302231,
      at: ISO,
      place: 1,
      fieldSize: 6,
      winMs: 17000,
      mode: 'l',
      steps: 100,
      fumbles: 2,
      fumble2: 0,
      trips: 0,
      input: 'k',
    });
  });

  it('logs DQ and DNF in history with the right nulls', () => {
    const store = RecordsStore.load(new MemStorage());
    store.record(outcome('pip', 'dnf', null, 18000), AT);
    store.record(outcome('pip', 'dq', null, null), AT);
    expect(store.data.events['100m'].history.map((h) => [h.result, h.ms, h.oppMs])).toEqual([
      ['dq', null, null],
      ['dnf', null, 18000],
    ]);
  });

  it('first win unlocks the next tier in that event only; losing and repeat wins unlock nothing', () => {
    const store = RecordsStore.load(new MemStorage());
    expect(store.record(outcome('pip', 'lose', 19000, 18000), AT).unlocked).toBeNull();
    expect(store.isUnlocked('100m', 'jess')).toBe(false);
    expect(store.record(outcome('pip', 'win', 17000, 18000), AT).unlocked).toBe('jess');
    expect(store.isUnlocked('100m', 'jess')).toBe(true);
    expect(store.isBeaten('100m', 'pip')).toBe(true);
    expect(store.isBeaten('110mh', 'pip')).toBe(false);
    expect(store.record(outcome('pip', 'win', 16900, 18000), AT).unlocked).toBeNull();
    store.record(outcome('jess', 'lose', 16000, 15000), AT);
    expect(store.data.events['100m'].unlockedTier).toBe(2);
    expect(store.data.events['110mh'].unlockedTier).toBe(1);
  });

  it('a photo finish is a win and unlocks', () => {
    const store = RecordsStore.load(new MemStorage());
    expect(store.record(outcome('pip', 'win', 18000, 18000), AT).unlocked).toBe('jess');
  });

  it('the 400 m ladder unlocks Sol after Kofi, and Zyx after UNIT-7', () => {
    const store = RecordsStore.load(new MemStorage());
    const ids: OpponentId[] = ['pip', 'jess', 'marco', 'kofi'];
    const got = ids.map(
      (id) => store.record(outcome(id, 'win', 50000, 60000, { event: '400m' }), AT).unlocked,
    );
    expect(got).toEqual(['jess', 'marco', 'kofi', 'sol']);
    expect(store.record(outcome('sol', 'win', 50000, 54000, { event: '400m' }), AT).unlocked).toBe('unit7');
  });

  it('champion only on the first tier 7 win, per event; ladder total once all 7 have a PB', () => {
    const store = RecordsStore.load(new MemStorage());
    const ids: OpponentId[] = ['pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7'];
    ids.forEach((id, i) => {
      const r = store.record(outcome(id, 'win', 10000 + i, 20000), AT);
      expect(r.revealPending).toBe(id === 'unit7');
      expect(store.ladderTotalMs('100m')).toBeNull();
    });
    // Tier 7 stays hidden until the reveal (design 30.1).
    expect(store.isUnlocked('100m', 'zyx')).toBe(false);
    expect(store.revealPending('100m')).toBe(true);
    store.markRevealed('100m');
    expect(store.isUnlocked('100m', 'zyx')).toBe(true);
    const first = store.record(outcome('zyx', 'win', 10300, 10400), AT);
    expect(first).toMatchObject({ becameChampion: true, unlocked: null });
    expect(store.data.events['100m'].champion).toBe(true);
    expect(store.data.events['110mh'].champion).toBe(false);
    expect(store.record(outcome('zyx', 'win', 10200, 10400), AT).becameChampion).toBe(false);
    expect(store.ladderTotalMs('100m')).toBe(10000 + 10001 + 10002 + 10003 + 10004 + 10005 + 10200);
    expect(store.ladderTotalMs('110mh')).toBeNull();
    const h = store.record(outcome('zyx', 'win', 13000, 13300, { event: '110mh', hit: 0 }), AT);
    expect(h.becameChampion).toBe(true);
  });

  it('caps history at 50 per event, newest first, without pushing out other events', () => {
    const store = RecordsStore.load(new MemStorage());
    store.record(outcome('pip', 'lose', 19000, 18000), AT);
    for (let i = 0; i < 60; i++)
      store.record(outcome('pip', 'lose', 23000 + i, 22000, { event: '110mh' }), AT);
    const h = store.data.events['110mh'].history;
    expect(h).toHaveLength(50);
    expect(h[0]?.ms).toBe(23059);
    expect(h[49]?.ms).toBe(23010);
    expect(store.data.events['100m'].history).toHaveLength(1);
  });

  it('rejects an opponent that is not on the event ladder', () => {
    const store = RecordsStore.load(new MemStorage());
    expect(() => store.record(outcome('sol', 'win', 12000, 13000), AT)).toThrow();
  });
});

describe('event unlocks (design 12.2, derived from beaten sets)', () => {
  function winUpTo(store: RecordsStore, event: EventId, last: OpponentId): (EventId | null)[] {
    const got: (EventId | null)[] = [];
    for (const { id } of LADDERS[event]) {
      got.push(store.record(outcome(id, 'win', 15000, 16000, { event }), AT).unlockedEvent);
      if (id === last) break;
    }
    return got;
  }

  it('hurdles after a 100 m win vs Marco, 400 m after a 100 m win vs Kofi', () => {
    const store = RecordsStore.load(new MemStorage());
    expect(winUpTo(store, '100m', 'kofi')).toEqual([null, null, '110mh', '400m']);
    expect(store.isEventUnlocked('110mh')).toBe(true);
    expect(store.isEventUnlocked('400m')).toBe(true);
  });

  it('or 400 m after a hurdles win vs Marco', () => {
    const store = RecordsStore.load(new MemStorage());
    winUpTo(store, '100m', 'marco');
    expect(store.isEventUnlocked('400m')).toBe(false);
    expect(winUpTo(store, '110mh', 'marco')).toEqual([null, null, '400m']);
    // Kofi in the 100 m later unlocks nothing new.
    expect(store.record(outcome('kofi', 'win', 12000, 12600), AT).unlockedEvent).toBeNull();
  });

  it('losses and repeat wins never report an event unlock', () => {
    const store = RecordsStore.load(new MemStorage());
    winUpTo(store, '100m', 'marco');
    expect(store.record(outcome('marco', 'win', 13000, 13600), AT).unlockedEvent).toBeNull();
    expect(store.record(outcome('kofi', 'lose', 13000, 12600), AT).unlockedEvent).toBeNull();
  });
});

describe('RecordsStore UI flags, settings and reset', () => {
  it('markEventSeen clears NEW (seenEvents) and sets lastEvent; locked events are ignored', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    store.markEventSeen('110mh');
    expect(store.data.seenEvents).toEqual(['100m']);
    expect(store.data.lastEvent).toBe('100m');
    for (const id of ['pip', 'jess', 'marco'] as const) store.record(outcome(id, 'win', 12000, 13000), AT);
    store.markEventSeen('110mh');
    expect(store.data.seenEvents).toEqual(['100m', '110mh']);
    expect(store.data.lastEvent).toBe('110mh');
    expect(stored(s).lastEvent).toBe('110mh');
    store.markEventSeen('100m');
    expect(store.data.seenEvents).toEqual(['100m', '110mh']);
    expect(RecordsStore.load(s).data.lastEvent).toBe('100m');
  });

  it('setHint persists the hint flag', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    store.setHint('addToHomeScreen', true);
    expect(RecordsStore.load(s).data.hints).toEqual({ addToHomeScreen: true, revealSeen: false });
  });

  it('validates and persists settings changes, including haptics', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    store.updateSettings({ volume: 14, crt: true, haptics: false });
    expect(store.data.settings).toMatchObject({ volume: 10, crt: true, haptics: false });
    store.updateSettings({ volume: -2.4, muted: true });
    expect(store.data.settings).toMatchObject({ volume: 0, muted: true });
    expect(RecordsStore.load(s).data.settings).toEqual(store.data.settings);
  });

  it('reset removes the v3, v2 and v1 keys, keeps settings and hints, relocks hurdles and 400 m', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY_V1, JSON.stringify(V1_TO_KOFI));
    s.map.set(SAVE_KEY_V2, 'not json');
    const store = RecordsStore.load(s);
    store.updateSettings({ volume: 3 });
    store.setHint('addToHomeScreen', true);
    store.markEventSeen('400m');
    store.reset();
    expect(s.map.has(SAVE_KEY_V1)).toBe(false);
    expect(s.map.has(SAVE_KEY_V2)).toBe(false);
    expect(store.data.events).toEqual({ '100m': FRESH_EVENT, '110mh': FRESH_EVENT, '400m': FRESH_EVENT });
    expect(store.data.seenEvents).toEqual(['100m']);
    expect(store.data.lastEvent).toBe('100m');
    expect(store.isEventUnlocked('110mh')).toBe(false);
    expect(store.isEventUnlocked('400m')).toBe(false);
    const reloaded = RecordsStore.load(s);
    expect(reloaded.bestMs('100m', 'pip')).toBeNull();
    expect(reloaded.data.settings.volume).toBe(3);
    expect(reloaded.data.hints.addToHomeScreen).toBe(true);
    expect(reloaded.isEventUnlocked('110mh')).toBe(false);
  });
});
