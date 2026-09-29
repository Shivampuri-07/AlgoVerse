// Account isolation on one device (lib/workspace.ts + lib/sync/engine.ts), with the real app store,
// real sync engine and an in-memory localStorage. No Firebase needed.
// Run: npm run test:workspace
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---- a minimal browser: localStorage, sessionStorage, events, document
class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}
const local = new MemoryStorage();
const session = new MemoryStorage();
const g = globalThis as Record<string, unknown>;
g.window = { localStorage: local, sessionStorage: session, addEventListener() {}, removeEventListener() {}, location: { origin: "http://localhost" } };
g.document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

const { useAppStore, STORAGE_KEY } = await import("@/lib/store");
const ws = await import("@/lib/workspace");
const engine = await import("@/lib/sync/engine");

const A = "uidAAAAAAAAAAAAAAAAAAAAAAAAA";
const B = "uidBBBBBBBBBBBBBBBBBBBBBBBBB";
const s = () => useAppStore.getState();
const completedIds = () => Object.keys(s().completed).sort();
const stored = () => JSON.parse(local.getItem(STORAGE_KEY) ?? "null")?.state ?? null;

async function freshDevice(seed?: { store?: unknown; meta?: unknown }) {
  engine.stopSync();
  local.clear();
  session.clear();
  if (seed?.store) local.setItem(STORAGE_KEY, JSON.stringify({ state: seed.store, version: 2 }));
  if (seed?.meta) local.setItem(engine.SYNC_META_KEY, JSON.stringify(seed.meta));
  // Simulate a page load: the app store rehydrates from storage (StoreHydration).
  ws.__resetTabForTests?.();
  await useAppStore.persist.rehydrate();
}
const progress = (ids: number[], extra: Record<string, unknown> = {}) => ({
  completed: Object.fromEntries(ids.map((id) => [id, `2026-09-${String(10 + id).padStart(2, "0")}T00:00:00.000Z`])),
  bookmarked: ids.slice(0, 1),
  notes: Object.fromEntries(ids.map((id) => [id, `note ${id}`])),
  mistakes: {},
  code: {},
  streak: { current: 0, longest: 3, lastActiveDate: null, activeDates: [] },
  lastVisitedId: ids[0] ?? null,
  ...extra,
});

beforeEach(() => engine.setSyncIdentity({ state: "loading" }));

test("A → sign out → B: B never sees A's progress; A's data is kept and comes back", async () => {
  await freshDevice({ store: progress([1, 2, 3]), meta: { ownerUserId: A, cursor: 5, noteVersions: {} } });
  // Existing device: data synced with A belongs to A.
  ws.activateWorkspace(ws.userOwner(A));
  assert.deepEqual(completedIds(), ["1", "2", "3"], "A sees A's progress");

  ws.activateWorkspace(ws.GUEST); // A signs out
  assert.deepEqual(completedIds(), [], "signed out: A's progress is not shown");
  assert.deepEqual([Object.keys(stored()?.completed ?? {}), Object.keys(stored()?.notes ?? {})], [[], []], "live storage holds none of A's data");

  s().setCompleted(40, true); // signed-out practice stays usable
  assert.deepEqual(completedIds(), ["40"]);

  ws.activateWorkspace(ws.userOwner(B)); // B signs in (existing account, first time here)
  assert.deepEqual(completedIds(), [], "B starts with B's own (empty) data — not A's, not the guest's");
  assert.deepEqual(Object.keys(s().notes), [], "no notes leak");
  assert.deepEqual(s().bookmarked, [], "no bookmarks leak");
  assert.equal(s().streak.longest, 0, "no streak leak");
  assert.equal(engine.readMeta().ownerUserId, null, "B doesn't inherit A's sync state");
  s().setCompleted(7, true);

  ws.activateWorkspace(ws.GUEST);
  assert.deepEqual(completedIds(), ["40"], "guest progress preserved");
  ws.activateWorkspace(ws.userOwner(A));
  assert.deepEqual(completedIds(), ["1", "2", "3"], "A's progress back, intact");
  assert.equal(s().notes[2], "note 2");
  assert.equal(engine.readMeta().ownerUserId, A);
  assert.equal(engine.readMeta().cursor, 5, "A's sync cursor restored");
  ws.activateWorkspace(ws.userOwner(B));
  assert.deepEqual(completedIds(), ["7"], "B's own progress back");
});

