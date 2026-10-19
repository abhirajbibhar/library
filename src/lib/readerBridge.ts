import { useSyncExternalStore } from 'react';

/**
 * Small link between the reader page and the site header: the header shows a Refresh button on the
 * reader page and the reader tells it when it is busy or has unsaved changes.
 */
interface BridgeState {
  active: boolean; // a reader page is open
  busy: boolean; // syncing or saving
  dirty: boolean; // annotations not saved yet
}

let state: BridgeState = { active: false, busy: false, dirty: false };
const listeners = new Set<() => void>();

export const readerBridge = {
  /** Set by the reader: pulls the latest annotations and progress from your other devices. */
  refresh: null as null | (() => void),
  set(change: Partial<BridgeState>) {
    const next = { ...state, ...change };
    if (next.active === state.active && next.busy === state.busy && next.dirty === state.dirty) return;
    state = next;
    listeners.forEach((l) => l());
  },
};

export function useReaderBridge(): BridgeState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
