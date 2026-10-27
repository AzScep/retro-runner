/**
 * Performance probe for a production build with VITE_TEST_HOOKS=1 (see docs/work/performance.md).
 *
 *   npx vite build && npx vite preview --port 4173      (built with VITE_TEST_HOOKS=1)
 *   node tools/perf/measure.ts boot   [--browser chromium|webkit] [--runs 5] [--throttle 4]
 *   node tools/perf/measure.ts race   [--browser chromium|webkit] [--throttle 4] [--crt] [--event 100m|110mh|400m]
 *   node tools/perf/measure.ts memory [--cycles 20] [--gauntlets 3]  (Chromium only)
 *   Headless Chromium renders with SwiftShader (software); --gpu renders on the real GPU, still
 *   headless (ANGLE on Metal, macOS). --headed runs a visible browser.
 *   race also takes --delay <ms> (wait on the Ladder first), --muted (the game's mute setting) and
 *   --alloc (V8 allocation sampling plus a trace: GC, the longest main-thread events and GPU-thread
 *   flush times).
 *   The game is always silent: Chromium runs with --mute-audio, and every AudioContext outputs
 *   through a zero gain (the same wrapper as e2e/fixtures.ts, needed for WebKit).
 *
 * boot:   cold load (fresh context, empty cache) to the first frame of the Title scene.
 * race:   one full 6-runner race against Pip, mashed in-page at the speed cap (hurdles: one clean
 *         jump per hurdle). Per frame it records the
 *         CPU time of Phaser's step (PRE_STEP to POST_RENDER), the rAF interval, WebGL draw calls
 *         and texture binds; Chromium also reports V8 allocation sampling and GC events.
 * memory: race + RETRY cycles, then whole Gauntlet runs; after each forced GC it records the JS heap, textures, display
 *         list sizes, window listeners and Web Audio node creation.
 */
