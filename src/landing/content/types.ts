import type { EventId, OpponentId } from '../../core/index.ts';

// Shapes of the landing page copy. Every line is display-ready (upper case for the pixel font) unless
// its field says otherwise.

export interface PageMeta {
  /** <title>, sentence case. */
  readonly title: string;
  readonly description: string;
  readonly ogTitle: string;
  readonly ogDescription: string;
  readonly siteName: string;
  /** Canonical and og:url. */
  readonly url: string;
  /** The game, relative to /welcome/. */
  readonly playHref: string;
}

export interface ModalityLines {
  readonly keyboard: readonly string[];
  readonly touch: readonly string[];
}

export interface HeroCopy {
  readonly kicker: string;
  readonly headline: string;
  readonly tagline: string;
  readonly subline: string;
  readonly playLabel: string;
  /** Short platform line under the CTA. */
  readonly platforms: string;
}

export interface DashResult {
  readonly title: string;
  /** Times arrive formatted, e.g. '09.84'. */
  readonly line: (youTime: string, pipTime: string) => string;
  readonly cta: string;
}

export interface DashCopy {
  readonly title: string;
  readonly rivalLine: string;
  readonly howTo: ModalityLines;
  readonly startPrompt: { readonly keyboard: string; readonly touch: string };
  /** Starter bubbles: at "3" and "2", then at "1". */
  readonly starter: { readonly marks: string; readonly set: string };
  readonly countdown: readonly [string, string, string, string];
  /** Key prompt while nothing is pressed, and after repeated same-side presses. */
  readonly mash: string;
  readonly alternate: string;
  readonly win: DashResult;
  /** A win by 50 ms or less (design 39.1.10). */
  readonly photoFinish: DashResult;
  readonly lose: DashResult;
  readonly falseStart: { readonly title: string; readonly line: string };
  readonly disqualified: { readonly title: string; readonly line: string; readonly cta: string };
  readonly retryLabel: string;
  readonly retryHint: ModalityLines;
}

export interface SectionHeading {
  readonly eyebrow: string;
  readonly title: string;
}

export interface StoryBeat {
  readonly tier: number;
  readonly meet: string;
  readonly venue: string;
  /** Named rivals at this tier across the three events, in event order, no repeats. */
  readonly rivals: readonly string[];
  readonly line: string;
}

export interface StoryLockedNode {
  readonly tier: '???';
  readonly meet: '???';
  readonly venue: string;
  readonly lines: readonly string[];
}

export interface StoryCopy {
  readonly heading: SectionHeading;
  readonly intro: readonly string[];
  readonly beats: readonly StoryBeat[];
  readonly locked: StoryLockedNode;
  readonly outro: string;
}

export interface EventCartridge {
  readonly event: EventId;
  /** 'HURDLES' */
  readonly label: string;
  /** '110 METRES HURDLES' */
  readonly title: string;
  readonly hook: string;
  readonly facts: readonly string[];
  readonly controls: string;
  readonly raceLength: string;
  /** Lines shown as the cartridge's unlock sticker. */
  readonly unlock: readonly string[];
}

export interface MechanicsCopy {
  readonly heading: SectionHeading;
  readonly intro: string;
  readonly cartridges: readonly EventCartridge[];
}

export interface RivalAppearance {
  readonly event: EventId;
  /** '100M', 'HURDLES', '400M' */
  readonly eventLabel: string;
  readonly tier: number;
  readonly meet: string;
  /** Formatted target time, e.g. '1:12.00'. */
  readonly target: string;
  /** The ladder card flavour line for this event. */
  readonly flavour: string;
}

export interface RivalCard {
  readonly id: OpponentId;
  readonly name: string;
  /** Upper-cased `who`, e.g. 'PRIMARY SCHOOL STUDENT'. */
  readonly who: string;
  /** Headline quirk: the flavour of the rival's first event. */
  readonly quirk: string;
  /** '100M / HURDLES / 400M' */
  readonly eventsLine: string;
  readonly appearances: readonly RivalAppearance[];
}

export interface MysteryCard {
  readonly name: '???';
  readonly who: string;
  readonly quirk: string;
  readonly eventsLine: string;
  /** Shown when the card is poked; the secret badge hangs off this card. */
  readonly pokeLines: readonly string[];
}

export interface PlayerCard {
  readonly name: string;
  readonly tag: string;
  readonly look: string;
}

export interface RivalsCopy {
  readonly heading: SectionHeading;
  readonly prompt: ModalityLines;
  readonly player: PlayerCard;
  readonly rivals: readonly RivalCard[];
  readonly mystery: MysteryCard;
  readonly labels: {
    readonly tier: string;
    readonly target: string;
    readonly events: string;
    readonly vs: string;
  };
}

export interface FeatureLine {
  readonly title: string;
  readonly line: string;
  /** Optional small print, e.g. an unlock condition. */
  readonly note?: string;
}

export interface ModesCopy {
  readonly heading: SectionHeading;
  readonly features: readonly FeatureLine[];
}

export interface ContinueCopy {
  readonly title: string;
  readonly countFrom: number;
  readonly lines: readonly string[];
  readonly playLabel: string;
  readonly playHint: ModalityLines;
  /** Shown when the count reaches 0; the button stays. */
  readonly gameOver: string;
  readonly gameOverLine: string;
  readonly smallPrint: string;
}

export type BadgeId =
  'ranDash' | 'beatPip' | 'falseStart' | 'allCarts' | 'allRivals' | 'secret' | 'reachedEnd';

export interface Badge {
  readonly id: BadgeId;
  readonly name: string;
  /** Shown before the badge is earned; '???' hides a secret. */
  readonly lockedName: string;
  /** How to earn it, shown in the badge list. */
  readonly how: string;
  /** Toast line when earned. */
  readonly earned: string;
  readonly points: number;
}

export interface HudCopy {
  readonly player: string;
  readonly score: string;
  readonly badges: string;
  readonly toastTitle: string;
  /** e.g. '3/7' */
  readonly progress: (have: number, total: number) => string;
  readonly allEarned: string;
  readonly list: readonly Badge[];
}

export interface AudioCopy {
  readonly on: string;
  readonly off: string;
  readonly label: string;
}
