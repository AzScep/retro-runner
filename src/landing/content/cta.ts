import { PLAYER } from '../../core/index.ts';
import type { ContinueCopy } from './types.ts';

export const CONTINUE: ContinueCopy = {
  title: 'CONTINUE?',
  countFrom: 10,
  lines: [`${PLAYER.name} IS STILL ON THE BLOCKS.`, 'THE STARTER IS WAITING.'],
  playLabel: 'PLAY',
  playHint: { keyboard: ['PRESS ENTER'], touch: ['TAP TO PLAY'] },
  gameOver: 'GAME OVER',
  gameOverLine: 'JUST KIDDING. THE TRACK IS STILL OPEN.',
  smallPrint: 'RUNS IN YOUR BROWSER. KEYBOARD OR TOUCH.',
};