import { chromium, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import type Phaser from 'phaser';

const args = process.argv.slice(2);
const mode = args[0] ?? 'race';
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const flag = (name: string): boolean => args.includes(`--${name}`);
const url = opt('url', 'http://localhost:4173/');
const browserName = opt('browser', 'chromium');
const throttle = Number(opt('throttle', '1'));
const event = opt('event', '100m');
const EVENT_ORDER = ['100m', '110mh', '400m'];
const types: Record<string, BrowserType> = { chromium, webkit };

/** Installed before any page script: counters for WebGL calls, window listeners and audio nodes. */
function instrument(): void {
  const w = window as unknown as Record<string, unknown>;
  const c = {
    draws: 0,
    binds: 0,
    listeners: 0,
    audioNodes: 0,
    links: [] as number[],
    uploads: [] as string[],
  };
  w['__perf'] = c;
  for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
    const p = proto as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = p[name];
      if (!orig) continue;
      p[name] = function (this: unknown, ...a: unknown[]) {
        c.draws++;
        return orig.apply(this, a);
      };
    }
    const link = p['linkProgram'];
    if (link) {
      p['linkProgram'] = function (this: unknown, ...a: unknown[]) {
        c.links.push(Math.round(performance.now()));
        return link.apply(this, a);
      };
    }
    for (const name of ['texImage2D', 'texSubImage2D', 'readPixels']) {
      const orig = p[name];
      if (!orig) continue;
      p[name] = function (this: unknown, ...a: unknown[]) {
        const t0 = performance.now();
        const r = orig.apply(this, a);
        const src = a.find((x) => typeof x === 'object' && x !== null && 'width' in x) as
          { width: number; height: number } | undefined;
        const size = src ? `${src.width}x${src.height}` : `${String(a[3])}x${String(a[4])}`;
        c.uploads.push(`${name} ${size} ${Math.round(performance.now() - t0)}ms@${Math.round(t0)}`);
        return r;
      };
    }
    const bind = p['bindTexture'];
    if (bind) {
      p['bindTexture'] = function (this: unknown, ...a: unknown[]) {
        c.binds++;
        return bind.apply(this, a);
      };
    }
  }
  const add = window.addEventListener.bind(window);
  const remove = window.removeEventListener.bind(window);
  const seen = new Set<unknown>();
  window.addEventListener = ((type: string, fn: unknown, o?: unknown) => {
    if (!seen.has(fn)) {
      seen.add(fn);
      c.listeners++;
    }
    add(type, fn as EventListener, o as AddEventListenerOptions);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((type: string, fn: unknown, o?: unknown) => {
    if (seen.delete(fn)) c.listeners--;
    remove(type, fn as EventListener, o as EventListenerOptions);
  }) as typeof window.removeEventListener;
  const ac = (window.AudioContext ?? (w['webkitAudioContext'] as typeof AudioContext | undefined))?.prototype;
  if (ac) {
    const a = ac as unknown as Record<string, (...x: unknown[]) => unknown>;
    for (const name of ['createBufferSource', 'createGain', 'createBiquadFilter', 'createBuffer']) {
      const orig = a[name];
      if (!orig) continue;
      a[name] = function (this: unknown, ...x: unknown[]) {
        c.audioNodes++;
        return orig.apply(this, x);
      };
    }
  }
  // Boot timing: first frame rendered while the Title scene is active.
  const poll = (): void => {
    const hook = w['__retroRunner'] as { game: { scene: { isActive(k: string): boolean } } } | undefined;
    if (hook?.game.scene.isActive('Title')) {
      w['__titleAt'] = performance.now();
      return;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
  const longTasks: string[] = [];
  w['__longTasks'] = longTasks;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        longTasks.push(`${Math.round(e.duration)}ms@${Math.round(e.startTime)}`);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    // WebKit has no longtask entries.
  }
}

/** Same as e2e/fixtures.ts: every AudioContext's destination is a zero gain in front of the output. */
function silence(): void {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Orig = w.AudioContext ?? w.webkitAudioContext;
  if (!Orig) return;
  class SilentAudioContext extends Orig {
    constructor(opts?: AudioContextOptions) {
      super(opts);
      const silent = this.createGain();
      silent.gain.value = 0;
      silent.connect(super.destination);
      Object.defineProperty(this, 'destination', { value: silent, configurable: true });
    }
  }
  w.AudioContext = SilentAudioContext;
  w.webkitAudioContext = SilentAudioContext;
}

async function launch(): Promise<Browser> {
  const t = types[browserName];
  if (!t) throw new Error(`unknown browser ${browserName}`);
  const gpu = flag('gpu') ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [];
  return t.launch({
    headless: !flag('headed'),
    args: browserName === 'chromium' ? ['--mute-audio', ...gpu] : [],
  });
}

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.addInitScript(silence);
  await page.addInitScript(instrument);
  if (throttle > 1) {
    if (browserName !== 'chromium') throw new Error('--throttle needs chromium');
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  return page;
}

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0) : 0;
};
const r1 = (n: number): number => Math.round(n * 10) / 10;

async function boot(): Promise<void> {
  const runs = Number(opt('runs', '5'));
  const browser = await launch();
  const out: { titleMs: number; dclMs: number; jsKB: number; longTasks: string[]; programsLinked: number }[] =
    [];
  for (let i = 0; i < runs; i++) {
    const page = await newPage(browser);
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { __titleAt?: number }).__titleAt, null, {
      timeout: 60_000,
    });
    out.push(
      await page.evaluate(() => {
        const w = window as unknown as {
          __titleAt: number;
          __longTasks: string[];
          __perf: { links: number[] };
        };
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const js = performance
          .getEntriesByType('resource')
          .filter((e) => e.name.endsWith('.js'))
          .reduce((s, e) => s + ((e as PerformanceResourceTiming).encodedBodySize || 0), 0);
        return {
          titleMs: Math.round(w.__titleAt),
          dclMs: Math.round(nav.domContentLoadedEventEnd),
          jsKB: Math.round(js / 1024),
          longTasks: [...w.__longTasks],
          programsLinked: w.__perf.links.length,
        };
      }),
    );
    await page.context().close();
  }
  await browser.close();
  const t = out.map((o) => o.titleMs);
  console.log(JSON.stringify({ browser: browserName, throttle, median: pct(t, 50), runs: out }, null, 1));
}

