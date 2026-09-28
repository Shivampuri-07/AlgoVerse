/**
 * Browser cloud-sync engine (Pro). docs/SAAS_ARCHITECTURE.md §5.
 *
 * - `dsa-roadmap-storage` (the app store) stays the source of truth for the UI and works
 *   offline exactly as before. Sync is a background layer on top of it.
 * - A store subscriber diffs every change into an OUTBOX (localStorage, survives reloads and
 *   offline periods). The outbox is pushed ~2 s after the last change, on reconnect and when the
 *   tab becomes visible; then changes since the last cursor are pulled.
 * - Cloud changes are applied to the store without being echoed back, and a pending local edit
 *   always wins over an incoming one for the same item (the server merges when it arrives).
 * - Nothing here ever deletes local data: switching accounts first backs the device's data up.
 */
import { create } from "zustand";
import { useAppStore } from "@/lib/store";
import { coalesce, diffSnapshots, importOps, snapshotIsEmpty, type SyncSnapshot } from "@/lib/sync/diff";
import { EMPTY_LEGACY, mergeLegacy } from "@/lib/sync/merge";
import {
  noteKey,
  opKey,
  SYNC_LIMITS,
  type NoteKind,
  type PullResponse,
  type PushResponse,
  type SyncChanges,
  type SyncOp,
  type ThemePreference,
} from "@/lib/sync/types";

export const SYNC_META_KEY = "algoverse-sync-meta";
export const SYNC_OUTBOX_KEY = "algoverse-sync-outbox";
export const LOCAL_BACKUP_PREFIX = "algoverse-local-backup:";
const PUSH_DELAY_MS = 2_000;
const PERIODIC_MS = 120_000;

export type SyncStatus = "off" | "syncing" | "synced" | "offline" | "error";

export interface SyncUiState {
  status: SyncStatus;
  lastSyncedAt: number | null;
  pending: number;
  message: string | null;
  /** Note edits merged with a newer cloud version since this page loaded (both texts kept). */
  conflicts: number;
  /** Notes kept on this device only (too long to sync, or too long to merge with the cloud copy). */
  unsynced: UnsyncedNote[];
}

export interface UnsyncedNote {
  key: string;
  id: number;
  kind: NoteKind;
  reason: "too_long" | "merge_too_long";
  chars: number;
}

export const useSyncStore = create<SyncUiState>(() => ({
  status: "off",
  lastSyncedAt: null,
  pending: 0,
  message: null,
  conflicts: 0,
  unsynced: [],
}));

// ------------------------------------------------------------------ persisted meta + outbox

export interface SyncMeta {
  /** Account whose data this device's store currently holds (null = never synced). */
  ownerUserId: string | null;
  /** Server-time cursor for the next pull. */
  cursor: number;
  importedAt: number | null;
  /** Server version of each synced note, by noteKey — the `base` of the next edit. */
  noteVersions: Record<string, number>;
  /** The user chose "keep on this device only" for this account. */
  declinedFor: string | null;
  /** Last theme change known to this device (local or from the cloud). */
  prefs: { theme: ThemePreference; at: number } | null;
  /** Notes kept on this device only; cloud changes never overwrite them. */
  unsyncedNotes: Record<string, { reason: UnsyncedNote["reason"]; serverVersion?: number }>;
}

const EMPTY_META: SyncMeta = {
  ownerUserId: null,
  cursor: 0,
  importedAt: null,
  noteVersions: {},
  declinedFor: null,
  prefs: null,
  unsyncedNotes: {},
};

/** A fresh meta object (never shares the default maps). */
function freshMeta(over: Partial<SyncMeta> = {}): SyncMeta {
  return {
    ...EMPTY_META,
    ...over,
    noteVersions: { ...(over.noteVersions ?? {}) },
    unsyncedNotes: { ...(over.unsyncedNotes ?? {}) },
  };
}

export function readMeta(): SyncMeta {
  try {
    const raw = window.localStorage.getItem(SYNC_META_KEY);
    return freshMeta(raw ? (JSON.parse(raw) as Partial<SyncMeta>) : {});
  } catch {
    return freshMeta();
  }
}

function writeMeta(meta: SyncMeta) {
  try {
    window.localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
  } catch {
    /* storage full/unavailable: sync resumes from scratch next time (merge is idempotent) */
  }
  publishUnsynced(meta);
}

