import { LEGACY_ID_MAP } from "@/data/legacyIdMap";
import { isoToDateKey } from "@/lib/utils";
import type { CompletedMap, LegacyProgress, StreakState } from "@/lib/types";

export const EMPTY_LEGACY: LegacyProgress = {
  completed: {},
  bookmarked: [],
  notes: {},
  mistakes: {},
  code: {},
};

/** Shape of anything progress-like we may need to migrate (persisted state or an export file). */
export interface ProgressLike {
  completed?: CompletedMap;
  bookmarked?: number[];
  notes?: Record<number, string>;
  mistakes?: Record<number, string>;
  code?: Record<number, string>;
  streak?: StreakState;
  lastVisitedId?: number | null;
  legacy?: LegacyProgress;
}

export interface MigratedProgress {
  completed: CompletedMap;
  bookmarked: number[];
  notes: Record<number, string>;
  mistakes: Record<number, string>;
  code: Record<number, string>;
  streak?: StreakState;
  lastVisitedId: number | null;
  legacy: LegacyProgress;
  /** How many old ids were moved onto A2Z problems / kept as legacy. */
  report: { moved: number; keptAsLegacy: number };
}

function mapId(oldId: number): number | null {
  const mapped = LEGACY_ID_MAP[oldId];
  return typeof mapped === "number" ? mapped : null;
}

/**
 * Convert progress recorded against the original 152-problem starter dataset (ids 1..152)
 * into A2Z ids. Anything without an identical A2Z problem is preserved in `legacy`
 * (keyed by its old id) instead of being dropped. Pure function — safe to unit test.
 */
export function migrateStarterProgress(input: ProgressLike): MigratedProgress {
  const legacy: LegacyProgress = {
    completed: { ...(input.legacy?.completed ?? {}) },
    bookmarked: [...(input.legacy?.bookmarked ?? [])],
    notes: { ...(input.legacy?.notes ?? {}) },
    mistakes: { ...(input.legacy?.mistakes ?? {}) },
    code: { ...(input.legacy?.code ?? {}) },
  };
  const touched = new Set<number>();
  const legacyIds = new Set<number>();

  const completed: CompletedMap = {};
  for (const [key, iso] of Object.entries(input.completed ?? {})) {
    const oldId = Number(key);
    const newId = mapId(oldId);
    if (newId === null) {
      legacy.completed[oldId] = iso;
      legacyIds.add(oldId);
      continue;
    }
    touched.add(oldId);
    // If two old problems land on one A2Z problem, keep the earliest completion.
    const existing = completed[newId];
    completed[newId] = existing && existing < iso ? existing : iso;
  }

  const bookmarked: number[] = [];
  for (const oldId of input.bookmarked ?? []) {
    const newId = mapId(oldId);
    if (newId === null) {
      if (!legacy.bookmarked.includes(oldId)) legacy.bookmarked.push(oldId);
      legacyIds.add(oldId);
    } else {
      touched.add(oldId);
      if (!bookmarked.includes(newId)) bookmarked.push(newId);
    }
  }

  function moveText(
    source: Record<number, string> | undefined,
    legacyTarget: Record<number, string>
  ): Record<number, string> {
    const out: Record<number, string> = {};
    for (const [key, text] of Object.entries(source ?? {})) {
      if (!text) continue;
      const oldId = Number(key);
      const newId = mapId(oldId);
      if (newId === null) {
        legacyTarget[oldId] = text;
        legacyIds.add(oldId);
      } else {
        touched.add(oldId);
        out[newId] = out[newId] ? `${out[newId]}\n\n${text}` : text;
      }
    }
    return out;
  }

  const notes = moveText(input.notes, legacy.notes);
  const mistakes = moveText(input.mistakes, legacy.mistakes);
  const code = moveText(input.code, legacy.code);

  const lastVisitedId =
    typeof input.lastVisitedId === "number" ? mapId(input.lastVisitedId) : null;

  return {
    completed,
    bookmarked,
    notes,
    mistakes,
    code,
    streak: input.streak,
    lastVisitedId,
    legacy,
    report: { moved: touched.size, keptAsLegacy: legacyIds.size },
  };
}

/** Local dates (YYYY-MM-DD) with at least one completion, current + legacy. */
export function collectActiveDates(completed: CompletedMap, legacy?: LegacyProgress): string[] {
  const dates = new Set<string>();
  for (const iso of Object.values(completed)) dates.add(isoToDateKey(iso));
  for (const iso of Object.values(legacy?.completed ?? {})) dates.add(isoToDateKey(iso));
  return Array.from(dates).sort();
}

export function legacyCount(legacy: LegacyProgress | undefined): number {
  if (!legacy) return 0;
  const ids = new Set<number>([
    ...Object.keys(legacy.completed).map(Number),
    ...legacy.bookmarked,
    ...Object.keys(legacy.notes).map(Number),
    ...Object.keys(legacy.mistakes).map(Number),
    ...Object.keys(legacy.code).map(Number),
  ]);
  return ids.size;
}
