// Real-browser tests of the account UI (Google Chrome via playwright-core) against production
// builds made by scripts/tests/run-e2e.mjs, with Firebase Auth/Firestore EMULATORS — no real
// Firebase project is touched. Run: npm run test:e2e
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`;
const CONFIGURED = "http://localhost:3121";
const UNCONFIGURED = "http://localhost:3122";
// A build made WITHOUT the public values, served by a deployment whose environment HAS them.
const RUNTIME_ONLY = "http://localhost:3123";
// Non-emulator build (real SDK domain check), opened on a hostname that isn't authorised.
const LIVE_SDK = "http://127.0.0.1:3124";
const DEMO_PUBLIC = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-algoverse.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-algoverse",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:demo",
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};
const STORAGE_KEY = "dsa-roadmap-storage";

const servers = [];
let browser;

function startServer(port, distDir, env) {
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    env: { ...env, NEXT_DIST_DIR: distDir, PORT: String(port) },
    stdio: "ignore",
  });
  servers.push(child);
}

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server at ${url} did not start`);
}

before(async () => {
  // Configured server: Admin SDK talks to the emulators (inherited env), no real credentials.
  startServer(3121, ".next-e2e", { ...process.env, FIREBASE_PROJECT_ID: "demo-algoverse" });
  // Unconfigured server: no emulator hosts and no service-account key.
  const bare = { ...process.env };
  for (const k of ["FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "FIREBASE_SERVICE_ACCOUNT_KEY", "FIREBASE_PROJECT_ID"]) delete bare[k];
  startServer(3122, ".next-e2e-nofb", bare);
  startServer(3123, ".next-e2e-nofb", { ...process.env, ...DEMO_PUBLIC, FIREBASE_PROJECT_ID: "demo-algoverse" });
  // Server-side Admin may use the emulator; the BROWSER bundle is a normal (non-emulator) build.
  const live = { ...process.env, FIREBASE_PROJECT_ID: "demo-algoverse", VERCEL_BRANCH_URL: "localhost", VERCEL_ENV: "preview" };
  delete live.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST;
  startServer(3124, ".next-e2e-live", live);
  await Promise.all([
    waitFor(`${CONFIGURED}/login`),
    waitFor(`${UNCONFIGURED}/login`),
    waitFor(`${RUNTIME_ONLY}/login`),
    waitFor(`${LIVE_SDK}/login`),
  ]);
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

after(async () => {
  await browser?.close();
  for (const s of servers) s.kill();
});

const SEEDED_PROGRESS = JSON.stringify({
  state: {
    completed: { 1: "2026-09-20T10:00:00.000Z", 5: "2026-09-21T10:00:00.000Z" },
    bookmarked: [7],
    notes: { 1: "my local note" },
    mistakes: {},
    code: {},
    streak: { current: 0, longest: 2, lastActiveDate: "2026-09-21", activeDates: ["2026-09-20", "2026-09-21"] },
    legacy: { completed: {}, bookmarked: [], notes: {}, mistakes: {}, code: {} },
    lastVisitedId: 5,
  },
  version: 2,
});

async function newPage(base, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, baseURL: base });
  const page = await context.newPage();
  return { context, page };
}

const headerLogin = (page) => page.locator("header").getByRole("link", { name: "Log in" });
const headerSignup = (page) => page.locator("header").getByRole("link", { name: "Sign up" });

async function readProgress(page) {
  return page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
}

// ------------------------------------------------------------------ without Firebase config

test("no Firebase config: homepage still shows Log in, Sign up and the Account link", async () => {
  const { context, page } = await newPage(UNCONFIGURED);
  await page.goto("/");
  await headerLogin(page).waitFor();
  assert.ok(await headerSignup(page).isVisible());
  assert.ok(await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Account" }).isVisible());
  // Existing dashboard still renders.
  assert.ok(await page.getByText(/455/).first().isVisible());
  await context.close();
});

test("no Firebase config: sign-up page explains exactly what's missing and disables submit", async () => {
  const { context, page } = await newPage(UNCONFIGURED);
  await page.goto("/signup");
  await page.getByText("Accounts aren't fully set up on this site yet").waitFor();
  const notice = await page.getByRole("status").first().innerText();
  assert.match(notice, /NEXT_PUBLIC_FIREBASE_API_KEY/);
  assert.match(notice, /FIREBASE_SERVICE_ACCOUNT_KEY is not set/);
  assert.match(notice, /redeploy/i);
  assert.ok(await page.getByRole("button", { name: "Create account" }).isDisabled());
  await page.goto("/account");
  await page.getByText("Accounts aren't fully set up on this site yet").waitFor();
  await context.close();
});

test("no Firebase config: /api/auth/diagnostics says which values are missing, without values", async () => {
  const res = await fetch(`${UNCONFIGURED}/api/auth/diagnostics`);
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.browserSignInConfigured, false);
  assert.equal(d.publicConfig.hasApiKey.inBuild, false);
  assert.equal(d.publicConfig.hasApiKey.atRuntime, false);
  assert.equal(d.hasAdminCredential, false);
});

test("build WITHOUT public values + environment WITH them → no false warning, sign-up works", async () => {
  const diag = await (await fetch(`${RUNTIME_ONLY}/api/auth/diagnostics`)).json();
  assert.equal(diag.publicConfig.hasApiKey.inBuild, false, "this build really lacks the inlined values");
  assert.equal(diag.publicConfig.hasApiKey.atRuntime, true);
  assert.equal(diag.browserSignInConfigured, true);
  assert.equal(diag.publicConfigSource, "runtime");

  const { context, page } = await newPage(RUNTIME_ONLY);
  await page.goto("/signup");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  assert.equal(await page.getByText("Accounts aren't fully set up on this site yet").count(), 0, "no missing-config warning");
  const email = `runtime-${Date.now()}@example.com`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("letters123");
  await page.getByLabel("Confirm password").fill("letters123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/account**");
  await page.getByText(email).first().waitFor();
  const cookie = (await context.cookies()).find((c) => c.name === "algoverse_session");
  assert.ok(cookie?.httpOnly, "secure session cookie");
  await context.close();
});

// ------------------------------------------------------------------ with Firebase (emulators)

test("configured: Log in and Sign up are visible on desktop and on a phone-sized screen", async () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const { context, page } = await newPage(CONFIGURED, viewport);
    await page.goto("/");
    await headerLogin(page).waitFor();
    assert.ok(await headerSignup(page).isVisible(), `Sign up visible at ${viewport.width}px`);
    await headerSignup(page).click();
    await page.waitForURL("**/signup");
    assert.ok(await page.getByRole("heading", { name: "Create your account" }).isVisible());
    await context.close();
  }
});

