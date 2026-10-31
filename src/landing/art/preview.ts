/**
 * Dev-only contact sheet of every landing asset: `npm run dev`, then open
 * /src/landing/art/preview.html. Shows each clip through PixelSprite and logs bake timings.
 */
import {
  characterAnims,
  characterFrames,
  eventIconUrl,
  hurdleJumpClip,
  LANDING_CHARACTERS,
  LANDING_EVENTS,
  LANDING_RIVALS,
  LANDING_TIERS,
  LANE_FEET_Y,
  laneOffsetPx,
  layerOffset,
  meetBadgeUrl,
  PixelSprite,
  portraitUrl,
  stadiumLayers,
  stadiumSceneUrl,
  STADIUM_HEIGHT,
  type SpriteClip,
} from './index.ts';
import { clipFrameAt } from './clip.ts';
import { toRGBA, type IndexMap } from '../../art/landing.ts';

const root = document.getElementById('root') as HTMLElement;
const timings: string[] = [];

function timed<T>(label: string, fn: () => T): T {
  const t0 = performance.now();
  const v = fn();
  timings.push(`${label}: ${(performance.now() - t0).toFixed(1)} ms`);
  return v;
}

function section(title: string): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  const row = document.createElement('div');
  row.className = 'row';
  root.append(h, row);
  return row;
}

function figure(row: HTMLElement, el: HTMLElement, caption: string, panel = true): void {
  const f = document.createElement('figure');
  if (panel) el.classList.add('panel');
  const c = document.createElement('figcaption');
  c.textContent = caption;
  f.append(el, c);
  row.append(f);
}

function img(src: string, alt: string): HTMLImageElement {
  const i = document.createElement('img');
  i.src = src;
  i.alt = alt;
  return i;
}

function sprite(row: HTMLElement, clip: SpriteClip, caption: string, scale = 2): void {
  figure(row, new PixelSprite(clip, { scale, label: caption }).canvas, caption);
}

// Hero mock: tier 1 parallax with Rio (lane 0) and Pip (lane 1) running side by side.
timed('hero mock (tier 1 layers + rio/pip run)', () => {
  const row = section('Hero mock: tier 1, Rio lane 0, Pip lane 1 (canvas, 2x)');
  const W = 320;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = STADIUM_HEIGHT;
  canvas.style.width = `${W * 2}px`;
  canvas.style.height = `${STADIUM_HEIGHT * 2}px`;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const bitmap = (m: IndexMap) => {
    const c = document.createElement('canvas');
    c.width = m.w;
    c.height = m.h;
    c.getContext('2d')?.putImageData(
      new ImageData(new Uint8ClampedArray(toRGBA(m).buffer as ArrayBuffer), m.w, m.h),
      0,
      0,
    );
    return c;
  };
  const layers = stadiumLayers(1).map((l) => ({ l, a: bitmap(l.map), b: l.alt ? bitmap(l.alt) : null }));
  const runners = (['rio', 'pip'] as const).map((id, lane) => ({
    lane,
    clip: characterFrames(id, 'run'),
    tiles: characterFrames(id, 'run').frames.map(bitmap),
  }));
  const t0 = performance.now();
  const frame = (now: number) => {
    const ms = now - t0;
    const scroll = Math.round(ms * 0.15);
    ctx.fillStyle = '#0b0b14';
    ctx.fillRect(0, 0, W, STADIUM_HEIGHT);
    for (const { l, a, b } of layers) {
      const tile = b && Math.floor(ms / 250) % 2 === 1 ? b : a;
      const off = layerOffset(l, scroll) % tile.width;
      for (let x = -off; x < W; x += tile.width) ctx.drawImage(tile, x, l.y);
    }
    for (const r of [...runners].reverse()) {
      const i = clipFrameAt(r.clip, ms, 14);
      const x = 96 + laneOffsetPx(r.lane);
      ctx.drawImage(r.tiles[i] as HTMLCanvasElement, x - 24, (LANE_FEET_Y[r.lane] as number) + 1 - 47);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  figure(row, canvas, 'stadiumLayers(1) + characterFrames run', false);
});

timed('all character clips (8 characters)', () => {
  for (const id of LANDING_CHARACTERS) {
    const row = section(`${id}: characterFrames (3x)`);
    for (const anim of characterAnims(id)) sprite(row, characterFrames(id, anim), anim, 3);
  }
});

timed('hurdle loops (7)', () => {
  const row = section('hurdleJumpClip (2x)');
  for (const id of LANDING_CHARACTERS.filter((c) => c !== 'sol')) {
    sprite(row, hurdleJumpClip(id as Exclude<typeof id, 'sol'>), id);
  }
});

timed('portraits (rio + 7 rivals + locked zyx, 2 sizes)', () => {
  // Locked silhouettes have an index 3 rim, made to read on index 2 panels (the page background).
  const row = section('portraitUrl: 48 at 3x, 16 at 3x, locked');
  for (const id of ['rio', ...LANDING_RIVALS] as const) {
    figure(row, img(portraitUrl(id, 48, false, 3), id), `${id} 48`);
    figure(row, img(portraitUrl(id, 16, false, 3), id), `${id} 16`);
    figure(row, img(portraitUrl(id, 48, true, 3), `${id} locked`), `${id} locked`, false);
  }
  figure(row, img(portraitUrl('zyx', 48, true, 3), '???'), 'zyx locked 48', false);
  figure(row, img(portraitUrl('zyx', 16, true, 3), '???'), 'zyx locked 16', false);
});

timed('meet badges and event icons', () => {
  const row = section('meetBadgeUrl 1-6 (4x), eventIconUrl 32 (3x) and 16 (3x)');
  for (const tier of LANDING_TIERS) figure(row, img(meetBadgeUrl(tier, 4), `meet ${tier}`), `meet ${tier}`);
  for (const ev of LANDING_EVENTS) {
    figure(row, img(eventIconUrl(ev, 32, 3), ev), `${ev} 32`);
    figure(row, img(eventIconUrl(ev, 16, 3), ev), `${ev} 16`);
  }
});

timed('stadium scenes 1-6', () => {
  const row = section('stadiumSceneUrl 1-6 (320x180 at 2x)');
  for (const tier of LANDING_TIERS) {
    figure(row, img(stadiumSceneUrl(tier, { scale: 2 }), `tier ${tier}`), `tier ${tier}`, false);
  }
});

document.getElementById('timings')!.textContent = timings.join('\n');
console.info(timings.join('\n'));
