import { describe, expect, it } from 'vitest';
import type { EventId, KeyValueStorage, OpponentId, RaceOutcome, RaceResult, SaveData } from '../index.ts';
import { defaultSettings, LADDERS, RecordsStore, SAVE_KEY, SAVE_KEY_V1, SAVE_KEY_V2 } from '../index.ts';

// Design 30.1 (reveal state), 32.5 (Gauntlet records), 34 (records v3: schema, validation,
// migration, best placings).

class MemStorage implements KeyValueStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const AT = new Date('2026-11-02T19:40:12.004Z');
const ISO = AT.toISOString();
const stored = (s: MemStorage): SaveData => JSON.parse(s.map.get(SAVE_KEY) ?? 'null') as SaveData;

function outcome(
  opponent: OpponentId,
  place: number | null,
  ms: number | null,
  extra: Partial<RaceOutcome> & { result?: RaceResult } = {},
): RaceOutcome {
  const event = extra.event ?? '100m';
  const result: RaceResult = extra.result ?? (place === 1 ? 'win' : 'lose');
  return {
    event,
    opponent,
    result,
    ms,
    oppMs: result === 'dq' ? null : 15000,
    marginMs: null,
    photoFinish: false,
    falseStarts: 0,
    seed: 4410923,
    hit: event === '110mh' ? 0 : null,
    splits: [],
    mode: 'l',
    place,
    fieldSize: 6,
    winMs: result === 'dq' ? null : place === 1 ? ms : 10000,
    standings: [],
    steps: 121,
    fumbles: 3,
    fumble2: 0,
    trips: 0,
    input: 'k',
    ...extra,
  };
}

const IDS_100: readonly OpponentId[] = LADDERS['100m'].map((e) => e.id);

/** A v2 document (design 16.2 shape) with the given 100 m progress. */
function v2Doc(beaten: readonly OpponentId[], champion = false, extra: Record<string, unknown> = {}): object {
  const fresh = { unlockedTier: 1, beaten: [], champion: false, best: {}, history: [] };
  return {
    version: 2,
    lastEvent: '100m',
    seenEvents: ['100m'],
    hints: { addToHomeScreen: true },
    settings: {
      volume: 5,
      muted: false,
      reducedFlashing: true,
      screenShake: true,
      crt: false,
      haptics: true,
    },
    events: {
      '100m': {
        unlockedTier: Math.min(7, beaten.length + 1),
        beaten,
        champion,
        best: { pip: { ms: 12840, at: '2026-10-26T20:15:03.120Z' } },
        history: [
          { opp: 'unit7', result: 'lose', ms: 11200, oppMs: 11000, falseStarts: 0, seed: 5, at: ISO },
          { opp: 'kofi', result: 'win', ms: 12410, oppMs: 12620, falseStarts: 1, seed: 6, at: ISO },
          { opp: 'kofi', result: 'dnf', ms: null, oppMs: 12620, falseStarts: 0, seed: 7, at: ISO },
          { opp: 'kofi', result: 'dq', ms: null, oppMs: null, falseStarts: 2, seed: 8, at: ISO },
        ],
      },
      '110mh': fresh,
      '400m': fresh,
      ...extra,
    },
  };
}

function loadV2(doc: object): { s: MemStorage; store: RecordsStore } {
  const s = new MemStorage();
  s.map.set(SAVE_KEY_V2, JSON.stringify(doc));
  return { s, store: RecordsStore.load(s) };
}

