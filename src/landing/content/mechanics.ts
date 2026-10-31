import { EVENTS, EVENT_LOCK_TEXT } from '../../core/index.ts';
import type { EventCartridge, MechanicsCopy } from './types.ts';

// Facts: design 0 and 2.2-2.5 (100 m), 13 (hurdles), 14 (400 m), unlocks 12.2.

const cartridges: readonly EventCartridge[] = [
  {
    event: '100m',
    label: EVENTS['100m'].short,
    title: EVENTS['100m'].name,
    hook: 'HONEST MASHING. NO SHORTCUTS.',
    facts: [
      'ONLY ALTERNATING PRESSES ADD SPEED.',
      'HOLDING, KEY REPEAT, SAME SIDE TWICE: NOTHING.',
      'JUMP THE GUN TWICE AND YOU ARE OUT.',
    ],
    controls: 'LEFT + RIGHT',
    raceLength: '10-20 SECONDS',
    unlock: ['READY TO PLAY'],
  },
  {
    event: '110mh',
    label: EVENTS['110mh'].short,
    title: EVENTS['110mh'].name,
    hook: 'TEN HURDLES. ONE JUMP BUTTON.',
    facts: [
      'UP OR W TO JUMP. TIME IT, DO NOT SPAM IT.',
      'A CLIP COSTS SPEED. A HIT COSTS A LOT MORE.',
      'KNOCK ONE DOWN AND YOU KEEP RUNNING.',
    ],
    controls: 'LEFT + RIGHT + UP',
    raceLength: '14-16 SECONDS',
    unlock: EVENT_LOCK_TEXT['110mh'],
  },
  {
    event: '400m',
    label: EVENTS['400m'].short,
    title: EVENTS['400m'].name,
    hook: 'ONE LAP. STAMINA DECIDES IT.',
    facts: [
      'MASH TOO FAST AND THE STAMINA METER DRAINS.',
      'RUN IT EMPTY AND YOUR LEGS TIE UP.',
      'STEADY BEATS FAST. SPLITS AT 100, 200, 300M.',
    ],
    controls: 'LEFT + RIGHT',
    raceLength: '50-60 SECONDS',
    unlock: EVENT_LOCK_TEXT['400m'],
  },
];

export const MECHANICS: MechanicsCopy = {
  heading: { eyebrow: 'EVENTS.EXE', title: '3 EVENTS. 3 SKILLS.' },
  intro: 'SAME MASH. A NEW TRICK EVERY EVENT.',
  cartridges,
  load: 'LOAD',
  eject: 'EJECT',
  labels: { controls: 'CONTROLS', length: 'RACE' },
};
