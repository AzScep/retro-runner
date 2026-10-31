import type { ModesCopy } from './types.ts';

// README "Why play" and design 0, 4, 16, 17, 29, 32.
export const MODES: ModesCopy = {
  heading: { eyebrow: 'OPTIONS', title: 'MODES + RECORDS' },
  features: [
    {
      title: 'GAUNTLET',
      line: 'EVERY MEET BACK TO BACK. LOSE ONCE, IT ENDS.',
      note: 'WIN THE NEON CUP FIRST',
    },
    { title: '1/100 TIMING', line: 'EVERY RACE TIMED TO THE HUNDREDTH.' },
    { title: 'PERSONAL BESTS', line: 'PBS, PLACINGS AND HISTORY SAVED IN YOUR BROWSER.' },
    { title: 'MEDALS', line: 'FINISH 2ND OR 3RD FOR SILVER OR BRONZE.' },
    { title: 'INSTANT RETRY', line: 'ONE KEY PRESS AND YOU ARE BACK ON THE BLOCKS.' },
    { title: 'PLAYS OFFLINE', line: 'ONCE IT HAS LOADED, NO CONNECTION NEEDED.' },
    {
      title: 'TOUCH READY',
      line: 'PHONES AND TABLETS IN LANDSCAPE. TAP TO RUN.',
      note: 'IPHONE: ADD TO HOME SCREEN FOR FULL SCREEN',
    },
  ],
};