/** Frame recorder plus an in-page masher that always presses the expected side once running. */
function startRecording(): void {
  const w = window as unknown as Record<string, unknown>;
  const hook = w['__retroRunner'] as { game: Phaser.Game };
  const game = hook.game;
  const c = w['__perf'] as { draws: number; binds: number };
  const frames: { t: number; phase: string; cpu: number; raf: number; draws: number; binds: number }[] = [];
  w['__frames'] = frames;
  let t0 = 0;
  let lastRaf = 0;
  let d0 = 0;
  let b0 = 0;
  const race = () =>
    game.scene.getScene('Race') as unknown as {
      raceState: {
        phase: string;
        expectedSide: 'L' | 'R' | null;
        nextHurdleS: number | null;
        nextHurdleIndex: number | null;
        player: { airM: number };
      };
    };
  let jumpedFor = -1;
  game.events.on('prestep', () => {
    t0 = performance.now();
    d0 = c.draws;
    b0 = c.binds;
  });
  game.events.on('postrender', () => {
    const now = performance.now();
    const phase = game.scene.isActive('Race') ? race().raceState.phase : 'other';
    frames.push({
      t: Math.round(t0),
      phase,
      cpu: now - t0,
      raf: lastRaf ? t0 - lastRaf : 0,
      draws: c.draws - d0,
      binds: c.binds - b0,
    });
    lastRaf = t0;
  });
  let next: 'L' | 'R' = 'L';
  let held: string | null = null;
  w['__masher'] = setInterval(() => {
    if (!game.scene.isActive('Race')) return;
    const st = race().raceState;
    if (held) {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: held }));
      held = null;
      return;
    }
    if (st.phase !== 'running') return;
    if (
      st.nextHurdleIndex !== null &&
      st.nextHurdleS !== null &&
      st.nextHurdleS <= 0.2 &&
      st.player.airM === 0 &&
      jumpedFor !== st.nextHurdleIndex
    ) {
      jumpedFor = st.nextHurdleIndex;
      held = 'ArrowUp';
      window.dispatchEvent(new KeyboardEvent('keydown', { code: held }));
      return;
    }
    next = st.expectedSide ?? next;
    held = next === 'L' ? 'ArrowLeft' : 'ArrowRight';
    window.dispatchEvent(new KeyboardEvent('keydown', { code: held }));
    next = next === 'L' ? 'R' : 'L';
  }, 21);
}

/**
 * A v1 save (design 4.3; every build migrates it) with the 100 m beaten up to Kofi, which unlocks
 * the hurdles and the 400 m (both start at Pip). The 100 m runs on a fresh save, also against Pip.
 */
function unlockEvents(): void {
  if (localStorage.getItem('retroRunner.save.v1') !== null) return;
  const at = '2026-10-26T20:15:03.120Z';
  const beaten = ['pip', 'jess', 'marco', 'kofi'];
  localStorage.setItem(
    'retroRunner.save.v1',
    JSON.stringify({
      version: 1,
      unlockedTier: beaten.length + 1,
      beaten,
      champion: false,
      best: {},
      history: beaten.map((opp) => ({
        opp,
        result: 'win',
        ms: 15000,
        oppMs: 18000,
        falseStarts: 0,
        seed: 7,
        at,
      })),
      settings: { volume: 8, muted: false, reducedFlashing: false, screenShake: true, crt: false },
    }),
  );
}

