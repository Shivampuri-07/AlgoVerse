/**
 * SERVER-ONLY cloud sync storage (Firestore, Admin SDK). Every function takes the uid of the
 * AUTHENTICATED user (lib/auth/server.ts) and only touches `users/{uid}/…`.
 *
 *   users/{uid}/progress/{problemId}   { completedAt, deleted, at, updatedAt }
 *   users/{uid}/bookmarks/{problemId}  { on, at, updatedAt }
 *   users/{uid}/notes/{id}_{kind}      { problemId, kind, content, version, deleted, at, updatedAt }
 *   users/{uid}/meta/state             { longestStreak, legacy, updatedAt }
 */
import { FieldValue, Timestamp, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { mergeBookmark, mergeMeta, mergeNote, mergeProgress, type StoredProgress } from "@/lib/sync/merge";
import {
  NOTE_KINDS,
  SYNC_LIMITS,
  THEMES,
  type ThemePreference,
  type BookmarkDoc,
  type MetaDoc,
  type NoteDoc,
  type NoteKind,
  type ProgressDoc,
  type PullResponse,
  type PushResponse,
  type SyncOp,
} from "@/lib/sync/types";
import type { LegacyProgress } from "@/lib/types";

const OVERLAP_MS = 5_000; // re-read a little behind the cursor; applying twice is harmless

function userDoc(db: Firestore, uid: string) {
  return db.collection("users").doc(uid);
}

function isInt(v: unknown, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max;
}
function isTime(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 32503680000000;
}
function isIso(v: unknown): v is string {
  return typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v));
}
function isTextMap(v: unknown): v is Record<number, string> {
  return !!v && typeof v === "object" && !Array.isArray(v) && Object.entries(v).every(([k, t]) => /^\d+$/.test(k) && typeof t === "string");
}
function isLegacy(v: unknown): v is LegacyProgress {
  const l = v as LegacyProgress | null;
  return (
    !!l &&
    typeof l === "object" &&
    !!l.completed && typeof l.completed === "object" && Object.values(l.completed).every(isIso) &&
    Array.isArray(l.bookmarked) && l.bookmarked.every((n) => Number.isInteger(n)) &&
    isTextMap(l.notes) && isTextMap(l.mistakes) && isTextMap(l.code) &&
    JSON.stringify(l).length <= SYNC_LIMITS.maxLegacyBytes
  );
}

/** Validates an untrusted op list. Returns null if anything is malformed (the whole request is rejected). */
export function parseOps(raw: unknown): SyncOp[] | null {
  if (!Array.isArray(raw) || raw.length > SYNC_LIMITS.maxOpsPerRequest) return null;
  const out: SyncOp[] = [];
  for (const r of raw) {
    const o = r as Record<string, unknown>;
    if (!o || typeof o !== "object" || !isTime(o.at)) return null;
    switch (o.t) {
      case "progress":
        if (!isInt(o.id, SYNC_LIMITS.maxProblemId) || !(o.completedAt === null || isIso(o.completedAt))) return null;
        out.push({ t: "progress", id: o.id, completedAt: o.completedAt as string | null, at: o.at });
        break;
      case "bookmark":
        if (!isInt(o.id, SYNC_LIMITS.maxProblemId) || typeof o.on !== "boolean") return null;
        out.push({ t: "bookmark", id: o.id, on: o.on, at: o.at });
        break;
      case "note":
        if (
          !isInt(o.id, SYNC_LIMITS.maxProblemId) ||
          !NOTE_KINDS.includes(o.kind as NoteKind) ||
          typeof o.content !== "string" ||
          o.content.length > SYNC_LIMITS.maxNoteChars ||
          !(typeof o.base === "number" && Number.isInteger(o.base) && o.base >= 0)
        )
          return null;
        out.push({ t: "note", id: o.id, kind: o.kind as NoteKind, content: o.content, base: o.base, at: o.at });
        break;
      case "streak":
        if (!(typeof o.longest === "number" && Number.isInteger(o.longest) && o.longest >= 0 && o.longest < 100_000)) return null;
        out.push({ t: "streak", longest: o.longest, at: o.at });
        break;
      case "legacy":
        if (!isLegacy(o.legacy)) return null;
        out.push({ t: "legacy", legacy: o.legacy, at: o.at });
        break;
      case "prefs":
        if (!THEMES.includes(o.theme as ThemePreference)) return null;
        out.push({ t: "prefs", theme: o.theme as ThemePreference, at: o.at });
        break;
      default:
        return null;
    }
  }
  return out;
}

function progressDoc(id: number, d: FirebaseFirestore.DocumentData): ProgressDoc {
  return { id, completedAt: d.completedAt ?? null, deleted: d.deleted === true, at: Number(d.at) || 0 };
}
function bookmarkDoc(id: number, d: FirebaseFirestore.DocumentData): BookmarkDoc {
  return { id, on: d.on === true, at: Number(d.at) || 0 };
}
function noteDoc(d: FirebaseFirestore.DocumentData): NoteDoc {
  return {
    id: Number(d.problemId),
    kind: d.kind as NoteKind,
    content: typeof d.content === "string" ? d.content : "",
    version: Number(d.version) || 0,
    deleted: d.deleted === true,
    at: Number(d.at) || 0,
  };
}
function metaDoc(d: FirebaseFirestore.DocumentData | undefined): MetaDoc | null {
  if (!d) return null;
  const p = d.preferences as { theme?: unknown; at?: unknown } | null | undefined;
  const preferences =
    p && THEMES.includes(p.theme as ThemePreference) && typeof p.at === "number" ? { theme: p.theme as ThemePreference, at: p.at } : null;
  return { longestStreak: Number(d.longestStreak) || 0, legacy: (d.legacy as LegacyProgress | null) ?? null, preferences };
}