describe('migration v2 -> v3 (design 34.4)', () => {
  it('old wins become 1st places, losses carry no medal, history gains place/fieldSize 2/winMs/mode', () => {
    const { s, store } = loadV2(v2Doc(['pip', 'jess', 'marco', 'kofi']));
    expect(store.bestPlace('100m', 'kofi')).toBe(1);
    expect(store.bestPlace('100m', 'unit7')).toBeNull();
    expect(store.data.events['100m'].place).toEqual({ pip: 1, jess: 1, marco: 1, kofi: 1 });
    expect(
      store.data.events['100m'].history.map((h) => [h.result, h.place, h.fieldSize, h.winMs, h.mode]),
    ).toEqual([
      ['lose', 2, 2, 11000, 'l'],
      ['win', 1, 2, 12410, 'l'],
      ['dnf', null, 2, 12620, 'l'],
      ['dq', null, 2, null, 'l'],
    ]);
    for (const h of store.data.events['100m'].history) {
      expect(h).not.toHaveProperty('steps');
      expect(h).not.toHaveProperty('input');
    }
    expect(store.gauntlet('100m')).toEqual({ runs: 0, clears: 0, furthest: 0, best: null });
    expect(store.data.hints).toEqual({ addToHomeScreen: true, revealSeen: false });
    expect(store.data.settings.volume).toBe(5);
    expect(stored(s)).toEqual(store.data);
  });

  it('a save with tier 6 beaten skips the reveal: Zyx is unlocked at once, revealSeen is set', () => {
    const { store } = loadV2(v2Doc(IDS_100.slice(0, 6)));
    expect(store.isRevealed('100m')).toBe(true);
    expect(store.revealPending('100m')).toBe(false);
    expect(store.isUnlocked('100m', 'zyx')).toBe(true);
    expect(store.revealSeen()).toBe(true);
    expect(store.isGauntletUnlocked('100m')).toBe(true);
    // The other events were not past tier 6: still hidden there.
    expect(store.isRevealed('110mh')).toBe(false);
    expect(store.isGauntletUnlocked('110mh')).toBe(false);
  });

  it('a champion save is revealed too; a save stopped at tier 5 keeps tier 7 hidden', () => {
    expect(loadV2(v2Doc(IDS_100, true)).store.isRevealed('100m')).toBe(true);
    const { store } = loadV2(v2Doc(IDS_100.slice(0, 5)));
    expect(store.isRevealed('100m')).toBe(false);
    expect(store.revealSeen()).toBe(false);
    expect(store.isUnlocked('100m', 'unit7')).toBe(true);
    expect(store.isUnlocked('100m', 'zyx')).toBe(false);
  });

  it('a v1-only save with UNIT-7 beaten migrates through v2 to v3 and skips the reveal', () => {
    const s = new MemStorage();
    s.map.set(
      SAVE_KEY_V1,
      JSON.stringify({
        version: 1,
        unlockedTier: 7,
        beaten: IDS_100.slice(0, 6),
        champion: false,
        best: {},
        history: [{ opp: 'zyx', result: 'lose', ms: 10700, oppMs: 10400, falseStarts: 0, seed: 1, at: ISO }],
        settings: { volume: 8, muted: false, reducedFlashing: false, screenShake: true },
      }),
    );
    const store = RecordsStore.load(s);
    expect(s.map.has(SAVE_KEY_V2)).toBe(false);
    expect(stored(s).version).toBe(3);
    expect(store.isUnlocked('100m', 'zyx')).toBe(true);
    expect(store.data.events['100m'].history[0]).toMatchObject({ place: 2, fieldSize: 2, winMs: 10400 });
  });
});

