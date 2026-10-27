import type {
  InputHub,
  JumpEvent,
  ModalityState,
  ModalityStore,
  RaceEvent,
  RaceFeed,
  RaceInput,
  RaceState,
} from '../index.ts';

// App-wide pub/sub singletons (contract "Input"). Engine-free, so touch and scenes can meet here
// without importing each other.

export function isJump(e: RaceInput): e is JumpEvent {
  return 'action' in e && e.action === 'jump';
}

/** Tiny listener set; a listener that throws does not stop the others. Snapshot per emit. */
function listeners<A extends unknown[]>(): {
  add(fn: (...a: A) => void): () => void;
  emit(...a: A): void;
} {
  const set = new Set<(...a: A) => void>();
  return {
    add(fn) {
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    emit(...a) {
      let first: unknown = null;
      for (const fn of [...set]) {
        try {
          fn(...a);
        } catch (err) {
          first ??= err;
        }
      }
      if (first !== null) throw first;
    },
  };
}

export function createInputHub(): InputHub {
  const l = listeners<[RaceInput]>();
  return { emit: (e) => l.emit(e), subscribe: (fn) => l.add(fn) };
}

export function createRaceFeed(): RaceFeed {
  const l = listeners<[RaceState | null, readonly RaceEvent[]]>();
  return { publish: (s, ev) => l.emit(s, ev), subscribe: (fn) => l.add(fn) };
}

export function createModalityStore(
  initial: ModalityState = { modality: 'keyboard', padsOverCanvas: false },
): ModalityStore {
  let state = initial;
  const l = listeners<[ModalityState]>();
  return {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch };
      if (next.modality === state.modality && next.padsOverCanvas === state.padsOverCanvas) return;
      state = next;
      l.emit(state);
    },
    subscribe: (fn) => l.add(fn),
  };
}

export const raceInput: InputHub = createInputHub();
export const raceFeed: RaceFeed = createRaceFeed();
export const modality: ModalityStore = createModalityStore();
