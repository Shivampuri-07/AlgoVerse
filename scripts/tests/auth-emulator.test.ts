// Integration tests for the account API against the local Firebase Auth + Firestore emulators:
// real ID tokens, real session cookies, real revocation. No real project is touched.
// Run: npm run test:firebase   (starts the emulators and runs this file)
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_PROJECT_ID = "demo-algoverse";
delete process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
console.error = () => {};

const PROJECT = "demo-algoverse";
const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const DB = `http://${process.env.FIRESTORE_EMULATOR_HOST}`;
const ORIGIN = "http://localhost:3000";

const sessionRoute = await import("@/app/api/auth/session/route");
const profileRoute = await import("@/app/api/account/profile/route");
const { getAdminAuth, getAdminDb } = await import("@/lib/firebase/admin");

async function signUp(email: string, password = "letters123"): Promise<{ uid: string; idToken: string }> {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(res.status, 200, "emulator sign-up");
  const data = (await res.json()) as { localId: string; idToken: string };
  return { uid: data.localId, idToken: data.idToken };
}

/** Emulator-only unsigned ID token with a chosen auth_time (to test the recent-sign-in rule). */
function craftIdToken(uid: string, authTime: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: "none", typ: "JWT" })}.${b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    auth_time: authTime,
    user_id: uid,
    sub: uid,
    iat: now,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: "password" },
  })}.`;
}

async function login(idToken: string, origin = ORIGIN): Promise<Response> {
  return sessionRoute.POST(
    new Request(`${ORIGIN}/api/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", origin },
      body: JSON.stringify({ idToken }),
    })
  );
}

function cookieFrom(res: Response): string {
  const header = res.headers.get("set-cookie") ?? "";
  const m = /algoverse_session=([^;]*)/.exec(header);
  assert.ok(m && m[1], "session cookie set");
  return `algoverse_session=${m![1]}`;
}

const getProfile = (cookie?: string, extra: Record<string, string> = {}) =>
  profileRoute.GET(new Request(`${ORIGIN}/api/account/profile`, { headers: { ...(cookie ? { cookie } : {}), ...extra } }));

const patchProfile = (cookie: string, body: unknown, origin = ORIGIN) =>
  profileRoute.PATCH(
    new Request(`${ORIGIN}/api/account/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", cookie, origin },
      body: JSON.stringify(body),
    })
  );

before(async () => {
  // Fresh emulator state for every run.
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
  await fetch(`${DB}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
});

test("sign in → HTTP-only session cookie → profile document created once", async () => {
  const { uid, idToken } = await signUp("alice@example.com");
  const res = await login(idToken);
  assert.equal(res.status, 200);
  const setCookie = res.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  const body = (await res.json()) as { user: { uid: string; email: string } };
  assert.equal(body.user.uid, uid);
  assert.equal(body.user.email, "alice@example.com");
  assert.ok(!JSON.stringify(body).includes(idToken), "token is not echoed");

  const snap = await getAdminDb()!.doc(`users/${uid}`).get();
  assert.ok(snap.exists, "users/{uid} created");
  // Idempotent: signing in again doesn't overwrite the profile.
  await getAdminDb()!.doc(`users/${uid}`).update({ displayName: "Kept" });
  assert.equal((await login(idToken)).status, 200);
  assert.equal((await getAdminDb()!.doc(`users/${uid}`).get()).data()?.displayName, "Kept");
});

test("GET /api/auth/session reflects the cookie", async () => {
  const { uid, idToken } = await signUp("session@example.com");
  const cookie = cookieFrom(await login(idToken));
  const signedIn = await sessionRoute.GET(new Request(`${ORIGIN}/api/auth/session`, { headers: { cookie } }));
  assert.equal(((await signedIn.json()) as { user: { uid: string } }).user.uid, uid);
  const anon = await sessionRoute.GET(new Request(`${ORIGIN}/api/auth/session`));
  assert.equal(((await anon.json()) as { user: unknown }).user, null);
});

test("session creation rejects cross-site requests, garbage tokens and old sign-ins", async () => {
  const { uid, idToken } = await signUp("bob@example.com");
  assert.equal((await login(idToken, "https://evil.example")).status, 403);
  assert.equal((await login("not-a-real-token-0123456789")).status, 401);
  const oldAuthTime = Math.floor(Date.now() / 1000) - 3600;
  // Backdate the account's "tokens valid since" so the old token isn't rejected as revoked —
  // this isolates the recent-sign-in rule.
  const upd = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ localId: uid, validSince: String(oldAuthTime - 60) }),
  });
  assert.equal(upd.status, 200, "emulator validSince update");
  const old = craftIdToken(uid, oldAuthTime);
  const stale = await login(old);
  assert.equal(stale.status, 401);
  assert.equal(((await stale.json()) as { error: { code: string } }).error.code, "stale_sign_in");
});

test("protected profile API: unauthenticated and forged sessions are rejected", async () => {
  assert.equal((await getProfile()).status, 401);
  assert.equal((await getProfile("algoverse_session=forged.value.here")).status, 401);
  assert.equal((await getProfile(undefined, { authorization: "Bearer forged" })).status, 401);
  assert.equal((await getProfile(undefined, { authorization: "Basic abc" })).status, 401);
});

