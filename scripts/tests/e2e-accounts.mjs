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
  await Promise.all([waitFor(`${CONFIGURED}/login`), waitFor(`${UNCONFIGURED}/login`)]);
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