describe('validation v3 (design 34.3)', () => {
  function loadV3(events: Record<string, unknown>, rest: Record<string, unknown> = {}): SaveData {
    const s = new MemStorage();
    s.map.set(SAVE_KEY, JSON.stringify({ version: 3, events, ...rest }));
    return RecordsStore.load(s).data;
  }
  const H = { opp: 'pip', ms: 17000, oppMs: 18000, falseStarts: 0, seed: 1, at: ISO };

  it('revealed: default false; forced true by champion or a beaten tier 7; false with tier 6 beaten is a pending reveal', () => {
    const d = loadV3({
      '100m': { beaten: IDS_100.slice(0, 6), revealed: 'yes' },
      '110mh': { beaten: ['pip', 'zyx'], revealed: false },
      '400m': {},
    });
    expect(d.events['100m'].revealed).toBe(false);
    expect(d.events['110mh'].revealed).toBe(true);
    expect(d.events['400m'].revealed).toBe(false);
    const s = new MemStorage();
    s.map.set(SAVE_KEY, JSON.stringify({ version: 3, events: { '100m': { beaten: IDS_100.slice(0, 6) } } }));
    const store = RecordsStore.load(s);
    expect(store.revealPending('100m')).toBe(true);
    expect(store.isUnlocked('100m', 'zyx')).toBe(false);
  });

  it('place: integers 1-6 on the ladder; beaten ids repaired to 1; a 1 without a win drops', () => {
    const d = loadV3({
      '100m': {
        beaten: ['pip', 'jess'],
        place: { pip: 3, jess: 1, marco: 1, kofi: 2, valentina: 7, unit7: 2.5, sol: 2, zyx: '3' },
      },
    });
    expect(d.events['100m'].place).toEqual({ pip: 1, jess: 1, kofi: 2 });
  });

  it('gauntlet: counts repaired, clears <= runs, furthest raised to 7 on a clear, best checked', () => {
    const times = [16010, 13420, 12280, 11690, 10990, 10560, 9260];
    const good = { ms: 84210, at: ISO, times };
    const d = loadV3({
      '100m': { gauntlet: { runs: 4, clears: 1, furthest: 3, best: good } },
      '110mh': { gauntlet: { runs: 1, clears: 2, furthest: 9, best: null } },
      '400m': { gauntlet: { runs: -1, clears: 0, furthest: 4, best: good } },
    });
    expect(d.events['100m'].gauntlet).toEqual({ runs: 4, clears: 1, furthest: 7, best: good });
    expect(d.events['110mh'].gauntlet).toEqual({ runs: 2, clears: 2, furthest: 7, best: null });
    expect(d.events['400m'].gauntlet).toEqual({ runs: 0, clears: 0, furthest: 4, best: null });
    const bad = (best: unknown): unknown =>
      loadV3({ '100m': { gauntlet: { runs: 1, clears: 1, furthest: 7, best } } }).events['100m'].gauntlet
        .best;
    expect(bad({ ...good, ms: 84211 })).toBeNull();
    expect(bad({ ...good, times: times.slice(1) })).toBeNull();
    expect(bad({ ...good, times: [...times.slice(1), 4000], ms: 84210 - 9260 + 4000 })).toBeNull();
    expect(bad({ ...good, at: 'yesterday' })).toBeNull();
    expect(bad(good)).toEqual(good);
    expect(loadV3({ '100m': { gauntlet: 'x' } }).events['100m'].gauntlet).toEqual({
      runs: 0,
      clears: 0,
      furthest: 0,
      best: null,
    });
  });

  it('history: place, fieldSize and winMs must match the result, or the entry drops', () => {
    const e = (x: Record<string, unknown>): Record<string, unknown> => ({
      ...H,
      mode: 'l',
      fieldSize: 6,
      ...x,
    });
    const d = loadV3({
      '100m': {
        history: [
          e({ result: 'win', place: 1, winMs: 17000 }), // ok
          e({ result: 'win', place: 2, winMs: 17000 }), // win needs 1
          e({ result: 'win', place: 1, winMs: 16000 }), // win: winMs = ms
          e({ result: 'lose', place: 1, winMs: 16000 }), // lose needs 2+
          e({ result: 'lose', place: 7, winMs: 16000 }), // above fieldSize
          e({ result: 'lose', place: 3, winMs: 16000, fieldSize: 2 }), // above fieldSize 2
          e({ result: 'lose', place: 3, winMs: 16000, fieldSize: 5 }), // fieldSize 6 or 2
          e({ result: 'lose', place: 6, winMs: 16000, mode: 'x' }), // ok, mode defaults to l
          e({ result: 'lose', place: 2, winMs: 40000 }), // winMs above the DNF cap
          e({ result: 'dnf', ms: null, place: null, winMs: 16000 }), // ok
          e({ result: 'dnf', ms: null, place: 2, winMs: 16000 }), // dnf needs null
          e({ result: 'dq', ms: null, oppMs: null, place: null, winMs: null, mode: 'g' }), // ok
          e({ result: 'dq', ms: null, oppMs: null, place: null, winMs: 16000 }), // dq needs null winMs
          e({ result: 'lose', place: 2 }), // winMs missing
        ],
      },
    });
    expect(d.events['100m'].history.map((h) => [h.result, h.place, h.mode])).toEqual([
      ['win', 1, 'l'],
      ['lose', 6, 'l'],
      ['dnf', null, 'l'],
      ['dq', null, 'g'],
    ]);
  });

  it('fumble logging fields are optional; an invalid one is removed, not the entry', () => {
    const base = { ...H, result: 'win', place: 1, fieldSize: 6, winMs: 17000, mode: 'l' };
    const d = loadV3({
      '100m': {
        history: [
          { ...base, steps: 121, fumbles: 3, fumble2: 1, trips: 1, input: 'k' },
          { ...base, steps: -1, fumbles: 3, fumble2: 4, trips: 0, input: 'x' },
          { ...base, steps: 10000, fumbles: 2, fumble2: 1, trips: 2, input: 'm' },
          { ...base, fumble2: 1, trips: 0 },
        ],
      },
    });
    const h = d.events['100m'].history;
    expect(h).toHaveLength(4);
    expect(h[0]).toMatchObject({ steps: 121, fumbles: 3, fumble2: 1, trips: 1, input: 'k' });
    expect(h[1]).toMatchObject({ fumbles: 3 });
    for (const key of ['steps', 'fumble2', 'trips', 'input']) expect(h[1]).not.toHaveProperty(key);
    expect(h[2]).toMatchObject({ fumbles: 2, fumble2: 1, input: 'm' });
    expect(h[2]).not.toHaveProperty('steps');
    expect(h[2]).not.toHaveProperty('trips');
    for (const key of ['fumbles', 'fumble2', 'trips']) expect(h[3]).not.toHaveProperty(key);
  });

  it('hints.revealSeen: boolean, default false; version must be 3', () => {
    expect(loadV3({}, { hints: { revealSeen: 1 } }).hints).toEqual({
      addToHomeScreen: false,
      revealSeen: false,
    });
    expect(loadV3({}, { hints: { revealSeen: true } }).hints.revealSeen).toBe(true);
  });

  it('the design 34.2 example document round-trips', () => {
    const doc = {
      version: 3,
      lastEvent: '100m',
      seenEvents: ['100m', '110mh', '400m'],
      hints: { addToHomeScreen: false, revealSeen: true },
      settings: {
        volume: 8,
        muted: false,
        reducedFlashing: false,
        screenShake: true,
        crt: false,
        haptics: true,
      },
      events: {
        '100m': {
          unlockedTier: 7,
          beaten: ['pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7'],
          champion: false,
          revealed: true,
          best: { zyx: { ms: 10620, at: '2026-11-02T19:40:12.004Z' } },
          place: { pip: 1, jess: 1, marco: 1, kofi: 1, valentina: 1, unit7: 1, zyx: 3 },
          gauntlet: {
            runs: 4,
            clears: 1,
            furthest: 7,
            best: {
              ms: 84210,
              at: '2026-11-02T20:01:55.120Z',
              times: [16010, 13420, 12280, 11690, 10990, 10560, 9260],
            },
          },
          history: [
            {
              opp: 'zyx',
              result: 'lose',
              ms: 10620,
              oppMs: 10380,
              winMs: 10380,
              place: 3,
              fieldSize: 6,
              mode: 'l',
              falseStarts: 0,
              seed: 4410923,
              at: '2026-11-02T19:40:12.004Z',
              steps: 121,
              fumbles: 3,
              fumble2: 0,
              trips: 0,
              input: 'k',
            },
          ],
        },
        '110mh': {
          unlockedTier: 1,
          beaten: [],
          champion: false,
          best: {},
          history: [],
          revealed: false,
          place: {},
          gauntlet: { runs: 0, clears: 0, furthest: 0, best: null },
        },
      },
    };
    const s = new MemStorage();
    s.map.set(SAVE_KEY, JSON.stringify(doc));
    const d = RecordsStore.load(s).data;
    expect(d.events['100m']).toEqual(doc.events['100m']);
    expect(d.events['400m']).toEqual(doc.events['110mh']);
    expect(d.hints).toEqual(doc.hints);
  });
});

