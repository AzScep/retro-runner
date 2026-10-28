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
  state: 'running' | 'suspended' | 'interrupted' | 'closed' = 'running';
  onstatechange: (() => void) | null = null;
  resumes = 0;
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
    this.resumes++;
    if (this.state === 'closed') return Promise.reject(new Error('closed'));
    this.state = 'running';
    return Promise.resolve();
  }
  /** The OS changes the state (an iOS call or Siri), as WebKit does, then fires statechange. */
  osSetState(state: 'suspended' | 'interrupted' | 'closed') {
    this.state = state;
    this.onstatechange?.();
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
      api.playSfx('jump', { volume: 0.5 });
      api.playSfx('stamina_low', { volume: Number.NaN });
      api.playMusic('quarter');
      api.setQuarterFinal(true);
      api.setQuarterFinal(false);
      api.playMusic('hurdles', 7);
    }).not.toThrow();
    expect(engine.audioState().unlocked).toBe(false);
    // State is remembered for when audio becomes available.
    expect(engine.audioState()).toMatchObject({
      volume: 3,
      muted: true,
      ducked: true,
      music: 'boss',
      crowd: 0.5,
      quarterFinal: false,
    });
  });

  it('remembers setQuarterFinal until the next track change', async () => {
    const { api, engine } = await fresh();
    api.playMusic('quarter', 2);
    api.setQuarterFinal(true);
    expect(engine.audioState().quarterFinal).toBe(true);
    api.playMusic('quarter', 5); // same track: keeps the flag
    expect(engine.audioState().quarterFinal).toBe(true);
    api.playMusic('ladder');
    expect(engine.audioState().quarterFinal).toBe(false);
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

  it('resumes an iOS interrupted context on the next tap or key', async () => {
    const { api, engine } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    // Without onstatechange (older engines) the state just changes underneath.
    ctx.state = 'interrupted';
    api.unlockAudio();
    expect(ctx.state).toBe('running');
    expect(engine.audioState().context).toBe('running');
  });

  it('asks for an interrupted or OS-suspended context back as soon as its state changes', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    const before = ctx.resumes;
    ctx.osSetState('interrupted');
    expect(ctx.resumes).toBe(before + 1);
    expect(ctx.state).toBe('running');
    ctx.osSetState('suspended');
    expect(ctx.state).toBe('running');
    // A closed context is never resumed.
    ctx.osSetState('closed');
    expect(ctx.resumes).toBe(before + 2);
    api.unlockAudio();
    expect(ctx.resumes).toBe(before + 2);
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

  it('plays SFX at a per-play volume through its own gain, rate-limited per volume', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    const gainsBefore = ctx.gains.length;
    api.playSfx('jump', { volume: 0.5 }); // rival takeoff
    expect(ctx.gains.length).toBe(gainsBefore + 1);
    expect(ctx.gains.at(-1)!.gain.value).toBe(0.5);
    expect(sfxSources(ctx)[0]!.connections[0]).toBe(ctx.gains.at(-1));
    ctx.currentTime = 0.01;
    api.playSfx('jump'); // player takeoff in the same frame is not swallowed
    expect(sfxSources(ctx)).toHaveLength(2);
    expect(ctx.gains.length).toBe(gainsBefore + 1); // full volume needs no extra gain
    api.playSfx('jump', { volume: 0.5 }); // rival burst: dropped
    api.playSfx('jump', { volume: 0 }); // silent: never scheduled
    api.playSfx('jump', { volume: Number.NaN });
    expect(sfxSources(ctx)).toHaveLength(2);
  });

  it('guards stamina SFX against bursts without cutting the 0.6 s cadence', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    for (let i = 0; i < 5; i++) api.playSfx('stamina_low');
    expect(sfxSources(ctx)).toHaveLength(1);
    ctx.currentTime = 0.6;
    api.playSfx('stamina_low');
    expect(sfxSources(ctx)).toHaveLength(2);
    api.playSfx('stamina_empty');
    ctx.currentTime = 1.0;
    api.playSfx('stamina_empty');
    ctx.currentTime = 3.6;
    api.playSfx('stamina_empty');
    expect(sfxSources(ctx)).toHaveLength(4);
  });

  it('plays the quarter track as two sample-locked loops and crossfades to final-100 over 1 s', async () => {
    const { api, engine } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    await api.prepareMusic('quarter');
    ctx.currentTime = 5;
    api.playMusic('quarter', 4);
    const loops = loopSources(ctx);
    expect(loops).toHaveLength(2);
    const [base, final] = loops as [FakeSource, FakeSource];
    expect(base.started).toBe(5);
    expect(final.started).toBe(5);
    expect(base.buffer!.duration).toBe(final.buffer!.duration);
    const baseMix = base.connections[0] as FakeGain;
    const finalMix = final.connections[0] as FakeGain;
    expect(baseMix.gain.value).toBe(1);
    expect(finalMix.gain.value).toBe(0);
    expect(baseMix.connections[0]).toBe(finalMix.connections[0]); // one track gain

    ctx.currentTime = 40;
    api.setQuarterFinal(true);
    expect(baseMix.gain.value).toBe(0);
    expect(finalMix.gain.value).toBe(1);
    expect(finalMix.gain.events.at(-1)).toEqual(['ramp', 1, 41]);
    expect(baseMix.gain.events.at(-1)).toEqual(['ramp', 0, 41]);
    expect(loopSources(ctx)).toHaveLength(2); // no restart: loop position kept
    expect(engine.audioState().quarterFinal).toBe(true);

    api.setQuarterFinal(true); // repeat is a no-op
    expect(finalMix.gain.events.at(-1)).toEqual(['ramp', 1, 41]);
    api.setQuarterFinal(false);
    expect(baseMix.gain.value).toBe(1);
    expect(finalMix.gain.value).toBe(0);

    ctx.currentTime = 70;
    api.playMusic(null);
    expect(base.stopped).toBeGreaterThan(70);
    expect(final.stopped).toBeGreaterThan(70);
  }, 20000);

  it('rate-limits field SFX to one per 100 ms across all field lanes, at the caller volume', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    const gainsBefore = ctx.gains.length;
    api.playSfx('hurdle_clip', { volume: 0.25, field: true }); // lane 2
    api.playSfx('hurdle_hit', { volume: 0.25, field: true }); // lane 4, same frame: dropped
    ctx.currentTime = 0.05;
    api.playSfx('hurdle_clip', { volume: 0.25, field: true }); // lane 5: dropped
    expect(sfxSources(ctx)).toHaveLength(1);
    expect(ctx.gains.length).toBe(gainsBefore + 1);
    expect(ctx.gains.at(-1)!.gain.value).toBe(0.25);
    // The player and the rival keep their own limits: a field burst never swallows them.
    api.playSfx('hurdle_clip');
    api.playSfx('hurdle_clip', { volume: 0.5 });
    expect(sfxSources(ctx)).toHaveLength(3);
    ctx.currentTime = 0.1;
    api.playSfx('hurdle_hit', { volume: 0.25, field: true });
    expect(sfxSources(ctx)).toHaveLength(4);
    ctx.currentTime = 0.15;
    api.playSfx('hurdle_hit', { volume: 0.25, field: true });
    api.playSfx('hurdle_hit', { volume: 0, field: true }); // silent: never scheduled
    expect(sfxSources(ctx)).toHaveLength(4);
    ctx.currentTime = 0.2;
    api.playSfx('hurdle_hit', { volume: 0.25, field: true });
    expect(sfxSources(ctx)).toHaveLength(5);
  });

  it('plays every v3 SFX', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    const ids = [
      'pistol',
      'trip_thud',
      'reveal_sting_1',
      'reveal_sting_2',
      'photo_click',
      'bubble',
      'gauntlet_clear',
    ] as const;
    for (const id of ids) api.playSfx(id);
    api.playSfx('beep_go'); // the pistol layers over GO
    expect(sfxSources(ctx)).toHaveLength(ids.length + 1);
    expect(sfxSources(ctx).every((s) => s.started === 0 && s.buffer)).toBe(true);
  });

  it('keeps gauntlet playing without a restart across races 1-6 and the cards between them', async () => {
    const { api, engine } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    await api.prepareMusic('gauntlet');
    api.playMusic('gauntlet'); // intro card
    const loops = () => loopSources(ctx);
    expect(loops()).toHaveLength(1);
    const track = loops()[0]!;
    for (let tier = 1; tier <= 6; tier++) {
      ctx.currentTime = tier * 20;
      api.playMusic('gauntlet', tier); // race n
      api.duckMusic(true); // countdown
      api.setCrowd(0.3);
      api.playSfx('beep_go');
      api.playSfx('pistol');
      api.duckMusic(false);
      api.setCrowd(0);
      api.playMusic('gauntlet'); // between-race card
      api.duckMusic(true); // win_jingle on the card
      api.playSfx('win_jingle');
      api.duckMusic(false);
    }
    expect(loops().filter((s) => s.buffer!.duration > 40)).toEqual([track]);
    expect(track.started).toBe(0);
    expect(track.stopped).toBeNull();
    expect(engine.audioState().playing).toBe('gauntlet');
    // Tier 7 crossfades to the boss track once it is rendered; gauntlet plays on until then.
    ctx.currentTime = 200;
    api.playMusic('gauntlet', 7);
    expect(engine.audioState().music).toBe('boss');
    expect(track.stopped).toBeNull();
    await api.prepareMusic('boss');
    await new Promise((r) => setTimeout(r, 0));
    expect(engine.audioState().playing).toBe('boss');
    expect(track.stopped).toBeGreaterThan(200);
  }, 20000);

  it('cutMusic stops the track dead (reveal step 3) and forgets it', async () => {
    const { api, engine } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    await api.prepareMusic('champion');
    api.playMusic('champion');
    const track = loopSources(ctx)[0]!;
    ctx.currentTime = 4;
    api.cutMusic();
    expect(track.stopped).toBeGreaterThan(4);
    expect(track.stopped).toBeLessThan(4.1);
    expect(engine.audioState()).toMatchObject({ music: null, playing: null });
    api.cutMusic(); // nothing playing: harmless
    api.playMusic('champion'); // wanted again after a cut: starts afresh
    expect(loopSources(ctx)).toHaveLength(2);
  }, 20000);

  it('setQuarterFinal on a non-quarter track is a harmless no-op', async () => {
    const { api } = await fresh();
    api.unlockAudio();
    const ctx = FakeContext.instances[0]!;
    await api.prepareMusic('hurdles', 2);
    api.playMusic('hurdles', 2);
    expect(loopSources(ctx)).toHaveLength(1);
    expect(() => api.setQuarterFinal(true)).not.toThrow();
    expect(loopSources(ctx)).toHaveLength(1);
  }, 20000);
});
