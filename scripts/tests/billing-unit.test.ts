// Unit tests for billing readiness (Phase 4 not live): the payments gate, webhook signature
// verification and the subscription → entitlement rules. No network, no Razorpay account.
// Run: npm run test:billing-unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const { billingStatus } = await import("@/lib/billing/config");
const { verifyWebhookSignature } = await import("@/lib/billing/webhook");
const sub = await import("@/lib/billing/subscription");
const { PRICING } = await import("@/lib/plans");

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

test("billing gate: TEST mode only, never on Production, never live — whatever the configuration", () => {
  assert.equal(PRICING.paymentsEnabled, false, "live payments not approved in code");
  assert.deepEqual(billingStatus({}), { enabled: false, reason: "not_configured" });
  const test = { RAZORPAY_MODE: "test", RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w", RAZORPAY_PLAN_ID: "plan_x" };
  assert.deepEqual(billingStatus(test), { enabled: true, mode: "test" }, "test mode on Preview/local");
  assert.deepEqual(billingStatus({ ...test, VERCEL_ENV: "preview" }), { enabled: true, mode: "test" });
  assert.deepEqual(billingStatus({ ...test, VERCEL_ENV: "production" }), { enabled: false, reason: "production" }, "never on Production");
  assert.deepEqual(billingStatus({ ...test, RAZORPAY_MODE: "live", RAZORPAY_KEY_ID: "rzp_live_abc" }, true), { enabled: false, reason: "live_not_allowed" }, "live refused even if approved in code");
  assert.deepEqual(billingStatus({ ...test, RAZORPAY_KEY_ID: "rzp_live_abc" }), { enabled: false, reason: "live_not_allowed" }, "a live key with test mode is refused");
  assert.deepEqual(billingStatus({ ...test, RAZORPAY_WEBHOOK_SECRET: "" }), { enabled: false, reason: "not_configured" });
  assert.deepEqual(billingStatus({ ...test, RAZORPAY_MODE: undefined }), { enabled: false, reason: "not_configured" });
});

test("Razorpay API base: only a LOCAL mock may override it, never on Production", async () => {
  const { razorpaySettings } = await import("@/lib/billing/config");
  assert.equal(razorpaySettings({}).apiBase, "https://api.razorpay.com");
  assert.equal(razorpaySettings({ RAZORPAY_API_BASE: "http://127.0.0.1:3190/" }).apiBase, "http://127.0.0.1:3190");
  assert.equal(razorpaySettings({ RAZORPAY_API_BASE: "https://evil.example" }).apiBase, "https://api.razorpay.com");
  assert.equal(razorpaySettings({ RAZORPAY_API_BASE: "http://127.0.0.1:3190", VERCEL_ENV: "production" }).apiBase, "https://api.razorpay.com");
});

test("webhook signature: exact raw body + secret, constant-time, anything else rejected", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "subscription.charged", created_at: 1 });
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyWebhookSignature(body, sig, secret), true);
  assert.equal(verifyWebhookSignature(body, sig.toUpperCase(), secret), true, "hex case doesn't matter");
  assert.equal(verifyWebhookSignature(body + " ", sig, secret), false, "body changed by one byte");
  assert.equal(verifyWebhookSignature(JSON.stringify(JSON.parse(body), null, 1), sig, secret), false, "re-serialised JSON");
  assert.equal(verifyWebhookSignature(body, sig, "other"), false, "wrong secret");
  assert.equal(verifyWebhookSignature(body, null, secret), false);
  assert.equal(verifyWebhookSignature(body, "abc", secret), false);
  assert.equal(verifyWebhookSignature(body, sig, ""), false, "no secret configured → never valid");
});

const event = (status: string, createdAt: number, currentEnd: number | null, id = "sub_A1") =>
  sub.parseSubscriptionEvent(
    { event: `subscription.${status}`, created_at: createdAt / 1000, payload: { subscription: { entity: { id, status, current_end: currentEnd === null ? null : currentEnd / 1000 } } } },
    `evt_${status}_${createdAt}`
  )!;
const record = { uid: "u1", subscriptionId: "sub_A1", status: "created" as const, currentEnd: null, lastEventAt: 0 };

test("webhook payloads are parsed strictly", () => {
  assert.equal(sub.parseSubscriptionEvent({ event: "payment.captured", created_at: 1, payload: {} }, "e"), null);
  assert.equal(sub.parseSubscriptionEvent({ event: "subscription.charged", created_at: 1, payload: { subscription: { entity: { id: "sub_1", status: "weird" } } } }, "e"), null);
  assert.equal(sub.parseSubscriptionEvent({ event: "subscription.charged", created_at: 1, payload: { subscription: { entity: { id: "../x", status: "active" } } } }, "e"), null);
  assert.equal(sub.parseSubscriptionEvent({ event: "subscription.charged", created_at: 1, payload: { subscription: { entity: { id: "sub_1", status: "active" } } } }, null), null, "event id required (idempotency)");
  assert.equal(event("active", NOW, NOW + 30 * DAY).currentEnd, NOW + 30 * DAY);
});

