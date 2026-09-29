// Real-browser tests of the account UI (Google Chrome via playwright-core) against production
// builds made by scripts/tests/run-e2e.mjs, with Firebase Auth/Firestore EMULATORS — no real
// Firebase project is touched. Run: npm run test:e2e
import { test as nodeTest, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

// Failure evidence (optional): with E2E_ARTIFACTS=<dir>, a failing test saves a screenshot, the
// URL and the last console lines of every page still open, plus the failing step's error.
const ARTIFACTS = process.env.E2E_ARTIFACTS || null;
if (ARTIFACTS) mkdirSync(ARTIFACTS, { recursive: true });
const openPages = new Set();
function track(page) {
  const lines = [];
  page.on("console", (m) => lines.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => lines.push(`[pageerror] ${String(e).slice(0, 300)}`));
  page.__lines = lines;
  openPages.add(page);
  page.on("close", () => openPages.delete(page));
}
async function captureFailure(name, err) {
  if (!ARTIFACTS) return;
  const dir = `${ARTIFACTS}/${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 80)}`;
  mkdirSync(dir, { recursive: true });
  const notes = [`error: ${err?.stack ?? err}`, `at: ${new Date().toISOString()}`];
  let i = 0;
  for (const page of openPages) {
    i++;
    notes.push(`page ${i}: ${page.url()}`, ...(page.__lines ?? []).slice(-40).map((l) => `  ${l}`));
    await page.screenshot({ path: `${dir}/page-${i}.png`, fullPage: false, timeout: 10_000 }).catch((e) => notes.push(`  (screenshot failed: ${e.message})`));
  }
  writeFileSync(`${dir}/failure.txt`, notes.join("\n"));
}
const test = (name, fn) =>
  nodeTest(name, async (t) => {
    const started = Date.now();
    try {
      await fn(t);
    } catch (err) {
      await captureFailure(name, err);
      throw err;
    } finally {
      if (ARTIFACTS) writeFileSync(`${ARTIFACTS}/timings.txt`, `${Math.round((Date.now() - started) / 1000)}s\t${name}\n`, { flag: "a" });
    }
  });

const AUTH = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`;
const CONFIGURED = "http://localhost:3121";
const UNCONFIGURED = "http://localhost:3122";
// A build made WITHOUT the public values, served by a deployment whose environment HAS them.
const RUNTIME_ONLY = "http://localhost:3123";
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
    // FIREBASE_SERVICE_ACCOUNT_KEY is set (empty) explicitly: Next.js never overrides an existing
    // variable with .env.local, so test servers can't pick up a real credential from it and can
    // never talk to the real Firebase project.
    // Never the real credentials from .env.local: no service account, and a fake Gemini key so the
    // real Gemini API can't be called from tests.
    env: { ...env, FIREBASE_SERVICE_ACCOUNT_KEY: "", GEMINI_API_KEY: "e2e-fake-not-a-key", NEXT_DIST_DIR: distDir, PORT: String(port) },
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
  await Promise.all([
    waitFor(`${CONFIGURED}/login`),
    waitFor(`${UNCONFIGURED}/login`),
    waitFor(`${RUNTIME_ONLY}/login`),
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
  context.on("page", track); // popups too
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

test("full journey: sign up → session cookie → refresh → log out → log in; the account keeps its progress", async () => {
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
  // Logged out: the account's progress is put away (not deleted) — the signed-out view doesn't show it.
  assert.deepEqual(Object.keys(JSON.parse((await readProgress(page)) ?? '{"state":{"completed":{}}}').state.completed), [], "log-out hides the account's progress");
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("algoverse-workspace:user:"))), "…and keeps it on the device");

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
  assert.deepEqual(JSON.parse(await readProgress(page)).state, JSON.parse(before).state, "log-in brings the account's progress back intact");

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

test("Preview per-deployment address: 'Continue with Google' moves to the stable branch address (same page and next), no popup", async () => {
  const PORT = 3125;
  startServer(PORT, ".next-e2e", { ...process.env, FIREBASE_PROJECT_ID: "demo-algoverse", VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "stable-preview.example.test" });
  await waitFor(`http://localhost:${PORT}/login`);
  const { context, page } = await newPage(`http://localhost:${PORT}`);
  let arrived = null;
  await context.route("https://stable-preview.example.test/**", (route) => {
    arrived = route.request().url();
    return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>stable</body></html>" });
  });
  let popups = 0;
  page.on("popup", () => popups++);
  await page.goto("/login?next=%2Fproblems%2F6");
  await waitGoogleReady(page);
  await page.getByTestId("google-stable-note").waitFor();
  await googleButton(page).click();
  await page.waitForURL("https://stable-preview.example.test/**");
  assert.equal(arrived, "https://stable-preview.example.test/login?next=%2Fproblems%2F6", "same page and next on the stable address");
  assert.equal(popups, 0, "no Google window from the per-deployment address");
  await context.close();
  // On the stable address itself (and on Production, which has no stable host) the normal flow is unchanged:
  // covered by the Google tests below, which run on a server without VERCEL_BRANCH_URL.
});