const NOTE_FIELD: Record<NoteKind, "notes" | "mistakes" | "code"> = { note: "notes", mistakes: "mistakes", code: "code" };

function publishUnsynced(meta: SyncMeta) {
  const s = useAppStore.getState();
  const unsynced: UnsyncedNote[] = Object.entries(meta.unsyncedNotes ?? {}).map(([key, v]) => {
    const [, id, kind] = key.split(":");
    const text = s[NOTE_FIELD[kind as NoteKind]]?.[Number(id)] ?? "";
    return { key, id: Number(id), kind: kind as NoteKind, reason: v.reason, chars: text.length };
  });
  useSyncStore.setState({ unsynced });
}

function tooLong(op: SyncOp): boolean {
  return op.t === "note" && op.content.length > SYNC_LIMITS.maxNoteChars;
}

interface Outbox {
  uid: string;
  ops: SyncOp[];
}

function readOutbox(uid: string): SyncOp[] {
  try {
    const raw = window.localStorage.getItem(SYNC_OUTBOX_KEY);
    const box = raw ? (JSON.parse(raw) as Outbox) : null;
    // Over-long notes (e.g. queued by an older version) would make the server reject the whole
    // request and stall sync: they never stay in the outbox.
    return box && box.uid === uid && Array.isArray(box.ops) ? box.ops.filter((o) => !tooLong(o)) : [];
  } catch {
    return [];
  }
}

function writeOutbox(uid: string, ops: SyncOp[]) {
  try {
    window.localStorage.setItem(SYNC_OUTBOX_KEY, JSON.stringify({ uid, ops } satisfies Outbox));
  } catch {
    /* ignore */
  }
  useSyncStore.setState({ pending: ops.length });
}

// ------------------------------------------------------------------ store ⇄ snapshot

export function snapshotFromStore(s = useAppStore.getState()): SyncSnapshot {
  return {
    completed: s.completed,
    bookmarked: s.bookmarked,
    notes: s.notes,
    mistakes: s.mistakes,
    code: s.code,
    longestStreak: s.streak.longest ?? 0,
    legacy: s.legacy ?? EMPTY_LEGACY,
  };
}

export function localHasData(): boolean {
  return !snapshotIsEmpty(snapshotFromStore());
}

// ------------------------------------------------------------------ engine

let running: {
  uid: string;
  cleanup: () => void;
} | null = null;
let suppress = false;

/**
 * Change journal: watches the store from the moment it's loaded (not only once sync has
 * started), so an edit made in the first second after a page load isn't missed. Changes are
 * recorded for the device's sync owner only when the signed-in user IS that owner; while sign-in
 * is still resolving they wait in memory; edits by anyone else (or while signed out) are never
 * attributed to the owner. Local data is unaffected either way.
 */
type Identity = { state: "loading" } | { state: "signed-out" } | { state: "signed-in"; uid: string };
let identity: Identity = { state: "loading" };
let journal: { owner: string; prev: SyncSnapshot; unsubscribe: () => void } | null = null;
const HELD_KEY = "algoverse-sync-held";

/** Edits made while sign-in is still resolving: stored (a page change mustn't lose them), sent only once confirmed. */
function readHeld(owner: string): SyncOp[] {
  try {
    const raw = window.localStorage.getItem(HELD_KEY);
    const box = raw ? (JSON.parse(raw) as Outbox) : null;
    return box && box.uid === owner && Array.isArray(box.ops) ? box.ops : [];
  } catch {
    return [];
  }
}

function writeHeld(owner: string, ops: SyncOp[]) {
  try {
    if (ops.length) window.localStorage.setItem(HELD_KEY, JSON.stringify({ uid: owner, ops } satisfies Outbox));
    else window.localStorage.removeItem(HELD_KEY);
  } catch {
    /* ignore */
  }
}

function recordFor(owner: string, ops: SyncOp[]) {
  if (identity.state === "signed-in" && identity.uid === owner) {
    enqueue(owner, ops);
    if (running?.uid === owner) schedulePush();
  } else if (identity.state === "loading") {
    writeHeld(owner, coalesce([...readHeld(owner), ...ops]));
  }
  // signed out / another user: not attributed to the owner
}

