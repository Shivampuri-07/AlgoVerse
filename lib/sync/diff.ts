/**
 * Turns local store changes into sync ops (pure). Used by the sync engine's store subscriber,
 * and to build the one-off "import this device" snapshot.
 */
import type { CompletedMap, LegacyProgress } from "@/lib/types";
import { NOTE_KINDS, noteKey, opKey, type NoteKind, type SyncOp } from "@/lib/sync/types";
import { legacyIsEmpty } from "@/lib/sync/merge";

/** The synced part of the app store. */
export interface SyncSnapshot {
  completed: CompletedMap;
  bookmarked: number[];
  notes: Record<number, string>;
  mistakes: Record<number, string>;
  code: Record<number, string>;
  longestStreak: number;
  legacy: LegacyProgress;
}

const FIELD: Record<NoteKind, "notes" | "mistakes" | "code"> = { note: "notes", mistakes: "mistakes", code: "code" };

/** Ops for everything that changed between two snapshots. `base(key)` = known server version of a note. */
export function diffSnapshots(prev: SyncSnapshot, next: SyncSnapshot, base: (key: string) => number, at = Date.now()): SyncOp[] {
  const ops: SyncOp[] = [];
  if (prev.completed !== next.completed) {
    const ids = new Set([...Object.keys(prev.completed), ...Object.keys(next.completed)].map(Number));
    for (const id of ids) {
      const a = prev.completed[id] ?? null;
      const b = next.completed[id] ?? null;
      if (a !== b) ops.push({ t: "progress", id, completedAt: b, at });
    }
  }
  if (prev.bookmarked !== next.bookmarked) {
    const a = new Set(prev.bookmarked);
    const b = new Set(next.bookmarked);
    for (const id of b) if (!a.has(id)) ops.push({ t: "bookmark", id, on: true, at });
    for (const id of a) if (!b.has(id)) ops.push({ t: "bookmark", id, on: false, at });
  }
  for (const kind of NOTE_KINDS) {
    const f = FIELD[kind];
    if (prev[f] === next[f]) continue;
    const ids = new Set([...Object.keys(prev[f]), ...Object.keys(next[f])].map(Number));
    for (const id of ids) {
      const a = prev[f][id] ?? "";
      const b = next[f][id] ?? "";
      if (a !== b) ops.push({ t: "note", id, kind, content: b, base: base(noteKey(id, kind)), at });
    }
  }
  if (next.longestStreak > prev.longestStreak) ops.push({ t: "streak", longest: next.longestStreak, at });
  if (prev.legacy !== next.legacy && JSON.stringify(prev.legacy) !== JSON.stringify(next.legacy)) {
    ops.push({ t: "legacy", legacy: next.legacy, at });
  }
  return ops;
}

/**
 * Ops that bring this device's data into an account ("Import and merge"): additions only —
 * an import never deletes anything in the cloud. Completions keep their original dates.
 */
export function importOps(s: SyncSnapshot, at = Date.now()): SyncOp[] {
  const ops: SyncOp[] = [];
  for (const [k, iso] of Object.entries(s.completed)) {
    const t = Date.parse(iso);
    ops.push({ t: "progress", id: Number(k), completedAt: iso, at: Number.isFinite(t) ? t : at });
  }
  for (const id of s.bookmarked) ops.push({ t: "bookmark", id, on: true, at });
  for (const kind of NOTE_KINDS) {
    for (const [k, text] of Object.entries(s[FIELD[kind]])) {
      if (text) ops.push({ t: "note", id: Number(k), kind, content: text, base: 0, at });
    }
  }
  if (s.longestStreak > 0) ops.push({ t: "streak", longest: s.longestStreak, at });
  if (!legacyIsEmpty(s.legacy)) ops.push({ t: "legacy", legacy: s.legacy, at });
  return ops;
}

export function snapshotIsEmpty(s: SyncSnapshot): boolean {
  return (
    !Object.keys(s.completed).length &&
    !s.bookmarked.length &&
    !Object.keys(s.notes).length &&
    !Object.keys(s.mistakes).length &&
    !Object.keys(s.code).length &&
    legacyIsEmpty(s.legacy)
  );
}

/** Keep only the newest op per key (a note keeps the base of its FIRST unsynced edit). */
export function coalesce(ops: SyncOp[]): SyncOp[] {
  const byKey = new Map<string, SyncOp>();
  for (const op of ops) {
    const key = opKey(op);
    const prev = byKey.get(key);
    if (op.t === "note" && prev && prev.t === "note") byKey.set(key, { ...op, base: prev.base });
    else if (op.t === "streak" && prev && prev.t === "streak") byKey.set(key, { ...op, longest: Math.max(op.longest, prev.longest) });
    else byKey.set(key, op);
    // Keep insertion order roughly chronological.
    if (prev) {
      const v = byKey.get(key)!;
      byKey.delete(key);
      byKey.set(key, v);
    }
  }
  return [...byKey.values()];
}
