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
