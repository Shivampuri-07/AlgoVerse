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
const diagReq = (host = "algo-verse-abc123-team.vercel.app") =>
  new Request(`https://${host}/api/auth/diagnostics`, { headers: { host } });
/** Stand-in for Firebase's public project-config lookup (no network in unit tests). */
async function withProjectConfig<T>(authorizedDomains: string[] | null, fn: (calls: string[]) => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (!String(input).startsWith("https://identitytoolkit.googleapis.com/v1/projects?key=")) throw new Error("unexpected network call");
    return authorizedDomains ? new Response(JSON.stringify({ projectId: "123456", authorizedDomains }), { status: 200 }) : new Response("{}", { status: 403 });
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("GET /api/auth/diagnostics (Preview): booleans and names only, never values", withEnv({ ...ALL, NEXT_PUBLIC_FIREBASE_APP_ID: undefined, FIREBASE_SERVICE_ACCOUNT_KEY: account(), VERCEL_ENV: "preview", "NEXT_PUBLIC_FIRBASE_APP_ID": "typo" }, async () => {
  const res = await diagnosticsRoute.GET(diagReq());
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.browserSignInConfigured, false);
  assert.deepEqual(body.missingPublicVariables, ["NEXT_PUBLIC_FIREBASE_APP_ID"]);
  assert.equal(body.publicConfig.hasApiKey.atRuntime, true);
  assert.equal(body.publicConfig.hasAppId.atRuntime, false);
  assert.equal(body.hasAdminCredential, true);
  assert.deepEqual(body.missingServerVariables, []);
  assert.deepEqual(body.unrecognisedFirebaseVariableNames, ['"NEXT_PUBLIC_FIRBASE_APP_ID"']);
  for (const secret of [ALL.NEXT_PUBLIC_FIREBASE_API_KEY, "algoverse-test.firebaseapp.com", "PRIVATE KEY", "svc@", "typo"]) {
    assert.ok(!text.includes(secret), `does not leak ${secret}`);
  }
}));

test("GET /api/auth/diagnostics (Production): answers with essentials only — no 404, no detail", withEnv({ ...ALL, FIREBASE_SERVICE_ACCOUNT_KEY: undefined, VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "feat/x" }, async () => {
  const res = await diagnosticsRoute.GET(diagReq("algo-verse-phi.vercel.app"));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.environment, "production");
  assert.equal(body.browserSignInConfigured, true);
  assert.deepEqual(body.missingPublicVariables, []);
  assert.equal(body.adminCredentialState, "missing");
  assert.deepEqual(body.missingServerVariables, ["FIREBASE_SERVICE_ACCOUNT_KEY"]);
  for (const k of ["publicConfig", "deployment", "unrecognisedFirebaseVariableNames", "googleSignIn", "firebaseProjectId"]) assert.ok(!(k in body), `no ${k} on production`);
}));

const loaderMod = await import("@/lib/firebase/admin-loader");

test("if firebase-admin can't load (e.g. Node 18: ERR_REQUIRE_ESM), status/diagnostics explain it instead of a 500", withEnv({ ...ALL, FIREBASE_SERVICE_ACCOUNT_KEY: account(), NEXT_PUBLIC_FIREBASE_PROJECT_ID: "algoverse-test", VERCEL_ENV: "preview" }, async () => {
  loaderMod.setAdminLoaderForTests(() => Promise.reject(Object.assign(new Error("require() of ES Module"), { code: "ERR_REQUIRE_ESM" })));
  try {
    const diag = await withProjectConfig(["localhost"], () => diagnosticsRoute.GET(diagReq()));
    assert.equal(diag.status, 200);
    const d = await diag.json();
    assert.equal(d.adminSdk, "load_failed");
    assert.equal(d.adminSdkError.code, "ERR_REQUIRE_ESM");
    assert.match(d.adminSdkError.message, /require\(\) of ES Module/);
    const st = await statusRoute.GET();
    assert.equal(st.status, 200);
    const s = await st.json();
    assert.equal(s.server, "sdk_unavailable");
    assert.equal(s.node, process.versions.node);
    assert.equal(s.sdkError.code, "ERR_REQUIRE_ESM", "the real error is reported, not a guess");
  } finally {
    loaderMod.setAdminLoaderForTests(null);
  }
  const ok = await withProjectConfig(["localhost"], async () => (await diagnosticsRoute.GET(diagReq())).json());
  assert.equal(ok.adminSdk, "ok", "real loader works on this Node version");
  assert.equal(ok.adminCredentialState, "ok");
}));