test("sign-up validation messages, confirmation and password visibility toggle", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/signup");
  const submit = page.getByRole("button", { name: "Create account" });
  await submit.waitFor();
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await submit.click();
  await page.getByText("Enter your email address.").waitFor();
  assert.ok(await page.getByText("Choose a password.").isVisible());

  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("different");
  await submit.click();
  await page.getByText("Enter a valid email address.").waitFor();
  assert.ok(await page.getByText(/at least 8 characters/i).isVisible());
  assert.ok(await page.getByText("Passwords don't match.").isVisible());
  assert.equal(await page.getByLabel("Email").getAttribute("aria-invalid"), "true");

  const pw = page.getByLabel("Password", { exact: true });
  assert.equal(await pw.getAttribute("type"), "password");
  await page.getByRole("button", { name: "Show password" }).first().click();
  assert.equal(await pw.getAttribute("type"), "text");
  await page.getByRole("button", { name: "Hide password" }).first().click();
  assert.equal(await pw.getAttribute("type"), "password");
  await context.close();
});

test("full journey: sign up → session cookie → refresh → log out → log in; local progress untouched", async () => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = "letters123";
  const { context, page } = await newPage(CONFIGURED);

  // An existing anonymous user with local progress.
  await page.goto("/");
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, SEEDED_PROGRESS]);
  await page.reload();
  const before = await readProgress(page);

  // Sign up through the header link.
  await headerSignup(page).click();
  await page.waitForURL("**/signup");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByLabel(/Name/).fill("E2E Student");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/account**");
  await page.getByText(email).first().waitFor();

  // The Firebase Auth (emulator) account really exists: a direct password sign-in works.
  const direct = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(direct.status, 200, "account exists in Firebase Auth");

  // Secure session: HTTP-only cookie, invisible to page scripts.
  const cookie = (await context.cookies()).find((c) => c.name === "algoverse_session");
  assert.ok(cookie, "session cookie set");
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Lax");
  assert.ok(!(await page.evaluate(() => document.cookie)).includes("algoverse_session"));

  // Header shows the account menu with the email.
  await page.getByRole("button", { name: /Account menu/ }).click();
  assert.equal((await page.getByTestId("account-email").innerText()).trim(), email);
  await page.keyboard.press("Escape");

  // Refresh keeps the (server-verified) session.
  await page.reload();
  await page.getByText(email).first().waitFor();
  assert.ok(page.url().includes("/account"));

  // Protected API: works with the session, rejected without it.
  const own = await page.evaluate(async () => (await fetch("/api/account/profile")).json());
  assert.equal(own.profile.email, email);
  assert.equal(own.profile.displayName, "E2E Student");
  const anon = await browser.newContext();
  const anonRes = await anon.request.get(`${CONFIGURED}/api/account/profile`);
  assert.equal(anonRes.status(), 401);
  await anon.close();

  assert.equal(await readProgress(page), before, "sign-up didn't change local progress");

  // Log out from the header menu.
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(`${CONFIGURED}/`);
  await headerLogin(page).waitFor();
  assert.ok(!(await context.cookies()).some((c) => c.name === "algoverse_session" && c.value), "cookie cleared");
  await page.goto("/account");
  await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("next") === "/account");
  assert.equal(await readProgress(page), before, "log-out didn't change local progress");

  // Wrong password → clear error; right password → back to /account.
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password1");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.getByText("Email or password is incorrect.").waitFor();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/account");
  await page.getByText(email).first().waitFor();
  assert.equal(await readProgress(page), before, "log-in didn't change local progress");

  // Existing app still works while signed in.
  await page.goto("/problems");
  await page.getByRole("link", { name: /Log in/ }).waitFor({ state: "detached" }).catch(() => {});
  assert.ok(await page.locator("main").getByText(/problem/i).first().isVisible());
  await context.close();
});

