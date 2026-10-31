/** Frame loops shared by the art API (index.ts) and PixelSprite. Pure. */
import type { IndexMap } from '../../art/landing.ts';

/** A frame loop: same-size maps, played at `fps`, looping or held on the last frame. */
export interface SpriteClip {
  readonly frames: readonly IndexMap[];
  readonly fps: number;
  readonly loop: boolean;
  readonly w: number;
  readonly h: number;
  /** Feet position in the frame (place the clip so this pixel sits on the ground row + 1). */
  readonly pivotX: number;
  readonly pivotY: number;
}

/** Frame index of `clip` `ms` after it started (loops wrap, one-shots hold the last frame). */
export function clipFrameAt(clip: SpriteClip, ms: number, fps: number = clip.fps): number {
  const n = Math.max(0, Math.floor((ms * fps) / 1000));
  return clip.loop ? n % clip.frames.length : Math.min(n, clip.frames.length - 1);
}