test("A → B directly (no sign-out in between) also isolates, and switching is idempotent", async () => {
  await freshDevice({ store: progress([5]), meta: { ownerUserId: A, cursor: 0, noteVersions: {} } });
  ws.activateWorkspace(ws.userOwner(A));
  ws.activateWorkspace(ws.userOwner(B));
  assert.deepEqual(completedIds(), []);
  const r = ws.activateWorkspace(ws.userOwner(B));
  assert.equal(r.switched, false, "no-op when already active");
  ws.activateWorkspace(ws.userOwner(A));
  assert.deepEqual(completedIds(), ["5"]);
});

test("existing device never synced: its progress is guest data — never given to the next account automatically", async () => {
  await freshDevice({ store: progress([1, 2]) });
  ws.activateWorkspace(ws.userOwner(B)); // B signs in on a device whose data was never synced
  assert.deepEqual(completedIds(), [], "B doesn't get it");
  assert.deepEqual(ws.guestProgressFor(B), { completed: 2, bookmarks: 1, notes: 2 }, "offered, not applied");
  ws.declineGuestProgress(B);
  assert.equal(ws.guestProgressFor(B), null, "Keep separate: not asked again");
  ws.activateWorkspace(ws.GUEST);
  assert.deepEqual(completedIds(), ["1", "2"], "still on the device");
  // The owner signs in and explicitly adds it.
  ws.activateWorkspace(ws.userOwner(A));
  assert.deepEqual(completedIds(), []);
  assert.ok(ws.guestProgressFor(A));
  assert.equal(ws.adoptGuestProgress(A), true);
  assert.deepEqual(completedIds(), ["1", "2"], "the owner got it back by choosing to");
  assert.equal(ws.guestProgressFor(A), null, "moved, not copied");
  ws.activateWorkspace(ws.GUEST);
  assert.deepEqual(completedIds(), []);
});

test("a brand-new account created on this device keeps the signed-out progress (sign-up flow)", async () => {
  await freshDevice({ store: progress([3]) });
  ws.activateWorkspace(ws.GUEST);
  const before = local.getItem(STORAGE_KEY);
  ws.markNewAccount(B);
  const r = ws.activateWorkspace(ws.userOwner(B));
  assert.equal(r.adoptedGuest, true);
  assert.deepEqual(completedIds(), ["3"]);
  assert.equal(local.getItem(STORAGE_KEY), before, "stored progress byte-for-byte unchanged");
  ws.activateWorkspace(ws.GUEST);
  assert.deepEqual(completedIds(), [], "after sign-out the account's progress is not shown");
  // Only the account created here: a different, existing account gets nothing automatically.
  s().setCompleted(9, true);
  ws.markNewAccount("someone-else");
  ws.activateWorkspace(ws.userOwner(A));
  assert.deepEqual(completedIds(), [], "the new-account flag is per account");
});

test("merging signed-out progress keeps everything from both sides", () => {
  const merged = ws.mergeGuestInto(
    { completed: { 1: "2026-09-05T00:00:00.000Z" }, bookmarked: [1], notes: { 1: "mine" }, mistakes: {}, code: { 2: "same" }, legacy: { completed: {}, bookmarked: [], notes: {}, mistakes: {}, code: {} }, longest: 2 },
    { completed: { 1: "2026-09-01T00:00:00.000Z", 4: "2026-09-02T00:00:00.000Z" }, bookmarked: [1, 4], notes: { 1: "theirs", 4: "only guest" }, code: { 2: "same" }, longest: 5 }
  );
  assert.equal(merged.completed[1], "2026-09-01T00:00:00.000Z", "earliest completion");
  assert.ok(merged.completed[4]);
  assert.deepEqual(merged.bookmarked, [1, 4]);
  assert.match(merged.notes[1], /^mine[\s\S]*theirs$/, "both texts kept");
  assert.equal(merged.notes[4], "only guest");
  assert.equal(merged.code[2], "same", "identical text not duplicated");
  assert.equal(merged.longestStreak, 5);
});

