import { describe, expect, it } from 'vitest';
import {
  canReloadForUpdate,
  markUpdateReload,
  takeUpdateReload,
  UPDATE_BUSY_SCENES,
  UPDATED_FLAG_KEY,
  type UpdateReloadState,
} from './updateReload.ts';
import { SceneKey } from '../scenes/sceneKey.ts';

const menu: UpdateReloadState = { hidden: false, raceExists: false, gauntletRun: false, scenes: ['Ladder'] };

describe('UPDATE_BUSY_SCENES', () => {
  // A renamed or added scene must be classified here, or the guard would silently stop matching it.
  const RELOAD_SAFE = ['Title', 'Events', 'Ladder', 'Records', 'Options', 'Hud'];

  it('names only real scene keys', () => {
    const keys: readonly string[] = Object.values(SceneKey);
    for (const k of UPDATE_BUSY_SCENES) expect(keys).toContain(k);
  });

  it('classifies every scene key as busy or reload-safe', () => {
    expect([...UPDATE_BUSY_SCENES, ...RELOAD_SAFE].sort()).toEqual(Object.values(SceneKey).sort());
  });
});

describe('canReloadForUpdate (research-mobile 5)', () => {
  it('reloads on a visible menu screen', () => {
    expect(canReloadForUpdate(menu)).toBe(true);
    expect(canReloadForUpdate({ ...menu, scenes: ['Title'] })).toBe(true);
    expect(canReloadForUpdate({ ...menu, scenes: ['Options'] })).toBe(true);
  });

  it('never reloads over a paused race (the blur auto-pause leaves Race paused, not active)', () => {
    // RaceScene.pauseRace() pauses the Race scene and launches Pause; Hud keeps running.
    expect(canReloadForUpdate({ ...menu, raceExists: true, scenes: ['Race', 'Hud', 'Pause'] })).toBe(false);
    // Even if the scene list were stale, the live race alone blocks the reload.
    expect(canReloadForUpdate({ ...menu, raceExists: true, scenes: [] })).toBe(false);
  });

  it('never reloads during a race or over its results card', () => {
    expect(canReloadForUpdate({ ...menu, raceExists: true, scenes: ['Race', 'Hud'] })).toBe(false);
    expect(canReloadForUpdate({ ...menu, raceExists: true, scenes: ['Race', 'Hud', 'Results'] })).toBe(false);
  });

  it('never reloads while a Gauntlet run is in progress, between races included', () => {
    expect(canReloadForUpdate({ ...menu, gauntletRun: true, scenes: ['Gauntlet'] })).toBe(false);
    expect(canReloadForUpdate({ ...menu, gauntletRun: true, scenes: ['Gauntlet', 'Pause'] })).toBe(false);
    expect(canReloadForUpdate({ ...menu, gauntletRun: true, scenes: ['Ladder'] })).toBe(false);
  });

  it('never reloads during boot, the reveal, the champion screen or a Gauntlet card', () => {
    for (const key of ['Boot', 'Reveal', 'Champion', 'Gauntlet', 'Pause', 'Results']) {
      expect(canReloadForUpdate({ ...menu, scenes: [key] })).toBe(false);
    }
  });

  it('never reloads while the page is hidden, even on a menu', () => {
    expect(canReloadForUpdate({ ...menu, hidden: true })).toBe(false);
  });
});

function memoryStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('UPDATED flag', () => {
  it('is reported once after an update reload', () => {
    const s = memoryStorage();
    expect(takeUpdateReload(s)).toBe(false);
    markUpdateReload(s);
    expect(s.map.get(UPDATED_FLAG_KEY)).toBe('1');
    expect(takeUpdateReload(s)).toBe(true);
    expect(takeUpdateReload(s)).toBe(false);
  });

  it('survives missing or throwing storage', () => {
    expect(() => markUpdateReload(null)).not.toThrow();
    expect(takeUpdateReload(null)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(() => markUpdateReload(broken)).not.toThrow();
    expect(takeUpdateReload(broken)).toBe(false);
  });
});
