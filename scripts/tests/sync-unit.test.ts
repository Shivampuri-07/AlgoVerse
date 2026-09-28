// Unit tests for cloud sync: conflict rules (lib/sync/merge.ts), store diffs and import ops
// (lib/sync/diff.ts), and request validation (lib/sync/server.ts parseOps). No Firebase needed.
// Run: npm run test:sync-unit
import { test } from "node:test";
import assert from "node:assert/strict";

const merge = await import("@/lib/sync/merge");
const diff = await import("@/lib/sync/diff");
const { parseOps } = await import("@/lib/sync/server");

const T = 1_700_000_000_000;

test("completion: earliest date wins; completing again later doesn't move it", () => {
  const a = merge.mergeProgress(null, { completedAt: "2026-09-10T00:00:00.000Z", at: T });
  assert.deepEqual(a, { completedAt: "2026-09-10T00:00:00.000Z", deleted: false, at: T });
  const b = merge.mergeProgress(a, { completedAt: "2026-09-05T00:00:00.000Z", at: T + 10 });
  assert.equal(b?.completedAt, "2026-09-05T00:00:00.000Z", "earlier completion from another device wins");
  assert.equal(merge.mergeProgress(b, { completedAt: "2026-09-20T00:00:00.000Z", at: b!.at }), null, "later date, same time: no change");
});

test("un-complete (tombstone) wins only if newer than the completion", () => {
  const done = { completedAt: "2026-09-10T00:00:00.000Z", deleted: false, at: T + 100 };
  assert.equal(merge.mergeProgress(done, { completedAt: null, at: T + 50 }), null, "stale un-complete ignored");
  assert.deepEqual(merge.mergeProgress(done, { completedAt: null, at: T + 200 }), { completedAt: null, deleted: true, at: T + 200 });
  const tomb = { completedAt: null, deleted: true, at: T + 200 };
  assert.equal(merge.mergeProgress(tomb, { completedAt: "2026-09-10T00:00:00.000Z", at: T + 100 }), null, "older completion doesn't resurrect");
  assert.equal(merge.mergeProgress(tomb, { completedAt: "2026-09-11T00:00:00.000Z", at: T + 300 })?.deleted, false, "newer completion does");
  // Idempotent: applying the same op twice changes nothing the second time.
  const once = merge.mergeProgress(null, { completedAt: "2026-09-10T00:00:00.000Z", at: T });
  assert.equal(merge.mergeProgress(once, { completedAt: "2026-09-10T00:00:00.000Z", at: T }), null);
});

test("bookmark: last write wins by client time", () => {
  const on = merge.mergeBookmark(null, { on: true, at: T });
  assert.deepEqual(on, { on: true, at: T });
  assert.equal(merge.mergeBookmark(on, { on: false, at: T - 1 }), null);
  assert.deepEqual(merge.mergeBookmark(on, { on: false, at: T + 1 }), { on: false, at: T + 1 });
});

test("notes: edits of the latest version replace; identical text is a no-op", () => {
  const v1 = merge.mergeNote(null, { content: "two pointers", base: 0, at: T }).next!;
  assert.equal(v1.version, 1);
  const v2 = merge.mergeNote(v1, { content: "two pointers, O(n)", base: 1, at: T + 1 });
  assert.deepEqual([v2.next?.content, v2.next?.version, v2.conflict], ["two pointers, O(n)", 2, false]);
  assert.deepEqual(merge.mergeNote(v2.next, { content: "two pointers, O(n)", base: 0, at: T + 5 }), { next: null, conflict: false });
});

test("notes: concurrent edits keep BOTH texts (newer first); nothing is silently lost", () => {
  const server = { content: "laptop version", version: 3, deleted: false, at: T + 100 };
  const r = merge.mergeNote(server, { content: "phone version", base: 2, at: T + 200 });
  assert.equal(r.conflict, true);
  assert.equal(r.next?.version, 4);
  assert.ok(r.next!.content.startsWith("phone version"));
  assert.match(r.next!.content, /--- Conflicting copy/);
  assert.ok(r.next!.content.endsWith("laptop version"));
  // A stale clear never deletes newer text.
  assert.deepEqual(merge.mergeNote(server, { content: "", base: 1, at: T + 300 }), { next: null, conflict: true });
  // Appending to the server text is not a conflict.
  const appended = merge.mergeNote(server, { content: "laptop version + more", base: 2, at: T + 300 });
  assert.equal(appended.conflict, false);
  assert.equal(appended.next?.content, "laptop version + more");
  // Clearing the latest version deletes it.
  assert.equal(merge.mergeNote(server, { content: "", base: 3, at: T + 300 }).next?.deleted, true);
});