test("Preview (separate Firebase project): a Google-only account's password login fails with a clear Preview note; real email/password accounts log in, persist and switch as before", async () => {
  const PREVIEW = "http://localhost:3125"; // started by the previous test with VERCEL_ENV=preview
  await waitFor(`${PREVIEW}/login`);
  // A Google-only account (what the owner's account is in algoverse-preview).
  const gEmail = `g-only-${Date.now()}@example.com`;
  const idp = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestUri: "http://localhost", returnSecureToken: true, postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: `g-${Date.now()}`, email: gEmail, email_verified: true }))}&providerId=google.com` }),
  });
  assert.equal(idp.status, 200);
  // A normal email/password account.
  const pEmail = `pw-${Date.now()}@example.com`;
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: pEmail, password: "letters123", returnSecureToken: true }) });

  const { context, page } = await newPage(PREVIEW);
  const tryLogin = async (email, password) => {
    await page.goto("/login");
    await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in" }).last().click();
  };
  await tryLogin(gEmail, "letters123");
  const err = page.getByText("Email or password is incorrect.");
  await err.waitFor();
  const text = await err.innerText();
  assert.match(text, /This Preview uses its own accounts, separate from the live site\. If your password was set on the live site, it won't work here\. Continue with Google, or sign in with Google and use Account → Set a password\./, "Preview note");
  assert.equal(await page.evaluate(async () => (await fetch("/api/auth/session")).json().then((j) => j.user ?? null)), null, "no session");

  // Wrong password for a real account: same generic message (no enumeration), no session.
  await tryLogin(pEmail, "wrongpass1");
  await page.getByText("Email or password is incorrect.").waitFor();
  // Right password: session, Account shows this account, survives refresh.
  await tryLogin(pEmail, "letters123");
  await page.waitForURL("**/account**");
  await page.getByText(pEmail).first().waitFor();
  assert.ok((await context.cookies()).some((c) => c.name === "algoverse_session" && c.value), "server session cookie");
  await page.reload();
  await page.getByText(pEmail).first().waitFor();
  // Log out, log back in.
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(`${PREVIEW}/`);
  assert.ok(!(await context.cookies()).some((c) => c.name === "algoverse_session" && c.value), "cookie cleared");
  await tryLogin(pEmail, "letters123");
  await page.waitForURL("**/account**");
  await page.getByText(pEmail).first().waitFor();
  await context.close();

  // Not a Preview: the same failure shows only the generic message.
  const other = await newPage(CONFIGURED);
  await other.page.goto("/login");
  await other.page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await other.page.getByLabel("Email").fill(gEmail);
  await other.page.getByLabel("Password", { exact: true }).fill("letters123");
  await other.page.getByRole("button", { name: "Log in" }).last().click();
  const e2 = other.page.getByText("Email or password is incorrect.");
  await e2.waitFor();
  assert.doesNotMatch(await e2.innerText(), /Preview/, "no Preview note outside Previews");
  await other.context.close();
});

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

test("Google-only account → Account → Set a password: the password is added to the same account (Google kept), then email/password login works", async () => {
  const email = `g-setpw-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/signup");
  await waitGoogleReady(page);
  await googlePopup(page, googleButton(page), email);
  await page.waitForURL("**/account**");
  const before = await profileOf(page);
  assert.deepEqual(before.providers, ["google.com"]);
  await page.getByRole("button", { name: "Set a password" }).first().click();
  const dialog = page.getByTestId("set-password-dialog");
  await dialog.waitFor();
  // Same rules as sign-up.
  await dialog.getByLabel("Password", { exact: true }).fill("short");
  await dialog.getByLabel("Confirm password").fill("short");
  await dialog.getByRole("button", { name: "Set password" }).click();
  await dialog.getByText("Use at least 8 characters.").waitFor();
  await dialog.getByLabel("Password", { exact: true }).fill("letters123");
  await dialog.getByLabel("Confirm password").fill("letters124");
  await dialog.getByRole("button", { name: "Set password" }).click();
  await dialog.getByText("Passwords don't match.").waitFor();
  await dialog.getByLabel("Confirm password").fill("letters123");
  await dialog.getByRole("button", { name: "Set password" }).click();
  await dialog.waitFor({ state: "detached" });
  const after = await profileOf(page);
  assert.equal(after.uid, before.uid, "same account");
  assert.deepEqual([...after.providers].sort(), ["google.com", "password"], "password added, Google kept");
  await page.getByRole("button", { name: "Change password" }).waitFor();
  // Log out, log in with the new password: same account, both methods still there.
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(`${CONFIGURED}/`);
  await logInInUi(page, email);
  const again = await profileOf(page);
  assert.equal(again.uid, before.uid);
  assert.deepEqual([...again.providers].sort(), ["google.com", "password"]);
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

