/**
 * Section 1, the hero: the marquee title and pitch, the playable dash (J4's mountDash, which shows
 * its own title and how-to lines), and the coin-op PLAY button. On a first visit a BIOS log types over it.
 */
import { HERO, TERMINAL } from '../content/index.ts';
import type { Game } from '../hud/index.ts';
import { mountDash } from '../minigame/index.ts';
import { mountBoot } from './boot.ts';
import { el, playButton, typedLine } from './dom.ts';

export function mountHero(game: Game): HTMLElement {
  const host = el('div', { class: 'hero__host' });
  const copy = el(
    'div',
    { class: 'hero__copy' },
    typedLine('p', `${TERMINAL.prompt} ${HERO.kicker}`, 'rr-prompt', { keepCaret: true }),
    el('h1', { class: 'rr-marquee hero__title', text: HERO.headline, attrs: { id: 'top-title' } }),
    typedLine('p', HERO.tagline, 'hero__tagline'),
    el('p', { class: 'hero__subline', text: HERO.subline }),
  );
  // The dash draws its own RACE.EXE window: title bar, Pip's line and the how-to log (J4).
  const dash = el('div', { class: 'hero__dash' }, host);
  const cta = el(
    'div',
    { class: 'hero__cta' },
    playButton(HERO.playLabel, { sub: HERO.kicker, coin: true }),
    el('p', { class: 'rr-small rr-muted', text: HERO.platforms }),
  );
  const section = el(
    'section',
    { class: 'rr-section rr-backdrop--floodlit hero', attrs: { id: 'top', 'aria-labelledby': 'top-title' } },
    el('div', { class: 'rr-container hero__grid' }, copy, dash, cta),
  );
  mountDash(host, (e) => game.dash(e));
  mountBoot(section);
  return section;
}
