/**
 * Section 4, rival select: a character select grid of the seven rivals and the locked ??? card,
 * with a VS panel that sets Rio against the chosen rival (idle loop, a celebrate on pick) and the
 * rival's ladder times. Viewing every rival earns allRivals. Poking ??? only ever answers with
 * system errors and a silhouette; the last error earns `secret`. The ??? is never named or drawn.
 */
import { CONTINUE, RIVALS, TERMINAL, type RivalCard } from '../content/index.ts';
import { characterFrames, PixelSprite, portraitUrl, type LandingRivalId } from '../art/index.ts';
import { playCue } from '../audio/index.ts';
import { Checklist } from '../hud/badges.ts';
import type { Game } from '../hud/index.ts';
import { el, modalityLines, onApproach, playButton, section, sectionHead, statusTag } from './dom.ts';

const CELEBRATE_MS = 1600;
/** First rung each rival runs, for the card's stadium sky. */
const TIER = (r: RivalCard) => r.appearances[0]?.tier ?? 1;

export function mountRivals(game: Game): HTMLElement {
  const { section: root, inner } = section('rivals', 'rivals');
  const scouted = new Checklist(RIVALS.rivals.map((r) => r.id));
  const scale = matchMedia('(min-width: 768px)').matches ? 3 : 2;

  // ---- VS panel ----
  const rioStage = el('div', { class: 'rivals__stage rr-tier-1' });
  const foeStage = el('div', { class: 'rivals__stage' });
  const foeName = el('h3', { class: 'rivals__name' });
  const foeWho = el('p', { class: 'rr-label rr-muted rivals__who' });
  const info = el('div', { class: 'rivals__info', attrs: { id: 'rival-detail' } });
  const count = el('p', { class: 'rr-label rivals__count' });
  const panel = el(
    'div',
    { class: 'rr-panel rivals__panel' },
    el(
      'div',
      { class: 'rivals__vs' },
      el(
        'div',
        { class: 'rivals__side' },
        rioStage,
        el('p', { class: 'rivals__name rr-h3', text: RIVALS.player.name }),
        el('p', { class: 'rr-label rivals__p1', text: RIVALS.player.tag }),
        el('p', { class: 'rr-label rr-muted rivals__who', text: RIVALS.player.look }),
      ),
      el('p', { class: 'rivals__vs-label', text: RIVALS.labels.vs, attrs: { 'aria-hidden': 'true' } }),
      el('div', { class: 'rivals__side' }, foeStage, foeName, foeWho),
    ),
    info,
    count,
  );

  let foe: PixelSprite | null = null;
  let foeId: LandingRivalId | null = null;
  let artReady = false;
  let calm = 0;

  const drawFoe = (celebrate: boolean) => {
    if (!artReady) return;
    clearTimeout(calm);
    if (foeId === null) {
      foe?.destroy();
      foe = null;
      foeStage.replaceChildren(
        el('img', {
          class: 'rr-sprite is-silhouette rivals__silhouette',
          attrs: { src: portraitUrl('zyx', 48, true, 1), width: '48', height: '48', alt: '' },
        }),
      );
      return;
    }
    const id = foeId;
    const clip = characterFrames(id, celebrate ? 'celebrate' : 'idle');
    if (foe) foe.setClip(clip);
    else {
      foe = new PixelSprite(clip, { scale });
      foeStage.replaceChildren(foe.canvas);
    }
    if (celebrate) calm = window.setTimeout(() => foe?.setClip(characterFrames(id, 'idle')), CELEBRATE_MS);
  };

  const drawCount = () => {
    count.textContent = `${RIVALS.labels.scouted} ${scouted.count}/${scouted.total}`;
  };

  const showRival = (r: RivalCard) => {
    foeId = r.id as LandingRivalId;
    foeStage.className = `rivals__stage rr-tier-${TIER(r)}`;
    foeName.textContent = r.name;
    foeWho.textContent = r.who;
    info.replaceChildren(
      el('p', { class: 'rivals__quirk', text: r.quirk }),
      el(
        'p',
        { class: 'rr-label' },
        el('span', { class: 'rr-muted', text: `${RIVALS.labels.events} ` }),
        r.eventsLine,
      ),
      el(
        'table',
        { class: 'rr-scores rivals__times' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { text: RIVALS.labels.tier, attrs: { scope: 'col' } }),
            el('th', { text: RIVALS.labels.event, attrs: { scope: 'col' } }),
            el('th', { text: RIVALS.labels.target, attrs: { scope: 'col' } }),
          ),
        ),
        el(
          'tbody',
          {},
          ...r.appearances.map((a) =>
            el(
              'tr',
              {},
              el('td', { text: String(a.tier) }),
              el('th', { text: a.eventLabel, attrs: { scope: 'row' } }),
              el('td', { text: a.target }),
            ),
          ),
        ),
      ),
    );
    drawFoe(true);
  };

  let pokes = 0;
  const log = el('div', { class: 'rr-log rivals__log', attrs: { role: 'log' } });
  const showMystery = () => {
    foeId = null;
    foeStage.className = 'rivals__stage rivals__stage--locked';
    foeName.textContent = RIVALS.mystery.name;
    foeWho.textContent = RIVALS.mystery.who;
    const lines = RIVALS.mystery.pokeLines;
    const line = lines[Math.min(pokes, lines.length - 1)] ?? '';
    pokes++;
    log.append(el('p', { class: 'rr-log__line', text: `> ${line}` }));
    while (log.children.length > lines.length) log.firstElementChild?.remove();
    info.replaceChildren(
      el('p', { class: 'rivals__quirk', text: RIVALS.mystery.quirk }),
      el(
        'p',
        { class: 'rr-label' },
        el('span', { class: 'rr-muted', text: `${RIVALS.labels.events} ` }),
        RIVALS.mystery.eventsLine,
      ),
      log,
    );
    drawFoe(false);
    if (pokes >= lines.length) game.earn('secret');
  };

  // ---- Grid ----
  const cards: HTMLButtonElement[] = [];
  const tags = new Map<string, HTMLElement>();
  const select = (card: HTMLButtonElement, sound = true) => {
    for (const c of cards) {
      c.classList.toggle('is-selected', c === card);
      if (c.hasAttribute('aria-pressed')) c.setAttribute('aria-pressed', String(c === card));
    }
    if (sound) playCue('select');
  };

  const rivalCard = (r: RivalCard) => {
    const img = el('img', {
      class: 'rr-rival__portrait rr-sprite',
      attrs: { width: '48', height: '48', alt: '' },
    });
    const tag = statusTag('new');
    tags.set(r.id, tag);
    const card = el(
      'button',
      {
        class: `rr-rival rr-tier-${TIER(r)}`,
        attrs: { type: 'button', 'aria-pressed': 'false', 'aria-controls': 'rival-detail' },
      },
      el('span', { class: 'rr-rival__art' }, img),
      el(
        'span',
        { class: 'rr-rival__plate' },
        el('span', { class: 'rr-rival__name', text: r.name }),
        el('span', { class: 'rr-rival__meta' }, tag),
      ),
    );
    card.addEventListener('click', () => {
      select(card);
      showRival(r);
      tag.className = 'rr-tag rr-tag--ok';
      tag.textContent = TERMINAL.tags.ok;
      if (scouted.add(r.id)) game.earn('allRivals');
      drawCount();
      // The panel sits above the grid: bring it back into view when a lower card is picked.
      panel.scrollIntoView({ block: 'nearest' });
    });
    onApproach(card, () => (img.src = portraitUrl(r.id as LandingRivalId, 48, false, 1)));
    return card;
  };

  const mysteryCard = () => {
    const card = el(
      'button',
      {
        class: 'rr-rival rr-rival--locked',
        attrs: { type: 'button', 'aria-controls': 'rival-detail' },
      },
      el(
        'span',
        { class: 'rr-rival__art' },
        el('img', {
          class: 'rr-rival__portrait rr-sprite is-silhouette',
          attrs: { src: portraitUrl('zyx', 48, true, 1), width: '48', height: '48', alt: '' },
        }),
      ),
      el(
        'span',
        { class: 'rr-rival__plate' },
        el('span', { class: 'rr-rival__name', text: RIVALS.mystery.name }),
        el('span', { class: 'rr-rival__meta' }, statusTag('locked')),
      ),
    );
    card.addEventListener('click', () => {
      select(card);
      showMystery();
      card.classList.remove('is-glitching');
      void card.offsetWidth;
      card.classList.add('is-glitching');
      // The panel sits above the grid: bring it back into view when a lower card is picked.
      panel.scrollIntoView({ block: 'nearest' });
    });
    return card;
  };

  for (const r of RIVALS.rivals) cards.push(rivalCard(r));
  cards.push(mysteryCard());
  const grid = el('ul', { class: 'rr-rival-grid' }, ...cards.map((c) => el('li', {}, c)));

  // Arrow keys move a roving focus through the grid; Enter or Space views (native button click).
  cards.forEach((c, i) => (c.tabIndex = i === 0 ? 0 : -1));
  grid.addEventListener('keydown', (e) => {
    const i = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const to: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowLeft: i - 1,
      ArrowDown: i + cols,
      ArrowUp: i - cols,
      Home: 0,
      End: cards.length - 1,
    };
    const next = to[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = cards[Math.max(0, Math.min(cards.length - 1, next))] as HTMLButtonElement;
    cards.forEach((c) => (c.tabIndex = c === target ? 0 : -1));
    target.focus();
  });

  inner.append(
    sectionHead(RIVALS.heading.eyebrow, RIVALS.heading.title, 'rivals-title'),
    el('p', { class: 'rr-label rr-muted section__intro', text: modalityLines(RIVALS.prompt).join(' ') }),
    panel,
    grid,
    el('div', { class: 'section__cta' }, playButton(CONTINUE.playLabel)),
  );

  // Pip is on screen first, and counts as scouted.
  const first = RIVALS.rivals[0] as RivalCard;
  select(cards[0] as HTMLButtonElement, false);
  showRival(first);
  const firstTag = tags.get(first.id);
  if (firstTag) {
    firstTag.className = 'rr-tag rr-tag--ok';
    firstTag.textContent = TERMINAL.tags.ok;
  }
  scouted.add(first.id);
  drawCount();

  onApproach(panel, () => {
    artReady = true;
    rioStage.append(new PixelSprite(characterFrames('rio', 'idle'), { scale }).canvas);
    drawFoe(false);
  });
  return root;
}
