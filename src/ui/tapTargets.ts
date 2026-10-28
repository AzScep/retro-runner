/**
 * Menu tap targets (design 17.5): scenes register rectangles in game px, the touch layer converts a
 * canvas tap to game px and calls dispatchTap(). This is the only UI file src/touch imports, so it
 * stays free of Phaser values and of every other UI module.
 *
 * Rules:
 * - Targets belong to a scene and are removed automatically when that scene shuts down.
 * - Only running scenes (not paused, sleeping or stopped) take taps; the topmost running scene that
 *   has a target under the tap wins, so an overlay (Pause) shadows the scene below it.
 * - Scenes keep their own targets apart (17.5.2: neighbours never overlap). A tap that misses every
 *   rectangle still reaches the nearest target within TAP_SLOP px, which pads small targets outward
 *   where space allows without ever stealing a tap that lands inside a neighbour.
 * - Within a scene, a target registered later wins over an earlier one under the same point, so a
 *   confirmation dialog drawn over a list takes the tap while it is open.
 */
import type Phaser from 'phaser';

export interface TapRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Minimum tap rectangle and touch row pitch in game px (design 17.5.2, MENU_TAP_MIN). Phones in
 * landscape show 1.8-2.3 CSS px per game px, so 24 game px is 44 CSS px from 1.84 up (43 in an
 * iPhone Safari tab with both toolbars showing, the smallest scale measured).
 */
export const MENU_TAP_MIN = 24;

/** Smallest canvas scale (CSS px per game px) at which MENU_TAP_MIN still reaches 44 CSS px. */
export const MENU_TAP_MIN_SCALE = 44 / MENU_TAP_MIN;

/** Extra reach in game px for a tap that lands just outside every target. */
export const TAP_SLOP = 4;

/** Phaser's SHUTDOWN scene event name (a string, so this module needs no Phaser value import). */
const SHUTDOWN = 'shutdown';

interface Target {
  readonly scene: Phaser.Scene;
  readonly rect: TapRect;
  readonly onTap: () => void;
}

const targets: Target[] = [];
const watched = new WeakSet<Phaser.Scene>();

function remove(t: Target): void {
  const i = targets.indexOf(t);
  if (i >= 0) targets.splice(i, 1);
}

function watchShutdown(scene: Phaser.Scene): void {
  if (watched.has(scene)) return;
  watched.add(scene);
  scene.events.once(SHUTDOWN, () => {
    watched.delete(scene);
    for (let i = targets.length - 1; i >= 0; i--) if (targets[i]?.scene === scene) targets.splice(i, 1);
  });
}

/** Scenes register tap targets; removed automatically on scene shutdown. Returns an unregister function. */
export function registerTapTarget(scene: Phaser.Scene, rect: TapRect, onTap: () => void): () => void {
  const t: Target = {
    scene,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
    onTap,
  };
  targets.push(t);
  watchShutdown(scene);
  return () => remove(t);
}

/** Distance in px from a point to a rectangle (0 inside or on the edge). */
function distance(r: TapRect, x: number, y: number): number {
  const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - (r.x + r.w) : 0;
  const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0;
  return Math.hypot(dx, dy);
}

function sceneOrder(scene: Phaser.Scene): number {
  return scene.scene.getIndex();
}

/**
 * Touch calls this with a tap position in game px (after pointerup). Returns true if a target took
 * it. The handler runs synchronously, inside the caller's user-gesture handler.
 */
export function dispatchTap(x: number, y: number): boolean {
  let best: Target | null = null;
  let bestOrder = -Infinity;
  let bestDist = Infinity;
  for (const t of targets) {
    if (!t.scene.sys.isActive()) continue;
    const d = distance(t.rect, x, y);
    if (d > TAP_SLOP) continue;
    const order = sceneOrder(t.scene);
    // Ties go to the later registration, so a dialog opened over a list takes the tap.
    if (order > bestOrder || (order === bestOrder && d <= bestDist)) {
      best = t;
      bestOrder = order;
      bestDist = d;
    }
  }
  if (best === null) return false;
  best.onTap();
  return true;
}

/** Live targets of running scenes, for tests and the test hook. */
export function activeTapTargets(): readonly { readonly scene: string; readonly rect: TapRect }[] {
  return targets
    .filter((t) => t.scene.sys.isActive())
    .map((t) => ({ scene: t.scene.sys.settings.key, rect: t.rect }));
}