test("streak and legacy: max and union", () => {
  const m1 = merge.mergeMeta(null, { longest: 5 })!;
  assert.equal(m1.longestStreak, 5);
  assert.equal(merge.mergeMeta(m1, { longest: 3 }), null, "never lowers");
  const la = { completed: { 3: "2026-01-02T00:00:00.000Z" }, bookmarked: [1], notes: { 3: "a" }, mistakes: {}, code: {} };
  const lb = { completed: { 3: "2026-01-01T00:00:00.000Z", 9: "2026-02-01T00:00:00.000Z" }, bookmarked: [2, 1], notes: { 3: "b" }, mistakes: {}, code: {} };
  const u = merge.mergeLegacy(la, lb);
  assert.deepEqual(u.completed, { 3: "2026-01-01T00:00:00.000Z", 9: "2026-02-01T00:00:00.000Z" });
  assert.deepEqual(u.bookmarked, [1, 2]);
  assert.equal(u.notes[3], "a\n\nb");
});

const EMPTY = { completed: {}, bookmarked: [], notes: {}, mistakes: {}, code: {}, longestStreak: 0, legacy: merge.EMPTY_LEGACY };

test("store diff → ops, including removals and note bases", () => {
  const prev = { ...EMPTY, completed: { 1: "2026-09-01T00:00:00.000Z", 2: "2026-09-02T00:00:00.000Z" }, bookmarked: [5], notes: { 7: "old" } };
  const next = { ...EMPTY, completed: { 2: "2026-09-02T00:00:00.000Z", 3: "2026-09-03T00:00:00.000Z" }, bookmarked: [6], notes: { 7: "new" }, longestStreak: 4 };
  const ops = diff.diffSnapshots(prev, next, (k) => (k === "n:7:note" ? 2 : 0), T);
  assert.deepEqual(
    ops.map((o) => JSON.stringify(o)).sort(),
    [
      { t: "progress", id: 1, completedAt: null, at: T },
      { t: "progress", id: 3, completedAt: "2026-09-03T00:00:00.000Z", at: T },
      { t: "bookmark", id: 6, on: true, at: T },
      { t: "bookmark", id: 5, on: false, at: T },
      { t: "note", id: 7, kind: "note", content: "new", base: 2, at: T },
      { t: "streak", longest: 4, at: T },
    ].map((o) => JSON.stringify(o)).sort()
  );
  assert.deepEqual(diff.diffSnapshots(next, next, () => 0, T), [], "no change → no ops");
});

test("import ops add only (never delete) and keep original completion dates", () => {
  const s = { ...EMPTY, completed: { 4: "2026-08-01T10:00:00.000Z" }, bookmarked: [4], code: { 4: "int main(){}" }, longestStreak: 2 };
  const ops = diff.importOps(s, T);
  assert.ok(ops.every((o) => !(o.t === "progress" && o.completedAt === null) && !(o.t === "bookmark" && !o.on)));
  const p = ops.find((o) => o.t === "progress");
  assert.equal(p && p.t === "progress" && p.at, Date.parse("2026-08-01T10:00:00.000Z"));
  assert.ok(ops.some((o) => o.t === "note" && o.kind === "code" && o.base === 0));
  assert.equal(diff.snapshotIsEmpty(EMPTY), true);
  assert.equal(diff.snapshotIsEmpty(s), false);
});

test("coalesce keeps the newest op per item and the FIRST base of a note", () => {
  const out = diff.coalesce([
    { t: "note", id: 1, kind: "note", content: "a", base: 3, at: T },
    { t: "progress", id: 2, completedAt: "2026-01-01T00:00:00.000Z", at: T },
    { t: "note", id: 1, kind: "note", content: "ab", base: 4, at: T + 1 },
    { t: "progress", id: 2, completedAt: null, at: T + 2 },
    { t: "streak", longest: 5, at: T },
    { t: "streak", longest: 3, at: T + 3 },
  ]);
  assert.equal(out.length, 3);
  const note = out.find((o) => o.t === "note");
  assert.deepEqual(note && note.t === "note" && [note.content, note.base], ["ab", 3]);
  const prog = out.find((o) => o.t === "progress");
  assert.equal(prog && prog.t === "progress" && prog.completedAt, null);
  const streak = out.find((o) => o.t === "streak");
  assert.equal(streak && streak.t === "streak" && streak.longest, 5);
});

