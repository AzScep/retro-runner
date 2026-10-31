/**
 * Section 3, the mechanics: one game cartridge per event, each with a looping sprite of the
 * event's skill (run, hurdle jump, the 400 m tie-up). LOAD opens a cartridge's rules; loading all
 * three earns allCarts.
 */
import { CONTINUE, MECHANICS, TERMINAL, type EventCartridge } from '../content/index.ts';
import type { EventId } from '../../core/index.ts';
import { characterFrames, hurdleJumpClip, PixelSprite, type SpriteClip } from '../art/index.ts';
import { playCue } from '../audio/index.ts';
import { Checklist } from '../hud/badges.ts';
import type { Game } from '../hud/index.ts';
import { el, onApproach, playButton, section, sectionHead, statusTag } from './dom.ts';

const LOOK: Readonly<Record<EventId, { mod: string; tier: number; clip: () => SpriteClip }>> = {
  '100m': { mod: '100m', tier: 1, clip: () => characterFrames('rio', 'run') },
  '110mh': { mod: 'hurdles', tier: 3, clip: () => hurdleJumpClip('rio') },
  '400m': { mod: '400m', tier: 5, clip: () => characterFrames('rio', 'tired') },
};

export function mountMechanics(game: Game): HTMLElement {
  const { section: root, inner } = section('mechanics', 'mechanics');
  const opened = new Checklist(MECHANICS.cartridges.map((c) => c.event));
  const grid = el('ul', { class: 'rr-cart-grid' }, ...MECHANICS.cartridges.map((c) => cartridge(c)));

  function cartridge(c: EventCartridge): HTMLLIElement {
    const look = LOOK[c.event];
    const bodyId = `cart-${c.event}`;
    const art = el('div', { class: `rr-cart__art mech__art mech__art--${look.mod} rr-tier-${look.tier}` });
    const tag = statusTag('new');
    const title = el('h3', { class: 'rr-cart__title' }, el('span', { text: c.title }), ' ', tag);
    const toggle = el('button', {
      class: 'rr-btn rr-btn--secondary mech__toggle',
      text: MECHANICS.load,
      attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId },
    });
    const keys = c.controls.split(' + ').map((k) => el('span', { class: 'rr-key', text: k }));
    const body = el(
      'div',
      { class: 'mech__body', attrs: { id: bodyId } },
      el(
        'ul',
        { class: 'mech__facts' },
        ...c.facts.map((f) => el('li', { class: 'rr-cart__text', text: f })),
      ),
      el(
        'dl',
        { class: 'mech__stats' },
        el('dt', { class: 'rr-label', text: MECHANICS.labels.controls }),
        el('dd', { class: 'mech__keys' }, ...keys),
        el('dt', { class: 'rr-label', text: MECHANICS.labels.length }),
        el('dd', { class: 'rr-cart__text', text: c.raceLength }),
      ),
      el('p', { class: 'mech__sticker rr-label' }, ...c.unlock.flatMap((l, i) => [i ? el('br') : null, l])),
    );
    body.hidden = true;
    toggle.addEventListener('click', () => {
      const open = body.hidden === true;
      body.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? MECHANICS.eject : MECHANICS.load;
      playCue('select');
      if (!open) return;
      tag.className = 'rr-tag rr-tag--ok';
      tag.textContent = TERMINAL.tags.ok;
      if (opened.add(c.event)) game.earn('allCarts');
    });
    const li = el(
      'li',
      { class: `rr-cart rr-cart--${look.mod}` },
      el('div', { class: 'rr-cart__label' }, art, title),
      el('p', { class: 'rr-cart__text mech__hook', text: c.hook }),
      toggle,
      body,
    );
    onApproach(li, () => art.append(new PixelSprite(look.clip(), { scale: 2 }).canvas));
    return li;
  }

  inner.append(
    sectionHead(MECHANICS.heading.eyebrow, MECHANICS.heading.title, 'mechanics-title'),
    el('p', { class: 'section__intro', text: MECHANICS.intro }),
    grid,
    el('div', { class: 'section__cta' }, playButton(CONTINUE.playLabel)),
  );
  return root;
}
