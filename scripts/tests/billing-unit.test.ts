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

test("payments are off in the shipped code and can never switch on in Production or live mode", () => {
  assert.equal(PRICING.paymentsEnabled, false, "no checkout until the owner approves");
  assert.deepEqual(billingStatus({}), { enabled: false, reason: "not_approved" });
  const test = { RAZORPAY_MODE: "test", RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "s", RAZORPAY_WEBHOOK_SECRET: "w", RAZORPAY_PLAN_ID: "plan_x" };
  assert.deepEqual(billingStatus(test, true), { enabled: true, mode: "test" }, "test mode on Preview/local once approved");
  assert.deepEqual(billingStatus({ ...test, VERCEL_ENV: "production" }, true), { enabled: false, reason: "production" });
  assert.deepEqual(billingStatus({ ...test, RAZORPAY_MODE: "live", RAZORPAY_KEY_ID: "rzp_live_abc" }, true), { enabled: false, reason: "live_not_allowed" });
  assert.deepEqual(billingStatus({ ...test, RAZORPAY_KEY_ID: "rzp_live_abc" }, true), { enabled: false, reason: "live_not_allowed" }, "a live key with test mode is still refused");
  assert.deepEqual(billingStatus({ ...test, RAZORPAY_WEBHOOK_SECRET: "" }, true), { enabled: false, reason: "not_configured" });
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
