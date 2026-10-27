/**
 * The Zyx reveal timeline (design 30.2-30.3) as data, pure so it runs under Vitest.
 *
 * Times are seconds from CONTINUE (full) or from the cut to the stadium (short). The short version
 * keeps the full version's order and compresses steps 6-9 into 6.4 s: the sky in 0.5 s, a drone
 * every 0.3 s, then Zyx and one 1.4 s bubble, with the final card at 6.4 s.
 */

export type RevealVersion = 'full' | 'short';

export interface RevealBubble {
  readonly text: string;
  readonly at: number;
  readonly dur: number;
}

export interface RevealTimeline {
  readonly version: RevealVersion;
  /** Steps 1-5 (fake champion card, credits, interruption, WAIT.): full version only. */
  readonly card: {
    readonly creditsAt: number;
    readonly interruptAt: number;
    readonly glitchDur: number;
    readonly waitAt: number;
    readonly somethingAt: number;
  } | null;
  /** Step 6: cut to the tier 6 stadium. */
  readonly cutAt: number;
  /** Sky steps to tier 7 in `skySteps` steps of `skyStep` s (one step with reduced flashing). */
  readonly skySteps: number;
  readonly skyStep: number;
  /** Crowd hush over this long from the cut. */
  readonly hushDur: number;
  /** Step 7: one beam per lane 5, 4, 3, 2 at these times. */
  readonly drones: readonly { readonly lane: number; readonly at: number }[];
  /** A drone appears this long after its beam, and the beam goes this long after it appeared. */
  readonly beamLead: number;
  readonly beamHold: number;
  /** Step 8: Zyx warps into lane 1 (warp-in 0.3 s), then the bubbles. */
  readonly zyxAt: number;
  readonly warpDur: number;
  readonly bubbles: readonly RevealBubble[];
  /** Step 9: the final card. */
  readonly finalAt: number;
  /** Enter, Space, Esc or a tap skips to step 9 from this time on (30.3.1). */
  readonly skipAfter: number;
}

const DRONE_LANES = [5, 4, 3, 2] as const;

export function revealTimeline(version: RevealVersion, skipAfterMs: number): RevealTimeline {
  if (version === 'full') {
    return {
      version,
      card: { creditsAt: 1.5, interruptAt: 4.0, glitchDur: 0.4, waitAt: 4.6, somethingAt: 5.6 },
      cutAt: 6.6,
      skySteps: 4,
      skyStep: 0.25,
      hushDur: 1.0,
      drones: DRONE_LANES.map((lane, i) => ({ lane, at: 7.6 + i * 0.4 })),
      beamLead: 0.2,
      beamHold: 0.2,
      zyxAt: 9.2,
      warpDur: 0.3,
      bubbles: [
        { text: 'CUTE TROPHY.', at: 9.8, dur: 1.6 },
        { text: 'NOW RUN WITH US.', at: 11.4, dur: 1.6 },
      ],
      finalAt: 13.0,
      skipAfter: skipAfterMs / 1000,
    };
  }
  return {
    version,
    card: null,
    cutAt: 0,
    skySteps: 4,
    skyStep: 0.125,
    hushDur: 0.5,
    drones: DRONE_LANES.map((lane, i) => ({ lane, at: 0.5 + i * 0.3 })),
    beamLead: 0.15,
    beamHold: 0.15,
    zyxAt: 2.6,
    warpDur: 0.3,
    bubbles: [{ text: 'AGAIN?', at: 3.2, dur: 1.4 }],
    finalAt: 6.4,
    skipAfter: 0,
  };
}

/**
 * Sky step at time t: 0 (tier 6) at the cut, then one step every `skyStep` s up to `skySteps`
 * (tier 7). Reduced flashing changes it in one step at the end of that span.
 */
export function skyStepAt(tl: RevealTimeline, t: number, reducedFlashing: boolean): number {
  const since = t - tl.cutAt;
  if (since < 0) return 0;
  if (reducedFlashing) return since >= tl.skySteps * tl.skyStep ? tl.skySteps : 0;
  return Math.min(tl.skySteps, Math.floor(since / tl.skyStep + 1e-9));
}

/** The bubble on screen at time t, if any. */
export function bubbleAt(tl: RevealTimeline, t: number): RevealBubble | null {
  return tl.bubbles.find((b) => t >= b.at && t < b.at + b.dur) ?? null;
}
