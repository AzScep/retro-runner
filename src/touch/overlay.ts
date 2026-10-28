/**
 * DOM for the touch controls (design 17.4, 17.6): invisible run/jump zones, pixel-art pad images,
 * the pause button, the rotate prompt and the Add to Home Screen hint.
 *
 * Nothing here takes focus (tabIndex -1), so the keyboard keeps driving the game. Pad art comes
 * from ART's `touchArtUrl` at an integer scale, shown with nearest-neighbour scaling.
 */
import { rotatePhoneUrl, touchArtUrl, type TouchArtId } from '../art/index.ts';
import type { Rect, TouchLayout } from './layout.ts';
import type { PadFrame } from './padState.ts';
import type { Control } from './pointerMap.ts';

const PAD_ART: Readonly<Record<Control, TouchArtId>> = { L: 'padL', R: 'padR', jump: 'padJump' };
const PAD_ART_W = 64;
const PAUSE_ART_W = 16;
const ROTATE_ART_W = 32;
const ROTATE_CSS = 128;

/** ART caches the data URLs per (id, state, scale). */
const art = touchArtUrl;
/** Rotate prompt: 4 frames at 4 fps (design 17.6). */
const ROTATE_FRAME_MS = 250;
/**
 * The hint opens on the release of a Title tap. iOS fires its compatibility click right after that
 * release at the same point, which may now be the OK button: ignore OK this soon after opening.
 */
const HINT_OK_GUARD_MS = 250;
/**
 * Add to Home Screen copy, 24 characters per line at most (200 game px panel). Safari's compact tab
 * bar (iOS 26) keeps Share behind the `...` button, hence both routes.
 */
export const HINT_LINES: readonly string[] = [
  'FOR FULL SCREEN, TAP',
  'SHARE (OR ... > SHARE)',
  '> ADD TO HOME SCREEN',
];

/** Integer art scale that covers `cssW` CSS px on this screen without upscaling blur. */
function artScale(cssW: number, artW: number): number {
  return Math.max(1, Math.ceil((cssW * window.devicePixelRatio) / artW));
}

