/**
 * Conflict rules for cloud sync — pure functions, used by the server inside Firestore
 * transactions (lib/sync/server.ts). Rules (docs/SAAS_ARCHITECTURE.md §5):
 *
 *   Completion  completed beats "never touched"; the EARLIEST completedAt is kept; an explicit
 *               un-complete (tombstone) wins only if it is newer than the completion.
 *   Bookmark    last write wins by client time (tombstones for removal).
 *   Notes       optimistic versioning: an edit based on the current server version replaces it;
 *               an edit based on an older version whose text differs keeps BOTH texts (newer
 *               first, then a "conflicting copy" block). Identical text is a no-op.
 *   Streak      longest = max(local, cloud).
 *   Legacy      union per key; earliest completion; differing notes are concatenated.
 * Nothing is ever silently dropped.
 */
import type { LegacyProgress } from "@/lib/types";
import { SYNC_LIMITS, type BookmarkDoc, type MetaDoc, type NoteDoc, type NoteKind, type ThemePreference } from "@/lib/sync/types";

export interface StoredProgress {
  completedAt: string | null;
  deleted: boolean;
  at: number;
}

/** New stored completion state, or null when nothing changes. */
export function mergeProgress(
  existing: StoredProgress | null,
  op: { completedAt: string | null; at: number }
): StoredProgress | null {
  if (op.completedAt) {
    if (existing && existing.deleted && existing.at > op.at) return null; // newer un-complete wins
    if (existing && !existing.deleted && existing.completedAt) {
      const earliest = existing.completedAt <= op.completedAt ? existing.completedAt : op.completedAt;
      const at = Math.max(existing.at, op.at);
      return earliest === existing.completedAt && at === existing.at ? null : { completedAt: earliest, deleted: false, at };
    }
    return { completedAt: op.completedAt, deleted: false, at: op.at };
  }
  // Un-complete: only if it's at least as new as what the server has.
  if (!existing) return { completedAt: null, deleted: true, at: op.at };
  if (existing.deleted) return op.at > existing.at ? { ...existing, at: op.at } : null;
  return op.at >= existing.at ? { completedAt: null, deleted: true, at: op.at } : null;
}

export function mergeBookmark(existing: Omit<BookmarkDoc, "id"> | null, op: { on: boolean; at: number }): Omit<BookmarkDoc, "id"> | null {
  if (existing && existing.at > op.at) return null;
  if (existing && existing.on === op.on && existing.at === op.at) return null;
  return { on: op.on, at: op.at };
}

export const CONFLICT_SEPARATOR = (at: number) =>
  `\n\n--- Conflicting copy (edited on another device, ${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC) ---\n\n`;

export interface NoteMergeResult {
  next: Omit<NoteDoc, "id" | "kind"> | null;
  conflict: boolean;
  /** Both texts together would exceed the size limit: nothing merged, the server keeps its text. */
  overflow?: boolean;
}

export function mergeNote(
  existing: Omit<NoteDoc, "id" | "kind"> | null,
  op: { content: string; base: number; at: number }
): NoteMergeResult {
  const incoming = op.content;
  if (!existing) {
    return incoming ? { next: { content: incoming, version: 1, deleted: false, at: op.at }, conflict: false } : { next: null, conflict: false };
  }
  const current = existing.deleted ? "" : existing.content;
  if (incoming === current) return { next: null, conflict: false }; // identical: no duplicate
  if (op.base === existing.version) {
    // Edit of the latest server text: plain replace (or clear).
    return {
      next: { content: incoming, version: existing.version + 1, deleted: incoming === "", at: op.at },
      conflict: false,
    };
  }
  // Stale base and different text.
  if (!current) {
    return { next: { content: incoming, version: existing.version + 1, deleted: false, at: op.at }, conflict: false };
  }
  if (!incoming) return { next: null, conflict: true }; // a stale "clear" never deletes newer text
  if (incoming.includes(current)) {
    // The other side only appended to the server text: take the longer text, nothing is lost.
    return { next: { content: incoming, version: existing.version + 1, deleted: false, at: Math.max(op.at, existing.at) }, conflict: false };
  }
  if (current.includes(incoming)) return { next: null, conflict: true }; // server already contains it
  const incomingNewer = op.at >= existing.at;
  const [first, second, secondAt] = incomingNewer ? [incoming, current, existing.at] : [current, incoming, op.at];
  const merged = `${first}${CONFLICT_SEPARATOR(secondAt)}${second}`;
  // Never truncate text to make it fit: keep the server copy, tell the device to keep its own.
  if (merged.length > SYNC_LIMITS.maxNoteChars) return { next: null, conflict: true, overflow: true };
  return {
    next: {
      content: merged,
      version: existing.version + 1,
      deleted: false,
      at: Math.max(op.at, existing.at),
    },
    conflict: true,
  };
}

function unionNumbers(a: number[], b: number[]): number[] {
  return Array.from(new Set([...a, ...b])).sort((x, y) => x - y);
}

function mergeTextMaps(a: Record<number, string>, b: Record<number, string>): Record<number, string> {
  const out: Record<number, string> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const key = Number(k);
    const cur = out[key];
    if (!cur) out[key] = v;
    else if (v && cur !== v && !cur.includes(v)) out[key] = `${cur}\n\n${v}`;
  }
  return out;
}

export const EMPTY_LEGACY: LegacyProgress = { completed: {}, bookmarked: [], notes: {}, mistakes: {}, code: {} };

export function mergeLegacy(a: LegacyProgress | null | undefined, b: LegacyProgress | null | undefined): LegacyProgress {
  const x = a ?? EMPTY_LEGACY;
  const y = b ?? EMPTY_LEGACY;
  const completed: Record<number, string> = { ...x.completed };
  for (const [k, iso] of Object.entries(y.completed)) {
    const key = Number(k);
    if (!completed[key] || iso < completed[key]) completed[key] = iso;
  }
  return {
    completed,
    bookmarked: unionNumbers(x.bookmarked, y.bookmarked),
    notes: mergeTextMaps(x.notes, y.notes),
    mistakes: mergeTextMaps(x.mistakes, y.mistakes),
    code: mergeTextMaps(x.code, y.code),
  };
}

export function legacyIsEmpty(l: LegacyProgress | null | undefined): boolean {
  if (!l) return true;
  return (
    !Object.keys(l.completed).length &&
    !l.bookmarked.length &&
    !Object.keys(l.notes).length &&
    !Object.keys(l.mistakes).length &&
    !Object.keys(l.code).length
  );
}

export function mergeMeta(
  existing: MetaDoc | null,
  patch: { longest?: number; legacy?: LegacyProgress; prefs?: { theme: ThemePreference; at: number } }
): MetaDoc | null {
  const cur: MetaDoc = existing ?? { longestStreak: 0, legacy: null, preferences: null };
  const longestStreak = patch.longest !== undefined ? Math.max(cur.longestStreak, Math.floor(patch.longest)) : cur.longestStreak;
  const legacy = patch.legacy !== undefined ? mergeLegacy(cur.legacy, patch.legacy) : cur.legacy;
  // Preferences: last write wins by client time.
  const preferences =
    patch.prefs && (!cur.preferences || patch.prefs.at > cur.preferences.at) ? { ...patch.prefs } : cur.preferences ?? null;
  const changed =
    longestStreak !== cur.longestStreak ||
    JSON.stringify(legacy) !== JSON.stringify(cur.legacy) ||
    JSON.stringify(preferences) !== JSON.stringify(cur.preferences ?? null);
  return changed || !existing ? { longestStreak, legacy, preferences } : null;
}

export type { NoteKind };