describe('record v3 (design 34.1, 29, 30.1)', () => {
  it('best placing per rival: 2nd shows SILVER once; a later 3rd never downgrades; 1st is a win', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    expect(store.record(outcome('pip', 4, 19000), AT)).toMatchObject({ place: 4, newBestPlace: null });
    expect(store.bestPlace('100m', 'pip')).toBe(4);
    expect(store.record(outcome('pip', 2, 18100), AT)).toMatchObject({
      place: 2,
      newBestPlace: 2,
      unlocked: null,
    });
    expect(store.record(outcome('pip', 3, 18200), AT)).toMatchObject({ place: 3, newBestPlace: null });
    expect(store.record(outcome('pip', 2, 18000), AT).newBestPlace).toBeNull();
    expect(store.bestPlace('100m', 'pip')).toBe(2);
    expect(store.isBeaten('100m', 'pip')).toBe(false);
    expect(store.isUnlocked('100m', 'jess')).toBe(false);
    const win = store.record(outcome('pip', 1, 17500), AT);
    expect(win).toMatchObject({ place: 1, newBestPlace: null, unlocked: 'jess' });
    expect(store.bestPlace('100m', 'pip')).toBe(1);
    expect(store.record(outcome('jess', null, null, { result: 'dnf' }), AT)).toMatchObject({
      place: null,
      newBestPlace: null,
    });
    expect(store.bestPlace('100m', 'jess')).toBeNull();
    // Round-trips through validation.
    expect(RecordsStore.load(s).data).toEqual(store.data);
  });

  it('history entries carry place, fieldSize, winMs, mode and the fumble log', () => {
    const store = RecordsStore.load(new MemStorage());
    store.record(outcome('pip', 3, 18500, { mode: 'g', fumbles: 5, fumble2: 2, trips: 1, input: 'm' }), AT);
    store.record(outcome('pip', null, null, { result: 'dq', winMs: null }), AT);
    expect(store.data.events['100m'].history).toEqual([
      expect.objectContaining({ result: 'dq', place: null, winMs: null, fieldSize: 6, mode: 'l' }),
      expect.objectContaining({
        result: 'lose',
        place: 3,
        winMs: 10000,
        mode: 'g',
        steps: 121,
        fumbles: 5,
        fumble2: 2,
        trips: 1,
        input: 'm',
      }),
    ]);
  });

  it('Gauntlet races count for PBs and placings like ladder races (design 23.2.8)', () => {
    const store = RecordsStore.load(new MemStorage());
    expect(store.record(outcome('pip', 1, 16000, { mode: 'g' }), AT).newPb).toBe(true);
    expect(store.bestMs('100m', 'pip')).toBe(16000);
    expect(store.bestPlace('100m', 'pip')).toBe(1);
  });

  it('winning tier 6 unrevealed: revealPending, Zyx stays locked until markRevealed; once only', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    for (const id of IDS_100.slice(0, 5))
      expect(store.record(outcome(id, 1, 12000), AT).revealPending).toBe(false);
    const r = store.record(outcome('unit7', 1, 10900), AT);
    expect(r).toMatchObject({ revealPending: true, unlocked: 'zyx' });
    expect(store.revealPending('100m')).toBe(true);
    expect(store.isUnlocked('100m', 'zyx')).toBe(false);
    expect(store.isGauntletUnlocked('100m')).toBe(false);
    // Interrupted reveal (reload): still pending.
    expect(RecordsStore.load(s).revealPending('100m')).toBe(true);
    expect(store.revealSeen()).toBe(false);
    store.markRevealed('100m');
    expect(store.isRevealed('100m')).toBe(true);
    expect(store.revealSeen()).toBe(true);
    expect(store.revealPending('100m')).toBe(false);
    expect(store.isUnlocked('100m', 'zyx')).toBe(true);
    expect(store.isGauntletUnlocked('100m')).toBe(true);
    expect(store.record(outcome('unit7', 1, 10800), AT).revealPending).toBe(false);
    const again = RecordsStore.load(s);
    expect(again.isRevealed('100m')).toBe(true);
    expect(again.revealSeen()).toBe(true);
  });

  it('reset hides tier 7 again in every event but keeps revealSeen (short reveal next time)', () => {
    const s = new MemStorage();
    s.map.set(SAVE_KEY_V2, JSON.stringify(v2Doc(IDS_100.slice(0, 6))));
    const store = RecordsStore.load(s);
    expect(store.isUnlocked('100m', 'zyx')).toBe(true);
    store.reset();
    for (const key of [SAVE_KEY_V2, SAVE_KEY_V1]) expect(s.map.has(key)).toBe(false);
    const again = RecordsStore.load(s);
    for (const e of ['100m', '110mh', '400m'] as EventId[]) {
      expect(again.isRevealed(e)).toBe(false);
      expect(again.isUnlocked(e, 'zyx')).toBe(false);
      expect(again.gauntlet(e)).toEqual({ runs: 0, clears: 0, furthest: 0, best: null });
    }
    expect(again.revealSeen()).toBe(true);
    expect(again.data.hints.addToHomeScreen).toBe(true);
  });
});

