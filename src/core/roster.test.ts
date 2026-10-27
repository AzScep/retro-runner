import { describe, expect, it } from 'vitest';
import { EVENT_COURSE, EVENT_IDS, EVENTS, LADDERS, ladderEntry, nextRival, OPPONENTS } from './index.ts';

describe('events (design 12.1)', () => {
  it('lists the three events with distance, DNF cap and names', () => {
    expect(EVENT_IDS).toEqual(['100m', '110mh', '400m']);
    expect(EVENTS['100m']).toEqual({
      id: '100m',
      name: '100 METRES',
      short: '100M',
      distanceM: 100,
      dnfMs: 30000,
    });
    expect(EVENTS['110mh']).toMatchObject({
      name: '110 METRES HURDLES',
      short: 'HURDLES',
      distanceM: 110,
      dnfMs: 40000,
    });
    expect(EVENTS['400m']).toMatchObject({ name: '400 METRES', short: '400M', distanceM: 400, dnfMs: 90000 });
  });

  it('lean windows are distance -/+ 2 m; 400 m splits and bell', () => {
    for (const e of EVENT_IDS) {
      expect(EVENT_COURSE[e].leanFromM).toBe(EVENTS[e].distanceM - 2);
      expect(EVENT_COURSE[e].leanToM).toBe(EVENTS[e].distanceM + 2);
    }
    expect(EVENT_COURSE['400m'].splitsM).toEqual([100, 200, 300]);
    expect(EVENT_COURSE['400m'].bellAtM).toBe(300);
    expect(EVENT_COURSE['110mh'].firstRaceTip).toEqual({ keyboard: 'UP TO JUMP', touch: 'TAP JUMP' });
  });
});

describe('ladders (design 15.6)', () => {
  it('has seven rivals per event in tier order with the summary targets', () => {
    const rows = EVENT_IDS.map((e) => LADDERS[e].map((r) => `${r.tier}:${r.id}:${r.targetMs}`));
    expect(rows).toEqual([
      [
        '1:pip:18000',
        '2:jess:15000',
        '3:marco:13600',
        '4:kofi:12600',
        '5:valentina:11600',
        '6:unit7:11000',
        '7:zyx:10400',
      ],
      [
        '1:pip:22000',
        '2:jess:18600',
        '3:marco:16900',
        '4:kofi:15600',
        '5:valentina:14500',
        '6:unit7:13800',
        '7:zyx:13300',
      ],
      [
        '1:pip:72000',
        '2:jess:64000',
        '3:marco:59000',
        '4:kofi:56000',
        '5:sol:54000',
        '6:unit7:52500',
        '7:zyx:51400',
      ],
    ]);
    for (const e of EVENT_IDS) for (const r of LADDERS[e]) expect(r.event).toBe(e);
    expect(ladderEntry('400m', 'sol')?.flavour).toBe('Even splits. Every lap.');
    expect(ladderEntry('110mh', 'zyx')?.flavour).toBe('Why jump when you can warp?');
  });

  it('ladderEntry and nextRival respect each ladder', () => {
    expect(ladderEntry('100m', 'sol')).toBeNull();
    expect(ladderEntry('400m', 'valentina')).toBeNull();
    expect(nextRival('400m', 'kofi')).toBe('sol');
    expect(nextRival('100m', 'kofi')).toBe('valentina');
    expect(nextRival('110mh', 'zyx')).toBeNull();
    expect(nextRival('400m', 'valentina')).toBeNull();
  });

  it('Sol is the one new character', () => {
    expect(OPPONENTS.sol).toEqual({ id: 'sol', name: 'SOL', who: 'Veteran 400 m runner' });
    expect(Object.keys(OPPONENTS)).toHaveLength(8);
  });
});