/** Start (or retarget) the journal for the device's current sync owner. Call once the store is hydrated. */
export function ensureJournal() {
  const owner = readMeta().ownerUserId;
  if (!owner) {
    stopJournal();
    return;
  }
  if (journal?.owner === owner) return;
  stopJournal();
  const j = {
    owner,
    prev: snapshotFromStore(),
    unsubscribe: () => {},
  };
  j.unsubscribe = useAppStore.subscribe((state) => {
    const next = snapshotFromStore(state);
    if (suppress) {
      j.prev = next;
      return;
    }
    const versions = readMeta().noteVersions;
    const ops = diffSnapshots(j.prev, next, (key) => versions[key] ?? 0);
    j.prev = next;
    if (ops.length) recordFor(owner, ops);
  });
  journal = j;
}

function stopJournal() {
  journal?.unsubscribe();
  journal = null;
}

/** Tell the engine who is signed in (from the auth provider). Releases or drops held edits. */
export function setSyncIdentity(next: Identity) {
  identity = next;
  if (next.state === "loading") return;
  const owner = readMeta().ownerUserId;
  if (!owner) return;
  const held = readHeld(owner);
  if (!held.length) return;
  writeHeld(owner, []);
  if (next.state === "signed-in" && next.uid === owner) {
    enqueue(owner, held);
    if (running?.uid === owner) schedulePush();
  }
  // Someone else (or nobody) is signed in: the held edits stay only in this device's local data.
}
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<void> = Promise.resolve();

function pendingKeys(uid: string): Set<string> {
  return new Set(readOutbox(uid).map(opKey));
}

/** Applies cloud docs to the store (skipping items with unsent local edits). */
function applyChanges(uid: string, changes: SyncChanges, mode: "merge" | "replace" = "merge") {
  const pending = mode === "merge" ? pendingKeys(uid) : new Set<string>();
  const meta = readMeta();
  if (mode === "merge") for (const key of Object.keys(meta.unsyncedNotes ?? {})) pending.add(key); // keep local text
  else meta.unsyncedNotes = {};
  const s = useAppStore.getState();
  const completed = mode === "replace" ? {} : { ...s.completed };
  const bookmarked = new Set(mode === "replace" ? [] : s.bookmarked);
  const text = {
    note: mode === "replace" ? {} : { ...s.notes },
    mistakes: mode === "replace" ? {} : { ...s.mistakes },
    code: mode === "replace" ? {} : { ...s.code },
  } as Record<"note" | "mistakes" | "code", Record<number, string>>;
  if (mode === "replace") meta.noteVersions = {};

  for (const p of changes.progress) {
    if (pending.has(`p:${p.id}`)) continue;
    if (p.deleted || !p.completedAt) delete completed[p.id];
    else completed[p.id] = p.completedAt;
  }
  for (const b of changes.bookmarks) {
    if (pending.has(`b:${b.id}`)) continue;
    if (b.on) bookmarked.add(b.id);
    else bookmarked.delete(b.id);
  }
  for (const n of changes.notes) {
    const key = noteKey(n.id, n.kind);
    if (pending.has(key)) continue;
    meta.noteVersions[key] = n.version;
    if (n.deleted || !n.content) delete text[n.kind][n.id];
    else text[n.kind][n.id] = n.content;
  }
  const legacy = changes.meta?.legacy
    ? mode === "replace"
      ? changes.meta.legacy
      : mergeLegacy(s.legacy, changes.meta.legacy)
    : mode === "replace"
      ? EMPTY_LEGACY
      : s.legacy;

  // Preferences: last write wins; only a newer cloud change is applied on this device.
  const remotePrefs = changes.meta?.preferences;
  if (remotePrefs && !pending.has("pf") && remotePrefs.at > (meta.prefs?.at ?? 0)) {
    meta.prefs = remotePrefs;
    preferencesHandler?.apply(remotePrefs.theme);
  }

  suppress = true;
  try {
    useAppStore.getState().applySync({
      completed,
      bookmarked: [...bookmarked],
      notes: text.note,
      mistakes: text.mistakes,
      code: text.code,
      legacy,
      longestStreak: changes.meta?.longestStreak ?? 0,
    });
  } finally {
    suppress = false;
  }
  if (journal && journal.owner === uid) journal.prev = snapshotFromStore();
  writeMeta(meta);
}

class SyncHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

async function request<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let code = "unavailable";
    try {
      code = ((await res.json()) as { error?: { code?: string } }).error?.code ?? code;
    } catch {
      /* ignore */
    }
    throw new SyncHttpError(res.status, code);
  }
  return (await res.json()) as T;
}

