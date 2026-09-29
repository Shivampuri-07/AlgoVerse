import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { localStorageAdapter } from "@/lib/storage-adapter";
import { computeStreak } from "@/lib/streak";
import { todayKey, isoToDateKey } from "@/lib/utils";
import {
  EMPTY_LEGACY,
  collectActiveDates,
  migrateStarterProgress,
  type ProgressLike,
} from "@/lib/migrate-progress";
import type { CompletedMap, LegacyProgress, ProgressExport, StreakState } from "@/lib/types";

export const STORAGE_KEY = "dsa-roadmap-storage";
/**
 * Bump when the meaning of stored ids changes.
 *   0/1 = original 152-problem starter dataset
 *   2   = A2Z dataset (data/a2zProblems.ts)
 */
export const STORAGE_VERSION = 2;
const EMPTY_STREAK: StreakState = { current: 0, longest: 0, lastActiveDate: null, activeDates: [] };

interface AppState {
  completed: CompletedMap;
  bookmarked: number[];
  notes: Record<number, string>;
  mistakes: Record<number, string>;
  code: Record<number, string>;
  streak: StreakState;
  /** Progress from an older dataset with no identical problem here — never discarded. */
  legacy: LegacyProgress;
  /** Most recently opened problem id, for "Continue where I left off". */
  lastVisitedId: number | null;
  /** Whether persisted state has finished loading from storage (client only). */
  hydrated: boolean;

  toggleCompleted: (id: number) => void;
  setCompleted: (id: number, value: boolean) => void;
  toggleBookmark: (id: number) => void;
  isBookmarked: (id: number) => boolean;
  setNote: (id: number, text: string) => void;
  setMistakes: (id: number, text: string) => void;
  setCode: (id: number, text: string) => void;
  markVisited: (id: number) => void;
  resetProgress: () => void;
  exportProgress: () => ProgressExport;
  /** Returns how many items were migrated from an old-format file (0 for current files). */
  importProgress: (data: ProgressExport) => { migrated: number; keptAsLegacy: number };
  setHydrated: (value: boolean) => void;
  /**
   * Cloud sync (lib/sync/engine.ts): applies merged cloud state. Only the given fields change;
   * the streak is recomputed from completions, keeping the larger longest streak.
   */
  applySync: (patch: SyncPatch) => void;
}

export interface SyncPatch {
  completed?: CompletedMap;
  bookmarked?: number[];
  notes?: Record<number, string>;
  mistakes?: Record<number, string>;
  code?: Record<number, string>;
  legacy?: LegacyProgress;
  longestStreak?: number;
}

function streakFrom(completed: CompletedMap, legacy: LegacyProgress, previous: StreakState): StreakState {
  const activeDates = collectActiveDates(completed, legacy);
  const { current, longest } = computeStreak(activeDates);
  return {
    current,
    longest: Math.max(longest, previous.longest ?? 0),
    lastActiveDate: activeDates.length ? activeDates[activeDates.length - 1] : null,
    activeDates,
  };
}

/** Turn a v0/v1 (starter dataset) persisted blob into v2 state. */
function migrateStarterState(persisted: ProgressLike) {
  const m = migrateStarterProgress(persisted);
  const previousStreak = persisted.streak ?? EMPTY_STREAK;
  return {
    completed: m.completed,
    bookmarked: m.bookmarked,
    notes: m.notes,
    mistakes: m.mistakes,
    code: m.code,
    legacy: m.legacy,
    lastVisitedId: m.lastVisitedId,
    streak: streakFrom(m.completed, m.legacy, previousStreak),
  };
}

