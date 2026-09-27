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

// ---------------------------------------------------------------- configuration states

const admin = await import("@/lib/firebase/admin");
const config = await import("@/lib/firebase/config");
const statusRoute = await import("@/app/api/auth/status/route");
const { generateKeyPairSync } = await import("node:crypto");

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await admin.resetAdminForTests();
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      await admin.resetAdminForTests();
    }
  };
}

const realKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const account = (over: Record<string, string> = {}) =>
  JSON.stringify({ type: "service_account", project_id: "algoverse-test", client_email: "svc@algoverse-test.iam.gserviceaccount.com", private_key: realKey, ...over });

test("missing public config is reported by variable NAME", withEnv({ NEXT_PUBLIC_FIREBASE_API_KEY: "k", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: undefined, NEXT_PUBLIC_FIREBASE_PROJECT_ID: "p", NEXT_PUBLIC_FIREBASE_APP_ID: undefined }, () => {
  assert.deepEqual(config.missingPublicConfigVars(), ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "NEXT_PUBLIC_FIREBASE_APP_ID"]);
  assert.equal(config.isFirebaseConfigured(), false);
}));

test("server credential states: missing vs invalid vs wrong project vs ok", async () => {
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: undefined }, () => assert.equal(admin.getAdminState(), "missing"))();
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: "not json at all" }, () => assert.equal(admin.getAdminState(), "invalid"))();
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: '{"project_id":"x"}' }, () => assert.equal(admin.getAdminState(), "invalid"))();
  await withEnv(
    { FIREBASE_SERVICE_ACCOUNT_KEY: account({ private_key: "-----BEGIN PRIVATE KEY-----\nbroken\n-----END PRIVATE KEY-----\n" }), NEXT_PUBLIC_FIREBASE_PROJECT_ID: undefined },
    () => assert.equal(admin.getAdminState(), "invalid", "damaged private key")
  )();
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: account(), NEXT_PUBLIC_FIREBASE_PROJECT_ID: "another-project" }, () =>
    assert.equal(admin.getAdminState(), "project_mismatch")
  )();
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: Buffer.from(account()).toString("base64"), NEXT_PUBLIC_FIREBASE_PROJECT_ID: "algoverse-test" }, () =>
    assert.equal(admin.getAdminState(), "ok", "base64-encoded key accepted")
  )();
});

test("protected APIs say WHY accounts are unavailable (missing vs invalid credentials)", async () => {
  const origin = "http://localhost:3000";
  const call = () => profileRoute.GET(new Request(`${origin}/api/account/profile`, { headers: { cookie: "algoverse_session=x" } }));
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: undefined }, async () => {
    assert.equal(((await (await call()).json()) as { error: { code: string } }).error.code, "not_configured");
  })();
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: "{broken" }, async () => {
    const res = await call();
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "server_credentials_invalid");
  })();
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: account(), NEXT_PUBLIC_FIREBASE_PROJECT_ID: "another-project" }, async () => {
    const res = await sessionRoute.POST(
      new Request(`${origin}/api/auth/session`, { method: "POST", headers: { origin }, body: JSON.stringify({ idToken: "x".repeat(40) }) })
    );
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "project_mismatch");
  })();
});

test("GET /api/auth/status reports state names only — never credential values", async () => {
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: account(), NEXT_PUBLIC_FIREBASE_PROJECT_ID: "another-project" }, async () => {
    const res = await statusRoute.GET();
    const text = await res.text();
    assert.equal(JSON.parse(text).server, "project_mismatch");
    assert.ok(!text.includes("PRIVATE KEY") && !text.includes("svc@") && !text.includes("algoverse-test"), "no secret material");
  })();
  await withEnv({ FIREBASE_SERVICE_ACCOUNT_KEY: undefined }, async () => {
    assert.equal(((await (await statusRoute.GET()).json()) as { server: string }).server, "missing");
  })();
});

// ---------------------------------------------------------------- public web config resolution

const ALL = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIzaTESTVALUE-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "algoverse-test.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "algoverse-test",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:123:web:abc",
};

