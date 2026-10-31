import { EVENTS, EVENT_IDS, LADDERS, OPPONENTS, PLAYER, formatTime, meet } from '../../core/index.ts';
import type { OpponentId } from '../../core/index.ts';
import type { RivalAppearance, RivalCard, RivalsCopy } from './types.ts';

// Ladder order, with Sol after Valentina (both tier 5). Zyx is never shown (design 30).
const SHOWN: readonly OpponentId[] = ['pip', 'jess', 'marco', 'kofi', 'valentina', 'sol', 'unit7'];

function appearances(id: OpponentId): readonly RivalAppearance[] {
  return EVENT_IDS.flatMap((event) =>
    LADDERS[event]
      .filter((e) => e.id === id)
      .map((e) => ({
        event,
        eventLabel: EVENTS[event].short,
        tier: e.tier,
        meet: meet(e.tier).name,
        target: formatTime(e.targetMs),
        flavour: e.flavour.toUpperCase(),
      })),
  );
}

function card(id: OpponentId): RivalCard {
  const info = OPPONENTS[id];
  const runs = appearances(id);
  return {
    id,
    name: info.name,
    who: info.who.toUpperCase(),
    quirk: runs[0]?.flavour ?? '',
    eventsLine: runs.map((r) => r.eventLabel).join(' / '),
    appearances: runs,
  };
}

export const RIVALS: RivalsCopy = {
  heading: { eyebrow: 'RIVALS.EXE', title: 'SELECT YOUR RIVAL' },
  prompt: {
    keyboard: ['ARROWS: CHOOSE   ENTER: VIEW'],
    touch: ['TAP A RIVAL'],
  },
  player: { name: PLAYER.name, tag: 'PLAYER 1', look: 'RED SINGLET. YELLOW HEADBAND.' },
  rivals: SHOWN.map(card),
  mystery: {
    name: '???',
    who: 'UNKNOWN',
    quirk: 'NOT ON ANY LADDER. YET.',
    eventsLine: '???',
    pokeLines: [
      'ERROR 403: ACCESS DENIED.',
      'ERROR 0x7E: FILE CORRUPTED.',
      'FINISH 1ST AT THE NEON CUP.',
      'THEN WE TALK.',
    ],
  },
  labels: { tier: 'TIER', target: 'TO BEAT', events: 'EVENTS', vs: 'VS', scouted: 'SCOUTED' },
};
