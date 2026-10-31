/**
 * The sound toggle: a `button.rr-btn.rr-btn--secondary` with aria-pressed, the game's speaker
 * icon and the AUDIO_COPY label. The accessible name stays AUDIO_COPY.label; aria-pressed carries
 * the state, and the title (read as the description) spells it out as SOUND ON / SOUND OFF.
 */
import { AUDIO_COPY } from '../content/index.ts';
import type { Sound } from './sound.ts';
import './toggle.css';

/*
 * One-colour copies of the game's 16x16 speakerOn / speakerOff icons (src/art/sprites/icons.ts,
 * which src/art/landing.ts does not export), drawn at 2 px per art pixel.
 */
const SPEAKER = [
  '......##',
  '.....###',
  '....####',
  '########',
  '########',
  '########',
  '########',
  '########',
  '########',
  '########',
  '....####',
  '.....###',
  '......##',
];
const WAVES = [
  '........',
  '........',
  '....#...',
  '.#...#..',
  '..#..#..',
  '..#...#.',
  '.#.#..#.',
  '.#.#..#.',
  '.#.#..#.',
  '..#...#.',
  '..#..#..',
  '.#...#..',
  '....#...',
];
const CROSS = [
  '........',
  '........',
  '........',
  '.#...#..',
  '.##.##..',
  '..###...',
  '...#....',
  '..###...',
  '.##.##..',
  '.#...#..',
  '........',
  '........',
  '........',
];
const ICON_TOP = 1;

/** Rows of '#' to an SVG path of 1x1 squares, offset by (x0, y0). */
function pixelPath(rows: readonly string[], x0: number, y0: number): string {
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') d += `M${x0 + x} ${y0 + y}h1v1h-1z`;
  });
  return d;
}

const SPEAKER_D = pixelPath(SPEAKER, 0, ICON_TOP);
const WAVES_D = pixelPath(WAVES, 8, ICON_TOP);
const CROSS_D = pixelPath(CROSS, 8, ICON_TOP);
const SVG_NS = 'http://www.w3.org/2000/svg';

function icon(): { readonly svg: SVGSVGElement; readonly state: SVGPathElement } {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('rr-sound__icon');
  const body = document.createElementNS(SVG_NS, 'path');
  body.setAttribute('d', SPEAKER_D);
  const state = document.createElementNS(SVG_NS, 'path');
  svg.append(body, state);
  return { svg, state };
}

export function mountToggleButton(host: HTMLElement, sound: Sound): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rr-btn rr-btn--secondary rr-sound';
  button.setAttribute('aria-keyshortcuts', 'M');
  const { svg, state } = icon();
  const label = document.createElement('span');
  label.className = 'rr-sound__label';
  label.textContent = AUDIO_COPY.label;
  button.append(svg, label);

  const render = (on: boolean) => {
    button.setAttribute('aria-pressed', String(on));
    button.classList.toggle('is-pressed', on);
    button.title = `${on ? AUDIO_COPY.on : AUDIO_COPY.off} (M)`;
    state.setAttribute('d', on ? WAVES_D : CROSS_D);
  };
  render(sound.on);
  sound.subscribe(render);
  // Start the download on press, so the import is usually done by the time the click lands.
  button.addEventListener('pointerdown', () => sound.prefetch());
  button.addEventListener('click', () => sound.setOn(!sound.on));
  host.append(button);
}

/**
 * M toggles sound, except with a modifier, on auto-repeat, when another handler already took the
 * key (preventDefault), when typing in a field, or while focus is inside an element that captures
 * keys: the hero dash host marks itself with `data-rr-keys`, and a focused canvas counts too.
 */
export function togglesOnKey(e: KeyboardEvent): boolean {
  if (e.key !== 'm' && e.key !== 'M') return false;
  if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement || el instanceof SVGElement)) return true;
  if (el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return false;
  return !el.closest('[data-rr-keys], canvas');
}