test("Node.js support check for firebase-admin", () => {
  assert.equal(loaderMod.nodeSupportsFirebaseAdmin("18.20.8"), false);
  assert.equal(loaderMod.nodeSupportsFirebaseAdmin("20.18.0"), false);
  assert.equal(loaderMod.nodeSupportsFirebaseAdmin("20.19.0"), true);
  assert.equal(loaderMod.nodeSupportsFirebaseAdmin("22.1.0"), true);
  assert.equal(loaderMod.nodeSupportsFirebaseAdmin("24.0.0"), true);
});

test("package.json pins a Node.js version firebase-admin supports", async () => {
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.engines?.node, "22.x");
});

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

test("load errors are reported safely: package-relative paths, keys and tokens redacted", () => {
  const err = Object.assign(
    new Error(
      "require() of ES Module /var/task/node_modules/jose/dist/webapi/index.js from /var/task/node_modules/jwks-rsa/src/utils.js not supported. " +
        "-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY----- eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk AIzaSyA1234567890abcdefghijklmnop\nstack line"
    ),
    { code: "ERR_REQUIRE_ESM" }
  );
  const d = loaderMod.describeLoadError(err);
  assert.equal(d.code, "ERR_REQUIRE_ESM");
  assert.match(d.message, /jose\/dist\/webapi\/index\.js from jwks-rsa\/src\/utils\.js/);
  for (const bad of ["/var/task", "BEGIN PRIVATE KEY", "MIIEvQ", "eyJhbGci", "AIzaSy", "stack line"]) {
    assert.ok(!d.message.includes(bad), `redacts ${bad}`);
  }
  assert.ok(d.message.length <= 300);
});

test("firebase-admin loads even where require(esm) is unavailable (jwks-rsa's jose is overridden to a CJS build)", async () => {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(
    process.execPath,
    ["--no-experimental-require-module", "-e", 'require("firebase-admin/app");require("firebase-admin/auth");require("firebase-admin/firestore");console.log("ok")'],
    { encoding: "utf8" }
  );
  assert.equal(out.trim(), "ok");
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.overrides?.["jwks-rsa"]?.jose, "5.10.0");
});

test("jwks-rsa's signing-key code path works with the overridden jose (importJWK + exportSPKI)", async () => {
  const { createRequire } = await import("node:module");
  const { generateKeyPairSync } = await import("node:crypto");
  const req = createRequire(import.meta.url);
  const { retrieveSigningKeys } = req("jwks-rsa/src/utils.js");
  const jwk = { ...generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
  const keys = await retrieveSigningKeys([jwk]);
  assert.equal(keys.length, 1);
  assert.equal(keys[0].kid, "k1");
  assert.match(keys[0].getPublicKey(), /BEGIN PUBLIC KEY/);
});

// ---------------------------------------------------------------- email verification requests

const verification = await import("@/lib/auth/verification");
const fakeUser = { uid: "u1", emailVerified: false } as unknown as import("firebase/auth").User;
const fbError = (code: string, reason = "Error") => Object.assign(new Error(`Firebase: ${reason} (${code}).`), { code });

test("verification email: a resolved Firebase request is reported as accepted (with the continue URL)", async () => {
  const calls: unknown[] = [];
  const out = await verification.requestVerificationEmail(fakeUser, "https://x.example/account?verified=1", async (_u, s) => {
    calls.push(s);
  });
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.continueUrlUsed, true);
  assert.deepEqual(calls, [{ url: "https://x.example/account?verified=1" }]);
});

test("verification email: unauthorised continue URL → sent again without it, and the reason is kept", async () => {
  const calls: unknown[] = [];
  const out = await verification.requestVerificationEmail(fakeUser, "https://preview.example/account", async (_u, s) => {
    calls.push(s ?? null);
    if (s) throw fbError("auth/unauthorized-continue-uri", "Domain not allowlisted by project");
  });
  assert.equal(out.ok, true);
  assert.equal(out.ok && out.continueUrlUsed, false);
  assert.equal(out.ok && out.fallbackCode, "auth/unauthorized-continue-uri");
  assert.deepEqual(calls, [{ url: "https://preview.example/account" }, null]);
});