test("all four public values present → configured (from the build)", () => {
  const r = config.resolvePublicConfig(ALL, {});
  assert.ok(r.config);
  assert.equal(r.config!.projectId, "algoverse-test");
  assert.deepEqual(r.missing, []);
  assert.equal(r.source, "build");
});

test("build lacks the values but the deployment has them at runtime → still configured", () => {
  const r = config.resolvePublicConfig({}, ALL);
  assert.ok(r.config, "runtime fallback works");
  assert.equal(r.source, "runtime");
  const mixed = config.resolvePublicConfig({ ...ALL, NEXT_PUBLIC_FIREBASE_APP_ID: "" }, { NEXT_PUBLIC_FIREBASE_APP_ID: "1:123:web:abc" });
  assert.ok(mixed.config);
  assert.equal(mixed.source, "mixed");
});

test("one or more values absent (or whitespace) → exactly those names reported missing", () => {
  const r = config.resolvePublicConfig({ ...ALL, NEXT_PUBLIC_FIREBASE_APP_ID: "   " }, {});
  assert.equal(r.config, null);
  assert.deepEqual(r.missing, ["NEXT_PUBLIC_FIREBASE_APP_ID"]);
  const none = config.resolvePublicConfig({}, {});
  assert.deepEqual(none.missing, [...config.PUBLIC_CONFIG_VARS]);
  assert.equal(none.source, "none");
});

test("the server credential is NOT needed for the browser config", withEnv({ ...ALL, FIREBASE_SERVICE_ACCOUNT_KEY: undefined }, async () => {
  const { getPublicConfigState } = await import("@/lib/firebase/runtime-config");
  assert.ok(getPublicConfigState().config, "public config usable without the service account");
  assert.equal(admin.getAdminState(), "missing", "server side reported separately");
}));

const diagnosticsRoute = await import("@/app/api/auth/diagnostics/route");

test("GET /api/auth/diagnostics: booleans only, never values", withEnv({ ...ALL, NEXT_PUBLIC_FIREBASE_APP_ID: undefined, FIREBASE_SERVICE_ACCOUNT_KEY: account(), VERCEL_ENV: "preview", "NEXT_PUBLIC_FIRBASE_APP_ID": "typo" }, async () => {
  const res = diagnosticsRoute.GET();
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.publicConfig.hasApiKey.atRuntime, true);
  assert.equal(body.publicConfig.hasAppId.atRuntime, false);
  assert.equal(body.browserSignInConfigured, false);
  assert.equal(body.hasAdminCredential, true);
  assert.deepEqual(body.unrecognisedFirebaseVariableNames, ['"NEXT_PUBLIC_FIRBASE_APP_ID"']);
  for (const secret of [ALL.NEXT_PUBLIC_FIREBASE_API_KEY, "algoverse-test.firebaseapp.com", "PRIVATE KEY", "svc@", "typo"]) {
    assert.ok(!text.includes(secret), `does not leak ${secret}`);
  }
}));

test("GET /api/auth/diagnostics is disabled on Production", withEnv({ VERCEL_ENV: "production" }, async () => {
  assert.equal(diagnosticsRoute.GET().status, 404);
}));

test("build-log report prints yes/no and names, never values", async () => {
  const { firebaseEnvReport } = await import("@/scripts/firebase-env-report.mjs");
  const report = firebaseEnvReport({
    ...ALL,
    NEXT_PUBLIC_FIREBASE_APP_ID: " ",
    FIREBASE_SERVICE_ACCOUNT_KEY: account(),
    "NEXT_PUBLIC_FIREBASE_API_KEY ": "x",
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "feat/accounts-firebase",
  });
  assert.match(report, /yes\s+NEXT_PUBLIC_FIREBASE_API_KEY/);
  assert.match(report, /NO\s+NEXT_PUBLIC_FIREBASE_APP_ID \(set but EMPTY\)/);
  assert.match(report, /"NEXT_PUBLIC_FIREBASE_API_KEY "/, "trailing-space name flagged");
  assert.match(report, /feat\/accounts-firebase/);
  for (const secret of [ALL.NEXT_PUBLIC_FIREBASE_API_KEY, "algoverse-test.firebaseapp.com", "PRIVATE KEY"]) {
    assert.ok(!report.includes(secret), `does not leak ${secret}`);
  }
});