test("sync: two Pro accounts on one device each see only their own data; nothing crosses between them", async () => {
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
  assert.equal((await storeOf(page)).completed["6"], undefined, "logged out: A's progress isn't shown");

  // Account B (Pro) signs up on the same device: starts with its own (empty) data, no dialog needed.
  await signUpInUi(page, b);
  await grantProInEmulator((await profileOf(page)).uid);
  await page.reload();
  await waitSynced(page);
  assert.equal(await page.getByText("This device has progress from another account").count(), 0);
  assert.equal((await storeOf(page)).completed["6"], undefined, "B sees only B's data");
  await page.goto("/problems/12");
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await waitCloud(page, (c) => c.progress.some((p) => p.id === 12 && !p.deleted), "B's completion");
  const cloudB = await cloudOf(page);
  assert.deepEqual(cloudB.progress.filter((p) => !p.deleted).map((p) => p.id), [12], "A's progress was not merged into B");

  // A logs back in: A's progress is back, B's isn't in it.
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.locator("header").getByRole("link", { name: "Log in" }).waitFor();
  await logInInUi(page, a);
  await waitSynced(page);
  const store = await storeOf(page);
  assert.ok(store.completed["6"], "A's progress restored");
  assert.equal(store.completed["12"], undefined, "B's progress not shown to A");
  assert.deepEqual((await cloudOf(page)).progress.filter((p) => !p.deleted).map((p) => p.id), [6]);
  await context.close();
});

test("sync: theme changes follow you to your other device", async () => {
  const email = `sync-theme-${Date.now()}@example.com`;
  const a = await newPage(CONFIGURED);
  await signUpInUi(a.page, email);
  await grantProInEmulator((await profileOf(a.page)).uid);
  await a.page.reload();
  await waitSynced(a.page);
  const b = await newPage(CONFIGURED);
  await logInInUi(b.page, email);
  await waitSynced(b.page);

  await a.page.goto("/settings");
  await a.page.getByRole("button", { name: "Toggle theme" }).first().click();
  await a.page.getByRole("menuitem", { name: /Dark/ }).click();
  await waitCloud(a.page, (c) => c.meta?.preferences?.theme === "dark", "dark theme in the cloud");
  await b.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await b.page.waitForFunction(() => document.documentElement.classList.contains("dark"), null, { timeout: 20_000 });
  assert.ok((await b.context.cookies()).some((c) => c.name === "dsa-theme" && c.value === "dark"), "device B saved it");
  await a.context.close();
  await b.context.close();
});

test("sync: a note over 50,000 characters stays on the device, is listed, and doesn't stall other syncing", async () => {
  const email = `sync-long-${Date.now()}@example.com`;
  const { context, page } = await newPage(CONFIGURED);
  await signUpInUi(page, email);
  await grantProInEmulator((await profileOf(page)).uid);
  await page.reload();
  await waitSynced(page);
  await page.goto("/problems/8");
  await page.locator("#notes").fill("n".repeat(50_010));
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await waitCloud(page, (c) => c.progress.some((p) => p.id === 8 && !p.deleted), "other changes still sync");
  const cloud = await cloudOf(page);
  assert.ok(!cloud.notes.some((n) => n.id === 8), "the over-long note wasn't uploaded");
  assert.equal((await storeOf(page)).notes["8"].length, 50_010, "and it's intact on the device");
  await page.goto("/account");
  await page.getByTestId("unsynced-notes").waitFor();
  assert.match(await page.getByTestId("unsynced-notes").innerText(), /50,010 characters\): longer than the 50,000-character sync limit/);
  await context.close();
});

// ------------------------------------------------------------------ Phase 3: plans, upgrade, billing

test("pricing: public page shows Free and Pro (₹30/month), marks planned features, and never offers a fake checkout", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/pricing");
  await page.getByRole("heading", { name: "Plans", exact: true }).waitFor();
  assert.equal((await page.getByTestId("pro-price").innerText()).trim(), "₹30");
  assert.equal((await page.getByTestId("plan-summary").innerText()).trim(), "All 455 DSA problems are free. Pro unlocks articles, videos, and cloud sync.");
  const status = await page.getByTestId("pricing-status").innerText();
  assert.match(status, /Payments aren't available yet/);
  assert.doesNotMatch(status, /proposal/i, "proposal banner removed");
  const table = await page.getByTestId("plan-comparison").innerText();
  assert.match(table, /All 455 DSA questions and problems[\s\S]*Unlimited access\s*Unlimited access/);
  assert.match(table, /Articles and written learning content/);
  assert.match(table, /Striver videos and video explanations/);
  assert.match(table, /Cloud sync across devices/);
  assert.match(table, /AI DSA helper[\s\S]*10 questions a day\s*50 questions a day/, "AI helper available with daily limits");
  for (const planned of ["Advanced analytics", "Interview preparation mode", "Personalized roadmap"]) {
    assert.match(table, new RegExp(`${planned}\\s*Planned`), `${planned} marked planned`);
  }
  // Signed out: the dialog leads to a free account, with no payment button.
  await page.getByRole("button", { name: "Upgrade to Pro" }).click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByTestId("upgrade-summary").innerText(), /All 455 DSA problems are free/);
  assert.match(await page.getByRole("dialog").innerText(), /Articles and written learning content[\s\S]*Striver videos and video explanations[\s\S]*Cloud sync across devices/);
  assert.ok(await page.getByTestId("payments-unavailable").isVisible());
  assert.ok(await page.getByRole("dialog").getByRole("link", { name: "Create a free account" }).isVisible());
  assert.equal(await page.getByRole("button", { name: /Continue to payment/ }).count(), 0);
  // Sidebar link on desktop.
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Plans" }).waitFor();
  await context.close();
});