test("verification email: other Firebase errors are returned (not swallowed) and not retried", async () => {
  let n = 0;
  const out = await verification.requestVerificationEmail(fakeUser, "https://x.example/a", async () => {
    n++;
    throw fbError("auth/too-many-requests");
  });
  assert.equal(n, 1);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.code, "auth/too-many-requests");
  assert.match(verification.verificationFailureMessage("auth/too-many-requests"), /too many requests/i);
});

test("verification email: if the fallback also fails, that error is reported", async () => {
  const out = await verification.requestVerificationEmail(fakeUser, "https://x.example/a", async (_u, s) => {
    throw s ? fbError("auth/unauthorized-continue-uri") : fbError("auth/quota-exceeded", "Exceeded quota for email");
  });
  assert.equal(!out.ok && out.code, "auth/quota-exceeded");
  assert.equal(!out.ok && out.detail, "Exceeded quota for email");
});

test("Firebase error info extracts code and server reason, without user data", () => {
  assert.deepEqual(verification.firebaseErrorInfo(fbError("auth/unauthorized-continue-uri", "Domain not allowlisted by project")), {
    code: "auth/unauthorized-continue-uri",
    detail: "Domain not allowlisted by project",
  });
  assert.deepEqual(verification.firebaseErrorInfo(fbError("auth/network-request-failed")), { code: "auth/network-request-failed", detail: "" });
  assert.equal(verification.firebaseErrorInfo(new Error("boom")).code, "unknown");
});

test("resend cooldown", () => {
  const t = 1_000_000;
  assert.equal(verification.cooldownRemaining(null, t), 0);
  assert.equal(verification.cooldownRemaining(t, t + 1_000), verification.VERIFICATION_COOLDOWN_MS - 1_000);
  assert.equal(verification.cooldownRemaining(t, t + verification.VERIFICATION_COOLDOWN_MS + 1), 0);
});

// ---------------------------------------------------------------- verification pause state machine

const MIN = 60_000;
const tmr = (at: number) => ({ ok: false as const, at, code: "auth/too-many-requests", detail: "" });
const cooldownClick = (at: number, left: number) => ({ ok: false as const, at, code: "app/cooldown", detail: String(left) });

test("pause has a FIXED expiry: clicks during it (app/cooldown) never extend or restart it", () => {
  const v = verification;
  const t0 = 1_000_000_000;
  const s1 = v.applyOutcome(v.INITIAL_VERIFICATION_STATE, tmr(t0));
  assert.equal(s1.until, t0 + 15 * MIN);
  let s = s1;
  for (let i = 1; i <= 20; i++) s = v.applyOutcome(s, cooldownClick(t0 + i * 30_000, 1));
  assert.deepEqual(s, s1, "20 clicks during the pause change nothing");
  assert.equal(v.requestGate(s, t0 + 14 * MIN).allowed, false);
  assert.equal(v.requestGate(s, t0 + 15 * MIN + 1).allowed, true, "allowed exactly after the fixed expiry");
});

test("repeated auth/too-many-requests escalates (15m → 1h → 4h → 24h cap) instead of an endless identical 15-minute loop", () => {
  const v = verification;
  let s = v.INITIAL_VERIFICATION_STATE;
  let t = 2_000_000_000;
  const waits: number[] = [];
  for (let i = 0; i < 6; i++) {
    s = v.applyOutcome(s, tmr(t));
    waits.push(s.until - t);
    t = s.until + 1; // the user waits for the pause to end, then tries ONCE
  }
  assert.deepEqual(waits, [15 * MIN, 60 * MIN, 240 * MIN, 1440 * MIN, 1440 * MIN, 1440 * MIN]);
  assert.equal(s.rateLimitStreak, 6);
  assert.equal(v.nextRateLimitBackoff(v.applyOutcome(v.INITIAL_VERIFICATION_STATE, tmr(t))), 60 * MIN, "UI can say what comes next");
});

