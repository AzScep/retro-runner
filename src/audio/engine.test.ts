import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AudioApi = typeof import('./index.ts');
type Engine = typeof import('./engine.ts');

async function fresh(): Promise<{ api: AudioApi; engine: Engine }> {
  vi.resetModules();
  return { api: await import('./index.ts'), engine: await import('./engine.ts') };
}

// ---------------------------------------------------------------------------------------------
// Minimal Web Audio fake: records what the engine builds and schedules.

class FakeParam {
  value: number;
  events: [string, number, number?][] = [];
  constructor(v = 1) {
    this.value = v;
  }
  cancelScheduledValues(t: number) {
    this.events.push(['cancel', t]);
  }
  setValueAtTime(v: number, t: number) {
    this.events.push(['set', v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push(['ramp', v, t]);
    this.value = v; // jump to the target: tests read end states
  }
}

class FakeNode {
  connections: FakeNode[] = [];
  connect<T extends FakeNode>(n: T): T {
    this.connections.push(n);
    return n;
  }
  disconnect() {
    this.connections = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

class FakeSource extends FakeNode {
  buffer: { duration: number; numberOfChannels: number } | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  started: number | null = null;
  stopped: number | null = null;
  onended: (() => void) | null = null;
  start(t: number) {
    this.started = t;
  }
  stop(t: number) {
    this.stopped = t;
  }
}

class FakeContext {
  static instances: FakeContext[] = [];
  state: 'running' | 'suspended' = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  constructor() {
    FakeContext.instances.push(this);
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), { type: '', Q: new FakeParam(1), frequency: new FakeParam(350) });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      duration: length / sampleRate,
      getChannelData: (i: number) => data[i]!,
    };
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
}

const loopSources = (ctx: FakeContext) => ctx.sources.filter((s) => s.loop);
const sfxSources = (ctx: FakeContext) => ctx.sources.filter((s) => !s.loop);

// ---------------------------------------------------------------------------------------------

describe('audio engine without Web Audio', () => {
  it('every public function is a safe no-op', async () => {
    const { api, engine } = await fresh();
    expect(() => {
      api.unlockAudio();
      api.playSfx('step_l');
      api.playMusic('race', 3);
      api.playMusic(null);
      api.duckMusic(true);
      api.setCrowd(0.5);
      api.setVolume(3);
      api.setMuted(true);
    }).not.toThrow();
    expect(engine.audioState().unlocked).toBe(false);
    // State is remembered for when audio becomes available.
    expect(engine.audioState()).toMatchObject({
      volume: 3,
      muted: true,
      ducked: true,
      music: null,
      crowd: 0.5,
    });
  });

  it('preloadAudio resolves and caches the first tracks', async () => {
    const { api, engine } = await fresh();
    await expect(api.preloadAudio()).resolves.toBeUndefined();
    expect(api.preloadAudio()).toBe(api.preloadAudio()); // idempotent
    expect(engine.audioState().cachedTracks).toEqual(['title', 'ladder', 'race:1']);
  }, 20000);

  it('maps volume perceptually', async () => {
    const { engine } = await fresh();
    expect(engine.volumeToGain(0)).toBe(0);
    expect(engine.volumeToGain(10)).toBe(1);
    expect(engine.volumeToGain(5)).toBeCloseTo(0.25);
    expect(engine.volumeToGain(-3)).toBe(0);
    expect(engine.volumeToGain(99)).toBe(1);
  });
});

describe('audio engine with a (fake) AudioContext', () => {
  beforeEach(() => {
    FakeContext.instances = [];
    vi.stubGlobal('AudioContext', FakeContext);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates exactly one context, lazily, on unlock', async () => {
    const { api } = await fresh();
    api.playSfx('menu_move');
    expect(FakeContext.instances).toHaveLength(0);
    api.unlockAudio();
    api.unlockAudio();
    expect(FakeContext.instances).toHaveLength(1);
  });

  it('applies volume and mute to the master gain', async () => {
    const { api } = await fresh();
    api.setVolume(5);
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    const master = ctx.gains[0]!;
    expect(master.gain.value).toBeCloseTo(0.25);
    api.setMuted(true);
    expect(master.gain.value).toBe(0);
    api.setVolume(10);
    expect(master.gain.value).toBe(0);
    api.setMuted(false);
    expect(master.gain.value).toBe(1);
  });

  it('plays SFX and rate-limits steps to one per 40 ms across both sides', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    api.playSfx('step_l');
    ctx.currentTime = 0.02;
    api.playSfx('step_r'); // dropped: within 40 ms
    ctx.currentTime = 0.041;
    api.playSfx('step_r');
    api.playSfx('beep_go');
    expect(sfxSources(ctx)).toHaveLength(3);
    expect(sfxSources(ctx).every((s) => s.started !== null && s.buffer)).toBe(true);
  });

  it('does not queue SFX while the context is suspended', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    ctx.state = 'suspended';
    api.playSfx('menu_select');
    expect(sfxSources(ctx)).toHaveLength(0);
  });

  it('starts music requested before unlock, keeps it on repeat calls, crossfades on change', async () => {
    const { api, engine } = await fresh();
    await api.preloadAudio();
    api.playMusic('title');
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    expect(loopSources(ctx)).toHaveLength(1);
    const title = loopSources(ctx)[0]!;
    expect(title.started).toBe(0);

    api.playMusic('title');
    expect(loopSources(ctx)).toHaveLength(1);

    ctx.currentTime = 10;
    api.playMusic('ladder');
    expect(loopSources(ctx)).toHaveLength(2);
    expect(title.stopped).toBeGreaterThan(10);
    expect(engine.audioState().playing).toBe('ladder');

    ctx.currentTime = 20;
    api.playMusic(null);
    expect(loopSources(ctx)[1]!.stopped).toBeGreaterThan(20);
    expect(engine.audioState().playing).toBeNull();
  }, 20000);

  it('renders and starts a race tier that was not preloaded', async () => {
    const { api, engine } = await fresh();
    api.unlockAudio();
    api.playMusic('race', 7);
    expect(engine.audioState().music).toBe('boss');
    await api.prepareMusic('race', 7);
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.audioState().playing).toBe('boss');
  }, 20000);

  it('ducks music to 40% and restores it', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    const duck = ctx.gains[2]!; // master, music, duck, sfx
    api.duckMusic(true);
    expect(duck.gain.value).toBeCloseTo(0.4);
    api.duckMusic(false);
    expect(duck.gain.value).toBe(1);
  });

  it('runs the crowd loop by intensity and stops it at 0', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    api.setCrowd(0.3);
    const crowd = loopSources(ctx)[0]!;
    expect(crowd.started).not.toBeNull();
    api.setCrowd(1);
    expect(loopSources(ctx)).toHaveLength(1);
    api.setCrowd(0);
    expect(crowd.stopped).not.toBeNull();
  });
});