test("request validation rejects malformed or oversized ops", () => {
  assert.ok(parseOps([{ t: "progress", id: 12, completedAt: "2026-09-01T00:00:00.000Z", at: T }]));
  for (const bad of [
    null,
    {},
    [{ t: "progress", id: -1, completedAt: null, at: T }],
    [{ t: "progress", id: 1.5, completedAt: null, at: T }],
    [{ t: "progress", id: 1, completedAt: "yesterday", at: T }],
    [{ t: "note", id: 1, kind: "diary", content: "x", base: 0, at: T }],
    [{ t: "note", id: 1, kind: "note", content: "x".repeat(50_001), base: 0, at: T }],
    [{ t: "bookmark", id: 1, on: "yes", at: T }],
    [{ t: "streak", longest: 1, at: "now" }],
    [{ t: "legacy", legacy: { completed: { 1: "x" } }, at: T }],
    [{ t: "admin", at: T }],
    Array.from({ length: 501 }, (_, i) => ({ t: "bookmark", id: i + 1, on: true, at: T })),
  ]) {
    assert.equal(parseOps(bad), null, `rejects ${JSON.stringify(bad)?.slice(0, 60)}`);
  }
});

test("notes: if keeping both versions would exceed the size limit, nothing is merged or truncated", () => {
  const big = "x".repeat(30_000);
  const server = { content: big, version: 2, deleted: false, at: T + 100 };
  const r = merge.mergeNote(server, { content: "y".repeat(30_000), base: 1, at: T + 200 });
  assert.deepEqual(r, { next: null, conflict: true, overflow: true });
  // Within the limit the normal "keep both" merge still applies.
  const small = merge.mergeNote({ ...server, content: "a" }, { content: "b", base: 1, at: T + 200 });
  assert.equal(small.overflow, undefined);
  assert.equal(small.conflict, true);
});

test("preferences: last write wins by client time", () => {
  const m1 = merge.mergeMeta(null, { prefs: { theme: "dark", at: T } })!;
  assert.deepEqual(m1.preferences, { theme: "dark", at: T });
  assert.equal(merge.mergeMeta(m1, { prefs: { theme: "light", at: T - 1 } }), null, "older change ignored");
  assert.deepEqual(merge.mergeMeta(m1, { prefs: { theme: "light", at: T + 1 } })!.preferences, { theme: "light", at: T + 1 });
  const withStreak = merge.mergeMeta(m1, { longest: 4 })!;
  assert.deepEqual(withStreak.preferences, m1.preferences, "other meta updates keep preferences");
});

test("preference ops are validated and coalesced", () => {
  assert.deepEqual(parseOps([{ t: "prefs", theme: "dark", at: T }]), [{ t: "prefs", theme: "dark", at: T }]);
  assert.equal(parseOps([{ t: "prefs", theme: "blue", at: T }]), null);
  const out = diff.coalesce([
    { t: "prefs", theme: "dark", at: T },
    { t: "prefs", theme: "system", at: T + 1 },
  ]);
  assert.deepEqual(out, [{ t: "prefs", theme: "system", at: T + 1 }]);
});

// ---------------------------------------------------------------- plans (Phase 3)

const plans = await import("@/lib/plans");

test("approved plans: all problems free; articles, videos and sync are Pro; config matches enforcement", () => {
  const row = (id: string) => plans.FEATURE_MATRIX.find((r) => r.id === id)!;
  assert.deepEqual([row("problems").free, row("problems").pro], ["Unlimited access", "Unlimited access"]);
  for (const id of ["navigation", "local-progress", "local-data", "account"]) assert.equal(row(id).free, true, `${id} free`);
  for (const id of ["articles", "videos", "cloud-sync"]) {
    assert.equal(row(id).free, false, `${id} not in Free`);
    assert.equal(row(id).pro, true, `${id} in Pro`);
    assert.equal(row(id).availability, "available");
  }
  for (const id of ["ai-helper", "analytics", "interview-prep", "personal-roadmap"]) assert.equal(row(id).availability, "planned", `${id} planned`);
  assert.equal(plans.PLANS.free.features.learningResources, false);
  assert.equal(plans.PLANS.pro.features.learningResources, true);
  assert.equal(plans.PLANS.free.features.cloudSync, false);
  assert.equal(plans.PLANS.pro.features.cloudSync, true);
  assert.equal(plans.PRICING.proMonthly, 30);
  assert.equal(plans.PRICING.approved, true);
  assert.equal(plans.PRICING.paymentsEnabled, false, "no checkout before Phase 4");
  assert.equal(plans.PLAN_SUMMARY, "All 455 DSA problems are free. Pro unlocks articles, videos, and cloud sync.");
  const { available, planned } = plans.proBenefits();
  assert.deepEqual(available.map((r) => r.id), ["articles", "videos", "cloud-sync"]);
  assert.deepEqual(planned.map((r) => r.id), ["ai-helper", "analytics", "interview-prep", "personal-roadmap"]);
});
