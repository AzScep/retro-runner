/**
 * Performance probe for a production build with VITE_TEST_HOOKS=1 (see docs/work/performance.md).
 *
 *   npx vite build && npx vite preview --port 4173      (built with VITE_TEST_HOOKS=1)
 *   node tools/perf/measure.ts boot   [--browser chromium|webkit] [--runs 5] [--throttle 4]
 *   node tools/perf/measure.ts race   [--browser chromium|webkit] [--throttle 4] [--crt]
 *   node tools/perf/measure.ts memory [--cycles 20]                (Chromium only)
 *   --headed runs a visible browser on the real GPU (headless Chromium renders with SwiftShader).
 *
 * boot:   cold load (fresh context, empty cache) to the first frame of the Title scene.
 * race:   one full race against Pip, mashed in-page at the speed cap. Per frame it records the
 *         CPU time of Phaser's step (PRE_STEP to POST_RENDER), the rAF interval, WebGL draw calls
 *         and texture binds; Chromium also reports V8 allocation sampling and GC events.
 * memory: race + RETRY cycles; after each forced GC it records the JS heap, textures, display
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
const types: Record<string, BrowserType> = { chromium, webkit };

/** Installed before any page script: counters for WebGL calls, window listeners and audio nodes. */
function instrument(): void {
  const w = window as unknown as Record<string, unknown>;
  const c = { draws: 0, binds: 0, listeners: 0, audioNodes: 0 };
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

async function launch(): Promise<Browser> {
  const t = types[browserName];
  if (!t) throw new Error(`unknown browser ${browserName}`);
  return t.launch({ headless: !flag('headed') });
}

async function newPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
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
  const out: { titleMs: number; dclMs: number; jsKB: number; longTasks: string[] }[] = [];
  for (let i = 0; i < runs; i++) {
    const page = await newPage(browser);
    await page.goto(url);
    await page.waitForFunction(() => (window as unknown as { __titleAt?: number }).__titleAt, null, {
      timeout: 60_000,
    });
    out.push(
      await page.evaluate(() => {
        const w = window as unknown as { __titleAt: number; __longTasks: string[] };
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
      raceState: { phase: string; expectedSide: 'L' | 'R' | null };
    };
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
    next = st.expectedSide ?? next;
    held = next === 'L' ? 'ArrowLeft' : 'ArrowRight';
    window.dispatchEvent(new KeyboardEvent('keydown', { code: held }));
    next = next === 'L' ? 'R' : 'L';
  }, 21);
}

async function toRace(page: Page): Promise<void> {
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
  const active = (key: string) =>
    page.waitForFunction(
      (k) =>
        (window as unknown as { __retroRunner: { game: Phaser.Game } }).__retroRunner.game.scene.isActive(k),
      key,
    );
  // Title -> Event Select -> the 100 m (first card) -> its Ladder.
  await page.keyboard.press('Enter');
  await active('Events');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
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
      categories: ['devtools.timeline', 'disabled-by-default-v8.gc', 'v8'],
    });
  }
  await page.evaluate(startRecording);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      (window as unknown as { __retroRunner: { game: Phaser.Game } }).__retroRunner.game.scene.isActive(
        'Results',
      ),
    null,
    { timeout: 60_000 },
  );
  await page.waitForTimeout(1000);
  const frames = await page.evaluate(() => (window as unknown as { __frames: unknown[] }).__frames);
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: string[] }).__longTasks);
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
    throttle,
    crt: flag('crt'),
    running: summary(running),
    wholeRace: summary(all),
    vsyncMs: r1(vsync),
    raceStartAt: all[0]?.t,
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
        args?: { name?: string };
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

async function memory(): Promise<void> {
  const cycles = Number(opt('cycles', '20'));
  const browser = await launch();
  const page = await newPage(browser);
  await toRace(page);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(startRecording);
  await page.keyboard.press('Enter');
  const rows: unknown[] = [];
  for (let i = 1; i <= cycles; i++) {
    await page.waitForFunction(
      () =>
        (window as unknown as { __retroRunner: { game: Phaser.Game } }).__retroRunner.game.scene.isActive(
          'Results',
        ),
      null,
      { timeout: 60_000 },
    );
    await page.waitForTimeout(400);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
    const s = await page.evaluate(() => {
      const w = window as unknown as {
        __retroRunner: { game: Phaser.Game };
        __perf: { listeners: number; audioNodes: number };
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
        anims: (g.anims as unknown as { anims: { size: number } }).anims.size,
      };
    });
    rows.push({ cycle: i, heapMB: Math.round(heap.usedSize / 1024 / 10.24) / 100, ...s });
    console.error(JSON.stringify(rows[rows.length - 1]));
    if (i < cycles) {
      await page.evaluate(() => {
        const w = window as unknown as { __retroRunner: { game: Phaser.Game } };
        (w.__retroRunner.game.scene.getScene('Results') as unknown as { choose(id: string): void }).choose(
          'retry',
        );
      });
      await page.waitForFunction(
        () =>
          (window as unknown as { __retroRunner: { game: Phaser.Game } }).__retroRunner.game.scene.isActive(
            'Race',
          ) &&
          !(window as unknown as { __retroRunner: { game: Phaser.Game } }).__retroRunner.game.scene.isActive(
            'Results',
          ),
      );
    }
  }
  console.log(JSON.stringify(rows, null, 1));
  await browser.close();
}

const run: Record<string, () => Promise<void>> = { boot, race, memory };
const fn = run[mode];
if (!fn) throw new Error(`unknown mode ${mode}`);
await fn();