test("an accepted request resets the streak; a network error neither extends the pause nor counts as Firebase's answer", () => {
  const v = verification;
  const t = 3_000_000_000;
  const limited = v.applyOutcome(v.applyOutcome(v.INITIAL_VERIFICATION_STATE, tmr(t)), tmr(t + 16 * MIN));
  assert.equal(limited.rateLimitStreak, 2);
  const net = v.applyOutcome(limited, { ok: false, at: t + 17 * MIN, code: "auth/network-request-failed", detail: "" });
  assert.equal(net.until, limited.until, "network failure keeps the same fixed expiry");
  assert.equal(net.rateLimitStreak, 2);
  const ok = v.applyOutcome(limited, { ok: true, at: t + 100 * MIN, continueUrlUsed: true });
  assert.equal(ok.rateLimitStreak, 0);
  assert.equal(ok.until, t + 100 * MIN + v.VERIFICATION_COOLDOWN_MS);
  assert.equal(v.applyOutcome(v.INITIAL_VERIFICATION_STATE, { ok: false, at: t, code: "auth/quota-exceeded", detail: "" }).until, t + v.QUOTA_BACKOFF_MS);
});

test("stored state survives reloads (round-trip), migrates the old format, and rejects junk", () => {
  const v = verification;
  const s = v.applyOutcome(v.INITIAL_VERIFICATION_STATE, tmr(4_000_000_000));
  assert.deepEqual(v.parseStoredState(JSON.stringify(s)), s);
  const old = v.parseStoredState(JSON.stringify({ until: 5, outcome: tmr(1) }));
  assert.deepEqual(old, { until: 5, last: tmr(1), rateLimitStreak: 1 });
  for (const junk of [null, "", "{", "[]", '{"until":"x"}']) assert.equal(v.parseStoredState(junk), null);
  // Two tabs: the one with the newer real answer wins.
  const newer = v.applyOutcome(s, tmr(4_100_000_000));
  assert.equal(v.newerState(s, newer), newer);
  assert.equal(v.newerState(newer, s), newer);
});

test("a continue URL already known to be rejected → exactly one request per send", async () => {
  const calls: unknown[] = [];
  const out = await verification.requestVerificationEmail(fakeUser, null, async (_u, s) => {
    calls.push(s ?? null);
  });
  assert.equal(out.ok, true);
  assert.deepEqual(calls, [null]);
});