test("lifecycle: paid → Pro for the period (+grace); pending keeps it; halted/expired end it; cancel keeps the paid period", () => {
  let r = sub.applySubscriptionEvent(record, event("authenticated", NOW, null), null, NOW);
  assert.ok(!r.ignored && r.entitlement.plan === "free", "mandate set up but not charged: not Pro yet");
  r = sub.applySubscriptionEvent(r.record, event("active", NOW + 1, NOW + 30 * DAY), r.entitlement, NOW);
  assert.ok(!r.ignored);
  assert.deepEqual(r.entitlement, { plan: "pro", expiresAt: NOW + 30 * DAY + sub.RENEWAL_GRACE_MS, source: "razorpay" });
  const pending = sub.applySubscriptionEvent(r.record, event("pending", NOW + 2, NOW + 30 * DAY), r.entitlement, NOW + 30 * DAY + DAY);
  assert.ok(!pending.ignored && pending.entitlement.plan === "pro", "renewal retrying: still Pro within grace");
  const halted = sub.applySubscriptionEvent(r.record, event("halted", NOW + 3, NOW + 30 * DAY), r.entitlement, NOW + 31 * DAY);
  assert.ok(!halted.ignored && halted.entitlement.plan === "free", "retries exhausted: Free");
  const cancelled = sub.applySubscriptionEvent(r.record, event("cancelled", NOW + 3, NOW + 30 * DAY), r.entitlement, NOW + 10 * DAY);
  assert.ok(!cancelled.ignored);
  assert.deepEqual(cancelled.entitlement, { plan: "pro", expiresAt: NOW + 30 * DAY, source: "razorpay" }, "cancel keeps what was paid for, no grace");
  for (const s of ["expired", "completed", "paused"]) {
    const x = sub.applySubscriptionEvent(r.record, event(s, NOW + 3, NOW + 30 * DAY), r.entitlement, NOW);
    assert.ok(!x.ignored && x.entitlement.plan === "free", s);
  }
});

test("out-of-order, unknown and mismatched events change nothing", () => {
  const active = sub.applySubscriptionEvent(record, event("active", NOW + 10, NOW + 30 * DAY), null, NOW);
  assert.ok(!active.ignored);
  assert.deepEqual(sub.applySubscriptionEvent(active.record, event("authenticated", NOW + 5, null), active.entitlement, NOW), { ignored: "stale" });
  assert.deepEqual(sub.applySubscriptionEvent(null, event("active", NOW, NOW + DAY), null, NOW), { ignored: "unknown_subscription" });
  assert.deepEqual(sub.applySubscriptionEvent(record, event("active", NOW, NOW + DAY, "sub_OTHER"), null, NOW), { ignored: "wrong_subscription" });
  // Same event applied twice: same result (the route also skips processed event ids).
  const again = sub.applySubscriptionEvent(active.record, event("active", NOW + 10, NOW + 30 * DAY), active.entitlement, NOW);
  assert.ok(!again.ignored);
  assert.deepEqual(again.entitlement, active.entitlement);
});

test("a longer manual grant is never shortened by billing", () => {
  const manual = { plan: "pro" as const, expiresAt: NOW + 365 * DAY, source: "manual" };
  const halted = sub.applySubscriptionEvent(record, event("halted", NOW, NOW + DAY), manual, NOW);
  assert.ok(!halted.ignored);
  assert.deepEqual(halted.entitlement, manual);
  const shortManual = { plan: "pro" as const, expiresAt: NOW + DAY, source: "manual" };
  const active = sub.applySubscriptionEvent(record, event("active", NOW, NOW + 30 * DAY), shortManual, NOW);
  assert.ok(!active.ignored && active.entitlement.source === "razorpay" && active.entitlement.expiresAt! > shortManual.expiresAt);
});

test("Razorpay client: Basic auth with the key pair, correct endpoints, codes-only errors", async () => {
  const { razorpayClient, RazorpayError } = await import("@/lib/billing/razorpay");
  const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
  const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method), auth: new Headers(init?.headers).get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (String(url).endsWith("/cancel")) return new Response(JSON.stringify({ id: "sub_T1", status: "active" }), { status: 200 });
    if (String(url).includes("sub_BAD")) return new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR", description: "secret-looking detail rzp_test_SECRET" } }), { status: 400 });
    return new Response(JSON.stringify({ id: "sub_T1", status: "created" }), { status: 200 });
  }) as typeof fetch;
  const c = razorpayClient({ keyId: "rzp_test_ID", keySecret: "SECRET123", apiBase: "https://api.razorpay.com" }, fake);
  assert.deepEqual(await c.createSubscription({ planId: "plan_1", uid: "u1" }), { id: "sub_T1", status: "created" });
  assert.equal(calls[0].url, "https://api.razorpay.com/v1/subscriptions");
  assert.equal(calls[0].auth, "Basic " + Buffer.from("rzp_test_ID:SECRET123").toString("base64"));
  assert.deepEqual([calls[0].body.plan_id, calls[0].body.total_count, calls[0].body.notes.uid], ["plan_1", 120, "u1"]);
  await c.cancelSubscription("sub_T1", true);
  assert.equal(calls[1].url, "https://api.razorpay.com/v1/subscriptions/sub_T1/cancel");
  assert.deepEqual(calls[1].body, { cancel_at_cycle_end: 1 });
  await assert.rejects(c.fetchSubscription("sub_BAD"), (e: Error) => e instanceof RazorpayError && e.status === 400 && e.message === "razorpay_400_BAD_REQUEST_ERROR" && !e.message.includes("SECRET"));
  await assert.rejects(async () => c.fetchSubscription("../../x"), (e: Error) => e instanceof RazorpayError && e.code === "bad_id");
});
