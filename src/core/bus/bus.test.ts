import { describe, expect, it } from 'vitest';
import type { RaceInput, RaceState } from '../index.ts';
import {
  createInputHub,
  createModalityStore,
  createRaceFeed,
  isJump,
  modality,
  raceFeed,
  raceInput,
} from '../index.ts';

describe('isJump', () => {
  it('tells jump inputs from run inputs', () => {
    expect(isJump({ kind: 'down', action: 'jump', t: 1, repeat: false })).toBe(true);
    expect(isJump({ kind: 'down', side: 'L', t: 1, repeat: false })).toBe(false);
  });
});

describe('InputHub', () => {
  it('delivers every emit to every subscriber until it unsubscribes', () => {
    const hub = createInputHub();
    const a: RaceInput[] = [];
    const b: RaceInput[] = [];
    const offA = hub.subscribe((e) => a.push(e));
    hub.subscribe((e) => b.push(e));
    const e1: RaceInput = { kind: 'down', side: 'L', t: 1, repeat: false };
    const e2: RaceInput = { kind: 'up', action: 'jump', t: 2, repeat: false };
    hub.emit(e1);
    offA();
    hub.emit(e2);
    expect(a).toEqual([e1]);
    expect(b).toEqual([e1, e2]);
  });

  it('a throwing subscriber does not starve the others (the error is rethrown after)', () => {
    const hub = createInputHub();
    const got: number[] = [];
    hub.subscribe(() => {
      throw new Error('boom');
    });
    hub.subscribe((e) => got.push(e.t));
    expect(() => hub.emit({ kind: 'down', side: 'R', t: 5, repeat: false })).toThrow('boom');
    expect(got).toEqual([5]);
  });

  it('the app instances exist', () => {
    expect(typeof raceInput.emit).toBe('function');
    expect(typeof raceFeed.publish).toBe('function');
  });
});

describe('RaceFeed', () => {
  it('broadcasts state and events, and null when no race is on screen', () => {
    const feed = createRaceFeed();
    const got: [RaceState | null, number][] = [];
    const off = feed.subscribe((s, ev) => got.push([s, ev.length]));
    feed.publish(null, [{ type: 'bell' }]);
    off();
    feed.publish(null, []);
    expect(got).toEqual([[null, 1]]);
  });
});

describe('ModalityStore (design 17.8)', () => {
  it('defaults to keyboard without pads over the canvas', () => {
    expect(modality.get()).toEqual({ modality: 'keyboard', padsOverCanvas: false });
  });

  it('merges patches and notifies only on change', () => {
    const store = createModalityStore();
    const seen: string[] = [];
    store.subscribe((s) => seen.push(`${s.modality}:${String(s.padsOverCanvas)}`));
    store.set({ modality: 'touch' });
    store.set({ modality: 'touch' });
    store.set({ padsOverCanvas: true });
    store.set({});
    expect(store.get()).toEqual({ modality: 'touch', padsOverCanvas: true });
    expect(seen).toEqual(['touch:false', 'touch:true']);
  });
});
