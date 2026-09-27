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
