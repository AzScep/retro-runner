import { RIVALS } from './rivals.ts';
import type { TerminalCopy } from './types.ts';

// The DOS and arcade frame around the page (BIOS boot, C: prompts, status tags). No Unix idioms.
export const TERMINAL: TerminalCopy = {
  prompt: 'C:\\RUNNER>',
  boot: [
    'RETRO RUNNER BIOS V3.1',
    'CHECKING CONTROLLER... L+R OK',
    'LOADING SPRITES........ [OK]',
    `RIVALS FOUND: ${RIVALS.rivals.length}  UNKNOWN: 1`,
    '> INSERT COIN',
  ],
  tags: { ok: '[OK]', locked: '[LOCKED]', new: '[NEW]' },
};