describe('Gauntlet records (design 32.5)', () => {
  const TIMES = [16010, 13420, 12280, 11690, 10990, 10560, 9260];
  const SUM = TIMES.reduce((a, b) => a + b, 0);

  it('runs +1 per end; clears +1 on a clear; furthest is the highest tier won; only clears set best', () => {
    const s = new MemStorage();
    const store = RecordsStore.load(s);
    expect(
      store.recordGauntletEnd('100m', { cleared: false, furthest: 3, times: TIMES.slice(0, 3) }, AT),
    ).toEqual({
      newBest: false,
      newFurthest: true,
      previousBestMs: null,
    });
    expect(store.gauntlet('100m')).toEqual({ runs: 1, clears: 0, furthest: 3, best: null });
    expect(store.recordGauntletEnd('100m', { cleared: false, furthest: 2, times: [] }, AT).newFurthest).toBe(
      false,
    );
    const clear = store.recordGauntletEnd('100m', { cleared: true, furthest: 7, times: TIMES }, AT);
    expect(clear).toEqual({ newBest: true, newFurthest: true, previousBestMs: null });
    expect(store.gauntlet('100m')).toEqual({
      runs: 3,
      clears: 1,
      furthest: 7,
      best: { ms: SUM, at: ISO, times: TIMES },
    });
    const slower = TIMES.map((t) => t + 10);
    expect(store.recordGauntletEnd('100m', { cleared: true, furthest: 7, times: slower }, AT)).toEqual({
      newBest: false,
      newFurthest: false,
      previousBestMs: SUM,
    });
    const faster = TIMES.map((t) => t - 10);
    expect(store.recordGauntletEnd('100m', { cleared: true, furthest: 7, times: faster }, AT).newBest).toBe(
      true,
    );
    expect(store.gauntlet('100m')).toMatchObject({ runs: 5, clears: 3, best: { ms: SUM - 70 } });
    expect(store.gauntlet('110mh')).toEqual({ runs: 0, clears: 0, furthest: 0, best: null });
    // Saved at once and valid on reload.
    expect(stored(s).events['100m'].gauntlet).toEqual(store.gauntlet('100m'));
    expect(RecordsStore.load(s).gauntlet('100m')).toEqual(store.gauntlet('100m'));
  });

  it('an abandoned run counts as a run; a clear with invalid times never sets best', () => {
    const store = RecordsStore.load(new MemStorage());
    store.recordGauntletEnd('400m', { cleared: false, furthest: 0, times: [] }, AT);
    expect(store.gauntlet('400m')).toEqual({ runs: 1, clears: 0, furthest: 0, best: null });
    const r = store.recordGauntletEnd('400m', { cleared: true, furthest: 7, times: [1, 2, 3] }, AT);
    expect(r.newBest).toBe(false);
    expect(store.gauntlet('400m')).toEqual({ runs: 2, clears: 1, furthest: 7, best: null });
  });
});

describe('fresh-save settings (OS reduced motion)', () => {
  const DEFAULT_SETTINGS = defaultSettings(false);
  const reduced = defaultSettings(true);

  it('a first save takes the given defaults, and so does storage that is unavailable', () => {
    expect(RecordsStore.load(new MemStorage(), reduced).data.settings).toEqual(reduced);
    expect(RecordsStore.load(null, reduced).data.settings).toEqual(reduced);
  });

  it('an existing save keeps its own settings', () => {
    const s = new MemStorage();
    RecordsStore.load(s).updateSettings({ volume: 7 });
    expect(RecordsStore.load(s, reduced).data.settings).toEqual({ ...DEFAULT_SETTINGS, volume: 7 });
  });
});
