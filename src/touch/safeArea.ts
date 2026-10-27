/**
 * Reads `env(safe-area-inset-*)` (non-zero only with `viewport-fit=cover`) through a hidden probe
 * element's computed padding. Used by main.ts to fit the canvas and by the touch layout.
 */
import type { Insets } from './layout.ts';

let probe: HTMLElement | null = null;

export function readSafeArea(doc: Document = document): Insets {
  if (!probe || !probe.isConnected) {
    probe = doc.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    doc.body.append(probe);
  }
  const cs = getComputedStyle(probe);
  const px = (v: string): number => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    top: px(cs.paddingTop),
    right: px(cs.paddingRight),
    bottom: px(cs.paddingBottom),
    left: px(cs.paddingLeft),
  };
}
