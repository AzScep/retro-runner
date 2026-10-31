/**
 * Contract of the hero dash (owner: J4). J5 mounts it into the hero section and turns its events
 * into HUD score and badges. This stub keeps the page compiling until J4 replaces the body.
 */

export type DashEvent =
  | { readonly type: 'start' }
  | { readonly type: 'falseStart' }
  | { readonly type: 'disqualified' }
  | {
      readonly type: 'finish';
      readonly won: boolean;
      /** A win by TUNING.PHOTO_FINISH_MS or less. */
      readonly photo: boolean;
      readonly youMs: number;
      readonly pipMs: number;
    };

export interface DashHandle {
  destroy(): void;
}

export function mountDash(host: HTMLElement, onEvent: (e: DashEvent) => void): DashHandle {
  void host;
  void onEvent;
  return { destroy() {} };
}
