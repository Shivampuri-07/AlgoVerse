// Firestore security-rules tests (firestore.rules) against the local Firestore emulator.
// Proves that a client can only read its own data and can never write — in particular it
// can't grant itself a plan/subscription or touch another user's records.
// Run: npm run test:firebase   (starts the emulators and runs this file)
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";

const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-algoverse",
    firestore: { rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"), host, port: Number(port) },
  });
});
after(async () => env?.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc("users/alice").set({ displayName: "Alice" });
    await db.doc("users/bob").set({ displayName: "Bob" });
    await db.doc("users/alice/progress/12").set({ completedAt: "2026-09-01" });
    await db.doc("users/bob/progress/12").set({ completedAt: "2026-09-02" });
    await db.doc("users/bob/notes/12_note").set({ content: "bob's private note" });
    await db.doc("subscriptions/sub_alice").set({ uid: "alice", status: "active" });
    await db.doc("aiUsage/alice_2026-09-27").set({ uid: "alice", requests: 1 });
    await db.doc("entitlements/alice").set({ plan: "pro" });
    await db.doc("users/alice/meta/state").set({ longestStreak: 3 });
  });
});

const alice = () => env.authenticatedContext("alice").firestore();
const anon = () => env.unauthenticatedContext().firestore();

test("a user can read their own profile and their own private data", async () => {
  await assertSucceeds(alice().doc("users/alice").get());
  await assertSucceeds(alice().doc("users/alice/progress/12").get());
  await assertSucceeds(alice().collection("users/alice/progress").get());
});

test("a user cannot read another user's profile, progress or notes", async () => {
  await assertFails(alice().doc("users/bob").get());
  await assertFails(alice().doc("users/bob/progress/12").get());
  await assertFails(alice().collection("users/bob/progress").get());
  await assertFails(alice().doc("users/bob/notes/12_note").get());
});

test("signed-out clients can't read anything", async () => {
  await assertFails(anon().doc("users/alice").get());
  await assertFails(anon().doc("users/alice/progress/12").get());
});

test("nobody can list all users", async () => {
  await assertFails(alice().collection("users").get());
});

test("clients cannot write their own profile (e.g. to forge a plan)", async () => {
  await assertFails(alice().doc("users/alice").set({ displayName: "A", plan: "pro" }, { merge: true }));
  await assertFails(alice().doc("users/alice").update({ plan: "pro" }));
  await assertFails(alice().doc("users/alice").delete());
  await assertFails(alice().doc("users/alice2").set({ displayName: "new" }));
});

test("clients cannot write progress directly (Pro sync goes through the server)", async () => {
  await assertFails(alice().doc("users/alice/progress/13").set({ completedAt: "2026-09-27" }));
  await assertFails(alice().doc("users/bob/progress/12").set({ completedAt: "tampered" }));
  await assertFails(alice().doc("users/bob/progress/12").delete());
});

test("subscriptions and AI usage are server-only: no client reads or writes, even your own", async () => {
  await assertFails(alice().doc("subscriptions/sub_alice").get());
  await assertFails(alice().doc("subscriptions/sub_alice").set({ uid: "alice", status: "active", plan: "pro" }));
  await assertFails(alice().doc("subscriptions/forged").set({ uid: "alice", status: "active" }));
  await assertFails(alice().doc("aiUsage/alice_2026-09-27").set({ uid: "alice", requests: 0 }));
  await assertFails(alice().doc("aiUsage/alice_2026-09-27").get());
  await assertFails(alice().doc("webhookEvents/evt_1").set({}));
});

test("entitlements are server-only: a user can't read or grant their own plan", async () => {
  await assertFails(alice().doc("entitlements/alice").get());
  await assertFails(alice().doc("entitlements/alice").set({ plan: "pro" }));
  await assertFails(alice().doc("entitlements/bob").set({ plan: "pro" }));
});

test("synced data: owner may read their own sync docs, never write them directly", async () => {
  await assertSucceeds(alice().doc("users/alice/meta/state").get());
  await assertFails(alice().doc("users/alice/meta/state").set({ longestStreak: 999 }));
  await assertFails(alice().doc("users/alice/bookmarks/1").set({ on: true, at: 1 }));
  await assertFails(alice().doc("users/bob/meta/state").get());
});
