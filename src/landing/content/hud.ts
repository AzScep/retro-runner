import { PLAYER } from '../../core/index.ts';
import type { Badge, HudCopy } from './types.ts';

const list: readonly Badge[] = [
  {
    id: 'ranDash',
    name: 'OFF THE BLOCKS',
    lockedName: 'OFF THE BLOCKS',
    how: 'RUN THE 60M DASH.',
    earned: 'YOU RAN THE DASH.',
    points: 100,
  },
  {
    id: 'beatPip',
    name: 'SPORTS DAY HERO',
    lockedName: 'SPORTS DAY HERO',
    how: 'BEAT PIP IN THE DASH.',
    earned: 'PIP IS WAVING TO MUM ANYWAY.',
    points: 300,
  },
  {
    id: 'falseStart',
    name: 'JUMPED THE GUN',
    lockedName: 'JUMPED THE GUN',
    how: 'FALSE START IN THE DASH.',
    earned: 'TOO KEEN. THE STARTER SAW THAT.',
    points: 50,
  },
  {
    id: 'allCarts',
    name: 'CART COLLECTOR',
    lockedName: 'CART COLLECTOR',
    how: 'OPEN ALL 3 EVENT CARTRIDGES.',
    earned: 'SPRINT, HURDLES, LAP. ALL LOADED.',
    points: 150,
  },
  {
    id: 'allRivals',
    name: 'SCOUTING REPORT',
    lockedName: 'SCOUTING REPORT',
    how: 'VIEW EVERY RIVAL CARD.',
    earned: 'YOU KNOW THEIR HABITS NOW.',
    points: 200,
  },
  {
    id: 'secret',
    name: 'WHAT WAS THAT?',
    lockedName: '???',
    how: 'SOMETHING ON THIS PAGE IS HIDING.',
    earned: 'THE TOP OF THE LADDER IS NOT THE TOP.',
    points: 500,
  },
  {
    id: 'reachedEnd',
    name: 'STAYED FOR CREDITS',
    lockedName: 'STAYED FOR CREDITS',
    how: 'REACH THE END OF THE PAGE.',
    earned: 'NOW PRESS PLAY.',
    points: 100,
  },
];

export const HUD: HudCopy = {
  player: `1UP ${PLAYER.name}`,
  score: 'SCORE',
  badges: 'BADGES',
  toastTitle: 'BADGE GET!',
  progress: (have, total) => `${have}/${total}`,
  allEarned: 'ALL BADGES! YOU ARE READY. PRESS PLAY.',
  list,
};
