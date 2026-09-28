/**
 * Razorpay subscription events → AlgoVerse entitlement (pure; no I/O). Phase 4 readiness:
 * the future webhook route verifies the signature (lib/billing/webhook.ts), then, in ONE
 * Firestore transaction: skips an event id it has already processed (webhookEvents/{id}),
 * loads subscriptions/{subscriptionId}, calls applySubscriptionEvent, and writes the record,
 * the event id and entitlements/{uid}. See docs/BILLING.md.
 *
 * Rules:
 * - The uid comes from OUR subscriptions/{id} record, created server-side when checkout starts —
 *   never from the webhook's notes or the browser.
 * - Out-of-order delivery: an event older than the last one applied changes nothing.
 * - Pro lasts until the end of the paid period (current_end) plus a short grace for renewals in
 *   flight; cancelled keeps what was paid for; halted/expired/completed end it.
 * - A longer manual grant (scripts/grant-pro.mjs) is never shortened by billing.
 */

export const RENEWAL_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export type RazorpayStatus =
  | "created" | "authenticated" | "active" | "pending" | "halted" | "cancelled" | "completed" | "expired" | "paused";

const STATUSES: readonly RazorpayStatus[] = ["created", "authenticated", "active", "pending", "halted", "cancelled", "completed", "expired", "paused"];

export interface SubscriptionEvent {
  eventId: string;
  type: string; // e.g. "subscription.charged"
  createdAt: number; // ms
  subscriptionId: string;
  status: RazorpayStatus;
  currentEnd: number | null; // ms, end of the paid period
}

/** Our record: subscriptions/{subscriptionId}. */
export interface SubscriptionRecord {
  uid: string;
  subscriptionId: string;
  status: RazorpayStatus;
  currentEnd: number | null;
  lastEventAt: number;
}

export interface Entitlement {
  plan: "pro" | "free";
  expiresAt: number | null;
  source: string;
}

export type ApplyResult =
  | { ignored: "stale" | "unknown_subscription" | "wrong_subscription" }
  | { ignored?: undefined; record: SubscriptionRecord; entitlement: Entitlement };

/** Parses a Razorpay webhook body (already signature-verified). Null for anything else. */
export function parseSubscriptionEvent(body: unknown, eventId: string | null): SubscriptionEvent | null {
  const b = body as {
    event?: unknown;
    created_at?: unknown;
    payload?: { subscription?: { entity?: { id?: unknown; status?: unknown; current_end?: unknown } } };
  } | null;
  const entity = b?.payload?.subscription?.entity;
  if (!eventId || typeof b?.event !== "string" || !b.event.startsWith("subscription.") || !entity) return null;
  if (typeof entity.id !== "string" || !/^sub_[A-Za-z0-9]{1,40}$/.test(entity.id)) return null;
  if (!STATUSES.includes(entity.status as RazorpayStatus)) return null;
  if (typeof b.created_at !== "number") return null;
  const end = typeof entity.current_end === "number" && entity.current_end > 0 ? entity.current_end * 1000 : null;
  return { eventId, type: b.event, createdAt: b.created_at * 1000, subscriptionId: entity.id, status: entity.status as RazorpayStatus, currentEnd: end };
}

/** Pro until when, for this subscription state? null = not Pro. */
export function proUntil(status: RazorpayStatus, currentEnd: number | null): number | null {
  if (currentEnd === null) return null;
  switch (status) {
    case "active":
    case "pending": // renewal being retried: keep access through the grace period
      return currentEnd + RENEWAL_GRACE_MS;
    case "cancelled": // paid period stays usable
      return currentEnd;
    default: // created/authenticated (not paid), halted, paused, completed, expired
      return null;
  }
}

export function applySubscriptionEvent(
  record: SubscriptionRecord | null,
  event: SubscriptionEvent,
  current: Entitlement | null,
  now: number
): ApplyResult {
  if (!record) return { ignored: "unknown_subscription" };
  if (record.subscriptionId !== event.subscriptionId) return { ignored: "wrong_subscription" };
  if (event.createdAt < record.lastEventAt) return { ignored: "stale" };
  const next: SubscriptionRecord = { ...record, status: event.status, currentEnd: event.currentEnd ?? record.currentEnd, lastEventAt: event.createdAt };
  const until = proUntil(next.status, next.currentEnd);
  // Keep a longer grant from elsewhere (manual/comp); billing never shortens it.
  const other = current && current.plan === "pro" && current.source !== "razorpay" && (current.expiresAt === null || current.expiresAt > now) ? current : null;
  let entitlement: Entitlement;
  if (other && (other.expiresAt === null || until === null || other.expiresAt >= until)) entitlement = other;
  else if (until !== null && until > now) entitlement = { plan: "pro", expiresAt: until, source: "razorpay" };
  else entitlement = { plan: "free", expiresAt: until, source: "razorpay" };
  return { record: next, entitlement };
}