test("user A only ever sees and changes their own profile (client-sent uid is ignored)", async () => {
  const a = await signUp("usera@example.com");
  const b = await signUp("userb@example.com");
  const cookieA = cookieFrom(await login(a.idToken));
  const cookieB = cookieFrom(await login(b.idToken));

  const res = await getProfile(cookieA);
  assert.equal(res.status, 200);
  const { profile } = (await res.json()) as { profile: { uid: string; email: string } };
  assert.equal(profile.uid, a.uid);
  assert.equal(profile.email, "usera@example.com");

  // A tries to rename B by sending B's uid: only A changes.
  const patch = await patchProfile(cookieA, { displayName: "Renamed", uid: b.uid, email: "userb@example.com", plan: "pro" });
  assert.equal(patch.status, 200);
  const db = getAdminDb()!;
  assert.equal((await db.doc(`users/${a.uid}`).get()).data()?.displayName, "Renamed");
  assert.equal((await db.doc(`users/${b.uid}`).get()).data()?.displayName ?? null, null);
  assert.equal((await db.doc(`users/${a.uid}`).get()).data()?.plan, undefined, "unknown fields are not stored");

  const bView = (await (await getProfile(cookieB)).json()) as { profile: { uid: string; displayName: string | null } };
  assert.equal(bView.profile.uid, b.uid);
  assert.equal(bView.profile.displayName, null);
});

test("Bearer ID tokens work for API clients (future Android app)", async () => {
  const { uid, idToken } = await signUp("android@example.com");
  const res = await getProfile(undefined, { authorization: `Bearer ${idToken}` });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { profile: { uid: string } }).profile.uid, uid);
});

test("profile update validates input and blocks cross-site requests", async () => {
  const { idToken } = await signUp("validate@example.com");
  const cookie = cookieFrom(await login(idToken));
  assert.equal((await patchProfile(cookie, { displayName: "x".repeat(51) })).status, 400);
  assert.equal((await patchProfile(cookie, { displayName: 7 })).status, 400);
  assert.equal((await patchProfile(cookie, {})).status, 400);
  assert.equal((await patchProfile(cookie, { displayName: "Evil" }, "https://evil.example")).status, 403);
  const cleared = await patchProfile(cookie, { displayName: null });
  assert.equal(cleared.status, 200);
});

test("sign out everywhere revokes existing session cookies", async () => {
  const { idToken } = await signUp("revoke@example.com");
  const cookie = cookieFrom(await login(idToken));
  assert.equal((await getProfile(cookie)).status, 200);
  // Revocation has one-second granularity: make sure it's later than the sign-in.
  await new Promise((r) => setTimeout(r, 1100));
  const out = await sessionRoute.DELETE(
    new Request(`${ORIGIN}/api/auth/session?everywhere=1`, { method: "DELETE", headers: { cookie, origin: ORIGIN } })
  );
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie") ?? "", /Max-Age=0/);
  assert.equal((await getProfile(cookie)).status, 401, "old cookie no longer works anywhere");
});

test("a disabled account's session is rejected", async () => {
  const { uid, idToken } = await signUp("disabled@example.com");
  const cookie = cookieFrom(await login(idToken));
  await getAdminAuth()!.updateUser(uid, { disabled: true });
  assert.equal((await getProfile(cookie)).status, 401);
});

// ---------------------------------------------------------------- cloud sync API (Pro)

const syncRoute = await import("@/app/api/sync/route");
const entRoute = await import("@/app/api/me/entitlements/route");
const { Timestamp } = await import("firebase-admin/firestore");

async function newSession(email: string) {
  const { uid, idToken } = await signUp(email);
  return { uid, cookie: cookieFrom(await login(idToken)) };
}
const grantPro = (uid: string, expiresAt?: number) =>
  getAdminDb()!.doc(`entitlements/${uid}`).set({ plan: "pro", ...(expiresAt ? { expiresAt: Timestamp.fromMillis(expiresAt) } : {}) });
const pull = async (cookie: string, since = 0) =>
  syncRoute.GET(new Request(`${ORIGIN}/api/sync?since=${since}`, { headers: { cookie } }));
const push = async (cookie: string, ops: unknown[], origin = ORIGIN) =>
  syncRoute.POST(new Request(`${ORIGIN}/api/sync`, { method: "POST", headers: { "Content-Type": "application/json", cookie, origin }, body: JSON.stringify({ ops }) }));
const T0 = Date.now();

test("sync: free users are refused (server-side entitlement), and entitlements report Free", async () => {
  const a = await newSession(`free-${Date.now()}@example.com`);
  const ent = await (await entRoute.GET(new Request(`${ORIGIN}/api/me/entitlements`, { headers: { cookie: a.cookie } }))).json();
  assert.equal(ent.plan, "free");
  assert.equal(ent.features.cloudSync, false);
  const p = await pull(a.cookie);
  assert.equal(p.status, 403);
  assert.equal((await p.json()).error.code, "not_entitled");
  assert.equal((await push(a.cookie, [{ t: "bookmark", id: 1, on: true, at: T0 }])).status, 403);
  assert.equal((await getAdminDb()!.collection(`users/${a.uid}/bookmarks`).get()).size, 0, "nothing written");
  assert.equal((await pull("")).status, 401, "signed-out → 401");
});

test("sync: Pro user pushes and pulls; an expired Pro is refused", async () => {
  const a = await newSession(`pro-${Date.now()}@example.com`);
  await grantPro(a.uid);
  const ops = [
    { t: "progress", id: 12, completedAt: "2026-09-01T10:00:00.000Z", at: T0 },
    { t: "bookmark", id: 12, on: true, at: T0 },
    { t: "note", id: 12, kind: "note", content: "hash map", base: 0, at: T0 },
    { t: "streak", longest: 3, at: T0 },
  ];
  const res = await push(a.cookie, ops);
  assert.equal(res.status, 200);
  const pushed = await res.json();
  assert.equal(pushed.notes[0].version, 1);
  const all = await (await pull(a.cookie, 0)).json();
  assert.deepEqual(all.progress.map((p: { id: number; completedAt: string }) => [p.id, p.completedAt]), [[12, "2026-09-01T10:00:00.000Z"]]);
  assert.deepEqual(all.bookmarks.map((b: { id: number; on: boolean }) => [b.id, b.on]), [[12, true]]);
  assert.equal(all.notes[0].content, "hash map");
  assert.equal(all.meta.longestStreak, 3);
  assert.ok(all.cursor > 0);

  await grantPro(a.uid, Date.now() - 1000);
  assert.equal((await pull(a.cookie)).status, 403, "expired Pro loses sync");
});