test("billing: requires sign-in; a Free account sees Free, no payments and an honest upgrade dialog", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/account/billing");
  await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("next") === "/account/billing");
  await signUpInUi(page, `billing-free-${Date.now()}@example.com`);
  await page.getByTestId("account-plan").waitFor();
  assert.match(await page.getByTestId("account-plan").innerText(), /Free plan/);
  await page.goto("/account/billing");
  assert.match(await page.getByTestId("current-plan").innerText(), /Free/);
  assert.equal((await page.getByTestId("plan-resources").innerText()).trim(), "Not included");
  assert.equal((await page.getByTestId("payment-history-empty").innerText()).trim(), "No payments.");
  assert.match(await page.getByTestId("sample-payments").innerText(), /Sample only .* not real payments/i);
  await page.getByRole("button", { name: "Upgrade to Pro" }).click();
  const pay = page.getByRole("dialog").getByRole("button", { name: "Payments coming soon" });
  assert.ok(await pay.isDisabled(), "no checkout before payments launch");
  await context.close();
});

test("billing: a Pro account (server entitlement) sees Pro, its end date and 'Your plan' on pricing", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await signUpInUi(page, `billing-pro-${Date.now()}@example.com`);
  const { uid } = await profileOf(page);
  const until = new Date(Date.now() + 30 * 86_400_000);
  const res = await fetch(`${DB_HOST}/v1/projects/demo-algoverse/databases/(default)/documents/entitlements/${uid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields: { plan: { stringValue: "pro" }, expiresAt: { timestampValue: until.toISOString() } } }),
  });
  assert.equal(res.status, 200);
  await page.goto("/account/billing");
  assert.match(await page.getByTestId("current-plan").innerText(), /Pro\s*Active/);
  assert.equal((await page.getByTestId("plan-resources").innerText()).trim(), "Included");
  assert.match(await page.getByTestId("plan-until").innerText(), new RegExp(String(until.getFullYear())));
  await page.goto("/pricing");
  await page.getByText("Your plan").waitFor();
  assert.ok(await page.getByRole("link", { name: "Manage plan" }).isVisible());
  // A forged client-side flag can't change the server's answer.
  await page.evaluate((u) => localStorage.setItem(`algoverse-entitlements:${u}`, JSON.stringify({ plan: "free" })), uid);
  await page.goto("/account/billing");
  assert.match(await page.getByTestId("current-plan").innerText(), /Pro/);
  await context.close();
});

// ------------------------------------------------------------------ account isolation on one device

test("account isolation: A (Google, verified, Pro) → log out → B sees none of A's progress or verification; A's data comes back", async () => {
  const { context, page } = await newPage(CONFIGURED);
  const aEmail = `iso-a-${Date.now()}@example.com`;
  const bEmail = `iso-b-${Date.now()}@example.com`;
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: bEmail, password: "letters123", returnSecureToken: true }),
  });
  // Signed-out practice before anyone logs in (guest progress).
  await page.goto("/problems/9");
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await page.waitForTimeout(400);

  // A: new Google account (created here, so the guest progress is A's), Pro, completes 1-3.
  await page.goto("/signup");
  await waitGoogleReady(page);
  await googlePopup(page, googleButton(page), aEmail);
  await page.waitForURL("**/account**");
  await page.getByText(/Email verified through Google/).waitFor();
  const a = await profileOf(page);
  await grantProInEmulator(a.uid);
  await page.reload();
  // A's local progress (the signed-out problem 9, kept at sign-up) → the usual first-sync choice.
  await page.getByText("Sync this device's progress to your account?").waitFor();
  await page.getByRole("button", { name: "Import and merge" }).click();
  await waitSynced(page);
  for (const id of [1, 2, 3]) {
    await page.goto(`/problems/${id}`);
    await page.getByRole("button", { name: "Mark Completed" }).click();
    await page.waitForTimeout(250);
  }
  // A also has a private note and a bookmark.
  await page.locator("#notes").fill("A's private note");
  await page.getByRole("button", { name: /bookmark/i }).first().click();
  await page.waitForTimeout(800);
  await page.goto("/account");
  await waitSynced(page);
  const aBefore = await storeOf(page);
  assert.deepEqual(Object.keys(aBefore.completed).sort(), ["1", "2", "3", "9"]);
  assert.equal(aBefore.notes["3"], "A's private note");
  assert.ok(aBefore.bookmarked.includes(3));
  assert.ok(aBefore.streak.activeDates.length > 0, "A has a streak history");

  // A logs out: A's progress is no longer shown (and not deleted).
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL(`${CONFIGURED}/`);
  await headerLogin(page).waitFor();
  assert.deepEqual(Object.keys((await storeOf(page)).completed), [], "signed out: A's progress hidden");
  assert.match(await page.locator("main").innerText(), /0 \/ 455/);

  // B logs in (existing email/password account, not verified).
  await headerLogin(page).click();
  await page.waitForURL("**/login**");
  await page.waitForFunction(() => !document.querySelector('button[type="submit"]')?.disabled);
  await page.getByLabel("Email").fill(bEmail);
  await page.getByLabel("Password", { exact: true }).fill("letters123");
  await page.getByRole("button", { name: "Log in" }).last().click();
  await page.waitForURL("**/account**");
  await page.getByText(bEmail).first().waitFor();
  const accountText = await page.locator("main").innerText();
  assert.ok(!accountText.includes(aEmail), "no trace of A's email");
  assert.doesNotMatch(accountText, /verified through Google|Email verified/, "B isn't shown as verified");
  assert.match(accountText, /Not verified/);
  const b = await profileOf(page);
  assert.notEqual(b.uid, a.uid);
  assert.deepEqual([b.emailVerified, b.verifiedByGoogle], [false, false]);
  const bStore = await storeOf(page);
  assert.deepEqual([Object.keys(bStore.completed), bStore.bookmarked, Object.keys(bStore.notes)], [[], [], []], "B sees none of A's data");
  assert.deepEqual([bStore.streak.current, bStore.streak.longest, bStore.streak.activeDates], [0, 0, []], "no streak from A");
  assert.ok(!JSON.stringify(bStore).includes("A's private note"), "A's note text nowhere in B's data");
  await page.goto("/problems/3");
  assert.equal(await page.locator("#notes").inputValue(), "", "A's note not shown on the problem page");
  await page.goto("/");
  assert.match(await page.locator("main").innerText(), /0 \/ 455/, "dashboard shows B's own (empty) progress");
  // B's own work stays B's.
  await page.goto("/problems/20");
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await page.waitForTimeout(400);

  // B logs out (from a problem page), A logs back in with Google: A's progress is back, B's isn't in it.
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await headerLogin(page).waitFor();
  assert.deepEqual(Object.keys((await storeOf(page)).completed), [], "B's progress hidden after B logs out");
  await page.goto("/login");
  await waitGoogleReady(page);
  await googlePopup(page, googleButton(page), aEmail);
  await page.waitForURL("**/account**");
  await page.getByText(/Email verified through Google/).waitFor();
  await waitSynced(page);
  const aAfter = await storeOf(page);
  assert.deepEqual(Object.keys(aAfter.completed).sort(), ["1", "2", "3", "9"], "A's progress restored");
  assert.deepEqual([aAfter.notes, aAfter.bookmarked, aAfter.streak.longest], [aBefore.notes, aBefore.bookmarked, aBefore.streak.longest], "A's notes, bookmarks and streak restored");
  assert.equal(aAfter.completed["20"], undefined, "B's completion isn't in A's data");
  const cloud = await cloudOf(page);
  assert.deepEqual(cloud.progress.filter((p) => !p.deleted).map((p) => p.id).sort((x, y) => x - y), [1, 2, 3, 9], "B's problem 20 never reached A's cloud");
  await context.close();
});

// ------------------------------------------------------------------ AI helper (Phase 5): sign-in required

test("AI helper: signed-out visitors get a sign-in prompt (problem still fully usable); unverified users are asked to verify", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await page.goto("/problems/1");
  const locked = page.getByTestId("ai-locked");
  await locked.waitFor();
  assert.match(await locked.innerText(), /Log in or create a free account to use the AI helper/);
  assert.equal(await locked.getByRole("link", { name: /Log in/ }).getAttribute("href"), "/login?next=%2Fproblems%2F1");
  assert.equal(await page.getByPlaceholder(/Ask AI something/).count(), 0, "no chat box for signed-out visitors");
  // A direct call is refused by the server.
  const direct = await page.evaluate(async () => {
    const r = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ problem: { title: "x", topic: "y", difficulty: "Easy", tags: [] }, messages: [{ role: "user", content: "hi" }] }) });
    return { status: r.status, body: await r.json() };
  });
  assert.deepEqual([direct.status, direct.body.error.code], [401, "sign_in_required"]);
  // The problem itself stays free and usable.
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await page.waitForTimeout(500);
  assert.ok((await storeOf(page)).completed["1"]);

  await signUpInUi(page, `ai-unverified-${Date.now()}@example.com`);
  await page.goto("/problems/1");
  await page.getByTestId("ai-locked").getByText(/Verify your email address to use the AI helper/).waitFor();
  assert.equal(await page.getByTestId("ai-locked").getByRole("link", { name: /Verify on the Account page/ }).getAttribute("href"), "/account");
  await context.close();
});

test("AI helper: a verified user chats as before, sees the allowance, and gets a clear message at the daily limit", async () => {
  const { context, page } = await newPage(CONFIGURED);
  const email = `ai-verified-${Date.now()}@example.com`;
  await signUpInUi(page, email);
  const [code] = await oobCodesFor(email);
  await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-api-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oobCode: code.oobCode }) });
  await page.goto("/account?verified=1");
  await page.getByText("Verified", { exact: true }).waitFor();
  // The real server enforces limits (tested on the emulators); here Gemini's side is simulated.
  let posts = 0;
  await context.route("**/api/ai", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts++;
    const usage = { plan: "free", limit: 10, used: 9 + posts - 1, remaining: 10 - (9 + posts - 1), resetAt: "2026-09-29T18:30:00.000Z" };
    if (posts === 1) {
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: `{"type":"delta","text":"Try a **hash map**."}\n{"type":"done","model":"gemini-3.8-flash","usage":${JSON.stringify(usage)}}\n` });
    }
    return route.fulfill({ status: 429, contentType: "application/json", headers: { "Retry-After": "3600" }, body: JSON.stringify({ error: { code: "daily_limit", message: "You've used all of today's AI questions. Your allowance resets at midnight (India time)." }, usage: { ...usage, used: 10, remaining: 0 } }) });
  });
  await page.goto("/problems/1");
  await page.getByTestId("ai-usage").waitFor();
  assert.match(await page.getByTestId("ai-usage").innerText(), /10 of 10 AI questions left today \(Free\)/, "allowance from GET /api/ai");
  const input = page.getByPlaceholder(/Ask AI something/);
  await input.fill("How do I start?");
  await input.press("Enter");
  await page.getByText("hash map").waitFor();
  assert.match(await page.getByTestId("ai-usage").innerText(), /1 of 10 AI questions left today/);
  await input.fill("And then?");
  await input.press("Enter");
  const alert = page.getByRole("alert").filter({ hasText: "used all of today's AI questions" });
  await alert.waitFor();
  assert.ok(await alert.getByRole("link", { name: "Pro: 50 a day" }).isVisible());
  assert.equal(await alert.getByRole("button", { name: "Retry" }).count(), 0, "no pointless retry");
  assert.match(await page.getByTestId("ai-usage").innerText(), /0 of 10/);
  await context.close();
});

// ------------------------------------------------------------------ Pro learning resources (articles + videos)

async function proLinksIn(html) {
  const { readFileSync } = await import("node:fs");
  const articleUrls = [...readFileSync("data/articles.ts", "utf8").matchAll(/url: "([^"]+)"/g)].map((m) => m[1]);
  const videoIds = [...readFileSync("data/striverVideos.ts", "utf8").matchAll(/videoId: "([A-Za-z0-9_-]{11})"/g)].map((m) => m[1]);
  return [...articleUrls, ...videoIds].filter((x) => html.includes(x));
}

test("all 455 problems are free: every problem page opens for a signed-out visitor, with no Pro links in the page", async () => {
  const { a2zProblems } = await import("../../data/a2zProblems.ts").catch(() => ({ a2zProblems: null }));
  const ids = a2zProblems ? a2zProblems.map((p) => p.id) : Array.from({ length: 455 }, (_, i) => i + 1);
  assert.equal(ids.length, 455);
  let ok = 0;
  const leaks = [];
  for (let i = 0; i < ids.length; i += 25) {
    await Promise.all(
      ids.slice(i, i + 25).map(async (id) => {
        const res = await fetch(`${CONFIGURED}/problems/${id}`);
        const html = await res.text();
        if (res.status === 200 && !/Pro-only problem|Upgrade to solve/i.test(html)) ok++;
        const found = await proLinksIn(html);
        if (found.length) leaks.push(`#${id}`);
      })
    );
  }
  assert.equal(ok, 455, "every problem page renders for free");
  assert.deepEqual(leaks, [], "no article URL or video id in any problem page");
  // Pages that list problems (home, problem list, bookmarks, every topic) carry no Pro links either.
  const { TOPICS } = await import("../../data/topics.ts");
  const listPages = ["/", "/problems", "/bookmarks", "/pricing", ...TOPICS.map((t) => `/topics/${t.id}`)];
  for (const path of listPages) {
    const res = await fetch(`${CONFIGURED}${path}`);
    assert.equal(res.status, 200, path);
    assert.deepEqual(await proLinksIn(await res.text()), [], `no Pro links in ${path}`);
  }
});