async function toRace(page: Page): Promise<void> {
  if (event !== '100m') await page.addInitScript(unlockEvents);
  await page.goto(url);
  await page.waitForFunction(() => (window as unknown as { __titleAt?: number }).__titleAt, null, {
    timeout: 60_000,
  });
  if (flag('crt')) {
    await page.evaluate(() => {
      // getState().records is the live save object; settings() reads it on every scene create.
      const w = window as unknown as {
        __retroRunner: { getState(): { records: { settings: { crt: boolean } } } };
      };
      w.__retroRunner.getState().records.settings.crt = true;
    });
  }
  if (flag('muted')) {
    await page.evaluate(() => {
      const w = window as unknown as {
        __retroRunner: { getState(): { records: { settings: { muted: boolean } } } };
      };
      w.__retroRunner.getState().records.settings.muted = true;
    });
  }
  const active = (key: string) =>
    page.waitForFunction(
      (k) =>
        (window as unknown as { __retroRunner: { game: Phaser.Game } }).__retroRunner.game.scene.isActive(k),
      key,
    );
  // Title -> Event Select -> the event's card -> its Ladder.
  await page.keyboard.press('Enter');
  await active('Events');
  for (let i = 0; i < EVENT_ORDER.length; i++) await page.keyboard.press('ArrowLeft');
  for (let i = 0; i < EVENT_ORDER.indexOf(event); i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await active('Ladder');
  await page.evaluate(() =>
    (window as unknown as { __retroRunner: { seed(n: number): void } }).__retroRunner.seed(7),
  );
}

async function race(): Promise<void> {
  const browser = await launch();
  const page = await newPage(browser);
  await toRace(page);
  const cdp = browserName === 'chromium' && flag('alloc') ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512 });
    await browser.startTracing(page, {
      categories: [
        'toplevel',
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'disabled-by-default-v8.gc',
        'v8',
        'gpu',
      ],
    });
  }
  await page.waitForTimeout(Number(opt('delay', '0')));
  await page.evaluate(startRecording);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      (window as unknown as { __retroRunner: { game: Phaser.Game } }).__retroRunner.game.scene.isActive(
        'Results',
      ),
    null,
    { timeout: 120_000 },
  );
  await page.waitForTimeout(1000);
  const frames = await page.evaluate(() => (window as unknown as { __frames: unknown[] }).__frames);
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: string[] }).__longTasks);
  const linkedAfterTitle = await page.evaluate(() => {
    const w = window as unknown as { __titleAt: number; __perf: { links: number[] } };
    return w.__perf.links.filter((t) => t > w.__titleAt).length;
  });
  const uploadsAfterTitle = await page.evaluate(() => {
    const w = window as unknown as { __titleAt: number; __perf: { uploads: string[] } };
    return w.__perf.uploads.filter((u) => Number(u.split('@')[1]) > w.__titleAt);
  });
  type F = { t: number; phase: string; cpu: number; raf: number; draws: number; binds: number };
  const fs = frames as F[];
  const running = fs.filter((f) => f.phase === 'running');
  const all = fs.slice(2);
  // A dropped frame is an rAF interval over 1.5 vsyncs (headless WebKit paces rAF at 30 Hz).
  const vsync = pct(
    all.map((f) => f.raf),
    50,
  );
  const isGap = (f: F): boolean => f.raf > vsync * 1.5;
  const summary = (xs: F[]) => ({
    frames: xs.length,
    cpuP50: r1(
      pct(
        xs.map((f) => f.cpu),
        50,
      ),
    ),
    cpuP95: r1(
      pct(
        xs.map((f) => f.cpu),
        95,
      ),
    ),
    cpuP99: r1(
      pct(
        xs.map((f) => f.cpu),
        99,
      ),
    ),
    cpuMax: r1(Math.max(...xs.map((f) => f.cpu))),
    over16: xs.filter((f) => f.cpu > 16.7).length,
    dropped: xs.filter(isGap).length,
    rafMax: r1(Math.max(...xs.map((f) => f.raf))),
    draws: r1(xs.reduce((s, f) => s + f.draws, 0) / Math.max(1, xs.length)),
    binds: r1(xs.reduce((s, f) => s + f.binds, 0) / Math.max(1, xs.length)),
  });
  const worst = [...all]
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 6)
    .map((f) => `${f.phase}:${r1(f.cpu)}ms@${f.t}`);
  // Each gap with the CPU time of the step before it (a long step versus time outside Phaser).
  const gaps = all
    .map((f, i) => ({ f, prev: all[i - 1] }))
    .filter(({ f }) => isGap(f))
    .slice(0, 12)
    .map(({ f, prev }) => `${f.phase}:${r1(f.raf)}ms@${f.t} (prev step ${r1(prev?.cpu ?? 0)}ms)`);
  const result: Record<string, unknown> = {
    browser: browserName,
    event,
    throttle,
    crt: flag('crt'),
    linkedAfterTitle,
    uploadsAfterTitle,
    running: summary(running),
    wholeRace: summary(all),
    vsyncMs: r1(vsync),
    raceStartAt: all[0]?.t,
    runningAt: running[0]?.t,
    worst,
    gaps,
    longTasks,
  };
  if (cdp) {
    const runMs = (running.length * 1000) / 60;
    const { profile } = (await cdp.send('HeapProfiler.stopSampling')) as {
      profile: { head: Node; samples: { size: number; nodeId: number }[] };
    };
    type Node = {
      id: number;
      selfSize: number;
      callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
      children: Node[];
    };
    const byFn = new Map<string, number>();
    let total = 0;
    const walk = (n: Node, stack: string): void => {
      const name = `${n.callFrame.functionName || '(anon)'}@${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}:${n.callFrame.columnNumber}`;
      if (n.selfSize) {
        byFn.set(name, (byFn.get(name) ?? 0) + n.selfSize);
        total += n.selfSize;
      }
      for (const ch of n.children) walk(ch, stack);
    };
    walk(profile.head, '');
    result['sampledAllocKB'] = Math.round(total / 1024);
    result['allocKBperSecOfRace'] = Math.round(total / 1024 / (runMs / 1000));
    result['topAllocators'] = [...byFn]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, v]) => `${Math.round(v / 1024)}KB ${k}`);
    const buf = await browser.stopTracing();
    const trace = JSON.parse(buf.toString()) as {
      traceEvents: {
        name: string;
        dur?: number;
        ph: string;
        pid: number;
        tid: number;
        ts: number;
        args?: { name?: string; data?: { functionName?: string; url?: string; lineNumber?: number } };
      }[];
    };
    // Only the page's main thread: the audio worker allocates whole songs and has its own GCs.
    const main = trace.traceEvents.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
    const gcs = trace.traceEvents.filter(
      (e) =>
        (e.name === 'MinorGC' || e.name === 'MajorGC') &&
        e.dur &&
        main !== undefined &&
        e.pid === main.pid &&
        e.tid === main.tid,
    );
    const by = (n: string) => gcs.filter((e) => e.name === n);
    const fl = trace.traceEvents
      .filter((e) => e.name === 'CommandBuffer::Flush' && e.dur)
      .map((e) => (e.dur ?? 0) / 1000);
    result['gpuFlush'] = {
      n: fl.length,
      p50: r1(pct(fl, 50)),
      p90: r1(pct(fl, 90)),
      p99: r1(pct(fl, 99)),
      max: r1(Math.max(...fl)),
      over10: fl.filter((x) => x > 10).length,
    };
    // The longest main-thread trace events (tasks and the script calls inside them).
    result['longEvents'] = trace.traceEvents
      .filter((e) => main !== undefined && e.pid === main.pid && e.tid === main.tid && (e.dur ?? 0) > 20_000)
      .sort((a, b) => (b.dur ?? 0) - (a.dur ?? 0))
      .slice(0, 20)
      .map((e) => {
        const d = e.args?.data;
        const where = d?.url
          ? ` ${d.functionName ?? ''}@${d.url.split('/').pop()}:${d.lineNumber ?? ''}`
          : '';
        return `${e.name} ${r1((e.dur ?? 0) / 1000)}ms ts=${Math.round(e.ts / 1000)}${where}`;
      });
    result['gc'] = {
      minor: by('MinorGC').length,
      major: by('MajorGC').length,
      minorMs: r1(by('MinorGC').reduce((s, e) => s + (e.dur ?? 0), 0) / 1000),
      majorMs: r1(by('MajorGC').reduce((s, e) => s + (e.dur ?? 0), 0) / 1000),
      maxMs: r1(Math.max(0, ...gcs.map((e) => (e.dur ?? 0) / 1000))),
    };
  }
  console.log(JSON.stringify(result, null, 1));
  await browser.close();
}

