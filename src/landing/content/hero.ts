import { EVENT_COURSE, LADDERS, OPPONENTS } from '../../core/index.ts';
import type { DashCopy, HeroCopy } from './types.ts';

const pip = OPPONENTS.pip;
const pipFlavour = LADDERS['100m'][0]?.flavour ?? '';
const tip100 = EVENT_COURSE['100m'].firstRaceTip;

export const HERO: HeroCopy = {
  kicker: 'INSERT COIN',
  headline: 'RETRO RUNNER',
  tagline: 'YOUR HANDS SET THE PACE.',
  subline: '16-BIT TRACK AND FIELD. MASH LEFT + RIGHT TO RUN.',
  playLabel: 'PLAY NOW',
  platforms: 'KEYBOARD OR TOUCH. NO DOWNLOAD.',
  skipLink: 'SKIP THE DASH',
};

export const DASH: DashCopy = {
  program: 'RACE.EXE',
  title: `100M DASH VS ${pip.name}`,
  rivalLine: `${pip.name}: ${pipFlavour.toUpperCase()}`,
  howTo: {
    keyboard: [
      tip100?.keyboard ?? 'ALTERNATE LEFT + RIGHT',
      'OR A + D. HOLDING DOES NOTHING.',
      'WAIT FOR GO!',
    ],
    touch: [tip100?.touch ?? 'TAP LEFT, RIGHT, LEFT...', 'LEFT SIDE, RIGHT SIDE, REPEAT.', 'WAIT FOR GO!'],
  },
  startPrompt: { keyboard: 'PRESS ENTER TO RACE', touch: 'TAP TO RACE' },
  paused: { title: 'PAUSED', keyboard: 'PRESS ENTER TO RESUME', touch: 'TAP TO RESUME' },
  pads: { left: 'LEFT', right: 'RIGHT' },
  output: { complete: 'RACE.EXE COMPLETE', halted: 'RACE.EXE HALTED' },
  noTime: 'DNF',
  starter: { marks: 'ON YOUR MARKS', set: 'SET' },
  countdown: ['3', '2', '1', 'GO!'],
  mash: 'MASH!',
  alternate: 'ALTERNATE!',
  win: {
    title: `YOU BEAT ${pip.name}!`,
    line: (you, pipTime) => `YOU ${you}   ${pip.name} ${pipTime}`,
    cta: 'NOW TAKE ON THE LADDER',
  },
  photoFinish: {
    title: 'PHOTO FINISH',
    line: (you, pipTime) => `YOU ${you}   ${pip.name} ${pipTime}`,
    cta: 'TOO CLOSE. PLAY FOR REAL',
  },
  lose: {
    title: (winner) => `${winner} WINS!`,
    line: (you, pipTime) => `${pip.name} ${pipTime}   YOU ${you}`,
    cta: 'GET REVENGE IN THE GAME',
  },
  falseStart: { title: 'FALSE START!', line: 'ONE MORE AND YOU ARE OUT' },
  disqualified: { title: 'DISQUALIFIED', line: '2 FALSE STARTS. WAIT FOR GO!', cta: 'TRY AGAIN' },
  retryLabel: 'RUN AGAIN',
  // Touch has the RUN AGAIN button only: a tap on the race must never restart it by accident.
  retryHint: { keyboard: ['PRESS R TO RETRY'], touch: [] },
};