test("Free user: video and article are locked (upgrade dialog, no player, no links); free features still work", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await signUpInUi(page, `res-free-${Date.now()}@example.com`);
  await page.goto("/problems/6");
  await page.getByTestId("locked-video").waitFor();
  assert.ok((await page.getByTestId("video-title").innerText()).length > 0, "title may be shown");
  assert.equal(await page.locator("iframe").count(), 0, "no embedded player");
  assert.equal(await page.locator('a[href*="youtube.com"], a[href*="youtu.be"], a[href*="takeuforward.org/data-structure"]').count(), 0);
  assert.deepEqual(await proLinksIn(await page.content()), [], "no Pro links anywhere in the DOM");
  await page.getByTestId("locked-video").click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /Striver's video explanations are part of AlgoVerse Pro/);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByTestId("locked-article").click();
  assert.match(await page.getByRole("dialog").innerText(), /Articles are part of AlgoVerse Pro/);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  // A direct API call is refused too.
  assert.equal(await page.evaluate(async () => (await fetch("/api/resources/6")).status), 403);
  // Free features: completion, notes, bookmark and export all still work.
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await page.locator("#notes").fill("free user's note");
  await page.getByRole("button", { name: /bookmark/i }).first().click();
  await page.waitForTimeout(800);
  const store = await storeOf(page);
  assert.ok(store.completed["6"] && store.notes["6"] === "free user's note" && store.bookmarked.includes(6));
  await page.goto("/settings");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export Progress" }).click()]);
  assert.match(download.suggestedFilename(), /^algoverse-progress-.*\.json$/);
  await context.close();
});