test("the previous account's outbox, held edits and sync meta never become the next account's", async () => {
  await freshDevice({ store: progress([1]), meta: { ownerUserId: A, cursor: 9, noteVersions: { "n:1:note": 3 } } });
  local.setItem(engine.SYNC_OUTBOX_KEY, JSON.stringify({ uid: A, ops: [{ t: "bookmark", id: 1, on: true, at: 1 }] }));
  local.setItem(engine.HELD_KEY, JSON.stringify({ uid: A, ops: [{ t: "bookmark", id: 2, on: true, at: 1 }] }));
  ws.activateWorkspace(ws.userOwner(A));
  ws.activateWorkspace(ws.userOwner(B));
  assert.equal(local.getItem(engine.SYNC_OUTBOX_KEY), null);
  assert.equal(local.getItem(engine.HELD_KEY), null);
  assert.deepEqual(engine.readMeta().noteVersions, {});
  ws.activateWorkspace(ws.userOwner(A));
  assert.equal(JSON.parse(local.getItem(engine.SYNC_OUTBOX_KEY)!).ops.length, 1, "A's unsent change still waiting for A");
  assert.equal(engine.readMeta().noteVersions["n:1:note"], 3);
});

test("edits made by B are never attributed to A's account", async () => {
  await freshDevice({ store: progress([1]), meta: { ownerUserId: A, cursor: 0, noteVersions: {} } });
  ws.activateWorkspace(ws.userOwner(A));
  ws.activateWorkspace(ws.userOwner(B));
  engine.setSyncIdentity({ state: "signed-in", uid: B });
  s().setCompleted(99, true);
  ws.activateWorkspace(ws.userOwner(A));
  assert.equal(s().completed[99], undefined, "B's edit isn't in A's data");
  assert.equal(local.getItem(engine.SYNC_OUTBOX_KEY), null, "nothing queued for A's cloud");
});

test("a late cloud response for A can't overwrite B's data after the switch", async () => {
  await freshDevice({ store: progress([]), meta: { ownerUserId: A, cursor: 0, noteVersions: {} } });
  ws.activateWorkspace(ws.userOwner(A));
  engine.setSyncIdentity({ state: "signed-in", uid: A });
  let release!: (r: Response) => void;
  const pending = new Promise<Response>((r) => (release = r));
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return pending;
  }) as typeof fetch;
  engine.startSync(A); // starts a pull that waits on the network
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(calls >= 1, "request in flight");
  // A signs out, B signs in.
  engine.setSyncIdentity({ state: "signed-in", uid: B });
  ws.activateWorkspace(ws.userOwner(B));
  s().setCompleted(8, true);
  // A's (late) cloud answer arrives now.
  const cloud = { progress: [{ id: 1, completedAt: "2026-09-01T00:00:00.000Z", deleted: false, at: 1 }], bookmarks: [{ id: 3, on: true, at: 1 }], notes: [{ id: 1, kind: "note", content: "A's secret note", version: 1, deleted: false, at: 1 }], meta: null, cursor: 123, more: false, notesAfter: null, conflicts: [], rejected: [] };
  release(new Response(JSON.stringify(cloud), { status: 200, headers: { "Content-Type": "application/json" } }));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(completedIds(), ["8"], "B's store untouched by A's late response");
  assert.deepEqual(s().bookmarked, []);
  assert.equal(s().notes[1], undefined);
  assert.equal(engine.readMeta().cursor, 0, "B's sync meta untouched");
  ws.activateWorkspace(ws.userOwner(A));
  assert.equal(engine.readMeta().cursor, 0, "the stale answer didn't move A's cursor either (it will be pulled again)");
});

test("parking must succeed before anything is replaced (storage full → nothing changes)", async () => {
  await freshDevice({ store: progress([1, 2]), meta: { ownerUserId: A, cursor: 0, noteVersions: {} } });
  ws.activateWorkspace(ws.userOwner(A));
  const realSet = local.setItem.bind(local);
  local.setItem = (k: string, v: string) => {
    if (k.startsWith(ws.PARKED_PREFIX)) throw new Error("QuotaExceededError");
    realSet(k, v);
  };
  assert.throws(() => ws.activateWorkspace(ws.userOwner(B)), ws.WorkspaceError);
  local.setItem = realSet;
  assert.deepEqual(Object.keys(stored().completed).sort(), ["1", "2"], "A's stored data intact");
  assert.equal(ws.activeOwner(), ws.userOwner(A));
});

