import type { StateStorage } from "zustand/middleware";

/**
 * Persistence adapter used by the Zustand store (see lib/store.ts).
 *
 * This is intentionally the ONLY place that talks to `window.localStorage`.
 * To move progress sync to a backend (Supabase, Firebase, a REST API...)
 * later, implement the same three methods against your backend instead —
 * e.g. `getItem` reads a row keyed by the signed-in user's id, `setItem`
 * upserts it, `removeItem` deletes it — and swap `localStorageAdapter` for
 * your implementation in the `persist(...)` call in lib/store.ts. Nothing
 * else in the app needs to change, since every component reads state
 * through the `useAppStore` hook, never through localStorage directly.
 */
let writesPaused = false;

/**
 * Runs `fn` without persisting any store change it makes. Used when switching the device's
 * active account (lib/workspace.ts): the in-memory store is cleared before the next owner's
 * data is loaded, and that momentary empty state must never overwrite anyone's saved data.
 */
export function withWritesPaused<T>(fn: () => T): T {
  writesPaused = true;
  try {
    return fn();
  } finally {
    writesPaused = false;
  }
}

export const localStorageAdapter: StateStorage = {
  getItem: (name) => {
    if (typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(name);
    } catch {
      // Storage can throw in private-browsing modes or when disabled.
      return null;
    }
  },
  setItem: (name, value) => {
    if (typeof window === "undefined" || writesPaused) return;
    try {
      window.localStorage.setItem(name, value);
    } catch {
      // Ignore quota / access errors — the app still works in-memory.
    }
  },
  removeItem: (name) => {
    if (typeof window === "undefined" || writesPaused) return;
    try {
      window.localStorage.removeItem(name);
    } catch {
      // no-op
    }
  },
};