test("two users in isolated browsers only ever see their own account", async () => {
  const users = [];
  for (const n of [1, 2]) {
    const email = `iso${n}-${Date.now()}@example.com`;
    const { context, page } = await newPage(CONFIGURED);
    await page.goto("/signup");
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("letters123");
    await page.getByLabel("Confirm password").fill("letters123");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/account**");
    users.push({ email, context, page });
  }
  for (const u of users) {
    const profile = await u.page.evaluate(async () => (await fetch("/api/account/profile")).json());
    assert.equal(profile.profile.email, u.email);
    await u.page.reload();
    const html = await u.page.content();
    for (const other of users) if (other !== u) assert.ok(!html.includes(other.email), "no other user's email");
    await u.context.close();
  }
});

test("forgot password sends a reset email (emulator) without revealing whether the account exists", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await page.waitForURL("**/forgot-password");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByText("Enter your email address.").waitFor();
  await page.getByLabel("Email").fill("nobody-here@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.getByText(/If an account exists for nobody-here@example.com/).waitFor();
  await context.close();
});

// ------------------------------------------------------------------ email verification

async function oobCodesFor(email) {
  const res = await fetch(`${AUTH}/emulator/v1/projects/demo-algoverse/oobCodes`);
  const { oobCodes = [] } = await res.json();
  return oobCodes.filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL");
}

test("email verification: sign-up requests it, resend is rate-limited, only Firebase's confirmation marks it verified", async () => {
  const email = `verify-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  const logs = [];
  page.on("console", async (msg) => {
    const args = await Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null)));
    logs.push(JSON.stringify(args));
  });
  await page.goto("/signup");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("letters123");
  await page.getByLabel("Confirm password").fill("letters123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/account**");

  // Sign-up made exactly one real VERIFY_EMAIL request for this user, and the page says so accurately.
  assert.equal((await oobCodesFor(email)).length, 1, "one verification email requested at sign-up");
  await page.getByText(/Firebase accepted the request at/).waitFor();
  assert.ok(await page.getByText("Not verified").isVisible());
  const diag = logs.filter((l) => l.includes("[auth] verification email request"));
  assert.equal(diag.length, 1, "one safe diagnostic line");
  assert.match(diag[0], /accepted by Firebase/);
  assert.match(diag[0], /"userPresent":true/);
  for (const l of logs) {
    assert.ok(!l.includes(email) && !/eyJ[A-Za-z0-9_-]{10,}/.test(l), "no email address or token in console output");
  }

  // Resend is disabled during the cooldown (no duplicate rapid requests).
  const resend = page.getByRole("button", { name: /^(Available in|Send verification email|Try once more)/ });
  assert.ok(await resend.isDisabled(), "resend disabled right after sending");
  assert.match(await resend.innerText(), /Available in (\d+s|\d+:\d\d)/);
  assert.equal((await oobCodesFor(email)).length, 1, "no extra request");

  // Visiting the continue URL without actually verifying must NOT mark the account verified.
  await page.goto("/account?verified=1");
  await page.getByText(/doesn't show this email as verified yet/).waitFor();
  assert.ok(await page.getByText("Not verified").isVisible());

  // Complete the real verification with the emailed code, then come back: now Firebase confirms it.
  const [code] = await oobCodesFor(email);
  const applied = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oobCode: code.oobCode }),
  });
  assert.equal(applied.status, 200, "emulator applied the verification code");
  await page.goto("/account?verified=1");
  await page.getByText("Verified", { exact: true }).waitFor();
  assert.equal(await page.getByText("Confirm your email").count(), 0, "banner gone");
  const profile = await page.evaluate(async () => (await fetch("/api/account/profile")).json());
  assert.equal(profile.profile.emailVerified, true, "server (Firebase Admin) agrees");
  await context.close();
});

test("verification requests: one per sign-up, none on load/focus/reload, and auth/too-many-requests pauses Resend across reloads", async () => {
  const email = `ratelimit-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  let sendOobCalls = 0;
  let simulateRateLimit = false;
  await context.route("**/accounts:sendOobCode**", async (route) => {
    sendOobCalls++;
    if (simulateRateLimit) {
      // What Firebase answers when it throttles: HTTP 400 TOO_MANY_ATTEMPTS_TRY_LATER.
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: 400, message: "TOO_MANY_ATTEMPTS_TRY_LATER", errors: [] } }),
      });
    } else {
      await route.continue();
    }
  });

  await page.goto("/signup");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("letters123");
  await page.getByLabel("Confirm password").fill("letters123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/account**");
  await page.getByText(/Firebase accepted the request at/).waitFor();
  assert.equal(sendOobCalls, 1, "sign-up sends exactly one request");

  // Page loads, reloads, tab focus / visibility changes: no sends.
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await page.getByText("Not verified").waitFor();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(500);
  }
  assert.equal(sendOobCalls, 1, "no automatic sends on load, reload or focus");
  const resend = page.getByRole("button", { name: /^(Available in|Send verification email|Try once more)/ });
  assert.ok(await resend.isDisabled(), "success cooldown survives reloads");

  // Pretend the success cooldown has passed, then let Firebase throttle the next request.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith("algoverse-verification-")) localStorage.removeItem(k);
  });
  await page.reload();
  await page.getByText("Not verified").waitFor();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Send verification email|Try once more/.test(x.textContent ?? ""));
    return b && !b.disabled;
  });
  simulateRateLimit = true;
  await resend.click();
  await page.getByText(/Firebase refused the last request at/).waitFor();
  assert.ok(await page.getByText("auth/too-many-requests").first().isVisible());
  assert.equal(sendOobCalls, 2, "exactly one request for the click");
  assert.ok(await resend.isDisabled(), "Resend paused after too-many-requests");
  assert.match(await resend.innerText(), /Available in 1[45]:\d\d/, "about 15 minutes");

  // Reload: still paused (persisted), still no new requests.
  await page.reload();
  await page.getByText(/Firebase refused the last request at/).waitFor();
  assert.ok(await resend.isDisabled(), "pause survives reload");
  await resend.click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  assert.equal(sendOobCalls, 2, "no further requests while paused");
  await context.close();
});