/** Stores non-empty text; clearing a note removes its key instead of keeping "". */
function withText(map: Record<number, string>, id: number, text: string): Record<number, string> {
  if (text.trim()) return { ...map, [id]: text };
  if (!(id in map)) return map;
  const next = { ...map };
  delete next[id];
  return next;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      completed: {},
      bookmarked: [],
      notes: {},
      mistakes: {},
      code: {},
      streak: EMPTY_STREAK,
      legacy: EMPTY_LEGACY,
      lastVisitedId: null,
      hydrated: false,

      toggleCompleted: (id) => {
        const isDone = Boolean(get().completed[id]);
        get().setCompleted(id, !isDone);
      },

      setCompleted: (id, value) => {
        set((state) => {
          const completed = { ...state.completed };
          if (value) {
            completed[id] = new Date().toISOString();
          } else {
            delete completed[id];
          }
          return { completed, streak: streakFrom(completed, state.legacy, state.streak) };
        });
      },

      toggleBookmark: (id) => {
        set((state) => {
          const has = state.bookmarked.includes(id);
          return {
            bookmarked: has
              ? state.bookmarked.filter((b) => b !== id)
              : [...state.bookmarked, id],
          };
        });
      },

      isBookmarked: (id) => get().bookmarked.includes(id),

      setNote: (id, text) => {
        set((state) => ({ notes: withText(state.notes, id, text) }));
      },

      setMistakes: (id, text) => {
        set((state) => ({ mistakes: withText(state.mistakes, id, text) }));
      },

      setCode: (id, text) => {
        set((state) => ({ code: withText(state.code, id, text) }));
      },

      markVisited: (id) => set({ lastVisitedId: id }),

      resetProgress: () =>
        set({
          completed: {},
          bookmarked: [],
          notes: {},
          mistakes: {},
          code: {},
          streak: EMPTY_STREAK,
          legacy: EMPTY_LEGACY,
          lastVisitedId: null,
        }),

      exportProgress: () => {
        const state = get();
        return {
          version: 2,
          dataset: "a2z-v2",
          exportedAt: new Date().toISOString(),
          completed: state.completed,
          bookmarked: state.bookmarked,
          notes: state.notes,
          mistakes: state.mistakes,
          code: state.code,
          streak: state.streak,
          legacy: state.legacy,
        };
      },

      importProgress: (data) => {
        const isCurrent = data.dataset === "a2z-v2" || data.version === 2;
        if (isCurrent) {
          const legacy = data.legacy ?? EMPTY_LEGACY;
          const completed = data.completed ?? {};
          set({
            completed,
            bookmarked: data.bookmarked ?? [],
            notes: data.notes ?? {},
            mistakes: data.mistakes ?? {},
            code: data.code ?? {},
            legacy,
            streak: streakFrom(completed, legacy, data.streak ?? EMPTY_STREAK),
          });
          return { migrated: 0, keptAsLegacy: 0 };
        }
        // Export made before the A2Z upgrade: ids refer to the old starter dataset.
        const m = migrateStarterProgress(data);
        set({
          completed: m.completed,
          bookmarked: m.bookmarked,
          notes: m.notes,
          mistakes: m.mistakes,
          code: m.code,
          legacy: m.legacy,
          streak: streakFrom(m.completed, m.legacy, data.streak ?? EMPTY_STREAK),
        });
        return { migrated: m.report.moved, keptAsLegacy: m.report.keptAsLegacy };
      },

      setHydrated: (value) => set({ hydrated: value }),

      applySync: (patch) => {
        set((state) => {
          const completed = patch.completed ?? state.completed;
          const legacy = patch.legacy ?? state.legacy;
          const previous = { ...state.streak, longest: Math.max(state.streak.longest ?? 0, patch.longestStreak ?? 0) };
          return {
            completed,
            bookmarked: patch.bookmarked ?? state.bookmarked,
            notes: patch.notes ?? state.notes,
            mistakes: patch.mistakes ?? state.mistakes,
            code: patch.code ?? state.code,
            legacy,
            streak: streakFrom(completed, legacy, previous),
          };
        });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => localStorageAdapter),
      // We rehydrate manually from a client-only provider so the very first
      // server-rendered HTML always matches the client's first paint.
      skipHydration: true,
      partialize: (state) => ({
        completed: state.completed,
        bookmarked: state.bookmarked,
        notes: state.notes,
        mistakes: state.mistakes,
        code: state.code,
        streak: state.streak,
        legacy: state.legacy,
        lastVisitedId: state.lastVisitedId,
      }),
      /**
       * Runs once when stored data is older than STORAGE_VERSION. Data saved by the
       * original app has version 0 (no version was set) and uses starter-dataset ids.
       * Progress is re-keyed to A2Z ids; unmatched items go to `legacy`. Nothing is wiped.
       */
      migrate: (persisted, fromVersion) => {
        const state = (persisted ?? {}) as ProgressLike;
        if (fromVersion < 2) return migrateStarterState(state) as unknown as AppState;
        return state as unknown as AppState;
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Refresh "current streak" relative to today on every load.
          const legacy = state.legacy ?? EMPTY_LEGACY;
          useAppStore.setState({
            legacy,
            streak: streakFrom(state.completed ?? {}, legacy, state.streak ?? EMPTY_STREAK),
          });
        }
        useAppStore.getState().setHydrated(true);
      },
    }
  )
);

/** Problems completed on today's local date. */
export function selectCompletedToday(completed: CompletedMap): number {
  const today = todayKey();
  return Object.values(completed).filter((iso) => isoToDateKey(iso) === today).length;
}
