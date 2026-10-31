/**
 * PixelSprite: plays a SpriteClip on a <canvas> at its native size, upscaled by CSS at an integer
 * scale with `image-rendering: pixelated`, so every game pixel is a crisp scale x scale block.
 * All sprites share one requestAnimationFrame loop that runs only while a sprite is visible;
 * off-screen sprites (IntersectionObserver) stop drawing, and under prefers-reduced-motion each
 * sprite shows one still frame.
 */
import { toRGBA, type IndexMap } from '../../art/landing.ts';
import { clipFrameAt, type SpriteClip } from './clip.ts';

export interface PixelSpriteOptions {
  /** Integer CSS upscale (game px -> CSS px). */
  readonly scale: number;
  /** Playback rate; default the clip's own (e.g. the game runs `run` at clamp(2 v, 6, 25)). */
  readonly fps?: number;
  /** Frame shown under reduced motion and while paused (default 0). */
  readonly stillFrame?: number;
  /** Accessible name; without one the canvas is decorative (aria-hidden). */
  readonly label?: string;
}

const images = new WeakMap<IndexMap, ImageData>();

function imageOf(map: IndexMap): ImageData {
  let img = images.get(map);
  if (img === undefined) {
    img = new ImageData(new Uint8ClampedArray(toRGBA(map).buffer as ArrayBuffer), map.w, map.h);
    images.set(map, img);
  }
  return img;
}

// One shared ticker for every playing sprite.
const playing = new Set<PixelSprite>();
let rafId = 0;

function tick(now: number): void {
  for (const s of playing) s.draw(now);
  rafId = playing.size > 0 ? requestAnimationFrame(tick) : 0;
}

function setPlaying(s: PixelSprite, on: boolean): void {
  if (on) playing.add(s);
  else playing.delete(s);
  if (playing.size > 0 && rafId === 0) rafId = requestAnimationFrame(tick);
}

let reducedQuery: MediaQueryList | null | undefined;
function reducedMotion(): MediaQueryList | null {
  if (reducedQuery === undefined) {
    reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }
  return reducedQuery;
}

export class PixelSprite {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly opts: PixelSpriteOptions;
  private clip: SpriteClip;
  private fps: number;
  private startMs = 0;
  private shown = -1;
  private visible = true;
  private paused = false;
  private readonly observer: IntersectionObserver | null;
  private readonly onMotion = () => this.update();

  constructor(clip: SpriteClip, opts: PixelSpriteOptions) {
    if (!Number.isInteger(opts.scale) || opts.scale < 1) {
      throw new RangeError(`PixelSprite: scale must be a positive integer, got ${opts.scale}`);
    }
    this.opts = opts;
    this.clip = clip;
    this.fps = opts.fps ?? clip.fps;
    this.canvas = document.createElement('canvas');
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('PixelSprite: no 2D canvas context');
    this.ctx = ctx;
    this.canvas.style.imageRendering = 'pixelated';
    if (opts.label) {
      this.canvas.setAttribute('role', 'img');
      this.canvas.setAttribute('aria-label', opts.label);
    } else {
      this.canvas.setAttribute('aria-hidden', 'true');
    }
    this.resize();
    this.observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            const e = entries[entries.length - 1];
            if (e) this.visible = e.isIntersecting;
            this.update();
          })
        : null;
    this.observer?.observe(this.canvas);
    reducedMotion()?.addEventListener('change', this.onMotion);
    this.startMs = performance.now();
    this.update();
  }

  /** Swap the clip (e.g. idle -> celebrate) and restart it; `fps` defaults to the new clip's. */
  setClip(clip: SpriteClip, fps?: number): void {
    this.clip = clip;
    this.fps = fps ?? this.opts.fps ?? clip.fps;
    this.resize();
    this.restart();
  }

  /** Change the playback rate without restarting the cycle at frame 0 (keeps the current frame). */
  setFps(fps: number): void {
    const now = performance.now();
    const at = ((now - this.startMs) * this.fps) / 1000;
    this.fps = fps;
    this.startMs = fps > 0 ? now - (at * 1000) / fps : now;
  }

  /** Play from frame 0 (one-shot clips such as `lean` or `stumble`). */
  restart(): void {
    this.startMs = performance.now();
    this.shown = -1;
    this.update();
  }

  pause(): void {
    this.paused = true;
    this.update();
  }

  play(): void {
    if (this.paused) this.startMs = performance.now();
    this.paused = false;
    this.update();
  }

  destroy(): void {
    setPlaying(this, false);
    this.observer?.disconnect();
    reducedMotion()?.removeEventListener('change', this.onMotion);
  }

  /** Called by the shared ticker. */
  draw(now: number): void {
    this.show(clipFrameAt(this.clip, now - this.startMs, this.fps));
  }

  private resize(): void {
    const { w, h } = this.clip;
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.canvas.style.width = `${w * this.opts.scale}px`;
    this.canvas.style.height = `${h * this.opts.scale}px`;
    this.shown = -1;
  }

  private update(): void {
    const still = this.paused || reducedMotion()?.matches === true || this.clip.frames.length < 2;
    setPlaying(this, this.visible && !still);
    if (still) {
      const n = this.clip.frames.length;
      this.show(Math.max(0, Math.min(n - 1, this.opts.stillFrame ?? 0)));
    }
  }

  private show(i: number): void {
    if (i === this.shown) return;
    const map = this.clip.frames[i];
    if (!map) return;
    this.shown = i;
    this.ctx.putImageData(imageOf(map), 0, 0);
  }
}