async function pushNow(uid: string) {
  for (;;) {
    const ops = readOutbox(uid);
    if (!ops.length) return;
    const batch = ops.slice(0, SYNC_LIMITS.maxOpsPerRequest);
    const result = await request<PushResponse>("POST", "/api/sync", { ops: batch });
    // Remove exactly what was sent; anything edited again meanwhile stays queued.
    const sent = new Map(batch.map((o) => [opKey(o), JSON.stringify(o)]));
    const remaining = readOutbox(uid).filter((o) => sent.get(opKey(o)) !== JSON.stringify(o));
    writeOutbox(uid, remaining);
    if (result.conflicts.length) useSyncStore.setState((s) => ({ conflicts: s.conflicts + result.conflicts.length }));
    if (result.rejected?.length) {
      // Both versions together are too long to keep: this device keeps its own text (never
      // overwritten), the cloud keeps the other one, until the user picks.
      const meta = readMeta();
      for (const r of result.rejected) {
        const key = noteKey(r.id, r.kind);
        meta.unsyncedNotes[key] = { reason: "merge_too_long", serverVersion: r.version };
        meta.noteVersions[key] = r.version;
      }
      writeMeta(meta);
    }
    applyChanges(uid, result);
  }
}

async function pullNow(uid: string) {
  const meta = readMeta();
  const result = await request<PullResponse>("GET", `/api/sync?since=${meta.cursor}`);
  applyChanges(uid, result);
  writeMeta({ ...readMeta(), cursor: result.cursor });
  // First sync of an account with no saved preference: upload this device's theme once.
  if (meta.cursor === 0 && !result.meta?.preferences && preferencesHandler) {
    recordPreference(preferencesHandler.current());
  }
}

/** Push the outbox, then pull. Serialised: never two syncs at once. */
export function syncNow(): Promise<void> {
  const uid = running?.uid;
  if (!uid) return Promise.resolve();
  chain = chain.then(async () => {
    if (!running || running.uid !== uid) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      useSyncStore.setState({ status: "offline", message: null });
      return;
    }
    useSyncStore.setState({ status: "syncing", message: null });
    try {
      await pushNow(uid);
      await pullNow(uid);
      useSyncStore.setState({ status: "synced", lastSyncedAt: Date.now(), message: null });
    } catch (err) {
      if (err instanceof SyncHttpError) {
        if (err.status === 401 || err.code === "not_entitled") {
          stopSync();
          useSyncStore.setState({ status: "off", message: err.code === "not_entitled" ? "Cloud sync is part of AlgoVerse Pro." : "Please sign in again to sync." });
          return;
        }
        useSyncStore.setState({ status: "error", message: "Sync failed. Your changes are saved on this device and will sync later." });
      } else {
        useSyncStore.setState({ status: "offline", message: null });
      }
    }
  });
  return chain;
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void syncNow(), PUSH_DELAY_MS);
}

function enqueue(uid: string, ops: SyncOp[]) {
  const meta = readMeta();
  let metaChanged = false;
  const accepted: SyncOp[] = [];
  for (const op of ops) {
    if (op.t !== "note") {
      accepted.push(op);
      continue;
    }
    const key = noteKey(op.id, op.kind);
    if (tooLong(op)) {
      // Too long to sync: stays on this device only (and is never overwritten by cloud changes).
      meta.unsyncedNotes[key] = { reason: "too_long" };
      metaChanged = true;
      continue;
    }
    const flag = meta.unsyncedNotes[key];
    if (flag) {
      // A new edit within the limit is the user's chosen version: it replaces the cloud copy.
      delete meta.unsyncedNotes[key];
      metaChanged = true;
      accepted.push(flag.serverVersion !== undefined ? { ...op, base: flag.serverVersion } : op);
      continue;
    }
    accepted.push(op);
  }
  if (metaChanged) writeMeta(meta);
  if (accepted.length) writeOutbox(uid, coalesce([...readOutbox(uid), ...accepted]));
  else if (metaChanged) publishUnsynced(meta);
}

// ------------------------------------------------------------------ preferences (theme)

let preferencesHandler: { current: () => ThemePreference; apply: (theme: ThemePreference) => void } | null = null;

/** The theme provider registers how to read and apply the theme (a cookie, not in the store). */
export function registerPreferencesHandler(handler: typeof preferencesHandler) {
  preferencesHandler = handler;
}