// ------------------------------------------------------------------ cooldown state machine (real browser)

async function signUpInUi(page, email, password = "letters123") {
  await page.goto("/signup");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/account**");
}

const verifyButton = (page) => page.getByRole("button", { name: /^(Available in|Send verification email|Try once more)/ });

async function readPauseEnd(page) {
  return page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("algoverse-verification-state:"));
    return k ? JSON.parse(localStorage.getItem(k)) : null;
  });
}

async function expirePause(page) {
  await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("algoverse-verification-state:"));
    const st = JSON.parse(localStorage.getItem(k));
    st.until = Date.now() - 1000; // the user waited until the fixed expiry passed
    localStorage.setItem(k, JSON.stringify(st));
  });
  await page.reload();
  await page.getByText("Not verified").waitFor();
}

test("pause: fixed expiry, zero requests while paused, survives reload, and a repeated too-many-requests escalates instead of looping", async () => {
  const email = `loop-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  let calls = 0;
  let throttle = false;
  await context.route("**/accounts:sendOobCode**", async (route) => {
    calls++;
    if (throttle) {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: 400, message: "TOO_MANY_ATTEMPTS_TRY_LATER", errors: [] } }) });
    } else await route.continue();
  });
  await signUpInUi(page, email);
  await page.getByText(/Firebase accepted the request at/).waitFor();
  assert.equal(calls, 1);

  // Firebase starts throttling. After the success pause ends, the user tries once.
  throttle = true;
  await expirePause(page);
  await verifyButton(page).click();
  await page.getByText(/Firebase refused the last request at/).waitFor();
  assert.equal(calls, 2);
  const first = await readPauseEnd(page);
  assert.equal(first.rateLimitStreak, 1);
  const firstEnd = first.until;
  assert.ok(Math.abs(firstEnd - Date.now() - 15 * 60_000) < 10_000, "first pause is 15 minutes");
  assert.ok(await page.getByTestId("verification-pause").isVisible(), "app-side pause shown separately from Firebase's answer");

  // Clicking (forced) and reloading during the pause: zero requests, same fixed end.
  for (let i = 0; i < 3; i++) await verifyButton(page).click({ force: true }).catch(() => {});
  await page.reload();
  await page.getByText(/Firebase refused the last request at/).waitFor();
  assert.ok(await verifyButton(page).isDisabled());
  assert.equal(calls, 2, "no requests during the pause");
  assert.equal((await readPauseEnd(page)).until, firstEnd, "pause end unchanged by clicks and reloads");

  // Pause ends: the page says Firebase may still be blocking, and offers ONE deliberate try.
  await expirePause(page);
  await page.getByText(/does\s+not\s+mean Firebase has lifted its block/).waitFor();
  assert.match(await page.getByTestId("verification-pause").innerText(), /pause for 1 hour/);
  assert.equal(await verifyButton(page).innerText(), "Try once more");
  await page.waitForTimeout(1500);
  assert.equal(calls, 2, "no automatic retry when the pause ends");

  await verifyButton(page).click();
  await page.getByText(/2 times in a row/).waitFor();
  assert.equal(calls, 3, "exactly one request for the deliberate try");
  const second = await readPauseEnd(page);
  assert.equal(second.rateLimitStreak, 2);
  assert.ok(Math.abs(second.until - Date.now() - 60 * 60_000) < 10_000, "second pause is 1 hour — not another 15 minutes");
  assert.match(await verifyButton(page).innerText(), /^Available in (59:\d\d|1:00:00)$/, "never more than the real pause");
  // The Google alternative is offered while Firebase blocks emails.
  assert.ok(await page.getByText(/works even while Firebase is blocking verification emails/).isVisible());
  await context.close();
});

// ------------------------------------------------------------------ Google Sign-In (Auth emulator popup)

async function googlePopup(page, trigger, email, { cancel = false } = {}) {
  const [popup] = await Promise.all([page.waitForEvent("popup"), trigger.click()]);
  await popup.waitForLoadState();
  if (cancel) {
    await popup.close();
    return;
  }
  const existing = popup.getByText(email, { exact: true });
  if (await existing.count()) {
    await existing.first().click();
  } else {
    await popup.getByText(/Add new account/i).first().click();
    await popup.locator("#email-input").fill(email);
    await popup.locator("#sign-in").click();
  }
  await popup.waitForEvent("close", { timeout: 15_000 }).catch(() => {});
}

async function accountsByEmail(email) {
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/demo-algoverse/accounts:query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ returnUserInfo: true }),
  });
  const { userInfo = [] } = await res.json();
  return userInfo.filter((u) => u.email === email);
}

const googleButton = (page) => page.getByRole("button", { name: "Continue with Google" });
async function waitGoogleReady(page) {
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Continue with Google"));
    return b && !b.disabled;
  });
}

test("Google: new user signs up with the popup; verified state comes from Firebase; secure session; local progress kept", async () => {
  const email = `g-new-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/");
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, SEEDED_PROGRESS]);
  const before = await readProgress(page);

  await page.goto("/signup");
  await waitGoogleReady(page);
  assert.ok(await page.getByRole("separator").isVisible(), "OR divider");
  await googlePopup(page, googleButton(page), email);
  await page.waitForURL("**/account**");
  await page.getByText(email).first().waitFor();

  const profile = (await page.evaluate(async () => (await fetch("/api/account/profile")).json())).profile;
  assert.deepEqual(profile.providers, ["google.com"]);
  assert.equal((await accountsByEmail(email)).length, 1, "one account");
  // The UI shows exactly what Firebase (server-side) reports.
  if (profile.emailVerified) {
    assert.equal(profile.verifiedByGoogle, true);
    await page.getByText("Email verified through Google.").waitFor();
    assert.equal(await page.getByText("Confirm your email").count(), 0);
  } else {
    await page.getByText("Confirm your email").waitFor();
  }
  const cookie = (await context.cookies()).find((c) => c.name === "algoverse_session");
  assert.ok(cookie?.httpOnly);
  assert.equal(await readProgress(page), before, "local progress untouched");
  await context.close();
});

