// Unit tests for the account/auth layer that need no Firebase project or emulator.
// Run: npm run test:auth-unit
import { test } from "node:test";
import assert from "node:assert/strict";

// Make sure no real credentials or emulators are picked up: this suite checks the
// "accounts not configured" behaviour and the pure helpers.
for (const k of ["FIREBASE_SERVICE_ACCOUNT_KEY", "FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST"]) delete process.env[k];
console.error = () => {};

const shared = await import("@/lib/auth/shared");
const server = await import("@/lib/auth/server");
const sessionRoute = await import("@/app/api/auth/session/route");
const profileRoute = await import("@/app/api/account/profile/route");

test("safeNextPath only allows same-site relative paths (no open redirects)", () => {
  const { safeNextPath } = shared;
  assert.equal(safeNextPath("/problems/12"), "/problems/12");
  assert.equal(safeNextPath("/account?x=1"), "/account?x=1");
  for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "evil.com", "", null, undefined, "/a\u0000b"]) {
    assert.equal(safeNextPath(bad as string), "/account", `rejects ${String(bad)}`);
  }
});

test("display names are normalised and bounded", () => {
  const { normalizeDisplayName, DISPLAY_NAME_MAX_LENGTH } = shared;
  assert.equal(normalizeDisplayName("  Asha   Rao "), "Asha Rao");
  assert.equal(normalizeDisplayName("a\u0000b‮c"), "abc");
  assert.equal(normalizeDisplayName("   "), null);
  assert.equal(normalizeDisplayName(null), null);
  assert.equal(normalizeDisplayName(42), undefined);
  assert.equal(normalizeDisplayName("x".repeat(DISPLAY_NAME_MAX_LENGTH + 1)), undefined);
});

test("password and email validation", () => {
  assert.ok(shared.passwordProblem("short1"));
  assert.ok(shared.passwordProblem("onlyletters"));
  assert.ok(shared.passwordProblem("12345678"));
  assert.equal(shared.passwordProblem("letters123"), null);
  assert.ok(shared.isValidEmail("a@b.co"));
  assert.ok(!shared.isValidEmail("a@b"));
  assert.ok(!shared.isValidEmail(`${"a".repeat(250)}@b.co`));
});

test("same-origin (CSRF) check", () => {
  const mk = (headers: Record<string, string>) => new Request("https://algoverse.example/api/account/profile", { method: "PATCH", headers });
  assert.ok(server.isSameOrigin(mk({ origin: "https://algoverse.example" })));
  assert.ok(!server.isSameOrigin(mk({ origin: "https://evil.example" })));
  assert.ok(!server.isSameOrigin(mk({ origin: "null" })));
  assert.ok(server.isSameOrigin(mk({ "sec-fetch-site": "same-origin" })));
  assert.ok(!server.isSameOrigin(mk({ "sec-fetch-site": "cross-site" })));
  assert.ok(!server.isSameOrigin(mk({})), "no Origin and no Sec-Fetch-Site → rejected");
});

test("session cookies are only minted from a recent sign-in", () => {
  const now = Date.UTC(2026, 8, 27, 12, 0, 0);
  assert.ok(server.isRecentSignIn(now / 1000 - 60, now));
  assert.ok(!server.isRecentSignIn(now / 1000 - shared.RECENT_SIGN_IN_SECONDS - 1, now));
  assert.ok(!server.isRecentSignIn(Number.NaN, now));
});

test("session cookie header is HttpOnly, SameSite=Lax, path-wide, and clearable", () => {
  const h = server.sessionCookieHeader("abc");
  assert.match(h, /^algoverse_session=abc;/);
  assert.match(h, /HttpOnly/);
  assert.match(h, /SameSite=Lax/);
  assert.match(h, /Path=\//);
  assert.match(h, new RegExp(`Max-Age=${shared.SESSION_MAX_AGE_SECONDS}`));
  assert.match(server.clearSessionCookieHeader(), /Max-Age=0/);
});

test("readCookie parses the Cookie header", () => {
  const req = new Request("https://x.example/", { headers: { cookie: "a=1; algoverse_session=tok%3D; b=2" } });
  assert.equal(server.readCookie(req, "algoverse_session"), "tok=");
  assert.equal(server.readCookie(req, "missing"), null);
});

test("without Firebase configured: routes answer 'not configured', never 200 with data", async () => {
  const origin = "http://localhost:3000";
  const get = await sessionRoute.GET(new Request(`${origin}/api/auth/session`));
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { user: null, configured: false });

  const post = await sessionRoute.POST(
    new Request(`${origin}/api/auth/session`, { method: "POST", headers: { origin }, body: JSON.stringify({ idToken: "x".repeat(40) }) })
  );
  assert.equal(post.status, 503);

  const profile = await profileRoute.GET(new Request(`${origin}/api/account/profile`, { headers: { cookie: "algoverse_session=forged" } }));
  assert.equal(profile.status, 503);
  const body = await profile.json();
  assert.equal(body.error.code, "not_configured");
});

test("DELETE /api/auth/session rejects cross-site requests and clears the cookie otherwise", async () => {
  const cross = await sessionRoute.DELETE(
    new Request("http://localhost:3000/api/auth/session", { method: "DELETE", headers: { origin: "https://evil.example" } })
  );
  assert.equal(cross.status, 403);
  const ok = await sessionRoute.DELETE(
    new Request("http://localhost:3000/api/auth/session", { method: "DELETE", headers: { origin: "http://localhost:3000" } })
  );
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("set-cookie") ?? "", /algoverse_session=; .*Max-Age=0/);
});