test("sync: user A can never read or write user B's data (uid comes from the session)", async () => {
  const a = await newSession(`iso-a-${Date.now()}@example.com`);
  const b = await newSession(`iso-b-${Date.now()}@example.com`);
  await grantPro(a.uid);
  await grantPro(b.uid);
  await push(a.cookie, [{ t: "note", id: 5, kind: "note", content: "A's private note", base: 0, at: T0 }]);
  // B tries to smuggle A's uid in the body and query string.
  const res = await syncRoute.POST(
    new Request(`${ORIGIN}/api/sync?uid=${a.uid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: b.cookie, origin: ORIGIN },
      body: JSON.stringify({ uid: a.uid, ops: [{ t: "note", id: 5, kind: "note", content: "B overwrote", base: 1, at: T0 + 5 }] }),
    })
  );
  assert.equal(res.status, 200);
  const aDoc = await getAdminDb()!.doc(`users/${a.uid}/notes/5_note`).get();
  assert.equal(aDoc.data()?.content, "A's private note", "A's note untouched");
  const bView = await (await pull(b.cookie, 0)).json();
  assert.equal(bView.notes.length, 1);
  assert.equal(bView.notes[0].content, "B overwrote", "B only ever sees B's own data");
  assert.ok(!JSON.stringify(bView).includes("A's private note"));
});

test("sync: cross-site POST is blocked; malformed ops are rejected whole", async () => {
  const a = await newSession(`csrf-${Date.now()}@example.com`);
  await grantPro(a.uid);
  assert.equal((await push(a.cookie, [{ t: "bookmark", id: 1, on: true, at: T0 }], "https://evil.example")).status, 403);
  assert.equal((await push(a.cookie, [{ t: "bookmark", id: 1, on: true, at: T0 }, { t: "evil" }])).status, 400);
  assert.equal((await getAdminDb()!.collection(`users/${a.uid}/bookmarks`).get()).size, 0);
});

test("sync: importing the same device twice changes nothing the second time (idempotent)", async () => {
  const a = await newSession(`idem-${Date.now()}@example.com`);
  await grantPro(a.uid);
  const importOps = [
    { t: "progress", id: 1, completedAt: "2026-09-01T00:00:00.000Z", at: Date.parse("2026-09-01T00:00:00.000Z") },
    { t: "progress", id: 2, completedAt: "2026-09-02T00:00:00.000Z", at: Date.parse("2026-09-02T00:00:00.000Z") },
    { t: "bookmark", id: 2, on: true, at: T0 },
    { t: "note", id: 2, kind: "mistakes", content: "off by one", base: 0, at: T0 },
  ];
  await push(a.cookie, importOps);
  const first = await (await pull(a.cookie, 0)).json();
  await push(a.cookie, importOps);
  const second = await (await pull(a.cookie, 0)).json();
  const strip = (x: { progress: unknown[]; bookmarks: unknown[]; notes: unknown[] }) => JSON.stringify([x.progress, x.bookmarks, x.notes]);
  assert.equal(strip(second), strip(first));
  assert.equal(second.notes[0].version, 1, "no duplicate note version");
});

test("sync: two devices edit the same note — both texts are kept; an old un-complete doesn't undo a newer completion", async () => {
  const a = await newSession(`conf-${Date.now()}@example.com`);
  await grantPro(a.uid);
  await push(a.cookie, [{ t: "note", id: 9, kind: "note", content: "start", base: 0, at: T0 }]);
  await push(a.cookie, [{ t: "note", id: 9, kind: "note", content: "laptop edit", base: 1, at: T0 + 10 }]);
  const res = await (await push(a.cookie, [{ t: "note", id: 9, kind: "note", content: "phone edit", base: 1, at: T0 + 20 }])).json();
  assert.deepEqual(res.conflicts, [{ id: 9, kind: "note" }]);
  assert.match(res.notes[0].content, /^phone edit[\s\S]*Conflicting copy[\s\S]*laptop edit$/);

  await push(a.cookie, [{ t: "progress", id: 3, completedAt: "2026-09-05T00:00:00.000Z", at: T0 + 100 }]);
  await push(a.cookie, [{ t: "progress", id: 3, completedAt: null, at: T0 + 50 }]);
  const doc = (await getAdminDb()!.doc(`users/${a.uid}/progress/3`).get()).data();
  assert.equal(doc?.deleted, false, "stale un-complete ignored");
});

test("sync: pulls are incremental (cursor) and include later changes", async () => {
  const a = await newSession(`cursor-${Date.now()}@example.com`);
  await grantPro(a.uid);
  await push(a.cookie, [{ t: "bookmark", id: 1, on: true, at: T0 }]);
  await new Promise((r) => setTimeout(r, 6_000)); // older than the 5 s overlap window
  const first = await (await pull(a.cookie, 0)).json();
  assert.deepEqual(first.bookmarks.map((b: { id: number }) => b.id), [1]);
  await push(a.cookie, [{ t: "bookmark", id: 2, on: true, at: T0 + 1 }]);
  const next = await (await pull(a.cookie, first.cursor)).json();
  assert.deepEqual(next.bookmarks.map((b: { id: number }) => b.id), [2], "only the newer change");
  assert.ok(next.cursor >= first.cursor);
  await new Promise((r) => setTimeout(r, 6_000));
  const quiet = await (await pull(a.cookie, next.cursor)).json();
  await new Promise((r) => setTimeout(r, 100));
  const quieter = await (await pull(a.cookie, quiet.cursor)).json();
  assert.equal(quieter.bookmarks.length + quieter.progress.length + quieter.notes.length, 0, "a quiet account returns nothing (no endless repeats)");
});

test("sync: theme preference round-trips (last write wins); a too-long merge is rejected, not truncated", async () => {
  const a = await newSession(`prefs-${Date.now()}@example.com`);
  await grantPro(a.uid);
  await push(a.cookie, [{ t: "prefs", theme: "dark", at: T0 + 10 }]);
  await push(a.cookie, [{ t: "prefs", theme: "light", at: T0 + 5 }]); // older: ignored
  assert.deepEqual((await (await pull(a.cookie, 0)).json()).meta.preferences, { theme: "dark", at: T0 + 10 });

  const big = (c: string) => c.repeat(30_000);
  await push(a.cookie, [{ t: "note", id: 20, kind: "code", content: big("a"), base: 0, at: T0 }]);
  await push(a.cookie, [{ t: "note", id: 20, kind: "code", content: big("b"), base: 1, at: T0 + 1 }]); // v2
  const res = await (await push(a.cookie, [{ t: "note", id: 20, kind: "code", content: big("c"), base: 1, at: T0 + 2 }])).json();
  assert.deepEqual(res.rejected, [{ id: 20, kind: "code", reason: "merge_too_long", version: 2 }]);
  const doc = (await getAdminDb()!.doc(`users/${a.uid}/notes/20_code`).get()).data();
  assert.equal(doc?.content, big("b"), "server copy unchanged");
  assert.equal(doc?.version, 2);
  // Choosing this device's version (base = server version) replaces it.
  const pick = await (await push(a.cookie, [{ t: "note", id: 20, kind: "code", content: big("c"), base: 2, at: T0 + 3 }])).json();
  assert.equal(pick.rejected.length, 0);
  assert.equal((await getAdminDb()!.doc(`users/${a.uid}/notes/20_code`).get()).data()?.content, big("c"));
  // A note over the limit is rejected at validation (the client never sends one).
  assert.equal((await push(a.cookie, [{ t: "note", id: 21, kind: "note", content: "z".repeat(50_001), base: 0, at: T0 }])).status, 400);
});

test("sync: a heavy account (≈5 MB of notes) pushes in size-bounded chunks and pulls in pages under the body limit", async () => {
  const a = await newSession(`heavy-${Date.now()}@example.com`);
  await grantPro(a.uid);
  const note = (id: number) => ({ t: "note", id, kind: "code", content: `${id}:`.padEnd(45_000, "é"), base: 0, at: T0 });
  const all = Array.from({ length: 120 }, (_, i) => note(i + 1));
  // One oversized-in-bytes request (as an old client might send) is still applied safely server-side:
  // transactions are chunked by size, so Firestore's limits aren't hit.
  const { takeBatch } = await import("@/lib/sync/batch");
  let rest = all;
  while (rest.length) {
    const batch = takeBatch(rest as never, 500, 1_500_000);
    assert.ok(JSON.stringify({ ops: batch }).length < 4_500_000);
    const res = await push(a.cookie, batch);
    assert.equal(res.status, 200);
    rest = rest.slice(batch.length);
  }
  // Pull everything from scratch, page by page.
  const seen = new Map<number, string>();
  let after: string | null = null;
  let pages = 0;
  let cursor = 0;
  for (;;) {
    const url: string = `${ORIGIN}/api/sync?since=0${after ? `&notesAfter=${encodeURIComponent(after)}` : ""}`;
    const res = await syncRoute.GET(new Request(url, { headers: { cookie: a.cookie } }));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(Buffer.byteLength(text) < 4_500_000, `page ${pages} is ${Buffer.byteLength(text)} bytes`);
    const page = JSON.parse(text);
    if (pages === 0) cursor = page.cursor;
    else assert.equal(page.progress.length + page.bookmarks.length, 0, "small collections only on the first page");
    for (const n of page.notes) {
      // Only the note edited mid-pull may come again (its newer version, now at the end).
      assert.ok(!seen.has(n.id) || (n.id === 1 && n.content === "edited"), "no note repeated across pages");
      seen.set(n.id, n.content);
    }
    pages++;
    if (!page.more) {
      assert.equal(page.notesAfter, null);
      break;
    }
    // Editing a note already sent doesn't make later notes be skipped.
    if (pages === 1) await push(a.cookie, [{ ...note(1), content: "edited", base: 1, at: T0 + 1 }]);
    after = page.notesAfter;
  }
  assert.ok(pages >= 3, `paged (${pages} pages)`);
  assert.equal(seen.get(1), "edited", "the edit made during the pull arrives in the same pull");
  for (let id = 2; id <= 120; id++) assert.equal(seen.get(id), note(id).content, `note ${id} intact`);
  assert.ok(cursor > 0);
  // A malformed page cursor is a bad request.
  const bad = await syncRoute.GET(new Request(`${ORIGIN}/api/sync?since=0&notesAfter=../x`, { headers: { cookie: a.cookie } }));
  assert.equal(bad.status, 400);
});

// ---------------------------------------------------------------- Pro learning resources API

const resourcesRoute = await import("@/app/api/resources/[id]/route");
const getResources = (id: string, cookie?: string) =>
  resourcesRoute.GET(new Request(`${ORIGIN}/api/resources/${id}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

test("resources: signed-out 401, Free 403 (no links in the body), Pro 200, expired Pro 403, bad/unknown ids", async () => {
  assert.equal((await getResources("6")).status, 401);
  const a = await newSession(`res-${Date.now()}@example.com`);
  const free = await getResources("6", a.cookie);
  assert.equal(free.status, 403);
  const freeText = await free.text();
  assert.equal(JSON.parse(freeText).error.code, "not_entitled");
  assert.ok(!/youtube|takeuforward/i.test(freeText), "no links for Free users");

  await grantPro(a.uid);
  const pro = await getResources("6", a.cookie);
  assert.equal(pro.status, 200);
  const body = await pro.json();
  assert.match(body.video.watchUrl, /^https:\/\/www\.youtube\.com\/watch\?v=/);
  assert.match(body.video.embed.videoId, /^[A-Za-z0-9_-]{11}$/, "Pro gets the id for the in-app player");
  assert.ok(body.video.watchUrl.includes(body.video.embed.videoId));
  assert.match(body.article.url, /^https:\/\/takeuforward\.org\//);
  assert.equal((await getResources("abc", a.cookie)).status, 400);
  assert.equal((await getResources("999999", a.cookie)).status, 404);

  await grantPro(a.uid, Date.now() - 1000);
  assert.equal((await getResources("6", a.cookie)).status, 403, "expired Pro loses access");
});

// ---------------------------------------------------------------- AI helper access + limits (Phase 5)

const aiRoute = await import("@/app/api/ai/route");
const { istDay } = await import("@/lib/ai/usage");
process.env.GEMINI_API_KEY = "AIzaSyTEST-FAKE-KEY-0123456789abcdefghi";
process.env.AI_GLOBAL_DAILY_LIMIT = "100000"; // tests share one emulator day; the cap is tested explicitly
const realFetch = globalThis.fetch;
let geminiCalls = 0;
let geminiMode: "ok" | "fail" = "ok";
// Gemini is mocked; everything else (Auth/Firestore emulators) goes through.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (!String(input).includes("generativelanguage.googleapis.com")) return realFetch(input, init);
  geminiCalls++;
  if (geminiMode === "fail") return new Response(JSON.stringify({ error: { code: 503, message: "overloaded", status: "UNAVAILABLE" } }), { status: 503, headers: { "Content-Type": "application/json" } });
  const chunk = { candidates: [{ content: { role: "model", parts: [{ text: "hint" }] }, index: 0 }] };
  return new Response(`data: ${JSON.stringify(chunk)}\r\n\r\n`, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}) as typeof fetch;

const aiBody = JSON.stringify({ problem: { title: "Two Sum", topic: "Arrays", difficulty: "Easy", tags: ["Array"] }, messages: [{ role: "user", content: "hint please" }], action: "hint" });
let aiIp = 0;
const askAi = async (headers: Record<string, string>) => {
  const res = await aiRoute.POST(new Request(`${ORIGIN}/api/ai`, { method: "POST", headers: { "Content-Type": "application/json", origin: ORIGIN, "x-forwarded-for": `10.9.${aiIp >> 8}.${++aiIp & 255}`, ...headers }, body: aiBody }));
  const text = await res.text();
  assert.ok(!text.includes(process.env.GEMINI_API_KEY!), "key never in a response");
  return { status: res.status, text, json: res.status === 200 ? null : JSON.parse(text), retryAfter: res.headers.get("retry-after") };
};
async function verifiedSession(email: string) {
  const s = await newSession(email);
  await getAdminAuth()!.updateUser(s.uid, { emailVerified: true }); // session claim stays stale on purpose
  return s;
}
const usageDoc = (uid: string) => getAdminDb()!.doc(`aiUsage/${uid}`);

test("ai: signed-out, forged, cross-site and unverified requests are refused before Gemini", async () => {
  geminiCalls = 0;
  assert.equal((await askAi({})).status, 401, "no session");
  assert.equal((await askAi({ cookie: "algoverse_session=forged.value.here" })).json.error.code, "sign_in_required");
  assert.equal((await askAi({ authorization: "Bearer not-a-token" })).status, 401);
  const u = await newSession(`ai-unverified-${Date.now()}@example.com`);
  const unverified = await askAi({ cookie: u.cookie });
  assert.equal(unverified.status, 403);
  assert.equal(unverified.json.error.code, "verify_email");
  const v = await verifiedSession(`ai-csrf-${Date.now()}@example.com`);
  const csrf = await askAi({ cookie: v.cookie, origin: "https://evil.example" });
  assert.equal(csrf.status, 403);
  assert.equal(csrf.json.error.code, "forbidden");
  assert.equal(geminiCalls, 0);
  // Verified after the session was created: the server asks Firebase and lets them in.
  assert.equal((await askAi({ cookie: v.cookie })).status, 200);
});

test("ai: limits hold across parallel requests (Firestore transactions), then 429 until midnight IST", async () => {
  const a = await verifiedSession(`ai-free-${Date.now()}@example.com`);
  // 12 at once from different IPs: exactly 5 pass the per-minute limit.
  const burst = await Promise.all(Array.from({ length: 12 }, () => askAi({ cookie: a.cookie })));
  assert.equal(burst.filter((r) => r.status === 200).length, 5);
  assert.ok(burst.filter((r) => r.status === 429).every((r) => r.json.error.code === "slow_down"));
  assert.equal((await usageDoc(a.uid).get()).get("count"), 5);
  // Near the daily limit (8 of 10, minute window expired): 6 at once → exactly 2 more.
  await usageDoc(a.uid).set({ day: istDay(Date.now()), count: 8, minuteStart: 0, minuteCount: 0 });
  const last = await Promise.all(Array.from({ length: 6 }, () => askAi({ cookie: a.cookie })));
  assert.equal(last.filter((r) => r.status === 200).length, 2);
  const over = last.find((r) => r.status === 429)!;
  assert.equal(over.json.error.code, "daily_limit");
  assert.equal(over.json.usage.limit, 10);
  assert.ok(Number(over.retryAfter) > 0 && Number(over.retryAfter) <= 86_400);
  assert.equal((await usageDoc(a.uid).get()).get("count"), 10);
});

test("ai: Pro gets 50 a day from the server entitlement; a Bearer token shares the same allowance", async () => {
  const email = `ai-pro-${Date.now()}@example.com`;
  const { uid, idToken } = await signUp(email);
  const cookie = cookieFrom(await login(idToken));
  await getAdminAuth()!.updateUser(uid, { emailVerified: true });
  await grantPro(uid);
  await usageDoc(uid).set({ day: istDay(Date.now()), count: 49, minuteStart: 0, minuteCount: 0 });
  assert.equal((await askAi({ cookie })).status, 200, "the 50th question");
  const bearer = await askAi({ authorization: `Bearer ${idToken}` });
  assert.equal(bearer.status, 429);
  assert.equal(bearer.json.error.code, "daily_limit");
  assert.equal(bearer.json.usage.plan, "pro");
  assert.equal(bearer.json.usage.limit, 50);
  // GET shows the allowance (display only).
  const g = await (await aiRoute.GET(new Request(`${ORIGIN}/api/ai`, { headers: { cookie } }))).json();
  assert.deepEqual([g.configured, g.usage.plan, g.usage.remaining], [true, "pro", 0]);
});

test("ai: a Gemini failure before any answer is refunded in Firestore; the shared daily cap answers busy", async () => {
  const a = await verifiedSession(`ai-refund-${Date.now()}@example.com`);
  geminiMode = "fail";
  const r = await askAi({ cookie: a.cookie });
  geminiMode = "ok";
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, "provider_unavailable");
  assert.equal((await usageDoc(a.uid).get()).get("count"), 0, "refunded");
  // Whole-app cap reached → busy, Gemini not called.
  const day = istDay(Date.now());
  const globalRef = getAdminDb()!.doc(`aiUsageGlobal/${day}`);
  const before = (await globalRef.get()).get("count");
  await globalRef.set({ count: 100000 });
  geminiCalls = 0;
  const busy = await askAi({ cookie: a.cookie });
  await globalRef.set({ count: before });
  assert.equal(busy.status, 429);
  assert.equal(busy.json.error.code, "busy");
  assert.equal(geminiCalls, 0);
});

// ---------------------------------------------------------------- status database probe

test("status: the database probe reads a valid path and reports ok (the reserved users/__status_probe__ id was rejected)", async () => {
  const statusRoute = await import("@/app/api/auth/status/route");
  const { STATUS_PROBE_PATH } = await import("@/lib/firebase/status-probe");
  const db = getAdminDb()!;
  // The old id: Firestore rejects reserved __…__ ids with INVALID_ARGUMENT (code 3).
  await assert.rejects(db.doc("users/__status_probe__").get(), (e: { code?: unknown }) => e.code === 3);
  const body = await (await statusRoute.GET()).json();
  assert.equal(body.server, "ok");
  assert.equal(body.database, "ok", "the probe succeeds");
  assert.equal((await db.doc(STATUS_PROBE_PATH).get()).exists, false, "read-only: nothing is created");
});

// ---------------------------------------------------------------- Razorpay billing (TEST mode, mocked Razorpay API)

const { createHmac } = await import("node:crypto");
const checkoutRoute = await import("@/app/api/billing/checkout/route");
const webhookRoute = await import("@/app/api/billing/webhook/route");
const cancelRoute = await import("@/app/api/billing/cancel/route");
const billingStatusRoute = await import("@/app/api/billing/status/route");
const WEBHOOK_SECRET = "whsec_test_emulator";
const BILLING_ENV = { RAZORPAY_MODE: "test", RAZORPAY_KEY_ID: "rzp_test_EMULATOR", RAZORPAY_KEY_SECRET: "sk_test_emulator", RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, RAZORPAY_PLAN_ID: "plan_TEST30" };
Object.assign(process.env, BILLING_ENV);
// Mocked Razorpay API (everything else passes through).
const razorpay = { created: 0, cancelled: [] as string[], subs: new Map<string, { status: string; current_end: number | null }>() };
const fetchBeforeBilling = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.startsWith("https://api.razorpay.com/")) return fetchBeforeBilling(input, init);
  assert.equal(new Headers(init?.headers).get("authorization"), "Basic " + Buffer.from("rzp_test_EMULATOR:sk_test_emulator").toString("base64"));
  const m = /\/v1\/subscriptions(?:\/(sub_\w+))?(\/cancel)?$/.exec(new URL(url).pathname);
  if (!m) return new Response("{}", { status: 404 });
  if (!m[1]) {
    const id = `sub_T${++razorpay.created}${Date.now().toString(36)}`;
    razorpay.subs.set(id, { status: "created", current_end: null });
    return new Response(JSON.stringify({ id, status: "created" }), { status: 200 });
  }
  const s = razorpay.subs.get(m[1]);
  if (!s) return new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR" } }), { status: 400 });
  if (m[2]) razorpay.cancelled.push(m[1]);
  return new Response(JSON.stringify({ id: m[1], ...s }), { status: 200 });
}) as typeof fetch;