test("Pro user gets the video (on YouTube) and article links; after Pro expires they're locked again, local data kept", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await signUpInUi(page, `res-pro-${Date.now()}@example.com`);
  const { uid } = await profileOf(page);
  await grantProInEmulator(uid);
  await page.goto("/problems/6");
  await page.getByTestId("watch-video").waitFor();
  assert.match(await page.getByTestId("watch-video").getAttribute("href"), /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}/);
  assert.equal(await page.getByTestId("watch-video").getAttribute("target"), "_blank");
  assert.match(await page.getByTestId("read-article").getAttribute("href"), /^https:\/\/takeuforward\.org\//);
  assert.equal(await page.locator("iframe").count(), 0, "no embedded player for Pro either");
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await page.waitForTimeout(500);

  // Pro expires (server-side): links locked again; the device's progress is untouched.
  const res = await fetch(`${DB_HOST}/v1/projects/demo-algoverse/databases/(default)/documents/entitlements/${uid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
    body: JSON.stringify({ fields: { plan: { stringValue: "pro" }, expiresAt: { timestampValue: new Date(Date.now() - 60_000).toISOString() } } }),
  });
  assert.equal(res.status, 200);
  await page.reload();
  await page.getByTestId("locked-video").waitFor();
  assert.equal(await page.getByTestId("watch-video").count(), 0);
  assert.ok((await storeOf(page)).completed["6"], "local progress kept after Pro expired");
  await context.close();
});

// ------------------------------------------------------------------ Pro in-app video player

/**
 * Stand-in for YouTube's official IFrame Player API (same contract: YT.Player, onReady, onError),
 * so the tests never contact YouTube. window.__ytMode = "error150" simulates a creator who has
 * disabled embedding.
 */
const FAKE_YT_API = `
window.YT = { Player: function (el, opts) {
  var f = document.createElement("iframe");
  var p = new URLSearchParams();
  Object.keys(opts.playerVars || {}).forEach(function (k) { p.set(k, String(opts.playerVars[k])); });
  f.src = opts.host + "/embed/" + opts.videoId + "?" + p.toString();
  el.replaceWith(f);
  var player = { destroy: function () { f.remove(); }, getIframe: function () { return f; } };
  setTimeout(function () {
    if (window.__ytMode === "error150") opts.events.onError({ data: 150, target: player });
    else opts.events.onReady({ target: player });
  }, 50);
  return player;
} };
setTimeout(function () { if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady(); }, 0);
`;

async function mockYouTube(context, { apiFails = false } = {}) {
  await context.route("https://www.youtube.com/iframe_api", (route) =>
    apiFails ? route.abort() : route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_YT_API })
  );
  await context.route(/^https:\/\/(www\.)?(youtube-nocookie|youtube)\.com\/embed\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>player</body></html>" })
  );
}

async function proOnProblem6(context, page) {
  await signUpInUi(page, `player-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`);
  await grantProInEmulator((await profileOf(page)).uid);
  await page.goto("/problems/6");
  await page.getByTestId("watch-in-app").waitFor();
}

test("Pro on a phone (390px): the player and its buttons fit on screen (long titles truncate)", async () => {
  const { context, page } = await newPage(CONFIGURED, { width: 390, height: 844 });
  await mockYouTube(context);
  await proOnProblem6(context, page);
  await page.getByTestId("watch-in-app").click();
  const dialog = page.getByTestId("video-player-dialog");
  await dialog.locator("iframe").waitFor();
  // Measure once the open animation (zoom/translate) has finished.
  await page.waitForFunction(() => document.querySelector('[data-testid="video-player-dialog"]')?.getAnimations().every((a) => a.playState === "finished"));
  const widest = await page.evaluate(() =>
    Math.max(...[...document.querySelectorAll('[data-testid="video-player-dialog"], [data-testid="video-player-dialog"] *')].map((e) => e.getBoundingClientRect().right))
  );
  assert.ok(widest <= 390, `dialog content ends at ${Math.round(widest)}px on a 390px screen`);
  assert.ok(await page.getByTestId("close-player").isVisible());
  await context.close();
});

test("Pro: Watch in AlgoVerse plays the authorised video in the official player; Watch on YouTube unchanged; closing keeps the page state", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await mockYouTube(context);
  await proOnProblem6(context, page);
  const api = await page.evaluate(async () => (await fetch("/api/resources/6")).json());
  assert.match(await page.getByTestId("watch-video").getAttribute("href"), /^https:\/\/www\.youtube\.com\/watch\?v=/, "external link as before");
  assert.equal(await page.getByTestId("watch-video").getAttribute("target"), "_blank");
  assert.equal(await page.locator("iframe").count(), 0, "nothing loads until the viewer chooses to watch");

  // Some page state that must survive opening/closing the player.
  await page.getByRole("button", { name: "Mark Completed" }).click();
  await page.locator("#notes").fill("notes before watching");
  await page.waitForTimeout(700);

  await page.getByTestId("watch-in-app").click();
  const dialog = page.getByTestId("video-player-dialog");
  await dialog.waitFor();
  assert.match(await dialog.innerText(), new RegExp(api.video.title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const frame = dialog.locator("iframe");
  await frame.waitFor();
  const src = await frame.getAttribute("src");
  assert.ok(src.startsWith(`https://www.youtube-nocookie.com/embed/${api.video.embed.videoId}?`), "official embed, id from the authorised API");
  assert.doesNotMatch(src, /autoplay=1/, "no autoplay");
  await page.waitForFunction(() => /Striver's video explanation/.test(document.querySelector('[data-testid="player-container"] iframe')?.title ?? ""));
  assert.equal(await frame.getAttribute("allowfullscreen"), "", "fullscreen allowed");
  assert.equal(await page.getByTestId("player-message").count(), 0);

  // Back to problem: dialog gone, player destroyed, focus returned, state intact.
  await page.getByTestId("close-player").click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(await page.locator("iframe").count(), 0, "player removed (no hidden playback)");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-testid")), "watch-in-app", "focus restored");
  assert.ok(page.url().endsWith("/problems/6"));
  assert.equal(await page.locator("#notes").inputValue(), "notes before watching");
  const store = await storeOf(page);
  assert.ok(store.completed["6"] && store.notes["6"] === "notes before watching");

  // Escape closes it too.
  await page.getByTestId("watch-in-app").click();
  await dialog.locator("iframe").waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });
  // Article still works as before.
  assert.match(await page.getByTestId("read-article").getAttribute("href"), /^https:\/\/takeuforward\.org\//);
  await context.close();
});