test("Google: closing the popup is a quiet cancel; a Firebase failure shows a clear error; nothing is created", async () => {
  const email = `g-cancel-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/login");
  await waitGoogleReady(page);
  await googlePopup(page, googleButton(page), email, { cancel: true });
  await page.waitForTimeout(1500);
  assert.ok(page.url().includes("/login"), "still on the login page");
  assert.equal(await page.getByText(/didn't complete|isn't enabled|blocked the Google/).count(), 0, "no error for a cancel");
  await waitGoogleReady(page);

  await context.route("**/accounts:signInWithIdp**", (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: 400, message: "OPERATION_NOT_ALLOWED", errors: [] } }) })
  );
  await googlePopup(page, googleButton(page), email);
  await page.getByText("Google sign-in isn't enabled for this app yet.").waitFor();
  assert.ok(page.url().includes("/login"));
  assert.equal((await accountsByEmail(email)).length, 0, "no account created");
  await context.close();
});

test("Google: an existing unverified password account links Google from the Account page — same UID, password kept, verified by Firebase", async () => {
  const email = `g-link-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  await signUpInUi(page, email);
  const before = (await page.evaluate(async () => (await fetch("/api/account/profile")).json())).profile;
  assert.equal(before.emailVerified, false);

  await page.getByRole("button", { name: "Link Google account" }).first().waitFor();
  await googlePopup(page, page.getByRole("button", { name: "Link Google account" }).first(), email);
  await page.getByText("Email verified through Google.").waitFor();
  const after = (await page.evaluate(async () => (await fetch("/api/account/profile")).json())).profile;
  assert.equal(after.uid, before.uid, "same account");
  assert.equal(after.emailVerified, true, "Firebase reports verified");
  assert.equal(after.verifiedByGoogle, true);
  assert.deepEqual([...after.providers].sort(), ["google.com", "password"], "password kept");
  assert.equal((await accountsByEmail(email)).length, 1, "no duplicate account");

  // The password still works.
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(`${CONFIGURED}/`);
  await page.goto("/login");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("letters123");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/account");
  assert.equal((await page.evaluate(async () => (await fetch("/api/account/profile")).json())).profile.uid, before.uid);
  await context.close();
});

