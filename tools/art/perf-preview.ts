/**
 * Frame-time probe for the art preview (v3: 6 lanes, 60 hurdles, officials):
 *
 *   npx vite build --config tools/art/vite.preview.config.ts
 *   npx vite preview --config tools/art/vite.preview.config.ts      (port 5198)
 *   node tools/art/perf-preview.ts [--throttle 4] [--query 'event=110mh&opp=marco'] [--seconds 14]
 *
 * Same counters as tools/perf/measure.ts race: Phaser step CPU (PRE_STEP to POST_RENDER), rAF
 * interval, WebGL draw calls and texture binds per frame. Headless Chromium renders with SwiftShader.
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? def) : def;
};
const throttle = Number(opt('throttle', '1'));
const query = opt('query', 'event=110mh&opp=marco');
const seconds = Number(opt('seconds', '14'));

function instrument(): void {
  const c = { draws: 0, binds: 0 };
  (window as unknown as Record<string, unknown>)['__gl'] = c;
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
}

const browser = await chromium.launch({ headless: !args.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
await page.addInitScript(instrument);
if (throttle > 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
}
await page.goto(`http://localhost:5198/tools/art/preview.html?${query}`);
await page.waitForFunction(() => (window as unknown as { __game?: unknown }).__game !== undefined);
const out = await page.evaluate(async (ms: number) => {
  const w = window as unknown as {
    __game: { events: { on: (e: string, f: () => void) => void } };
    __gl: { draws: number; binds: number };
  };
  const steps: number[] = [];
  const raf: number[] = [];
  const draws: number[] = [];
  const binds: number[] = [];
  let t0 = 0;
  let d0 = 0;
  let b0 = 0;
  w.__game.events.on('prestep', () => {
    t0 = performance.now();
    d0 = w.__gl.draws;
    b0 = w.__gl.binds;
  });
  w.__game.events.on('postrender', () => {
    steps.push(performance.now() - t0);
    draws.push(w.__gl.draws - d0);
    binds.push(w.__gl.binds - b0);
  });
  let last = performance.now();
  const end = last + ms;
  await new Promise<void>((resolve) => {
    const f = (t: number) => {
      raf.push(t - last);
      last = t;
      if (t < end) requestAnimationFrame(f);
      else resolve();
    };
    requestAnimationFrame(f);
  });
  const q = (v: number[], k: number) =>
    [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor(k * v.length))] ?? 0;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    frames: raf.length,
    stepP50: r(q(steps, 0.5)),
    stepP99: r(q(steps, 0.99)),
    stepMax: r(Math.max(...steps)),
    rafP50: r(q(raf, 0.5)),
    rafMax: r(Math.max(...raf.slice(5))),
    dropped: raf.slice(5).filter((x) => x > (1000 / 60) * 1.5).length,
    dropAt: raf.flatMap((x, i) => (i >= 5 && x > 25 ? [[i, Math.round(x)]] : [])),
    drawsP50: q(draws, 0.5),
    bindsP50: q(binds, 0.5),
    bindsMax: Math.max(...binds),
  };
}, seconds * 1000);
console.log(JSON.stringify({ throttle, query, ...out }));
await browser.close();
