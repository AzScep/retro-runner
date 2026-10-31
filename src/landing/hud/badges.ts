/**
 * Badge and score rules of the landing page game layer. Pure: no DOM and no storage, so the HUD
 * (index.ts) and the tests share one source of truth. The score is the sum of earned badge points.
 */
import type { Badge, BadgeId } from '../content/index.ts';
import type { DashEvent } from '../minigame/index.ts';

/** Earned badges, in the order they were earned. */
export class BadgeBook {
  private readonly list: readonly Badge[];
  private readonly earned: BadgeId[] = [];

  constructor(list: readonly Badge[], saved: readonly BadgeId[] = []) {
    this.list = list;
    for (const id of saved) this.earn(id);
  }

  has(id: BadgeId): boolean {
    return this.earned.includes(id);
  }

  /** Marks `id` earned. Returns the badge when it is new, or null if it was already earned. */
  earn(id: BadgeId): Badge | null {
    const badge = this.list.find((b) => b.id === id);
    if (badge === undefined || this.has(id)) return null;
    this.earned.push(id);
    return badge;
  }

  get ids(): readonly BadgeId[] {
    return this.earned;
  }

  get count(): number {
    return this.earned.length;
  }

  get total(): number {
    return this.list.length;
  }

  get complete(): boolean {
    return this.count === this.total;
  }

  get score(): number {
    return this.list.reduce((sum, b) => sum + (this.has(b.id) ? b.points : 0), 0);
  }
}

/** The badge a hero dash event earns, if any (a disqualification already earned falseStart). */
export function dashBadge(e: DashEvent): BadgeId | null {
  switch (e.type) {
    case 'start':
      return 'ranDash';
    case 'falseStart':
      return 'falseStart';
    case 'finish':
      // Ahead of Pip, not 1st: a field runner can win the race while Rio still beats Pip.
      return e.youMs < e.pipMs ? 'beatPip' : null;
    case 'disqualified':
      return null;
  }
}

/** Saved badge ids from storage. Anything malformed or unknown is dropped, never thrown. */
export function parseSaved(raw: string | null, list: readonly Badge[]): BadgeId[] {
  if (raw === null) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const known = new Set<string>(list.map((b) => b.id));
  return [...new Set(data.filter((v): v is BadgeId => typeof v === 'string' && known.has(v)))];
}

export function serialize(book: BadgeBook): string {
  return JSON.stringify(book.ids);
}

/** Six-digit arcade score, so the HUD never changes width. Clamped to 0-999999. */
export function scoreDigits(score: number): string {
  return String(Math.max(0, Math.min(999_999, Math.round(score)))).padStart(6, '0');
}

/** Score shown `elapsedMs` into a count-up from `from` to `to`: whole steps, done at `durationMs`. */
export function countUp(from: number, to: number, elapsedMs: number, durationMs: number): number {
  if (durationMs <= 0 || elapsedMs >= durationMs) return to;
  const t = Math.max(0, elapsedMs) / durationMs;
  return Math.round(from + (to - from) * t);
}

/** Collects the ids of a set (cartridges opened, rivals viewed); `add` says when it is complete. */
export class Checklist<T> {
  private readonly all: readonly T[];
  private readonly seen = new Set<T>();

  constructor(all: readonly T[]) {
    this.all = all;
  }

  /** Records `id`; true exactly once, on the call that completes the set. */
  add(id: T): boolean {
    if (!this.all.includes(id) || this.seen.has(id)) return false;
    this.seen.add(id);
    return this.seen.size === this.all.length;
  }

  has(id: T): boolean {
    return this.seen.has(id);
  }

  get count(): number {
    return this.seen.size;
  }

  get total(): number {
    return this.all.length;
  }
}