test("Google on the login page for an unverified password account: same account (no duplicate), and Firebase's password removal is shown, not silent", async () => {
  const email = `g-takeover-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  await signUpInUi(page, email); // session records the password sign-in method
  const uid = (await page.evaluate(async () => (await fetch("/api/account/profile")).json())).profile.uid;
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(`${CONFIGURED}/`);

  await page.goto("/login");
  await waitGoogleReady(page);
  assert.ok(await page.getByText(/then choose\s+Link Google account/).isVisible(), "safe path explained before continuing");
  await googlePopup(page, googleButton(page), email);
  await page.waitForURL("**/account**");
  const profile = (await page.evaluate(async () => (await fetch("/api/account/profile")).json())).profile;
  assert.equal(profile.uid, uid, "same account and UID — data preserved");
  assert.equal((await accountsByEmail(email)).length, 1, "no second account");
  // Firebase's rule (observed in the emulator): Google proves the email, so the unverified password is removed.
  assert.deepEqual(profile.providers, ["google.com"], "Firebase removed the unverified password method");
  await page.getByTestId("password-removed-notice").waitFor();
  assert.ok(profile.passwordRemovedAt, "server recorded when Firebase removed the password");
  assert.ok(await page.getByRole("button", { name: "Set a password" }).first().isVisible(), "a way back to a password");
  await context.close();
});

test("Google account whose email is NOT verified is not marked verified (server truth)", async () => {
  const email = `g-unverified-${Date.now()}@example.com`;
  const res = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `u-${Date.now()}`, email, email_verified: false }))}&providerId=google.com`,
      requestUri: "http://localhost",
      returnSecureToken: true,
    }),
  });
  const { idToken } = await res.json();
  const login = await fetch(`${CONFIGURED}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin: CONFIGURED },
    body: JSON.stringify({ idToken }),
  });
  assert.equal(login.status, 200);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const profile = (await (await fetch(`${CONFIGURED}/api/account/profile`, { headers: { cookie } })).json()).profile;
  assert.deepEqual(profile.providers, ["google.com"]);
  assert.equal(profile.emailVerified, false, "unverified Google email stays unverified");
  assert.equal(profile.verifiedByGoogle, false);
});

// ------------------------------------------------------------------ real SDK authorised-domain check

test("unauthorised hostname: explained up front with the exact host (same check as the SDK), and no doomed popup opens", async () => {
  const context = await browser.newContext({ baseURL: LIVE_SDK });
  let configRequests = 0;
  // Firebase's public project-config endpoint (what the SDK checks): 127.0.0.1 is NOT listed.
  await context.route("https://identitytoolkit.googleapis.com/v1/projects?**", (route) => {
    configRequests++;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ projectId: "demo-algoverse", authorizedDomains: ["localhost", "demo-algoverse.firebaseapp.com"] }),
    });
  });
  // Nothing may reach real Google/Firebase hosts from this test.
  await context.route(/^https:\/\/(?!identitytoolkit\.googleapis\.com\/v1\/projects).*(googleapis|firebaseapp|google)\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" })
  );
  const page = await context.newPage();
  await page.goto("/login");
  const expected = /this page's hostname “127\.0\.0\.1” isn't one of them \(auth\/unauthorized-domain\)/;
  await page.getByText(expected).waitFor({ timeout: 20_000 });
  const message = await page.getByRole("alert").filter({ hasText: "unauthorized-domain" }).innerText();
  assert.match(message, /Authorized domains of project demo-algoverse/);
  assert.match(message, /https:\/\/localhost is authorised — open that instead/);
  assert.match(message, /Currently authorised: localhost, demo-algoverse\.firebaseapp\.com/, "preview shows the list");
  assert.ok(!message.includes("demo-api-key"), "API key not shown");
  assert.equal(configRequests, 1, "one background check of the project's authorised domains");
  const link = page.getByRole("link", { name: "Open the authorised address" });
  assert.equal(await link.getAttribute("href"), "https://localhost/login");

  // Clicking doesn't open a popup that Firebase would reject anyway.
  await waitGoogleReady(page);
  const popup = page.waitForEvent("popup", { timeout: 3_000 }).catch(() => null);
  await googleButton(page).click();
  assert.equal(await popup, null, "no popup opened");
  assert.ok(await page.getByText(expected).isVisible());
  assert.ok(page.url().includes("/login"), "no sign-in happened");

  // An AUTHORISED hostname gets no warning (same build, localhost is listed).
  const ok = await context.newPage();
  await ok.goto("http://localhost:3124/login");
  await waitGoogleReady(ok);
  await ok.waitForTimeout(1500);
  assert.equal(await ok.getByText(/unauthorized-domain/).count(), 0, "no false alarm on an authorised host");
  await context.close();
});

// ------------------------------------------------------------------ cloud sync (Pro), two devices

const DB_HOST = `http://${process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080"}`;

async function grantProInEmulator(uid) {
  const res = await fetch(`${DB_HOST}/v1/projects/demo-algoverse/databases/(default)/documents/entitlements/${uid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields: { plan: { stringValue: "pro" } } }),
  });
  assert.equal(res.status, 200, "emulator: entitlement written");
}

const profileOf = (page) => page.evaluate(async () => (await (await fetch("/api/account/profile")).json()).profile);
const storeOf = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null")?.state ?? null, STORAGE_KEY);
const cloudOf = (page) => page.evaluate(async () => (await fetch("/api/sync?since=0")).json());

/** Polls the account's cloud data (server API) until `check(cloud)` is true. */
async function waitCloud(page, check, what) {
  for (let i = 0; i < 40; i++) {
    const cloud = await cloudOf(page);
    if (check(cloud)) return cloud;
    await page.waitForTimeout(500);
  }
  throw new Error(`cloud never showed: ${what}`);
}

async function waitSynced(page) {
  await page.locator('[data-testid="sync-indicator"][data-status="synced"]').waitFor({ timeout: 20_000 });
}

async function logInInUi(page, email, password = "letters123") {
  await page.goto("/login");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/account");
}

test("sync: free accounts don't sync — no indicator, no prompt, local progress untouched", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/");
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, SEEDED_PROGRESS]);
  const before = await readProgress(page);
  await signUpInUi(page, `sync-free-${Date.now()}@example.com`);
  await page.getByText(/Cloud sync is part of AlgoVerse Pro/).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(await page.getByTestId("sync-indicator").count(), 0);
  assert.equal(await page.getByText("Sync this device's progress to your account?").count(), 0);
  assert.equal((await page.evaluate(async () => (await fetch("/api/sync")).status)), 403);
  assert.equal(await readProgress(page), before);
  await context.close();
});

test("sync: Pro — progress and notes made on one device appear on the other, both ways", async () => {
  const email = `sync-two-${Date.now()}@example.com`;
  const laptop = await newPage(CONFIGURED);
  await signUpInUi(laptop.page, email);
  const { uid } = await profileOf(laptop.page);
  await grantProInEmulator(uid);
  await laptop.page.reload(); // entitlements are read on load
  await waitSynced(laptop.page); // empty device: sync starts without asking

  // Laptop: complete problem 1 and write a note on problem 2 through the real UI.
  await laptop.page.goto("/problems/1");
  await laptop.page.getByRole("button", { name: "Mark Completed" }).click();
  await laptop.page.goto("/problems/2");
  await laptop.page.locator("#notes").fill("laptop note: sliding window");
  await waitCloud(
    laptop.page,
    (c) => c.progress.some((p) => p.id === 1 && !p.deleted) && c.notes.some((n) => n.id === 2 && n.content === "laptop note: sliding window"),
    "laptop completion + note"
  );

  // Phone: a fresh device signs in and gets everything.
  const phone = await newPage(CONFIGURED, { width: 390, height: 844 });
  await logInInUi(phone.page, email);
  await waitSynced(phone.page);
  await phone.page.waitForFunction((k) => {
    const s = JSON.parse(localStorage.getItem(k) ?? "null")?.state;
    return s && s.completed["1"] && s.notes["2"] === "laptop note: sliding window";
  }, STORAGE_KEY);

  // Phone bookmarks problem 3 → laptop receives it on the next sync (tab focus).
  await phone.page.goto("/problems/3");
  await phone.page.getByRole("button", { name: /bookmark/i }).first().click();
  await waitCloud(phone.page, (c) => c.bookmarks.some((b) => b.id === 3 && b.on), "phone bookmark");
  await laptop.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await laptop.page.waitForFunction((k) => (JSON.parse(localStorage.getItem(k) ?? "null")?.state?.bookmarked ?? []).includes(3), STORAGE_KEY, { timeout: 20_000 });
  await laptop.context.close();
  await phone.context.close();
});

test("sync: first login with local data asks first; 'Import and merge' uploads it without deleting anything", async () => {
  const email = `sync-import-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/");
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, SEEDED_PROGRESS]);
  const before = await readProgress(page);
  await signUpInUi(page, email);
  await grantProInEmulator((await profileOf(page)).uid);
  await page.reload();
  await page.getByText("Sync this device's progress to your account?").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /2 completed problems, 1 bookmark/);
  await page.getByRole("button", { name: "Import and merge" }).click();
  await waitSynced(page);
  const cloud = await cloudOf(page);
  assert.deepEqual(cloud.progress.filter((p) => !p.deleted).map((p) => p.id).sort(), [1, 5]);
  assert.equal(cloud.progress.find((p) => p.id === 1).completedAt, "2026-09-20T10:00:00.000Z", "original completion date kept");
  assert.deepEqual(cloud.bookmarks.filter((b) => b.on).map((b) => b.id), [7]);
  assert.ok(cloud.notes.some((n) => n.id === 1 && n.content === "my local note"));
  const after = JSON.parse(await readProgress(page)).state;
  const was = JSON.parse(before).state;
  assert.deepEqual([after.completed, after.bookmarked, after.notes], [was.completed, was.bookmarked, was.notes], "local data unchanged");
  await page.reload();
  await waitSynced(page);
  assert.equal(await page.getByText("Sync this device's progress to your account?").count(), 0, "not asked again");
  await context.close();
});

