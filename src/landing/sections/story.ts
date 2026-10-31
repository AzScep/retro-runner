/**
 * Section 2, the story: the meet ladder as a stage select. Nodes climb in one by one when the
 * ladder scrolls in (Sports Day first, the locked ??? last), and picking one shows its meet in the
 * story card with the stadium. Beating Pip in the dash marks Sports Day [OK].
 */
import { CONTINUE, RIVALS, STORY, type StoryBeat } from '../content/index.ts';
import {
  meetBadgeUrl,
  portraitUrl,
  stadiumSceneUrl,
  type LandingRivalId,
  type LandingTier,
} from '../art/index.ts';
import { playCue } from '../audio/index.ts';
import type { Game } from '../hud/index.ts';
import {
  el,
  onApproach,
  onceVisible,
  playButton,
  reducedMotion,
  section,
  sectionHead,
  statusTag,
} from './dom.ts';

const REVEAL_MS = 180;

function rivalId(name: string | undefined): LandingRivalId {
  const card = RIVALS.rivals.find((r) => r.name === name);
  return (card?.id ?? 'pip') as LandingRivalId;
}

interface Node {
  readonly li: HTMLLIElement;
  readonly pick: HTMLButtonElement;
  readonly meta: HTMLElement;
  readonly beat: StoryBeat | null;
}

export function mountStory(game: Game): HTMLElement {
  const { section: root, inner } = section('story', 'rr-backdrop--space story');
  const ladder = el('ol', { class: 'rr-ladder story__ladder' });

  // ---- Story card ----
  const scene = el('div', { class: 'story__scene' });
  const badge = el('img', { class: 'rr-sprite story__badge', attrs: { width: '32', height: '32', alt: '' } });
  const tier = el('span', { class: 'rr-label story__tier' });
  const meet = el('h3', { class: 'story__meet' });
  const venue = el('p', { class: 'rr-label rr-muted story__venue' });
  const rivals = el('p', { class: 'rr-label story__rivals' });
  const lines = el('div', { class: 'story__lines' });
  const card = el(
    'div',
    { class: 'rr-panel story__card', attrs: { id: 'story-card' } },
    scene,
    el('div', { class: 'story__card-head' }, badge, tier),
    meet,
    venue,
    rivals,
    lines,
    el('p', { class: 'rr-small rr-muted story__outro', text: STORY.outro }),
    el('div', { class: 'story__cta' }, playButton(CONTINUE.playLabel)),
  );
  let artReady = false;

  const nodes: Node[] = [];
  let selected: Node | undefined;

  const select = (n: Node, sound = true) => {
    selected = n;
    for (const o of nodes) o.pick.setAttribute('aria-pressed', String(o === n));
    const b = n.beat;
    tier.textContent = b ? `${RIVALS.labels.tier} ${b.tier}` : `${RIVALS.labels.tier} ${STORY.locked.tier}`;
    badge.hidden = b === null;
    if (b) badge.src = meetBadgeUrl(b.tier as LandingTier, 2);
    meet.textContent = b ? b.meet : STORY.locked.meet;
    meet.append(' ', b ? tagFor(b.tier) : statusTag('locked'));
    venue.textContent = b ? b.venue : STORY.locked.venue;
    rivals.textContent = b
      ? `${RIVALS.labels.vs} ${b.rivals.join(' + ')}`
      : `${RIVALS.labels.vs} ${RIVALS.mystery.name}`;
    lines.replaceChildren(...(b ? [b.line] : STORY.locked.lines).map((t) => el('p', { text: t })));
    drawScene();
    if (sound) playCue('select');
  };

  const drawScene = () => {
    if (!artReady || !selected) return;
    const b = selected.beat;
    scene.classList.toggle('story__scene--locked', b === null);
    if (b === null) {
      scene.replaceChildren(el('span', { class: 'rr-label', text: STORY.locked.venue }));
      return;
    }
    scene.replaceChildren(
      el('img', {
        class: 'rr-sprite',
        attrs: { src: stadiumSceneUrl(b.tier as LandingTier), width: '320', height: '180', alt: '' },
      }),
    );
  };

  // Rio's place on the ladder: Sports Day until Pip is beaten on this page.
  const current = () => (game.has('beatPip') ? 2 : 1);
  const tagFor = (t: number): HTMLElement | string =>
    t < current() ? statusTag('ok') : t === current() ? statusTag('new') : '';

  const drawStates = () => {
    for (const n of nodes) {
      const t = n.beat?.tier;
      n.li.classList.toggle('rr-ladder__node--beaten', t !== undefined && t < current());
      n.li.classList.toggle('rr-ladder__node--current', t === current());
      n.meta.querySelector('.rr-tag')?.remove();
      const tag = t === undefined ? statusTag('locked') : tagFor(t);
      if (tag) n.meta.append(' ', tag);
    }
    if (selected) select(selected, false);
  };

  const addNode = (beat: StoryBeat | null) => {
    const li = el('li', { class: `rr-ladder__node story__node${beat ? '' : ' rr-ladder__node--locked'}` });
    const img = el('img', {
      class: `rr-ladder__portrait rr-sprite${beat ? '' : ' is-silhouette'}`,
      attrs: { width: '16', height: '16', alt: '' },
    });
    const name = el('span', { class: 'rr-ladder__name', text: beat ? beat.meet : STORY.locked.meet });
    const meta = el('span', {
      class: 'rr-ladder__meta',
      text: beat ? beat.rivals.join(' + ') : STORY.locked.venue,
    });
    const pick = el(
      'button',
      {
        class: 'story__pick',
        attrs: { type: 'button', 'aria-pressed': 'false', 'aria-controls': 'story-card' },
      },
      el('span', { class: `rr-ladder__frame rr-tier-${beat?.tier ?? 7}` }, img),
      el('span', { class: 'story__text' }, name, meta),
    );
    li.append(pick);
    ladder.append(li);
    const n: Node = { li, pick, meta, beat };
    nodes.push(n);
    pick.addEventListener('click', () => select(n));
    onApproach(li, () => {
      img.src = beat ? portraitUrl(rivalId(beat.rivals[0]), 16, false, 1) : portraitUrl('zyx', 16, true, 1);
    });
  };
  for (const b of STORY.beats) addNode(b);
  addNode(null);

  inner.append(
    sectionHead(STORY.heading.eyebrow, STORY.heading.title, 'story-title'),
    el('div', { class: 'story__intro' }, ...STORY.intro.map((t) => el('p', { text: t }))),
    el('div', { class: 'story__grid' }, ladder, card),
  );

  const start = nodes.find((n) => n.beat?.tier === current()) ?? (nodes[0] as Node);
  drawStates();
  select(start, false);
  game.onEarn((id) => {
    if (id === 'beatPip') drawStates();
  });

  onApproach(card, () => {
    artReady = true;
    drawScene();
  });

  // Climb: reveal the nodes in race order once the ladder is on screen.
  if (!reducedMotion()) {
    for (const n of nodes) n.li.classList.add('is-pending');
    onceVisible(
      ladder,
      () => nodes.forEach((n, i) => setTimeout(() => n.li.classList.remove('is-pending'), i * REVEAL_MS)),
      { threshold: 0.25 },
    );
  }
  return root;
}