/** A theme change made on this device (last write wins across devices). */
export function recordPreference(theme: ThemePreference) {
  const meta = readMeta();
  const at = Date.now();
  writeMeta({ ...meta, prefs: { theme, at } });
  const owner = meta.ownerUserId;
  if (owner) recordFor(owner, [{ t: "prefs", theme, at }]);
}

/**
 * "Use this device's version" for a note whose two versions were too long to merge: uploads
 * the local text as the new cloud version (only if it's within the size limit).
 */
export function uploadDeviceNote(key: string): boolean {
  const meta = readMeta();
  const flag = meta.unsyncedNotes[key];
  const owner = meta.ownerUserId;
  if (!flag || !owner) return false;
  const [, id, kind] = key.split(":");
  const content = useAppStore.getState()[NOTE_FIELD[kind as NoteKind]]?.[Number(id)] ?? "";
  if (content.length > SYNC_LIMITS.maxNoteChars) return false;
  enqueue(owner, [{ t: "note", id: Number(id), kind: kind as NoteKind, content, base: flag.serverVersion ?? 0, at: Date.now() }]);
  schedulePush();
  return true;
}

/** Start syncing the store with `uid`'s cloud data. The store must already be hydrated. */
export function startSync(uid: string) {
  if (running?.uid === uid) return;
  stopSync();
  const meta = readMeta();
  writeMeta({ ...meta, ownerUserId: uid, declinedFor: meta.declinedFor === uid ? null : meta.declinedFor });
  ensureJournal();
  const onOnline = () => void syncNow();
  const onVisible = () => {
    if (document.visibilityState === "visible") void syncNow();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  const interval = setInterval(() => {
    if (document.visibilityState === "visible") void syncNow();
  }, PERIODIC_MS);
  running = {
    uid,
    cleanup: () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    },
  };
  useSyncStore.setState({ pending: readOutbox(uid).length, message: null });
  publishUnsynced(readMeta());
  void syncNow();
}

export function stopSync() {
  clearTimeout(pushTimer);
  if (!running) return;
  running.cleanup();
  running = null;
  useSyncStore.setState({ status: "off" });
}

export function isSyncRunning(uid?: string): boolean {
  return !!running && (!uid || running.uid === uid);
}

// ------------------------------------------------------------------ first-login choices

/** "Import and merge": queue this device's data for the account, then sync. Idempotent. */
export function importDeviceAndStart(uid: string) {
  const meta = readMeta();
  writeMeta({ ...meta, ownerUserId: uid, importedAt: Date.now(), declinedFor: null });
  ensureJournal();
  enqueue(uid, importOps(snapshotFromStore()));
  startSync(uid);
}

/** Copy of everything this device holds, kept forever under a new key (never read back automatically). */
export function backupLocalData(reason: string): string {
  const key = `${LOCAL_BACKUP_PREFIX}${new Date().toISOString()}`;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        reason,
        store: window.localStorage.getItem("dsa-roadmap-storage"),
        syncMeta: window.localStorage.getItem(SYNC_META_KEY),
        outbox: window.localStorage.getItem(SYNC_OUTBOX_KEY),
      })
    );
  } catch {
    /* if even the backup can't be written, the caller must not replace anything */
    throw new Error("backup_failed");
  }
  return key;
}

/**
 * "Use this account's cloud data" on a device that holds another account's progress:
 * back the device data up, then replace the store with the account's cloud data.
 */
export async function switchToCloudAndStart(uid: string): Promise<string> {
  const backupKey = backupLocalData(`switch to account ${uid.slice(0, 6)}…`);
  stopSync();
  const cloud = await request<PullResponse>("GET", "/api/sync?since=0");
  writeMeta(freshMeta({ ownerUserId: uid, cursor: cloud.cursor, prefs: readMeta().prefs }));
  try {
    window.localStorage.removeItem(SYNC_OUTBOX_KEY); // the other account's unsent changes are in the backup
  } catch {
    /* ignore */
  }
  ensureJournal(); // retarget the journal to the new owner before replacing the store
  applyChanges(uid, cloud, "replace");
  startSync(uid);
  return backupKey;
}

/** "Keep on this device only": don't sync this account here (can be turned on later). */
export function declineSync(uid: string) {
  writeMeta({ ...readMeta(), declinedFor: uid });
}
