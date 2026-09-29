/**
 * Per-account local workspaces (browser only).
 *
 * The app's progress store (`dsa-roadmap-storage`) and the sync bookkeeping (meta, outbox, held
 * edits) are the device's LIVE data. They belong to exactly one owner at a time:
 *   "guest"       — nobody signed in on this device (anonymous, local-only progress)
 *   "user:<uid>"  — a Firebase account (the Firebase client user, so it also works offline)
 * When the owner changes (sign-out, a different account signs in), the live data is MOVED into a
 * parked copy for its owner (`algoverse-workspace:<owner>`) and the new owner's parked copy
 * becomes live. Nothing is ever deleted: every account's local data stays on the device and comes
 * back when that account signs in again. One account's progress, notes, bookmarks, streak or
 * sync state is never shown to — or merged into — another account.
 *
 * Guest progress moves into an account only when that is clearly the same person:
 *   - automatically, for an account created on this device moments ago (sign-up keeps progress);
 *   - otherwise only when the user chooses "Add to this account" (adoptGuestProgress).
 *
 * Existing devices (before workspaces existed): data that was synced with account X belongs to X;
 * anything else is guest data — never handed to whichever account happens to sign in next.
 */
import { useAppStore, STORAGE_KEY } from "@/lib/store";
import { withWritesPaused } from "@/lib/storage-adapter";
import { HELD_KEY, SYNC_META_KEY, SYNC_OUTBOX_KEY, ensureJournal, readMeta, stopJournal, stopSync } from "@/lib/sync/engine";
import { EMPTY_LEGACY, mergeLegacy } from "@/lib/sync/merge";
import type { CompletedMap, LegacyProgress } from "@/lib/types";

export type WorkspaceOwner = "guest" | `user:${string}`;
export const GUEST: WorkspaceOwner = "guest";
export const userOwner = (uid: string): WorkspaceOwner => `user:${uid}`;

export const ACTIVE_OWNER_KEY = "algoverse-workspace-active";
export const PARKED_PREFIX = "algoverse-workspace:";
const NEW_ACCOUNT_PREFIX = "algoverse-new-account:";
const GUEST_DECLINED_PREFIX = "algoverse-guest-declined:";
/** Everything that belongs to the active owner. */
export const WORKSPACE_KEYS = [STORAGE_KEY, SYNC_META_KEY, SYNC_OUTBOX_KEY, HELD_KEY] as const;

interface Parked {
  owner: WorkspaceOwner;
  savedAt: string;
  keys: Partial<Record<(typeof WORKSPACE_KEYS)[number], string>>;
}

export class WorkspaceError extends Error {}

const ls = () => window.localStorage;

function readParked(owner: WorkspaceOwner): Parked | null {
  try {
    const raw = ls().getItem(PARKED_PREFIX + owner);
    const p = raw ? (JSON.parse(raw) as Parked) : null;
    return p && typeof p.keys === "object" && p.keys ? p : null;
  } catch {
    return null;
  }
}

/** Owner of the live data. Before workspaces existed: the account it was synced with, else guest. */
export function activeOwner(): WorkspaceOwner {
  try {
    const stored = ls().getItem(ACTIVE_OWNER_KEY);
    if (stored === GUEST || stored?.startsWith("user:")) return stored as WorkspaceOwner;
  } catch {
    /* fall through */
  }
  const synced = readMeta().ownerUserId;
  return synced ? userOwner(synced) : GUEST;
}

/** Which owner's data this tab's in-memory store currently holds. */
let tabOwner: WorkspaceOwner | null = null;

/** Replace the in-memory store with what storage holds for the live owner (never writes storage). */
function reloadStoreFromStorage() {
  withWritesPaused(() => {
    const s = useAppStore.getState();
    useAppStore.setState({
      completed: {},
      bookmarked: [],
      notes: {},
      mistakes: {},
      code: {},
      streak: { current: 0, longest: 0, lastActiveDate: null, activeDates: [] },
      legacy: EMPTY_LEGACY,
      lastVisitedId: null,
      hydrated: s.hydrated,
    });
  });
  void useAppStore.persist.rehydrate();
}