test("sync: 'Keep on this device only' keeps sync off here, and it can be turned on later", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/");
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [STORAGE_KEY, SEEDED_PROGRESS]);
  await signUpInUi(page, `sync-keep-${Date.now()}@example.com`);
  await grantProInEmulator((await profileOf(page)).uid);
  await page.reload();
  await page.getByRole("button", { name: "Keep on this device only" }).click();
  await page.goto("/account");
  await page.getByText(/Sync is off on this device/).waitFor();
  assert.equal(await page.getByTestId("sync-indicator").count(), 0);
  const cloud = await cloudOf(page);
  assert.equal(cloud.progress.length + cloud.bookmarks.length + cloud.notes.length, 0, "nothing uploaded");
  await page.getByRole("button", { name: "Set up sync on this device" }).click();
  await page.getByRole("button", { name: "Import and merge" }).click();
  await waitSynced(page);
  assert.equal((await cloudOf(page)).progress.length, 2);
  await context.close();
});

test("sync: offline changes are kept and uploaded when the connection returns", async () => {
  const email = `sync-offline-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  await signUpInUi(page, email);
  await grantProInEmulator((await profileOf(page)).uid);
  await page.reload();
  await waitSynced(page);
  await page.goto("/problems/4");
  await page.getByRole("button", { name: "Mark Completed" }).waitFor();
  await waitSynced(page); // sync running on this page
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await page.waitForTimeout(3000);
  await page.locator('[data-testid="sync-indicator"][data-status="offline"]').waitFor();
  assert.ok((await storeOf(page)).completed["4"], "saved on the device while offline");
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitCloud(page, (c) => c.progress.some((p) => p.id === 4 && !p.deleted), "uploaded after reconnecting");
  await context.close();
});

test("sync: a device holding another account's data asks before touching it, and backs it up before switching", async () => {
  const a = `sync-owner-a-${Date.now()}@example.com`;
  const b = `sync-owner-b-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  // Account A (Pro) syncs a completion from this device.
  await signUpInUi(page, a);
  await grantProInEmulator((await profileOf(page)).uid);
  await page.reload();
  await waitSynced(page);
  await page.goto("/problems/6");
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await waitCloud(page, (c) => c.progress.some((p) => p.id === 6 && !p.deleted), "A's completion");
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.locator("header").getByRole("link", { name: "Log in" }).waitFor();
  assert.ok((await storeOf(page)).completed["6"], "logging out keeps the device's progress");

  // Account B (Pro) signs in on the same device.
  await signUpInUi(page, b);
  await grantProInEmulator((await profileOf(page)).uid);
  await page.reload();
  await page.getByText("This device has progress from another account").waitFor();
  await page.getByRole("button", { name: "Use this account's cloud data" }).click();
  await waitSynced(page);
  const store = await storeOf(page);
  assert.equal(store.completed["6"], undefined, "B sees only B's (empty) cloud data");
  const backup = await page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith("algoverse-local-backup:"));
    return k ? JSON.parse(localStorage.getItem(k)) : null;
  });
  assert.ok(backup && JSON.parse(backup.store).state.completed["6"], "A's device data was backed up first");
  const cloudB = await cloudOf(page);
  assert.equal(cloudB.progress.length, 0, "A's progress was not merged into B");
  await context.close();
});