test("Pro: a video whose owner disabled embedding (player error 150) shows a friendly message and the YouTube link", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await mockYouTube(context);
  await proOnProblem6(context, page);
  await page.evaluate(() => (window.__ytMode = "error150"));
  await page.getByTestId("watch-in-app").click();
  const msg = page.getByTestId("player-message");
  await msg.waitFor();
  assert.match(await msg.innerText(), /owner allows it to be watched on YouTube only/);
  assert.match(await msg.getByRole("link", { name: /Watch on YouTube/ }).getAttribute("href"), /youtube\.com\/watch\?v=/);
  await context.close();
});

test("Pro: if the YouTube player can't load, a message offers the YouTube link", async () => {
  const { context, page } = await newPage(CONFIGURED);
  await mockYouTube(context, { apiFails: true });
  await proOnProblem6(context, page);
  await page.getByTestId("watch-in-app").click();
  await page.getByTestId("player-message").waitFor();
  assert.match(await page.getByTestId("player-message").innerText(), /didn't load/);
  await context.close();
});

test("Free: no in-app player, no id anywhere; the locked video still opens the upgrade dialog", async () => {
  const { context, page } = await newPage(CONFIGURED);
  let playerApiRequested = false;
  await context.route("https://www.youtube.com/iframe_api", (route) => {
    playerApiRequested = true;
    return route.abort();
  });
  await signUpInUi(page, `player-free-${Date.now()}@example.com`);
  await page.goto("/problems/6");
  await page.getByTestId("locked-video").waitFor();
  assert.equal(await page.getByTestId("watch-in-app").count(), 0);
  await page.getByTestId("locked-video").click();
  await page.getByRole("dialog").waitFor();
  assert.match(await page.getByRole("dialog").innerText(), /All 455 DSA problems are free\. Pro unlocks articles, videos, and cloud sync\./);
  assert.equal(await page.locator("iframe").count(), 0);
  assert.deepEqual(await proLinksIn(await page.content()), []);
  const body = await page.evaluate(async () => (await fetch("/api/resources/6")).text());
  assert.ok(!/embed|videoId|youtube/i.test(body), "API gives Free users no video data");
  assert.equal(playerApiRequested, false, "the YouTube player API is never even loaded for Free users");
  await context.close();
});
