/**
 * Cloud sync wire format (browser ⇄ /api/sync), shared by client and server.
 * See docs/SAAS_ARCHITECTURE.md §5 for the conflict rules implemented in lib/sync/merge.ts.
 */
import type { LegacyProgress } from "@/lib/types";

export type NoteKind = "note" | "mistakes" | "code";
export const NOTE_KINDS: readonly NoteKind[] = ["note", "mistakes", "code"];

/** One local change. `at` = client time (ms) of the change, used only to break ties. */
export type SyncOp =
  /** completedAt = ISO date when completed, null = explicitly un-completed (tombstone). */
  | { t: "progress"; id: number; completedAt: string | null; at: number }
  | { t: "bookmark"; id: number; on: boolean; at: number }
  /** base = server version this edit started from (0 = never synced). content "" = cleared. */
  | { t: "note"; id: number; kind: NoteKind; content: string; base: number; at: number }
  | { t: "streak"; longest: number; at: number }
  | { t: "legacy"; legacy: LegacyProgress; at: number }
  /** Preferences (last write wins). */
  | { t: "prefs"; theme: ThemePreference; at: number };

export type ThemePreference = "light" | "dark" | "system";
export const THEMES: readonly ThemePreference[] = ["light", "dark", "system"];

/** Server documents, as returned by pulls and pushes. */
export interface ProgressDoc {
  id: number;
  completedAt: string | null;
  deleted: boolean;
  at: number;
}
export interface BookmarkDoc {
  id: number;
  on: boolean;
  at: number;
}
export interface NoteDoc {
  id: number;
  kind: NoteKind;
  content: string;
  version: number;
  deleted: boolean;
  at: number;
}
export interface MetaDoc {
  longestStreak: number;
  legacy: LegacyProgress | null;
  preferences: { theme: ThemePreference; at: number } | null;
}

export interface SyncChanges {
  progress: ProgressDoc[];
  bookmarks: BookmarkDoc[];
  notes: NoteDoc[];
  meta: MetaDoc | null;
}

export interface PullResponse extends SyncChanges {
  /** Pass back as `since` on the next pull (server time, ms). */
  cursor: number;
}

export interface PushResponse extends SyncChanges {
  /** Note edits that met a newer server version and were merged (both texts kept). */
  conflicts: { id: number; kind: NoteKind }[];
  /**
   * Note edits NOT applied because keeping both versions would exceed the note size limit.
   * The server keeps its version; the device keeps its own until the user picks one.
   */
  rejected: { id: number; kind: NoteKind; reason: "merge_too_long"; version: number }[];
}

export const SYNC_LIMITS = {
  maxOpsPerRequest: 500,
  maxProblemId: 100_000,
  maxNoteChars: 50_000,
  maxLegacyBytes: 200_000,
} as const;

/** Stable key for coalescing ops and matching server docs. */
export function opKey(op: SyncOp): string {
  switch (op.t) {
    case "progress":
      return `p:${op.id}`;
    case "bookmark":
      return `b:${op.id}`;
    case "note":
      return `n:${op.id}:${op.kind}`;
    case "streak":
      return "s";
    case "legacy":
      return "l";
    case "prefs":
      return "pf";
  }
}

export function noteKey(id: number, kind: NoteKind): string {
  return `n:${id}:${kind}`;
}
