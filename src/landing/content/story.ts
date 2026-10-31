import { EVENT_IDS, LADDERS, OPPONENTS, PLAYER, meet } from '../../core/index.ts';
import type { StoryBeat, StoryCopy } from './types.ts';

// Tiers 1-6 only: tier 7 stays '???' on this page (design 30 is a surprise).
const SHOWN_TIERS = [1, 2, 3, 4, 5, 6] as const;

/** Venue and one beat per tier (stadium themes, design 5.8; quirks, 3.3 and 15.3-15.5). */
const BEATS: Readonly<Record<(typeof SHOWN_TIERS)[number], { venue: string; line: string }>> = {
  1: { venue: 'SCHOOLYARD, CHALK LINES', line: 'A GRASS TRACK, A WHISTLE AND A KID IN A HUGE CAP.' },
  2: { venue: 'HIGH SCHOOL TRACK AT DUSK', line: 'JESS FLIES OFF THE LINE. THEN GETS BORED.' },
  3: { venue: 'UNIVERSITY STADIUM', line: 'MARCO HAS TALENT. EFFORT, LESS SO.' },
  4: { venue: 'CITY STADIUM, FLOODLIGHTS', line: 'KOFI NEVER COASTS. WATCH THE LATE KICK.' },
  5: { venue: 'WORLD STADIUM AT SUNSET', line: 'VALENTINA OWNS THE SPRINTS. SOL OWNS THE LAP.' },
  6: { venue: 'CYBER ARENA, NEON BOARDS', line: 'UNIT-7 BOOTS UP SLOW. THEN IT NEVER STOPS.' },
};

function rivalsAt(tier: number): readonly string[] {
  const names = EVENT_IDS.map((e) => LADDERS[e][tier - 1]?.id)
    .filter((id) => id !== undefined)
    .map((id) => OPPONENTS[id].name);
  return [...new Set(names)];
}

const beats: readonly StoryBeat[] = SHOWN_TIERS.map((tier) => ({
  tier,
  meet: meet(tier).name,
  venue: BEATS[tier].venue,
  rivals: rivalsAt(tier),
  line: BEATS[tier].line,
}));

export const STORY: StoryCopy = {
  heading: { eyebrow: 'STAGE SELECT', title: `${PLAYER.name}'S CLIMB` },
  intro: [
    `THIS IS ${PLAYER.name}. RED SINGLET. YELLOW HEADBAND.`,
    'SIX RUNNERS A RACE. ONLY 1ST MOVES YOU UP.',
    'EVERY MEET, A RIVAL WITH A FASTER HAND.',
  ],
  beats,
  locked: {
    tier: '???',
    meet: '???',
    venue: 'NO SIGNAL',
    lines: ['THE LADDER ENDS AT THE NEON CUP.', 'EVERYONE SAYS SO.', 'EVERYONE.'],
  },
  outro: 'WIN A MEET TO UNLOCK THE NEXT.',
};