function hasProgress(storeJson: string | null | undefined): boolean {
  if (!storeJson) return false;
  try {
    const st = (JSON.parse(storeJson) as { state?: Record<string, unknown> }).state ?? {};
    const nonEmpty = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v && typeof v === "object" && Object.keys(v).length > 0);
    const legacy = (st.legacy ?? {}) as Record<string, unknown>;
    return ["completed", "bookmarked", "notes", "mistakes", "code"].some((k) => nonEmpty(st[k])) || Object.values(legacy).some(nonEmpty);
  } catch {
    return false;
  }
}

export interface ActivateResult {
  owner: WorkspaceOwner;
  /** The live data changed owner (parked + loaded). */
  switched: boolean;
  /** Guest progress was moved into this (brand-new) account. */
  adoptedGuest: boolean;
}

/**
 * Make `target` the owner of the live data. Idempotent. Throws WorkspaceError (changing nothing)
 * if the current owner's data can't be parked safely — e.g. storage is full.
 */
export function activateWorkspace(target: WorkspaceOwner): ActivateResult {
  const current = activeOwner();
  let switched = false;
  let adoptedGuest = false;

  if (current !== target) {
    stopSync(); // in-flight sync for the previous owner is now stale (lib/sync/engine.ts)
    stopJournal();
    const live: Parked["keys"] = {};
    for (const k of WORKSPACE_KEYS) {
      const v = ls().getItem(k);
      if (v !== null) live[k] = v;
    }
    const newAccount = target !== GUEST && consumeNewAccountFlag(target);
    if (current === GUEST && newAccount && !readParked(target)) {
      // Signed up on this device just now: the signed-out progress is this person's — keep it live.
      adoptedGuest = hasProgress(live[STORAGE_KEY]);
      // The guest's sync bookkeeping is meaningless for the account; its progress becomes the account's.
      for (const k of [SYNC_META_KEY, SYNC_OUTBOX_KEY, HELD_KEY]) ls().removeItem(k);
    } else {
      const parked: Parked = { owner: current, savedAt: new Date().toISOString(), keys: live };
      const text = JSON.stringify(parked);
      try {
        ls().setItem(PARKED_PREFIX + current, text);
      } catch {
        throw new WorkspaceError("park_failed");
      }
      if (ls().getItem(PARKED_PREFIX + current) !== text) throw new WorkspaceError("park_failed");
      // Parked safely: now load the target's data into the live keys.
      const next = readParked(target);
      for (const k of WORKSPACE_KEYS) {
        const v = next?.keys[k];
        if (typeof v === "string") ls().setItem(k, v);
        else ls().removeItem(k);
      }
      ls().removeItem(PARKED_PREFIX + target); // it is live now (one copy per owner)
    }
    ls().setItem(ACTIVE_OWNER_KEY, target);
    switched = true;
  } else {
    try {
      if (ls().getItem(ACTIVE_OWNER_KEY) !== target) ls().setItem(ACTIVE_OWNER_KEY, target); // record the inferred owner
    } catch {
      /* ignore */
    }
  }

  // This tab's memory may hold another owner's data (switched here, or by another tab).
  if (switched || tabOwner !== target) {
    if (switched || tabOwner !== null) reloadStoreFromStorage();
    ensureJournal();
  }
  tabOwner = target;
  return { owner: target, switched, adoptedGuest };
}

/** Another tab changed the active owner: reload this tab's store so it never writes stale data over it. */
export function followOtherTab(): WorkspaceOwner | null {
  const owner = activeOwner();
  if (tabOwner === null || tabOwner === owner) return null;
  stopSync();
  stopJournal();
  reloadStoreFromStorage();
  ensureJournal();
  tabOwner = owner;
  return owner;
}

// ------------------------------------------------------------------ new accounts + guest progress

