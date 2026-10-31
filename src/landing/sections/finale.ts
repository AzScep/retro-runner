/**
 * Section 6, the final CTA: an arcade CONTINUE? that counts down from 10 once it is in view, then
 * shows GAME OVER and its joke. PLAY stays put the whole time and nothing redirects. Reaching the
 * section earns reachedEnd. Under reduced motion the count does not tick: the end state shows.
 */
import { CONTINUE } from '../content/index.ts';
import { playCue } from '../audio/index.ts';
import type { Game } from '../hud/index.ts';
import { el, modalityLines, onceVisible, playButton, reducedMotion, typedLine } from './dom.ts';

const TICK_MS = 1000;

export function mountFinale(game: Game): HTMLElement {
  const number = el('p', {
    class: 'rr-countdown__number',
    text: String(CONTINUE.countFrom),
    attrs: { 'aria-hidden': 'true' },
  });
  const over = el('div', { class: 'finale__over' });
  const status = el('div', { class: 'finale__status', attrs: { 'aria-live': 'polite' } }, over);
  const play = playButton(CONTINUE.playLabel, {
    coin: true,
    sub: modalityLines(CONTINUE.playHint).join(' '),
  });
  const box = el(
    'div',
    { class: 'rr-container rr-countdown finale' },
    el('h2', { class: 'rr-marquee finale__title', text: CONTINUE.title, attrs: { id: 'continue-title' } }),
    el('div', { class: 'finale__slot' }, number, status),
    el(
      'div',
      { class: 'finale__lines' },
      ...CONTINUE.lines.map((l, i) => (i === 0 ? typedLine('p', l) : el('p', { text: l }))),
    ),
    play,
    el('p', { class: 'rr-small rr-muted', text: CONTINUE.smallPrint }),
  );
  const root = el(
    'section',
    {
      class: 'rr-section rr-backdrop--floodlit',
      attrs: { id: 'continue', 'aria-labelledby': 'continue-title' },
    },
    box,
  );

  // PRESS ENTER: with nothing else focused, Enter on the final screen presses PLAY.
  let inView = false;
  new IntersectionObserver((e) => (inView = e.some((x) => x.isIntersecting)), { threshold: 0.5 }).observe(
    box,
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && inView && document.activeElement === document.body && !e.defaultPrevented)
      play.click();
  });

  const gameOver = () => {
    number.classList.add('is-over');
    over.replaceChildren(
      el('p', { class: 'finale__game-over', text: CONTINUE.gameOver }),
      el('p', { text: CONTINUE.gameOverLine }),
    );
  };

  onceVisible(
    root,
    () => {
      game.earn('reachedEnd');
      if (reducedMotion()) {
        number.textContent = '0';
        gameOver();
        return;
      }
      let n = CONTINUE.countFrom;
      const timer = setInterval(() => {
        n--;
        number.textContent = String(n);
        playCue('countdown');
        if (n > 0) return;
        clearInterval(timer);
        gameOver();
      }, TICK_MS);
    },
    { threshold: 0.25 },
  );
  return root;
}
