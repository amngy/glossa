import { useEffect, useState } from 'preact/hooks';

/** Minimal observable state container shared by a controller and its Preact views. */
export interface Store<T> {
  get(): T;
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const changes = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const key in changes) {
        if (!Object.is(changes[key], state[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...changes };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  const state = store.get();
  const [, setVersion] = useState(0);
  useEffect(() => {
    const update = () => setVersion((v) => v + 1);
    const unsubscribe = store.subscribe(update);
    // Effects run after rendering, so the store may already have changed.
    if (store.get() !== state) update();
    return unsubscribe;
  }, [store]);
  return state;
}
