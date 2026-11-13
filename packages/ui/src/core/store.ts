import { useSyncExternalStore } from 'react';

/** Minimal external store (no dependencies). The game loop never goes through React. */
export class Store<T extends object> {
  private listeners = new Set<() => void>();
  constructor(private state: T) {}
  get(): T {
    return this.state;
  }
  set(patch: Partial<T> | ((s: T) => Partial<T>)): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l();
  }
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export function useStore<T extends object, S>(store: Store<T>, select: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => select(store.get()), () => select(store.get()));
}