const post = (route: { POST: (r: Request) => Promise<Response> }, path: string, cookie: string, origin = ORIGIN) =>
  route.POST(new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "Content-Type": "application/json", cookie, origin }, body: "{}" }));
let evSeq = 0;
function subEvent(subId: string, status: string, opts: { createdAt: number; currentEnd?: number | null; payment?: { id: string; amount?: number; status?: string } }) {
  return {
    event: `subscription.${status === "active" && opts.payment ? "charged" : status}`,
    created_at: Math.floor(opts.createdAt / 1000),
    payload: {
      subscription: { entity: { id: subId, status, current_end: opts.currentEnd == null ? null : Math.floor(opts.currentEnd / 1000) } },
      ...(opts.payment ? { payment: { entity: { id: opts.payment.id, amount: opts.payment.amount ?? 3000, currency: "INR", status: opts.payment.status ?? "captured", created_at: Math.floor(opts.createdAt / 1000) } } } : {}),
    },
  };
}
async function deliver(body: unknown, opts: { eventId?: string; secret?: string; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(body);
  const sig = createHmac("sha256", opts.secret ?? WEBHOOK_SECRET).update(raw).digest("hex");
  const res = await webhookRoute.POST(new Request(`${ORIGIN}/api/billing/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": opts.eventId ?? `evt_${++evSeq}${Date.now()}` }, body: raw }));
  return { status: res.status, body: await res.json() };
}
const plan = async (cookie: string) => (await (await entRoute.GET(new Request(`${ORIGIN}/api/me/entitlements`, { headers: { cookie } }))).json()) as { plan: string; expiresAt: string | null };
const DAY = 86_400_000;
const sec = (ms: number) => Math.floor(ms / 1000) * 1000; // Razorpay timestamps are whole seconds

async function subscribedUser(tag: string) {
  const u = await verifiedSession(`bill-${tag}-${Date.now()}@example.com`);
  const res = await post(checkoutRoute, "/api/billing/checkout", u.cookie);
  assert.equal(res.status, 200, "checkout starts");
  const body = await res.json();
  return { ...u, subId: body.subscriptionId as string, checkout: body };
}

test("billing: checkout needs sign-in, same-origin and a verified email; it records the subscription but grants nothing", async () => {
  assert.equal((await post(checkoutRoute, "/api/billing/checkout", "")).status, 401);
  const unverified = await newSession(`bill-unv-${Date.now()}@example.com`);
  assert.equal((await post(checkoutRoute, "/api/billing/checkout", unverified.cookie)).status, 403);
  const v = await verifiedSession(`bill-csrf-${Date.now()}@example.com`);
  assert.equal((await post(checkoutRoute, "/api/billing/checkout", v.cookie, "https://evil.example")).status, 403);
  const u = await subscribedUser("start");
  assert.deepEqual(Object.keys(u.checkout).sort(), ["email", "keyId", "subscriptionId"], "only public data to the browser");
  assert.equal(u.checkout.keyId, "rzp_test_EMULATOR");
  assert.ok(!JSON.stringify(u.checkout).includes("sk_test_emulator"), "no key secret");
  const rec = (await getAdminDb()!.doc(`subscriptions/${u.subId}`).get()).data();
  assert.equal(rec?.uid, u.uid, "our record ties the subscription to this user");
  assert.equal((await plan(u.cookie)).plan, "free", "starting checkout grants nothing");
});

test("billing: Pro ONLY via a verified webhook — bad/missing signature or wrong secret change nothing; a charge activates Pro and records the payment", async () => {
  const u = await subscribedUser("activate");
  const t = Date.now();
  const end = sec(t + 30 * DAY);
  const charged = subEvent(u.subId, "active", { createdAt: t, currentEnd: end, payment: { id: `pay_A${Date.now()}` } });
  const raw = JSON.stringify(charged);
  const bad = await webhookRoute.POST(new Request(`${ORIGIN}/api/billing/webhook`, { method: "POST", headers: { "x-razorpay-signature": "0".repeat(64), "x-razorpay-event-id": "evt_bad1" }, body: raw }));
  assert.equal(bad.status, 400);
  const none = await webhookRoute.POST(new Request(`${ORIGIN}/api/billing/webhook`, { method: "POST", headers: { "x-razorpay-event-id": "evt_bad2" }, body: raw }));
  assert.equal(none.status, 400);
  assert.equal((await deliver(charged, { secret: "wrong-secret" })).status, 400);
  // A body altered after signing (e.g. the payment status) fails verification.
  const tampered = await webhookRoute.POST(new Request(`${ORIGIN}/api/billing/webhook`, { method: "POST", headers: { "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"), "x-razorpay-event-id": "evt_bad3" }, body: raw.replace('"captured"', '"refunded"') }));
  assert.equal(tampered.status, 400);
  assert.equal((await plan(u.cookie)).plan, "free", "unverified events change nothing");
  // The browser can't claim Pro either (entitlements are server-only; no client write path exists).
  const ok = await deliver(charged);
  assert.deepEqual([ok.status, ok.body.outcome], [200, "applied"]);
  const p = await plan(u.cookie);
  assert.equal(p.plan, "pro");
  assert.equal(new Date(p.expiresAt!).getTime(), end + 3 * DAY, "paid period + 3-day renewal grace");
  const status = await (await billingStatusRoute.GET(new Request(`${ORIGIN}/api/billing/status`, { headers: { cookie: u.cookie } }))).json();
  assert.equal(status.subscription.status, "active");
  assert.equal(status.payments.length, 1);
  assert.deepEqual([status.payments[0].amount, status.payments[0].currency, status.payments[0].status], [3000, "INR", "captured"]);
});

test("billing: duplicate deliveries and out-of-order events are harmless", async () => {
  const u = await subscribedUser("dup");
  const t = Date.now();
  const charged = subEvent(u.subId, "active", { createdAt: t, currentEnd: t + 30 * DAY, payment: { id: `pay_D${Date.now()}` } });
  const first = await deliver(charged, { eventId: `evt_dup_${u.uid.slice(0, 8)}` });
  const again = await deliver(charged, { eventId: `evt_dup_${u.uid.slice(0, 8)}` });
  assert.deepEqual([first.body.outcome, again.body.outcome, again.status], ["applied", "duplicate", 200]);
  const payments = await getAdminDb()!.collection(`billingAccounts/${u.uid}/payments`).get();
  assert.equal(payments.size, 1, "one payment row, not two");
  // An older 'authenticated' event arriving late can't take Pro away.
  const late = await deliver(subEvent(u.subId, "authenticated", { createdAt: t - 60_000 }));
  assert.equal(late.body.outcome, "stale");
  assert.equal((await plan(u.cookie)).plan, "pro");
});

test("billing: renewal extends Pro; a failed renewal (pending) keeps it within grace; halted ends it", async () => {
  const u = await subscribedUser("renew");
  const t = Date.now();
  await deliver(subEvent(u.subId, "active", { createdAt: t - 40 * DAY, currentEnd: t - 10 * DAY, payment: { id: `pay_R1${Date.now()}` } }));
  const renewalEnd = sec(t + 20 * DAY);
  await deliver(subEvent(u.subId, "active", { createdAt: t - 10 * DAY, currentEnd: renewalEnd, payment: { id: `pay_R2${Date.now()}` } }));
  assert.equal(new Date((await plan(u.cookie)).expiresAt!).getTime(), renewalEnd + 3 * DAY, "renewed period");
  assert.equal((await getAdminDb()!.collection(`billingAccounts/${u.uid}/payments`).get()).size, 2, "both charges in history");
  // Next renewal fails: Razorpay retries (pending) — still Pro.
  await deliver(subEvent(u.subId, "pending", { createdAt: t - 1000, currentEnd: renewalEnd }));
  assert.equal((await plan(u.cookie)).plan, "pro", "pending keeps Pro during retries");
  // Retries exhausted: halted — Pro ends now.
  await deliver(subEvent(u.subId, "halted", { createdAt: t, currentEnd: renewalEnd }));
  assert.equal((await plan(u.cookie)).plan, "free", "halted ends Pro");
});

test("billing: cancel (own subscription only) → Razorpay cancels at period end; Pro stays until then", async () => {
  const u = await subscribedUser("cancel");
  const other = await verifiedSession(`bill-other-${Date.now()}@example.com`);
  assert.equal((await post(cancelRoute, "/api/billing/cancel", other.cookie)).status, 409, "someone without a subscription can't cancel anything");
  assert.equal((await post(cancelRoute, "/api/billing/cancel", "")).status, 401);
  const t = Date.now();
  const end = sec(t + 25 * DAY);
  await deliver(subEvent(u.subId, "active", { createdAt: t - 5 * DAY, currentEnd: end, payment: { id: `pay_C${Date.now()}` } }));
  assert.equal((await post(cancelRoute, "/api/billing/cancel", u.cookie, "https://evil.example")).status, 403, "cross-site cancel blocked");
  const res = await post(cancelRoute, "/api/billing/cancel", u.cookie);
  assert.equal(res.status, 200);
  assert.ok(razorpay.cancelled.includes(u.subId), "Razorpay asked to cancel at cycle end");
  assert.equal((await plan(u.cookie)).plan, "pro", "still Pro after cancelling");
  assert.equal((await post(cancelRoute, "/api/billing/cancel", u.cookie)).status, 409, "no double cancel");
  // Razorpay later reports the cancellation: Pro until the paid period ends (no grace).
  await deliver(subEvent(u.subId, "cancelled", { createdAt: t, currentEnd: end }));
  const p = await plan(u.cookie);
  assert.deepEqual([p.plan, new Date(p.expiresAt!).getTime()], ["pro", end]);
});

test("billing: forged/unknown subscriptions, non-subscription events and a longer manual grant", async () => {
  // A validly signed event for a subscription we never created (e.g. notes.uid spoofed) grants nothing.
  const forged = await deliver(subEvent("sub_FORGED123", "active", { createdAt: Date.now(), currentEnd: Date.now() + 30 * DAY }));
  assert.deepEqual([forged.status, forged.body.outcome], [200, "unknown_subscription"]);
  // Other Razorpay events are acknowledged and ignored.
  assert.equal((await deliver({ event: "payment.captured", created_at: 1, payload: {} })).body.outcome, "ignored");
  // A user with a year-long manual grant keeps it even if their subscription halts.
  const u = await subscribedUser("manual");
  const yearEnd = sec(Date.now() + 365 * DAY);
  await getAdminDb()!.doc(`entitlements/${u.uid}`).set({ plan: "pro", expiresAt: Timestamp.fromMillis(yearEnd), source: "manual" });
  await deliver(subEvent(u.subId, "halted", { createdAt: Date.now(), currentEnd: Date.now() }));
  const p = await plan(u.cookie);
  assert.deepEqual([p.plan, new Date(p.expiresAt!).getTime()], ["pro", yearEnd]);
});

test("billing: disabled on Production and without test configuration — every billing route answers 404", async () => {
  const saved = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    const u = await verifiedSession(`bill-prod-${Date.now()}@example.com`);
    assert.equal((await post(checkoutRoute, "/api/billing/checkout", u.cookie)).status, 404);
    assert.equal((await post(cancelRoute, "/api/billing/cancel", u.cookie)).status, 404);
    assert.equal((await deliver(subEvent("sub_X1", "active", { createdAt: Date.now(), currentEnd: Date.now() }))).status, 404);
    assert.deepEqual(await (await billingStatusRoute.GET(new Request(`${ORIGIN}/api/billing/status`, { headers: { cookie: u.cookie } }))).json(), { enabled: false });
  } finally {
    if (saved === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = saved;
  }
  const savedKey = process.env.RAZORPAY_KEY_ID;
  process.env.RAZORPAY_KEY_ID = "rzp_live_SHOULD_NOT_WORK";
  try {
    assert.equal((await deliver(subEvent("sub_X2", "active", { createdAt: Date.now(), currentEnd: Date.now() }))).status, 404, "a live key disables billing");
  } finally {
    process.env.RAZORPAY_KEY_ID = savedKey;
  }
});

test("billing: reconciliation applies Razorpay's current state through the same rules (missed webhook)", async () => {
  const { reconcileSubscription } = await import("@/lib/billing/service");
  const { razorpayClient } = await import("@/lib/billing/razorpay");
  const { razorpaySettings } = await import("@/lib/billing/config");
  const u = await subscribedUser("reconcile");
  const end = Date.now() + 30 * DAY;
  razorpay.subs.set(u.subId, { status: "active", current_end: Math.floor(end / 1000) }); // paid, but the webhook never arrived
  assert.equal((await plan(u.cookie)).plan, "free");
  const r = await reconcileSubscription(getAdminDb()!, razorpayClient(razorpaySettings()), u.subId);
  assert.equal(r.outcome, "applied");
  assert.equal((await plan(u.cookie)).plan, "pro");
});
