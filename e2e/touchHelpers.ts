import type { CDPSession, Page } from '@playwright/test';

/**
 * Touch drivers for the mobile projects (research-mobile 6).
 *
 * Chromium: trusted multi-touch through CDP `Input.dispatchTouchEvent`, which also produces real
 * pointer events with distinct pointerIds, capture and hit testing. Spike result (Chromium in
 * Playwright 1.64.1): a `touchStart` / `touchMove` that omits an active finger does NOT lift it;
 * a `touchEnd` lists the fingers to lift (an empty `touchEnd` lifts every finger). The CDP
 * `timestamp` field is not carried into `event.timeStamp` (it arrives as 0), so it is never sent.
 *
 * WebKit: no CDP, so untrusted PointerEvents are dispatched in the page at the element under the
 * point. setPointerCapture throws for them, so a finger's later events go to the element it landed
 * on, which is what capture would do.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Control = 'L' | 'R' | 'jump' | 'pause';

export interface TouchDriver {
  down(id: number, at: Point): Promise<void>;
  move(id: number, at: Point): Promise<void>;
  up(id: number): Promise<void>;
  cancel(id: number): Promise<void>;
  /** One finger down and up at `at`. */
  tap(at: Point): Promise<void>;
}

class CdpTouch implements TouchDriver {
  private readonly active = new Map<number, Point>();
  private nextTapId = 1000;
  private readonly cdp: CDPSession;
  constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }

  private points(): { id: number; x: number; y: number }[] {
    return [...this.active].map(([id, p]) => ({ id, x: p.x, y: p.y }));
  }

  async down(id: number, at: Point): Promise<void> {
    this.active.set(id, at);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: this.points() });
  }

  async move(id: number, at: Point): Promise<void> {
    this.active.set(id, at);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: this.points() });
  }

  async up(id: number): Promise<void> {
    const p = this.active.get(id);
    if (!p) return;
    this.active.delete(id);
    await this.cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ id, x: p.x, y: p.y }],
    });
  }

  /** CDP cancels every active finger. */
  async cancel(_id: number): Promise<void> {
    this.active.clear();
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  }

  async tap(at: Point): Promise<void> {
    const id = this.nextTapId++;
    await this.down(id, at);
    await this.up(id);
  }
}

class SyntheticTouch implements TouchDriver {
  private nextTapId = 1000;
  private readonly page: Page;
  constructor(page: Page) {
    this.page = page;
  }

  private send(type: string, id: number, at: Point | null): Promise<void> {
    return this.page.evaluate(
      ({ type, id, at }) => {
        const w = window as unknown as { __touchEls?: Map<number, { el: Element; x: number; y: number }> };
        const els = (w.__touchEls ??= new Map());
        let entry = els.get(id);
        if (type === 'pointerdown' && at) {
          const el = document.elementFromPoint(at.x, at.y);
          if (!el) throw new Error(`nothing at ${at.x},${at.y}`);
          entry = { el, x: at.x, y: at.y };
          els.set(id, entry);
        }
        if (!entry) return;
        if (at) {
          entry.x = at.x;
          entry.y = at.y;
        }
        const init: PointerEventInit = {
          pointerId: id,
          pointerType: 'touch',
          isPrimary: els.size === 1,
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: entry.x,
          clientY: entry.y,
          button: type === 'pointermove' ? -1 : 0,
          buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
        };
        entry.el.dispatchEvent(new PointerEvent(type, init));
        if (type === 'pointerup' || type === 'pointercancel') els.delete(id);
      },
      { type, id, at },
    );
  }

  down(id: number, at: Point): Promise<void> {
    return this.send('pointerdown', id, at);
  }
  move(id: number, at: Point): Promise<void> {
    return this.send('pointermove', id, at);
  }
  up(id: number): Promise<void> {
    return this.send('pointerup', id, null);
  }
  cancel(id: number): Promise<void> {
    return this.send('pointercancel', id, null);
  }
  async tap(at: Point): Promise<void> {
    const id = this.nextTapId++;
    await this.down(id, at);
    await this.up(id);
  }
}

/** Trusted CDP touches on Chromium, synthetic pointer events elsewhere. */
export async function touchDriver(page: Page, browserName: string): Promise<TouchDriver> {
  if (browserName === 'chromium') return new CdpTouch(await page.context().newCDPSession(page));
  return new SyntheticTouch(page);
}

/** Centre of a touch control in viewport CSS px. */
export async function controlCenter(page: Page, c: Control): Promise<Point> {
  const box = await page.locator(`[data-touch="${c}"]`).boundingBox();
  if (!box) throw new Error(`touch control ${c} not visible`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A game-px point on the canvas in viewport CSS px. */
export async function gamePoint(page: Page, gx: number, gy: number): Promise<Point> {
  const box = await page.locator('#app canvas').boundingBox();
  if (!box) throw new Error('canvas not visible');
  return { x: box.x + (gx / 320) * box.width, y: box.y + (gy / 180) * box.height };
}

/**
 * A v2 save (design 16.2). Marco is beaten in the 100 m, which unlocks the hurdles (12.2); the
 * iPhone hint is dismissed unless `hintSeen` is false.
 */
export function v2Save(opts: { readonly hintSeen?: boolean; readonly lastEvent?: string } = {}): string {
  const fresh = { unlockedTier: 1, beaten: [], champion: false, best: {}, history: [] };
  return JSON.stringify({
    version: 2,
    lastEvent: opts.lastEvent ?? '100m',
    seenEvents: ['100m', '110mh'],
    hints: { addToHomeScreen: opts.hintSeen ?? true },
    settings: {
      volume: 8,
      muted: true,
      reducedFlashing: false,
      screenShake: true,
      crt: false,
      haptics: true,
    },
    events: {
      '100m': { ...fresh, unlockedTier: 4, beaten: ['pip', 'jess', 'marco'] },
      '110mh': fresh,
      '400m': fresh,
    },
  });
}

/** Writes `save` to localStorage before the game loads (every navigation in this page). */
export async function seedSave(page: Page, save: string): Promise<void> {
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('rr-seeded') === '1') return;
    localStorage.setItem('retroRunner.save.v2', s);
    sessionStorage.setItem('rr-seeded', '1');
  }, save);
}