test("Google errors from the Firebase SDK (incl. a real auth/unauthorized-domain) get clear messages; cancels are silent", async () => {
  const google = await import("@/lib/auth/google");
  assert.match(google.googleErrorMessage("auth/unauthorized-domain"), /isn't authorised for Google sign-in/, "Production: neutral message");
  assert.match(google.googleErrorMessage("auth/popup-blocked"), /blocked the Google sign-in window/);
  assert.match(google.googleErrorMessage("auth/credential-already-in-use"), /never merged automatically/);
  assert.equal(google.isGoogleCancel("auth/popup-closed-by-user"), true);
  assert.equal(google.isGoogleCancel("auth/unauthorized-domain"), false);
});

// ---------------------------------------------------------------- Google sign-in: authorized domains

// Production project's Authorized domains as read from Firebase on 2026-09-29 (public, non-secret).
const PROD_DOMAINS = ["localhost", "algoverse-f5b48.firebaseapp.com", "algoverse-f5b48.web.app", "algo-verse-git-feat-accounts-firebase-algo-verse1.vercel.app", "algo-verse-phi.vercel.app", "algo-verse-cztr4xzv3-algo-verse1.vercel.app", "algo-verse-6lvyxg8z1-algo-verse1.vercel.app"];
const BRANCH_HOST = "algo-verse-git-feat-accounts-firebase-algo-verse1.vercel.app";

test("authorized-domain rule matches Firebase's: exact host or subdomain, http(s) only, no look-alikes", async () => {
  const g = await import("@/lib/auth/google");
  assert.equal(g.isAuthorizedHost(BRANCH_HOST, PROD_DOMAINS), true, "stable branch address is authorised");
  assert.equal(g.isAuthorizedHost("algo-verse-15lr4tgm1-algo-verse1.vercel.app", PROD_DOMAINS), false, "a new per-deployment address is not — this is the reported error");
  assert.equal(g.isAuthorizedHost("localhost", PROD_DOMAINS), true);
  assert.equal(g.hostMatchesAuthorizedDomain("sub.algo-verse-phi.vercel.app", "algo-verse-phi.vercel.app"), true, "subdomains count (as in Firebase)");
  assert.equal(g.hostMatchesAuthorizedDomain("evilalgo-verse-phi.vercel.app", "algo-verse-phi.vercel.app"), false, "no suffix look-alikes");
  assert.equal(g.hostMatchesAuthorizedDomain("algo-verse-phi.vercel.app.evil.com", "algo-verse-phi.vercel.app"), false);
  assert.equal(g.hostMatchesAuthorizedDomain("algo-verse-phiXvercel.app", "algo-verse-phi.vercel.app"), false, "dots are literal");
  assert.equal(g.hostMatchesAuthorizedDomain("10.0.0.12", "10.0.0.1"), false, "IP addresses match exactly");
  assert.equal(g.hostMatchesAuthorizedDomain(BRANCH_HOST, BRANCH_HOST, "file:"), false);
  assert.equal(g.isAuthorizedHost("anything.vercel.app", PROD_DOMAINS), false, "vercel.app itself is not authorised");
});

test("auth/unauthorized-domain message: exact host, project and the stable address on Preview; neutral on Production", async () => {
  const g = await import("@/lib/auth/google");
  const preview = g.googleErrorMessage("auth/unauthorized-domain", { host: "algo-verse-15lr4tgm1-algo-verse1.vercel.app", projectId: "algoverse-preview", stableHost: BRANCH_HOST, details: true });
  assert.match(preview, /algo-verse-15lr4tgm1-algo-verse1\.vercel\.app/);
  assert.match(preview, /project "algoverse-preview" → Authentication → Settings → Authorized domains/);
  assert.match(preview, new RegExp(`stable address ${BRANCH_HOST.replace(/\./g, "\\.")}`));
  const onStable = g.googleErrorMessage("auth/unauthorized-domain", { host: BRANCH_HOST, projectId: "algoverse-preview", stableHost: BRANCH_HOST, details: true });
  assert.match(onStable, new RegExp(`add ${BRANCH_HOST.replace(/\./g, "\\.")} to Firebase → project "algoverse-preview"`), "on the stable address: add it to the (Preview) project");
  const prod = g.googleErrorMessage("auth/unauthorized-domain", { host: "algo-verse-phi.vercel.app", projectId: "algoverse-f5b48", details: false });
  assert.doesNotMatch(prod, /algoverse-f5b48|Settings/, "no setup details on Production");
  assert.match(g.googleErrorMessage("auth/operation-not-allowed"), /isn't enabled/, "other codes keep their own message");
});

test("authorized-domain lookup: same public endpoint as the SDK, booleans only, never blocks", async () => {
  const { checkAuthorizedDomains, requestHostname } = await import("@/lib/firebase/authorized-domains");
  const key = "AIzaSyTEST-FAKE-KEY-0123456789abcdefghi";
  const r = await withProjectConfig(PROD_DOMAINS, (calls) =>
    checkAuthorizedDomains(key, ["algo-verse-15lr4tgm1-algo-verse1.vercel.app", BRANCH_HOST, null], { referer: "https://x/" }).then((out) => ({ out, calls }))
  );
  assert.deepEqual(r.out, { checked: true, results: { "algo-verse-15lr4tgm1-algo-verse1.vercel.app": false, [BRANCH_HOST]: true } });
  assert.equal(r.calls.length, 1);
  assert.ok(!JSON.stringify(r.out).includes(key), "the key isn't in the result");
  assert.deepEqual(await checkAuthorizedDomains(key, ["h"], { emulator: true }), { checked: false, reason: "emulator" }, "emulator: Firebase skips the check too");
  assert.deepEqual(await checkAuthorizedDomains(null, ["h"]), { checked: false, reason: "no_config" });
  assert.deepEqual(await withProjectConfig(null, () => checkAuthorizedDomains(key, ["h"])), { checked: false, reason: "lookup_failed" });
  assert.equal(requestHostname(new Request("https://a.example/x", { headers: { "x-forwarded-host": "Preview.Example.app:443, proxy" } })), "preview.example.app");
});

test("Preview diagnostics: which project the client and server use, the stable address, and whether each host is authorised", withEnv({ ...ALL, FIREBASE_SERVICE_ACCOUNT_KEY: account({ project_id: "algoverse-f5b48" }), NEXT_PUBLIC_FIREBASE_PROJECT_ID: "algoverse-preview", NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "algoverse-preview.firebaseapp.com", VERCEL_ENV: "preview", VERCEL_BRANCH_URL: BRANCH_HOST }, async () => {
  const host = "algo-verse-15lr4tgm1-algo-verse1.vercel.app";
  const text = await withProjectConfig(["localhost", BRANCH_HOST], async () => (await diagnosticsRoute.GET(diagReq(host))).text());
  const g = JSON.parse(text).googleSignIn;
  assert.equal(g.requestHost, host);
  assert.equal(g.stableHost, BRANCH_HOST);
  assert.equal(g.firebaseProjectId, "algoverse-preview");
  assert.equal(g.authDomainMatchesProject, true);
  assert.equal(g.adminProjectId, "algoverse-f5b48", "the service account's project is reported even when it doesn't match");
  assert.equal(g.clientAndServerSameProject, false, "client and server on different projects is flagged");
  assert.deepEqual(g.authorizedDomains, { checked: true, requestHostAuthorized: false, stableHostAuthorized: true });
  for (const secret of [ALL.NEXT_PUBLIC_FIREBASE_API_KEY, "PRIVATE KEY", "svc@", "algoverse-preview.firebaseapp.com"]) assert.ok(!text.includes(secret), `does not leak ${secret}`);
}));

test("stable branch address comes from VERCEL_BRANCH_URL on Preview, never on Production", async () => {
  const deployment = await import("@/lib/firebase/deployment");
  await withEnv({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: `https://${BRANCH_HOST}/` }, () => assert.equal(deployment.stableHost(), BRANCH_HOST))();
  await withEnv({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: BRANCH_HOST }, () => assert.equal(deployment.deploymentInfo()?.stableHost, BRANCH_HOST))();
  await withEnv({ VERCEL_ENV: "production", VERCEL_BRANCH_URL: BRANCH_HOST }, () => {
    assert.equal(deployment.stableHost(), null);
    assert.equal(deployment.deploymentInfo(), null);
  })();
  await withEnv({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: undefined }, () => assert.equal(deployment.stableHost(), null))();
});

test("login: Firebase's generic credential errors are recognised; the Preview note explains separate accounts", async () => {
  const c = await import("@/lib/auth/client");
  for (const code of ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"]) assert.equal(c.isCredentialError({ code }), true, code);
  for (const code of ["auth/too-many-requests", "auth/network-request-failed", "auth/operation-not-allowed", undefined]) assert.equal(c.isCredentialError({ code }), false, String(code));
  assert.equal(c.firebaseErrorMessage({ code: "auth/invalid-credential" }), "Email or password is incorrect.", "message unchanged (no account enumeration)");
  assert.equal(
    c.previewAccountsNote(),
    "This Preview uses its own accounts, separate from the live site. If your password was set on the live site, it won't work here. Continue with Google, or sign in with Google and use Account → Set a password."
  );
  assert.doesNotMatch(c.previewAccountsNote(), /firebase|project|algoverse-/i, "no Firebase jargon or project names");
  assert.match(c.firebaseErrorMessage({ code: "auth/provider-already-linked" }), /already has a password/);
});

test("stable Preview address: same path and query, host always the stable host (no open redirect)", async () => {
  const { stableAddressFor } = await import("@/lib/auth/google");
  const S = "algo-verse-git-feat-accounts-firebase-algo-verse1.vercel.app";
  assert.equal(stableAddressFor(S, "https://algo-verse-gkyhw9ka2-algo-verse1.vercel.app/login?next=%2Fproblems%2F6"), `https://${S}/login?next=%2Fproblems%2F6`);
  assert.equal(stableAddressFor(S, `https://${S}/login`), null, "already on the stable address");
  assert.equal(stableAddressFor(null, "https://x.vercel.app/login"), null, "no stable host (e.g. Production)");
  for (const href of ["https://a.vercel.app//evil.example/login", "https://a.vercel.app/%2F%2Fevil.example", "https://a.vercel.app/\\evil.example/x", "https://a.vercel.app/login?next=https://evil.example"]) {
    const out = stableAddressFor(S, href);
    assert.ok(out && new URL(out).host === S, `${href} → ${out}`);
  }
  for (const bad of ["evil.example/path", "evil.example:8080", "https://evil.example", "localhost", "", "a..b"]) assert.equal(stableAddressFor(bad, "https://a.vercel.app/login"), null, `rejects stable host ${JSON.stringify(bad)}`);
});

test("status probe: a valid, collision-safe Firestore path (the old users/__status_probe__ was reserved → INVALID_ARGUMENT)", async () => {
  const { STATUS_PROBE_PATH, isValidDocumentPath } = await import("@/lib/firebase/status-probe");
  assert.equal(isValidDocumentPath(STATUS_PROBE_PATH), true);
  assert.ok(!STATUS_PROBE_PATH.startsWith("users/"), "never in the users collection (can't collide with a real account)");
  assert.equal(isValidDocumentPath("users/__status_probe__"), false, "reserved __…__ id");
  for (const bad of ["users", "a/b/c", "a//b", "__x__/doc", "a/.", "a/.."]) assert.equal(isValidDocumentPath(bad), false, bad);
  const source = (await import("node:fs")).readFileSync("app/api/auth/status/route.ts", "utf8");
  assert.ok(source.includes("STATUS_PROBE_PATH") && !source.includes("__status_probe__"), "the route uses the valid path");
});

test("build report: AI cap and key state are shown without printing the key", async () => {
  const { firebaseEnvReport } = await import("../firebase-env-report.mjs");
  const key = "AIzaSyTEST-FAKE-KEY-0123456789abcdefghi";
  const preview = firebaseEnvReport({ VERCEL_ENV: "preview", AI_GLOBAL_DAILY_LIMIT: "30", GEMINI_API_KEY: key, GEMINI_KEY_SCOPE: "preview" });
  assert.match(preview, /AI: global daily cap 30 \| GEMINI_API_KEY set \| GEMINI_KEY_SCOPE=preview: yes/);
  assert.ok(!preview.includes(key), "key never printed");
  assert.match(firebaseEnvReport({}), /global daily cap 500 \(default\) \| GEMINI_API_KEY NOT set \| GEMINI_KEY_SCOPE=preview: no/);
  assert.match(firebaseEnvReport({ AI_GLOBAL_DAILY_LIMIT: "abc", GEMINI_API_KEY: "your_key_here" }), /500 \(default; AI_GLOBAL_DAILY_LIMIT is not a positive integer\) \| GEMINI_API_KEY placeholder \(AI off\)/);
});

test("build report: which Firebase project the build uses — ids only, never key material", async () => {
  const { firebaseEnvReport } = await import("../firebase-env-report.mjs");
  const sa = account({ project_id: "algoverse-f5b48" });
  const env = {
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "algoverse-f5b48",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "algoverse-f5b48.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_APP_ID: "1:132880800030:web:abc",
    FIREBASE_SERVICE_ACCOUNT_KEY: Buffer.from(sa).toString("base64"),
  };
  const out = firebaseEnvReport(env);
  assert.match(out, /Firebase project: web config algoverse-f5b48 \| auth domain matches: yes \| app project number 132880800030 \| service account algoverse-f5b48 \| client and server same project: yes/);
  for (const secret of ["PRIVATE KEY", "svc@", env.FIREBASE_SERVICE_ACCOUNT_KEY.slice(0, 30)]) assert.ok(!out.includes(secret), `does not print ${secret}`);
  const mixed = firebaseEnvReport({ ...env, FIREBASE_SERVICE_ACCOUNT_KEY: account({ project_id: "algoverse-preview" }) });
  assert.match(mixed, /service account algoverse-preview \| client and server same project: no/, "a mismatch is visible in the build log");
  assert.match(firebaseEnvReport({}), /web config - \| auth domain matches: no \| app project number - \| service account - \| client and server same project: no/);
});