/** Called by the auth provider when an account is created in this browser (sign-up). */
export function markNewAccount(uid: string) {
  try {
    window.sessionStorage.setItem(NEW_ACCOUNT_PREFIX + uid, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function consumeNewAccountFlag(owner: WorkspaceOwner): boolean {
  const uid = owner.slice("user:".length);
  try {
    const at = Number(window.sessionStorage.getItem(NEW_ACCOUNT_PREFIX + uid));
    window.sessionStorage.removeItem(NEW_ACCOUNT_PREFIX + uid);
    return Number.isFinite(at) && at > 0 && Date.now() - at < 10 * 60_000;
  } catch {
    return false;
  }
}

export interface GuestSummary {
  completed: number;
  bookmarks: number;
  notes: number;
}

function guestState(): Record<string, unknown> | null {
  const p = readParked(GUEST);
  const raw = p?.keys[STORAGE_KEY];
  if (!raw || !hasProgress(raw)) return null;
  try {
    return (JSON.parse(raw) as { state?: Record<string, unknown> }).state ?? null;
  } catch {
    return null;
  }
}

/** Signed-out progress kept on this device, if an account could choose to add it. */
export function guestProgressFor(uid: string): GuestSummary | null {
  if (activeOwner() !== userOwner(uid)) return null;
  try {
    if (ls().getItem(GUEST_DECLINED_PREFIX + uid)) return null;
  } catch {
    /* ignore */
  }
  const st = guestState();
  if (!st) return null;
  const count = (v: unknown) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0);
  const notes = new Set([...Object.keys((st.notes as object) ?? {}), ...Object.keys((st.mistakes as object) ?? {}), ...Object.keys((st.code as object) ?? {})]);
  return { completed: count(st.completed), bookmarks: count(st.bookmarked), notes: notes.size };
}

/** "Keep separate": don't ask this account again on this device. */
export function declineGuestProgress(uid: string) {
  try {
    ls().setItem(GUEST_DECLINED_PREFIX + uid, "1");
  } catch {
    /* ignore */
  }
}

const NOTE_SEPARATOR = "\n\n--- Added from this device's signed-out progress ---\n";

/** Pure merge of guest progress into an account's progress. Nothing is dropped. */
export function mergeGuestInto(
  account: { completed: CompletedMap; bookmarked: number[]; notes: Record<number, string>; mistakes: Record<number, string>; code: Record<number, string>; legacy: LegacyProgress; longest: number },
  guest: { completed?: CompletedMap; bookmarked?: number[]; notes?: Record<number, string>; mistakes?: Record<number, string>; code?: Record<number, string>; legacy?: LegacyProgress; longest?: number }
) {
  const completed: CompletedMap = { ...account.completed };
  for (const [id, at] of Object.entries(guest.completed ?? {})) {
    const mine = completed[Number(id)];
    completed[Number(id)] = mine && mine <= at ? mine : at; // earliest completion wins
  }
  const bookmarked = [...account.bookmarked];
  for (const id of guest.bookmarked ?? []) if (!bookmarked.includes(id)) bookmarked.push(id);
  const text = (mine: Record<number, string>, theirs: Record<number, string> = {}) => {
    const out = { ...mine };
    for (const [id, t] of Object.entries(theirs)) {
      const k = Number(id);
      if (!t) continue;
      if (!out[k]) out[k] = t;
      else if (out[k] !== t && !out[k].includes(t)) out[k] = `${out[k]}${NOTE_SEPARATOR}${t}`; // keep both
    }
    return out;
  };
  return {
    completed,
    bookmarked,
    notes: text(account.notes, guest.notes),
    mistakes: text(account.mistakes, guest.mistakes),
    code: text(account.code, guest.code),
    legacy: mergeLegacy(account.legacy, guest.legacy ?? EMPTY_LEGACY),
    longestStreak: Math.max(account.longest, guest.longest ?? 0),
  };
}

/**
 * "Add to this account": moves the signed-out progress into the signed-in account's live data
 * (merged; the account's own data is kept). Recorded like normal edits, so Pro sync uploads it.
 */
export function adoptGuestProgress(uid: string): boolean {
  if (activeOwner() !== userOwner(uid)) return false;
  const st = guestState();
  if (!st) return false;
  const s = useAppStore.getState();
  const merged = mergeGuestInto(
  { completed: s.completed, bookmarked: s.bookmarked, notes: s.notes, mistakes: s.mistakes, code: s.code, legacy: s.legacy, longest: s.streak.longest ?? 0 },
    {
      completed: st.completed as CompletedMap,
      bookmarked: st.bookmarked as number[],
      notes: st.notes as Record<number, string>,
      mistakes: st.mistakes as Record<number, string>,
      code: st.code as Record<number, string>,
      legacy: st.legacy as LegacyProgress,
      longest: (st.streak as { longest?: number } | undefined)?.longest ?? 0,
    }
  );
  s.applySync(merged);
  try {
    ls().removeItem(PARKED_PREFIX + GUEST); // moved into the account
  } catch {
    /* ignore */
  }
  return true;
}

/** Tests only: forget which owner this (simulated) tab loaded, as on a fresh page load. */
export function __resetTabForTests() {
  tabOwner = null;
}