/**
 * Applies ops with the conflict rules. Each chunk is one Firestore transaction (all-or-nothing),
 * and every rule is idempotent, so a retried request after a network failure is harmless.
 */
export async function pushOps(db: Firestore, uid: string, ops: SyncOp[]): Promise<PushResponse> {
  const user = userDoc(db, uid);
  const result: PushResponse = { progress: [], bookmarks: [], notes: [], meta: null, conflicts: [], rejected: [] };
  // ≤ 200 docs per transaction (Firestore's limit is 500 writes).
  for (let i = 0; i < ops.length; i += 200) {
    const chunk = ops.slice(i, i + 200);
    await db.runTransaction(async (tx) => {
      const refs = new Map<string, DocumentReference>();
      const refFor = (op: SyncOp): DocumentReference => {
        const path =
          op.t === "progress" ? `progress/${op.id}` : op.t === "bookmark" ? `bookmarks/${op.id}` : op.t === "note" ? `notes/${op.id}_${op.kind}` : "meta/state";
        let ref = refs.get(path);
        if (!ref) {
          ref = user.collection(path.split("/")[0]).doc(path.split("/")[1]);
          refs.set(path, ref);
        }
        return ref;
      };
      chunk.forEach(refFor);
      const paths = [...refs.keys()];
      const snaps = await tx.getAll(...paths.map((p) => refs.get(p)!));
      const current = new Map<string, FirebaseFirestore.DocumentData | undefined>(paths.map((p, j) => [p, snaps[j].exists ? snaps[j].data() : undefined]));
      const pathOf = (op: SyncOp) => [...refs.entries()].find(([, r]) => r === refFor(op))![0];
      const stamp = FieldValue.serverTimestamp();
      const touched = new Set<string>();

      for (const op of chunk) {
        const path = pathOf(op);
        const existing = current.get(path);
        if (op.t === "progress") {
          const prev: StoredProgress | null = existing ? { completedAt: existing.completedAt ?? null, deleted: existing.deleted === true, at: Number(existing.at) || 0 } : null;
          const next = mergeProgress(prev, op);
          if (next) current.set(path, { ...next });
        } else if (op.t === "bookmark") {
          const prev = existing ? { on: existing.on === true, at: Number(existing.at) || 0 } : null;
          const next = mergeBookmark(prev, op);
          if (next) current.set(path, { ...next });
        } else if (op.t === "note") {
          const prev = existing ? { content: existing.content ?? "", version: Number(existing.version) || 0, deleted: existing.deleted === true, at: Number(existing.at) || 0 } : null;
          const { next, conflict, overflow } = mergeNote(prev, op);
          if (next) current.set(path, { problemId: op.id, kind: op.kind, ...next });
          if (overflow) result.rejected.push({ id: op.id, kind: op.kind, reason: "merge_too_long", version: prev?.version ?? 0 });
          else if (conflict) result.conflicts.push({ id: op.id, kind: op.kind });
        } else {
          const prev = metaDoc(existing);
          const next = mergeMeta(
            prev,
            op.t === "streak" ? { longest: op.longest } : op.t === "legacy" ? { legacy: op.legacy } : { prefs: { theme: op.theme, at: op.at } }
          );
          if (next) current.set(path, { ...next });
        }
        if (current.get(path) !== existing) touched.add(path);
      }

      for (const path of touched) tx.set(refs.get(path)!, { ...current.get(path), updatedAt: stamp });
      // Report the final state of every doc the request mentioned (changed or not).
      for (const path of paths) {
        const d = current.get(path);
        if (!d) continue;
        const [col, id] = path.split("/");
        if (col === "progress") result.progress.push(progressDoc(Number(id), d));
        else if (col === "bookmarks") result.bookmarks.push(bookmarkDoc(Number(id), d));
        else if (col === "notes") result.notes.push(noteDoc(d));
        else result.meta = metaDoc(d);
      }
    });
  }
  return result;
}

/**
 * Everything changed since `since` (ms, server time). since=0 → the full account state.
 * The returned cursor is the server's clock at query time minus a small overlap, so a write
 * that commits while this query runs is picked up by the next pull (at most one repeat; applying
 * a doc twice is harmless) and a quiet account returns nothing on later pulls.
 */
export async function pullChanges(db: Firestore, uid: string, since: number, now = Date.now()): Promise<PullResponse> {
  const user = userDoc(db, uid);
  const cursor = Math.max(since, now - OVERLAP_MS);
  const from = Timestamp.fromMillis(since);
  const query = (col: string) => (since > 0 ? user.collection(col).where("updatedAt", ">", from) : user.collection(col));
  const [p, b, n, m] = await Promise.all([query("progress").get(), query("bookmarks").get(), query("notes").get(), user.collection("meta").doc("state").get()]);
  const progress = p.docs.map((d) => progressDoc(Number(d.id), d.data()));
  const bookmarks = b.docs.map((d) => bookmarkDoc(Number(d.id), d.data()));
  const notes = n.docs.map((d) => noteDoc(d.data()));
  const md = m.exists ? m.data() : undefined;
  const metaChanged = md && (since === 0 || (md.updatedAt instanceof Timestamp && md.updatedAt.toMillis() > since));
  return { progress, bookmarks, notes, meta: metaChanged ? metaDoc(md) : null, cursor };
}
