/**
 * The hero dash (owner: J4): a playable 100 m against Pip, the game's own first race, run by the
 * real core Race and drawn with the game's art. J5 mounts it into the hero section and turns its
 * events into HUD score and badges. Rules: session.ts; page wiring: view.ts.
 */
import { DashView } from './view.ts';

export type DashEvent =
  | { readonly type: 'start' }
  | { readonly type: 'falseStart' }
  | { readonly type: 'disqualified' }
  | {
      readonly type: 'finish';
      /** 1st of the six runners (the game's win rule). Rio beat Pip when youMs < pipMs. */
      readonly won: boolean;
      /** A win by TUNING.PHOTO_FINISH_MS or less. */
      readonly photo: boolean;
      /** Rio's time; a DNF reports the event's 30 s cap. */
      readonly youMs: number;
      readonly pipMs: number;
    };

export interface DashHandle {
  destroy(): void;
}

/**
 * Renders the dash into `host` (it fills the host's width) and reports to `onEvent`: 'start' per
 * race, 'falseStart' per false start, 'disqualified' after the second, 'finish' when the result
 * card shows. Sound cues go to src/landing/audio playCue.
 */
export function mountDash(host: HTMLElement, onEvent: (e: DashEvent) => void): DashHandle {
  const view = new DashView(host, onEvent);
  return { destroy: () => view.destroy() };
}
