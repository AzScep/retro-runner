/** Pure focus model shared by vertical menu lists and horizontal button rows. */

export interface MenuItem<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly enabled?: boolean;
}

export class MenuModel<Id extends string = string> {
  #items: readonly MenuItem<Id>[];
  #index: number;
  readonly wrap: boolean;

  constructor(items: readonly MenuItem<Id>[], initial: Id | null = null, wrap = true) {
    this.#items = items;
    this.wrap = wrap;
    const wanted = initial === null ? -1 : items.findIndex((i) => i.id === initial && i.enabled !== false);
    this.#index = wanted >= 0 ? wanted : items.findIndex((i) => i.enabled !== false);
  }

  get items(): readonly MenuItem<Id>[] {
    return this.#items;
  }

  /** Focused index, or -1 when nothing is enabled. */
  get index(): number {
    return this.#index;
  }

  get focused(): MenuItem<Id> | null {
    return this.#items[this.#index] ?? null;
  }

  /** Moves focus by +1/-1 over enabled items. Returns true if focus changed. */
  move(delta: 1 | -1): boolean {
    const n = this.#items.length;
    if (n === 0 || this.#index < 0) return false;
    let i = this.#index;
    for (let step = 0; step < n; step++) {
      i += delta;
      if (i < 0 || i >= n) {
        if (!this.wrap) return false;
        i = (i + n) % n;
      }
      if (this.#items[i]?.enabled !== false) {
        if (i === this.#index) return false;
        this.#index = i;
        return true;
      }
    }
    return false;
  }

  /** Enables or disables an item; focus leaves a disabled item for the first enabled one. */
  setEnabled(id: Id, enabled: boolean): void {
    this.#items = this.#items.map((it) => (it.id === id ? { ...it, enabled } : it));
    if (this.#items[this.#index]?.enabled === false) {
      this.#index = this.#items.findIndex((i) => i.enabled !== false);
    } else if (this.#index < 0) {
      this.#index = this.#items.findIndex((i) => i.enabled !== false);
    }
  }

  /** Focus a specific item by id if enabled. */
  focus(id: Id): boolean {
    const i = this.#items.findIndex((it) => it.id === id && it.enabled !== false);
    if (i < 0 || i === this.#index) return false;
    this.#index = i;
    return true;
  }
}
