/**
 * Section 5, modes and records: the feature list as an OPTIONS.CFG window, and an arcade hi-score
 * table of the 100 m rivals' target times with Rio's empty row waiting at the bottom.
 */
import { CONTINUE, MODES, RIVALS } from '../content/index.ts';
import { el, playButton, section, sectionHead, statusTag } from './dom.ts';

function hiScores(): { name: string; time: string }[] {
  return RIVALS.rivals
    .flatMap((r) =>
      r.appearances
        .filter((a) => a.event === '100m')
        .map((a) => ({ name: r.name, tier: a.tier, time: a.target })),
    )
    .sort((a, b) => b.tier - a.tier);
}

function window_(title: string, body: HTMLElement): HTMLElement {
  return el(
    'div',
    { class: 'rr-panel rr-window' },
    el('p', { class: 'rr-window__bar', text: title }),
    el('div', { class: 'rr-window__body' }, body),
  );
}

export function mountModes(): HTMLElement {
  const { section: root, inner } = section('modes', 'modes');
  const features = el(
    'ul',
    { class: 'modes__list' },
    ...MODES.features.map((f) =>
      el(
        'li',
        { class: 'modes__item' },
        el('h3', { class: 'modes__title' }, f.title, ' ', statusTag(f.locked ? 'locked' : 'ok')),
        el('p', { text: f.line }),
        f.note ? el('p', { class: 'rr-small rr-muted', text: f.note }) : null,
      ),
    ),
  );
  const rows = hiScores();
  const table = el(
    'table',
    { class: 'rr-scores' },
    el('caption', { text: MODES.records.caption }),
    el(
      'thead',
      {},
      el('tr', {}, ...MODES.records.head.map((h) => el('th', { text: h, attrs: { scope: 'col' } }))),
    ),
    el(
      'tbody',
      {},
      ...rows.map((r, i) =>
        el(
          'tr',
          {},
          el('td', { text: String(i + 1) }),
          el('td', { text: r.name }),
          el('td', { text: r.time }),
        ),
      ),
      el(
        'tr',
        { class: 'modes__you' },
        el('td', { text: String(rows.length + 1) }),
        el('td', { text: RIVALS.player.name }),
        el('td', { text: MODES.records.playerTime }),
      ),
    ),
  );
  inner.append(
    sectionHead(MODES.heading.eyebrow, MODES.heading.title, 'modes-title'),
    el(
      'div',
      { class: 'modes__grid' },
      window_(MODES.window, features),
      window_(MODES.records.window, table),
    ),
    el('div', { class: 'section__cta' }, playButton(CONTINUE.playLabel)),
  );
  return root;
}