test("regression: Firebase reporting the numeric project number is NOT a key mismatch and doesn't block Google", async () => {
  const context = await browser.newContext({ baseURL: "http://localhost:3124" });
  // Real endpoint behaviour: "projectId" holds the project NUMBER. The test build's App ID is
  // 1:000000000000:web:demo, i.e. project number 000000000000 — the same project.
  await context.route("https://identitytoolkit.googleapis.com/v1/projects?**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projectId: "000000000000", authorizedDomains: ["localhost"] }) })
  );
  await context.route(/^https:\/\/(?!identitytoolkit\.googleapis\.com\/v1\/projects).*(googleapis|firebaseapp|google)\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html></html>" })
  );
  const page = await context.newPage();
  await page.goto("/login");
  await waitGoogleReady(page);
  await page.waitForTimeout(2000); // background check done
  assert.equal(await page.getByText(/different Firebase project|belongs to project/).count(), 0, "no false mismatch");
  assert.equal(await page.getByText(/unauthorized-domain/).count(), 0, "authorised host, no warning");
  // The click isn't blocked by our check: it hands over to the Firebase SDK (button goes busy)
  // and no mismatch/domain error is shown. (The SDK's own popup needs firebaseapp.com, which
  // this sealed test doesn't reach.)
  await googleButton(page).click();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Continue with Google"));
    return b?.disabled === true;
  });
  await page.waitForTimeout(1500);
  assert.equal(await page.getByText(/different Firebase project|unauthorized-domain/).count(), 0, "not blocked");

  // On an unauthorised host the message names the configured project, not a bare number.
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:3124/login");
  await other.getByText(/this page's hostname “127\.0\.0\.1” isn't one of them/).waitFor({ timeout: 20_000 });
  assert.equal(await other.getByText(/different Firebase project/).count(), 0);
  await context.close();
});
