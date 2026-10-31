import { describe, expect, it } from 'vitest';
import type { MusicId, SfxId } from '../../audio/index.ts';
import {
  createSound,
  CUE_SFX,
  PREF_KEY,
  STEP_GAP_MS,
  STEP_VOLUME,
  type AudioBackend,
  type LandingCue,
  type PrefStorage,
} from './sound.ts';

type Call = readonly [string, ...unknown[]];

/** Records every call; typed against src/audio/index.ts, so a changed signature fails to compile. */
function fakeBackend(): { readonly backend: AudioBackend; readonly calls: Call[] } {
  const calls: Call[] = [];
  const backend: AudioBackend = {
    unlockAudio: () => void calls.push(['unlockAudio']),
    playSfx: (id: SfxId, opts?: { readonly volume?: number; readonly field?: boolean }) =>
      void calls.push(opts ? ['playSfx', id, opts] : ['playSfx', id]),
    playMusic: (id: MusicId | null, tier?: number) =>
      void calls.push(tier === undefined ? ['playMusic', id] : ['playMusic', id, tier]),
    setMuted: (muted: boolean) => void calls.push(['setMuted', muted]),
    setVolume: (volume: number) => void calls.push(['setVolume', volume]),
    duckMusic: (ducked: boolean) => void calls.push(['duckMusic', ducked]),
  };
  return { backend, calls };
}

function memoryStorage(
  initial: Record<string, string> = {},
): PrefStorage & { readonly data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

function setup(storage: PrefStorage | null = memoryStorage()) {
  const { backend, calls } = fakeBackend();
  let loads = 0;
  let clock = 0;
  const sound = createSound({
    load: () => {
      loads++;
      return Promise.resolve(backend);
    },
    storage,
    now: () => clock,
  });
  return {
    sound,
    calls,
    loads: () => loads,
    advance: (ms: number) => void (clock += ms),
    sfx: () => calls.filter((c) => c[0] === 'playSfx'),
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const ALL_CUES: readonly LandingCue[] = [
  'coin',
  'select',
  'badge',
  'countdown',
  'go',
  'step',
  'falseStart',
  'win',
  'lose',
];

describe('landing sound', () => {
  it('is off by default and creates nothing, even after gestures and cues', async () => {
    const t = setup();
    expect(t.sound.on).toBe(false);
    t.sound.gesture();
    for (const cue of ALL_CUES) t.sound.play(cue);
    await flush();
    expect(t.loads()).toBe(0);
    expect(t.calls).toEqual([]);
  });

  it('loads the backend on enable, unlocks it and starts the title theme quietly', async () => {
    const t = setup();
    t.sound.setOn(true);
    expect(t.loads()).toBe(1);
    await flush();
    expect(t.calls).toEqual([
      ['setVolume', 6],
      ['duckMusic', true],
      ['unlockAudio'],
      ['setMuted', false],
      ['playMusic', 'title'],
    ]);
  });

  it('plays each cue as the game SFX while on, and nothing once off again', async () => {
    const t = setup();
    t.sound.setOn(true);
    await flush();
    for (const cue of ALL_CUES) t.sound.play(cue);
    const played = t.sfx().map((c) => c[1]);
    expect(played).toEqual([
      'split',
      'menu_select',
      'unlock',
      'beep_count',
      'beep_go',
      'pistol',
      'step_l',
      'false_start',
      'win_jingle',
      'lose_jingle',
    ]);
    expect(Object.keys(CUE_SFX)).toHaveLength(ALL_CUES.length - 1);

    t.calls.length = 0;
    t.sound.setOn(false);
    expect(t.calls).toEqual([
      ['playMusic', null],
      ['setMuted', true],
    ]);
    for (const cue of ALL_CUES) t.sound.play(cue);
    expect(t.sfx()).toEqual([]);
  });

  it('drops cues that arrive before the backend has loaded', async () => {
    const t = setup();
    t.sound.setOn(true);
    t.sound.play('coin');
    await flush();
    expect(t.sfx()).toEqual([]);
  });

  it('never unlocks when turned off before the download finished', async () => {
    const t = setup();
    t.sound.setOn(true);
    t.sound.setOn(false);
    await flush();
    expect(t.calls.map((c) => c[0])).not.toContain('unlockAudio');
    expect(t.calls).toContainEqual(['setMuted', true]);
  });

  it('throttles steps to one per STEP_GAP_MS, quiet and alternating feet', async () => {
    const t = setup();
    t.sound.setOn(true);
    await flush();
    // 500 presses in 1 s (a 2 ms mash) play at most 1000 / STEP_GAP_MS + 1 steps.
    for (let i = 0; i < 500; i++) {
      t.sound.play('step');
      t.advance(2);
    }
    const steps = t.sfx();
    expect(steps.length).toBe(Math.floor(1000 / STEP_GAP_MS) + 1);
    expect(steps.slice(0, 3)).toEqual([
      ['playSfx', 'step_l', { volume: STEP_VOLUME }],
      ['playSfx', 'step_r', { volume: STEP_VOLUME }],
      ['playSfx', 'step_l', { volume: STEP_VOLUME }],
    ]);

    t.calls.length = 0;
    t.advance(STEP_GAP_MS);
    t.sound.play('step');
    t.sound.play('step');
    expect(t.sfx()).toHaveLength(1);
  });

  it('remembers the choice, and a returning visitor waits for a gesture', async () => {
    const storage = memoryStorage();
    const first = setup(storage);
    first.sound.setOn(true);
    expect(storage.data.get(PREF_KEY)).toBe('on');

    const back = setup(storage);
    expect(back.sound.on).toBe(true);
    await flush();
    expect(back.loads()).toBe(0);
    back.sound.gesture();
    await flush();
    expect(back.loads()).toBe(1);
    expect(back.calls).toContainEqual(['playMusic', 'title']);
    back.sound.gesture();
    expect(back.calls.at(-1)).toEqual(['unlockAudio']);

    back.sound.setOn(false);
    expect(storage.data.get(PREF_KEY)).toBe('off');
    expect(setup(storage).sound.on).toBe(false);
  });

  it('works without storage, or with storage that throws', async () => {
    const throwing: PrefStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    for (const storage of [null, throwing]) {
      const t = setup(storage);
      expect(t.sound.on).toBe(false);
      t.sound.setOn(true);
      await flush();
      expect(t.sound.on).toBe(true);
      expect(t.calls).toContainEqual(['playMusic', 'title']);
    }
  });

  it('retries a failed download on the next gesture', async () => {
    const { backend } = fakeBackend();
    let attempts = 0;
    const sound = createSound({
      load: () => (++attempts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(backend)),
      storage: null,
      now: () => 0,
    });
    sound.setOn(true);
    await flush();
    sound.gesture();
    await flush();
    expect(attempts).toBe(2);
  });

  it('notifies subscribers of every change', () => {
    const t = setup();
    const seen: boolean[] = [];
    const off = t.sound.subscribe((on) => seen.push(on));
    t.sound.setOn(true);
    t.sound.setOn(true);
    t.sound.setOn(false);
    off();
    t.sound.setOn(true);
    expect(seen).toEqual([true, false]);
  });
});