test("another tab switched accounts: this tab reloads instead of keeping (and later saving) stale data", async () => {
  await freshDevice({ store: progress([1]), meta: { ownerUserId: A, cursor: 0, noteVersions: {} } });
  ws.activateWorkspace(ws.userOwner(A));
  // Simulate the other tab: park A, make B live (empty), mark B active — directly in storage.
  const aLive = local.getItem(STORAGE_KEY)!;
  local.setItem(ws.PARKED_PREFIX + ws.userOwner(A), JSON.stringify({ owner: ws.userOwner(A), savedAt: "x", keys: { [STORAGE_KEY]: aLive } }));
  local.removeItem(STORAGE_KEY);
  local.setItem(ws.ACTIVE_OWNER_KEY, ws.userOwner(B));
  assert.deepEqual(completedIds(), ["1"], "this tab still shows A in memory");
  assert.equal(ws.followOtherTab(), ws.userOwner(B));
  assert.deepEqual(completedIds(), [], "now shows B's (empty) data");
  s().setCompleted(5, true);
  ws.activateWorkspace(ws.userOwner(A));
  assert.deepEqual(completedIds(), ["1"], "A intact — the stale tab never overwrote it");
});

test("another tab switched accounts while this tab's sync for A was in flight: A's late answer is dropped", async () => {
  await freshDevice({ store: progress([]), meta: { ownerUserId: A, cursor: 0, noteVersions: {} } });
  ws.activateWorkspace(ws.userOwner(A));
  engine.setSyncIdentity({ state: "signed-in", uid: A });
  let release!: (r: Response) => void;
  globalThis.fetch = (async () => new Promise<Response>((r) => (release = r))) as typeof fetch;
  engine.startSync(A);
  await new Promise((r) => setTimeout(r, 10));
  // The OTHER tab parks A and makes B live — this tab's engine is not told (no stopSync here).
  const aLive = local.getItem(STORAGE_KEY)!;
  local.setItem(ws.PARKED_PREFIX + ws.userOwner(A), JSON.stringify({ owner: ws.userOwner(A), savedAt: "x", keys: { [STORAGE_KEY]: aLive } }));
  local.setItem(STORAGE_KEY, JSON.stringify({ state: progress([77]), version: 2 }));
  local.removeItem(engine.SYNC_META_KEY);
  local.setItem(ws.ACTIVE_OWNER_KEY, ws.userOwner(B));
  const cloud = { progress: [{ id: 1, completedAt: "2026-09-01T00:00:00.000Z", deleted: false, at: 1 }], bookmarks: [], notes: [], meta: null, cursor: 99, more: false, notesAfter: null };
  release(new Response(JSON.stringify(cloud), { status: 200 }));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(Object.keys(stored().completed), ["77"], "B's live data untouched");
  assert.equal(engine.readMeta().ownerUserId, null, "no A meta written into B's slot");
  // Edits this tab makes for A before catching up are not queued into B's outbox.
  s().setCompleted(5, true);
  assert.equal(local.getItem(engine.SYNC_OUTBOX_KEY), null);
  engine.stopSync();
});

test("switching accounts clears the previous account's sync status, conflicts and unsynced-notes list", async () => {
  await freshDevice({ store: progress([1]), meta: { ownerUserId: A, cursor: 0, noteVersions: {}, unsyncedNotes: { "n:1:note": { reason: "too_long" } } } });
  ws.activateWorkspace(ws.userOwner(A));
  engine.useSyncStore.setState({ conflicts: 3, pending: 4, message: "x", status: "synced" });
  engine.resetSyncUi();
  assert.equal(engine.useSyncStore.getState().unsynced.length, 1, "A's own list while A is active");
  engine.useSyncStore.setState({ conflicts: 3, pending: 4 });
  ws.activateWorkspace(ws.userOwner(B));
  const ui = engine.useSyncStore.getState();
  assert.deepEqual([ui.conflicts, ui.pending, ui.unsynced.length, ui.status, ui.message], [0, 0, 0, "off", null]);
});
