/**
 * Entry point of the /welcome/ landing page. A plain DOM page: it must never import Phaser, so the
 * page stays light and loads without the game bundle. Sections mount into #landing in page order.
 * Ownership of each folder: src/landing/README.md.
 */
import './styles/index.css';
import './sections/sections.css';
import { HERO } from './content/index.ts';
import { mountHud } from './hud/index.ts';
import { el, track } from './sections/dom.ts';
import { mountFinale } from './sections/finale.ts';
import { mountHero } from './sections/hero.ts';
import { mountMechanics } from './sections/mechanics.ts';
import { mountModes } from './sections/modes.ts';
import { mountRivals } from './sections/rivals.ts';
import { mountStory } from './sections/story.ts';

const root = document.getElementById('landing');
if (!root) throw new Error('#landing missing from welcome/index.html');

const SECTIONS = 6;
const { header, overlay, game } = mountHud(SECTIONS);
const sections = [
  mountHero(game),
  mountStory(game),
  mountMechanics(game),
  mountRivals(game),
  mountModes(),
  mountFinale(game),
];

// Skip link first in body, the status line pinned above main, the CRT overlay last.
document.body.prepend(
  el('a', { class: 'rr-skip-link', text: HERO.skipLink, attrs: { href: '#story' } }),
  header,
);
sections.forEach((s, i) => {
  if (i > 0) root.append(track(i === sections.length - 1));
  root.append(s);
  game.track(s);
});
document.body.append(...overlay, el('div', { class: 'rr-crt', attrs: { 'aria-hidden': 'true' } }));