function place(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

export class Overlay {
  readonly root: HTMLElement;
  readonly zones: Readonly<Record<Control, HTMLElement>>;
  readonly pause: HTMLButtonElement;
  private readonly pads: Readonly<Record<Control, HTMLImageElement>>;
  /** 1 px border drawn instead of the art frame when the pads are over the canvas (27.6.4). */
  private readonly frames: Readonly<Record<Control, HTMLElement>>;
  private readonly pauseImg: HTMLImageElement;
  private readonly rotate: HTMLElement;
  private readonly rotateImg: HTMLImageElement;
  private readonly hintBackdrop: HTMLElement;
  private readonly hintPanel: HTMLElement;
  private padScale: Record<Control, number> = { L: 1, R: 1, jump: 1 };
  private pauseScale = 1;
  private gamePx = 1;
  private readonly shown: Record<Control, string> = { L: '', R: '', jump: '' };
  private pausePressed = false;
  private rotateTimer = 0;
  private rotateFrame = 0;

  constructor(doc: Document) {
    const root = doc.createElement('div');
    root.className = 'touch-root';
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    const zone = (c: Control): HTMLElement => {
      const el = doc.createElement('div');
      el.className = 'touch-zone';
      el.dataset['touch'] = c;
      el.setAttribute('aria-hidden', 'true');
      root.append(el);
      return el;
    };
    this.zones = { L: zone('L'), R: zone('R'), jump: zone('jump') };

    const pad = (c: Control): HTMLImageElement => {
      const img = doc.createElement('img');
      img.className = 'touch-pad';
      img.dataset['pad'] = c;
      img.alt = '';
      img.draggable = false;
      root.append(img);
      return img;
    };
    this.pads = { L: pad('L'), R: pad('R'), jump: pad('jump') };
    const frame = (c: Control): HTMLElement => {
      const el = doc.createElement('div');
      el.className = 'touch-pad-frame';
      el.dataset['padFrame'] = c;
      el.setAttribute('aria-hidden', 'true');
      root.append(el);
      return el;
    };
    this.frames = { L: frame('L'), R: frame('R'), jump: frame('jump') };

    this.pause = doc.createElement('button');
    this.pause.type = 'button';
    this.pause.className = 'touch-pause';
    this.pause.dataset['touch'] = 'pause';
    this.pause.tabIndex = -1;
    this.pause.setAttribute('aria-label', 'Pause');
    this.pauseImg = doc.createElement('img');
    this.pauseImg.alt = '';
    this.pauseImg.draggable = false;
    this.pause.append(this.pauseImg);
    root.append(this.pause);

    this.rotate = doc.createElement('div');
    this.rotate.className = 'touch-rotate';
    this.rotate.setAttribute('role', 'alert');
    this.rotateImg = doc.createElement('img');
    this.rotateImg.alt = '';
    this.rotateImg.draggable = false;
    const rotateText = doc.createElement('p');
    rotateText.textContent = 'ROTATE YOUR DEVICE';
    rotateText.style.margin = '0';
    this.rotate.append(this.rotateImg, rotateText);
    this.rotate.addEventListener('contextmenu', (e) => e.preventDefault());

    this.hintBackdrop = doc.createElement('div');
    this.hintBackdrop.className = 'touch-hint-backdrop';
    this.hintPanel = doc.createElement('div');
    this.hintPanel.className = 'touch-hint';
    this.hintPanel.setAttribute('role', 'dialog');
    this.hintPanel.setAttribute('aria-label', 'Add to Home Screen');
    this.hintBackdrop.append(this.hintPanel);

    this.root = root;
    doc.body.append(root, this.hintBackdrop, this.rotate);
  }

  applyLayout(l: TouchLayout, gamePx: number, hurdles: boolean): void {
    this.gamePx = gamePx;
    for (const c of ['L', 'R'] as const) place(this.zones[c], l.zones[c]);
    if (l.zones.jump) place(this.zones.jump, l.zones.jump);
    for (const c of ['L', 'R', 'jump'] as const) {
      const r = c === 'jump' ? l.pads.jump : l.pads[c];
      if (!r) continue;
      place(this.pads[c], r);
      place(this.frames[c], r);
      // Over the canvas a pad is a thin frame (27.6.4); in a bar it is the full art.
      const over = c === 'jump' ? l.jumpOverCanvas : l.padsOverCanvas;
      this.pads[c].dataset['over'] = over ? 'canvas' : 'bar';
      this.frames[c].dataset['over'] = over ? 'canvas' : 'bar';
      this.padScale[c] = artScale(r.w, PAD_ART_W);
      this.shown[c] = '';
    }
    place(this.pause, l.pause);
    this.pauseImg.style.width = `${l.pauseIcon}px`;
    this.pauseImg.style.height = `${l.pauseIcon}px`;
    this.pauseScale = artScale(l.pauseIcon, PAUSE_ART_W);
    this.renderPause();
    this.root.classList.toggle('hurdles', hurdles);
    this.root.dataset['pads'] = l.padsOverCanvas ? 'canvas' : 'bars';
    this.root.dataset['placement'] = l.placement;
  }

  /** Pad images and visibility for one frame. */
  render(frame: PadFrame, showPause: boolean): void {
    this.root.classList.toggle('live', frame.live);
    this.root.classList.toggle('show-pause', showPause);
    this.root.classList.toggle('hurdles', frame.hurdles);
    if (!frame.live) return;
    for (const c of ['L', 'R', 'jump'] as const) {
      const state = frame.pads[c];
      const key = `${state}:${this.padScale[c]}`;
      const img = this.pads[c];
      if (this.shown[c] !== key) {
        img.src = art(PAD_ART[c], state, this.padScale[c]);
        img.dataset['state'] = state;
        this.frames[c].dataset['state'] = state;
        this.shown[c] = key;
      }
      const dx = frame.shake[c] * this.gamePx;
      img.style.transform = dx === 0 ? '' : `translateX(${dx}px)`;
      this.frames[c].style.transform = img.style.transform;
    }
  }

  setPausePressed(pressed: boolean): void {
    if (this.pausePressed === pressed) return;
    this.pausePressed = pressed;
    this.pause.classList.toggle('pressed', pressed);
    this.renderPause();
  }

  private renderPause(): void {
    this.pauseImg.src = art('pause', this.pausePressed ? 'pressed' : 'idle', this.pauseScale);
  }

  /** Shows or hides the rotate prompt; the phone turns in 4 frames unless `still` (reduced flashing or motion). */
  setRotate(visible: boolean, still: boolean): void {
    const win = this.rotate.ownerDocument.defaultView;
    const scale = artScale(ROTATE_CSS, ROTATE_ART_W);
    const draw = (): void => {
      this.rotateImg.src = rotatePhoneUrl(this.rotateFrame as 0 | 1 | 2 | 3, scale);
    };
    win?.clearInterval(this.rotateTimer);
    this.rotateTimer = 0;
    this.rotateFrame = 0;
    if (visible) {
      draw();
      if (!still && win) {
        this.rotateTimer = win.setInterval(() => {
          this.rotateFrame = (this.rotateFrame + 1) % 4;
          draw();
        }, ROTATE_FRAME_MS);
      }
    }
    this.rotate.classList.toggle('visible', visible);
  }

  get hintVisible(): boolean {
    return this.hintBackdrop.classList.contains('visible');
  }

  /** The one-time hint panel at game (60, 100), 200 game px wide. */
  showHint(canvas: Rect, gamePx: number, onOk: () => void): void {
    const doc = this.hintPanel.ownerDocument;
    this.hintPanel.replaceChildren();
    for (const line of HINT_LINES) {
      const p = doc.createElement('p');
      p.textContent = line;
      this.hintPanel.append(p);
    }
    const ok = doc.createElement('button');
    ok.type = 'button';
    ok.tabIndex = -1;
    ok.textContent = 'OK';
    ok.dataset['touch'] = 'hint-ok';
    // Release closes it like every other tap in the game (click covers mouse and keyboard).
    const shownAt = performance.now();
    const close = (): void => {
      if (!this.hintVisible || performance.now() - shownAt < HINT_OK_GUARD_MS) return;
      this.hintBackdrop.classList.remove('visible');
      onOk();
    };
    ok.addEventListener('pointerup', close);
    ok.addEventListener('click', close);
    this.hintPanel.append(ok);
    this.hintPanel.style.left = `${Math.round(canvas.x + 60 * gamePx)}px`;
    this.hintPanel.style.top = `${Math.round(canvas.y + 100 * gamePx)}px`;
    this.hintPanel.style.width = `${Math.round(200 * gamePx)}px`;
    this.hintPanel.style.minHeight = `${Math.round(64 * gamePx)}px`;
    this.hintBackdrop.classList.add('visible');
  }

  destroy(): void {
    this.setRotate(false, true);
    this.root.remove();
    this.rotate.remove();
    this.hintBackdrop.remove();
  }
}