type Hook = {
  game: Phaser.Game;
  getState(): { scene: string | null; texts: string[] };
  startGauntletRace(tier: number, times: number[]): void;
};

async function memory(): Promise<void> {
  const cycles = Number(opt('cycles', '20'));
  const gauntlets = Number(opt('gauntlets', '3'));
  const browser = await launch();
  const page = await newPage(browser);
  await toRace(page);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(startRecording);
  await page.keyboard.press('Enter');
  const rows: unknown[] = [];
  const sample = async (label: string): Promise<void> => {
    await page.waitForTimeout(400);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
    const s = await page.evaluate(() => {
      const w = window as unknown as {
        __retroRunner: Hook;
        __perf: { listeners: number; audioNodes: number; links: number[] };
        __frames: unknown[];
      };
      const g = w.__retroRunner.game;
      w.__frames.length = 0;
      const scenes = g.scene.getScenes(false);
      return {
        textures: Object.keys((g.textures as unknown as { list: object }).list).length,
        displayObjects: scenes.reduce((n, sc) => n + sc.children.list.length, 0),
        updateListeners: scenes.reduce((n, sc) => n + sc.events.listenerCount('update'), 0),
        timers: scenes.reduce(
          (n, sc) => n + (sc.time as unknown as { _active: unknown[] })._active.length,
          0,
        ),
        // The trimmed Phaser build has no tween plugin (the game uses none).
        tweens: scenes.reduce((n, sc) => n + (sc.tweens?.getTweens().length ?? 0), 0),
        windowListeners: w.__perf.listeners,
        audioNodes: w.__perf.audioNodes,
        programs: w.__perf.links.length,
        anims: (g.anims as unknown as { anims: { size: number } }).anims.size,
      };
    });
    rows.push({ at: label, heapMB: Math.round(heap.usedSize / 1024 / 10.24) / 100, ...s });
    console.error(JSON.stringify(rows[rows.length - 1]));
  };
  const isActive = (key: string): Promise<boolean> =>
    page.evaluate(
      (k) => (window as unknown as { __retroRunner: Hook }).__retroRunner.game.scene.isActive(k),
      key,
    );
  for (let i = 1; i <= cycles; i++) {
    await page.waitForFunction(
      () => (window as unknown as { __retroRunner: Hook }).__retroRunner.game.scene.isActive('Results'),
      null,
      { timeout: 120_000 },
    );
    await sample(`race ${i}`);
    if (i < cycles) {
      await page.evaluate(() => {
        const w = window as unknown as { __retroRunner: Hook };
        (w.__retroRunner.game.scene.getScene('Results') as unknown as { choose(id: string): void }).choose(
          'retry',
        );
      });
      await page.waitForFunction(() => {
        const g = (window as unknown as { __retroRunner: Hook }).__retroRunner.game;
        return g.scene.isActive('Race') && !g.scene.isActive('Results');
      });
    }
  }
  // Whole Gauntlet runs (7 meets back to back until a loss or the clear); the masher races them.
  for (let i = 1; i <= gauntlets; i++) {
    await page.evaluate(() =>
      (window as unknown as { __retroRunner: Hook }).__retroRunner.startGauntletRace(1, []),
    );
    const deadline = Date.now() + 15 * 60_000;
    let end = '';
    while (!end) {
      if (Date.now() > deadline) throw new Error(`Gauntlet run ${i} never ended`);
      await page.waitForTimeout(300);
      const st = await page.evaluate(() =>
        (window as unknown as { __retroRunner: Hook }).__retroRunner.getState(),
      );
      if (st.texts.includes('GAUNTLET OVER')) end = 'over';
      else if (st.texts.includes('GAUNTLET CLEAR!')) end = 'clear';
      // A first Zyx win shows the champion screen and possibly the reveal; Enter skips both.
      else if ((await isActive('Champion')) || (await isActive('Reveal'))) await page.keyboard.press('Enter');
    }
    await sample(`gauntlet ${i} (${end})`);
  }
  console.log(JSON.stringify(rows, null, 1));
  await browser.close();
}

const run: Record<string, () => Promise<void>> = { boot, race, memory };
const fn = run[mode];
if (!fn) throw new Error(`unknown mode ${mode}`);
await fn();
