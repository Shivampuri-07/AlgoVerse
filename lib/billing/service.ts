/**
 * SERVER-ONLY. Razorpay subscriptions (TEST mode) wired to AlgoVerse Pro. docs/BILLING.md.
 *
 * Firestore (all server-only — firestore.rules denies every client read/write outside users/{uid}):
 *   subscriptions/{sub_id}             { uid, subscriptionId, status, currentEnd, lastEventAt, cancelRequested, mode, createdAt, updatedAt }
 *   billingAccounts/{uid}              { subscriptionId, status, currentEnd, cancelRequested, updatedAt }
 *   billingAccounts/{uid}/payments/{pay_id}  { amount (paise), currency, status, subscriptionId, createdAt }
 *   webhookEvents/{event_id}           { type, subscriptionId, outcome, receivedAt }   ← idempotency
 *   entitlements/{uid}                 { plan, expiresAt, source, subscriptionId, updatedAt }  (read by lib/entitlements.ts)
 *
 * Rules:
 *   - Pro is granted ONLY by a signature-verified webhook (or reconciliation from Razorpay's API),
 *     never by the browser, the checkout callback, or anything the client sends.
 *   - The uid comes from OUR subscriptions/{id} record, written before checkout opens — never from
 *     the webhook's notes.
 *   - Each event id is applied at most once (same transaction as its effects); older events than
 *     the last applied one change nothing (lib/billing/subscription.ts).
 */
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { verifyWebhookSignature } from "@/lib/billing/webhook";
import { applySubscriptionEvent, parseSubscriptionEvent, type Entitlement, type RazorpayStatus, type SubscriptionEvent, type SubscriptionRecord } from "@/lib/billing/subscription";
import type { RazorpayClient } from "@/lib/billing/razorpay";

export const SUBSCRIPTIONS = "subscriptions";
export const BILLING_ACCOUNTS = "billingAccounts";
export const WEBHOOK_EVENTS = "webhookEvents";
const ENTITLEMENTS = "entitlements";
const MAX_WEBHOOK_BYTES = 256 * 1024;

export class BillingError extends Error {
  readonly code: "already_subscribed" | "no_subscription" | "unavailable";
  constructor(code: BillingError["code"]) {
    super(code);
    this.code = code;
  }
}

const LIVE_STATUSES: readonly string[] = ["created", "authenticated", "active", "pending"];

// ------------------------------------------------------------------ checkout

/** Creates a Razorpay subscription for `uid` and records it as ours BEFORE checkout opens. */
export async function startCheckout(db: Firestore, client: RazorpayClient, uid: string, planId: string, now = Date.now()) {
  const account = await db.doc(`${BILLING_ACCOUNTS}/${uid}`).get();
  const status = account.get("status") as string | undefined;
  const currentEnd = account.get("currentEnd") as number | null | undefined;
  if (status && ["active", "authenticated", "pending"].includes(status) && (!currentEnd || currentEnd > now)) {
    throw new BillingError("already_subscribed");
  }
  const sub = await client.createSubscription({ planId, uid });
  await db.runTransaction(async (tx) => {
    tx.set(db.doc(`${SUBSCRIPTIONS}/${sub.id}`), {
      uid,
      subscriptionId: sub.id,
      status: sub.status || "created",
      currentEnd: null,
      lastEventAt: 0,
      cancelRequested: false,
      mode: "test",
      createdAt: Timestamp.fromMillis(now),
      updatedAt: Timestamp.fromMillis(now),
    });
    tx.set(db.doc(`${BILLING_ACCOUNTS}/${uid}`), { subscriptionId: sub.id, status: sub.status || "created", currentEnd: null, cancelRequested: false, updatedAt: Timestamp.fromMillis(now) }, { merge: true });
  });
  return { subscriptionId: sub.id };
}

// ------------------------------------------------------------------ webhook

export type WebhookResult =
  | { status: 400; outcome: "invalid_signature" | "bad_request" }
  | { status: 200; outcome: "applied" | "duplicate" | "ignored" | "stale" | "unknown_subscription" | "wrong_subscription" };

/** Verify → parse → apply in one transaction. Only verified events ever change anything. */
export async function handleWebhook(
  db: Firestore,
  input: { rawBody: string; signature: string | null; eventId: string | null; secret: string },
  now = Date.now()
): Promise<WebhookResult> {
  if (input.rawBody.length > MAX_WEBHOOK_BYTES) return { status: 400, outcome: "bad_request" };
  if (!verifyWebhookSignature(input.rawBody, input.signature, input.secret)) return { status: 400, outcome: "invalid_signature" };
  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, outcome: "bad_request" };
  }
  if (!input.eventId || !/^[A-Za-z0-9_-]{1,64}$/.test(input.eventId)) return { status: 400, outcome: "bad_request" };
  const type = (body as { event?: unknown })?.event;
  if (typeof type !== "string" || !type.startsWith("subscription.")) {
    return { status: 200, outcome: "ignored" }; // e.g. payment.captured: subscription events carry what we need
  }
  const event = parseSubscriptionEvent(body, input.eventId);
  if (!event) return { status: 400, outcome: "bad_request" };
  const payment = paymentFrom(body);
  return db.runTransaction((tx) => applyEvent(db, tx, event, payment, now));
}

interface PaymentRow {
  id: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: number;
}

function paymentFrom(body: unknown): PaymentRow | null {
  const p = (body as { payload?: { payment?: { entity?: Record<string, unknown> } } })?.payload?.payment?.entity;
  if (!p || typeof p.id !== "string" || !/^pay_[A-Za-z0-9]{1,40}$/.test(p.id)) return null;
  return {
    id: p.id,
    amount: typeof p.amount === "number" ? p.amount : 0,
    currency: typeof p.currency === "string" ? p.currency.slice(0, 3) : "INR",
    status: typeof p.status === "string" ? p.status.slice(0, 20) : "unknown",
    createdAt: typeof p.created_at === "number" ? p.created_at * 1000 : Date.now(),
  };
}

async function applyEvent(db: Firestore, tx: Transaction, event: SubscriptionEvent, payment: PaymentRow | null, now: number): Promise<WebhookResult> {
  const evRef = db.doc(`${WEBHOOK_EVENTS}/${event.eventId}`);
  const subRef = db.doc(`${SUBSCRIPTIONS}/${event.subscriptionId}`);
  const [ev, sub] = await Promise.all([tx.get(evRef), tx.get(subRef)]);
  if (ev.exists) return { status: 200, outcome: "duplicate" };

  const record: SubscriptionRecord | null = sub.exists
    ? {
        uid: String(sub.get("uid")),
        subscriptionId: String(sub.get("subscriptionId")),
        status: sub.get("status") as RazorpayStatus,
        currentEnd: (sub.get("currentEnd") as number | null) ?? null,
        lastEventAt: Number(sub.get("lastEventAt")) || 0,
      }
    : null;
  const entRef = record ? db.doc(`${ENTITLEMENTS}/${record.uid}`) : null;
  const ent = entRef ? await tx.get(entRef) : null;
  const current: Entitlement | null = ent?.exists
    ? {
        plan: ent.get("plan") === "pro" ? "pro" : "free",
        expiresAt: ent.get("expiresAt") instanceof Timestamp ? (ent.get("expiresAt") as Timestamp).toMillis() : null,
        source: String(ent.get("source") ?? "manual"),
      }
    : null;

  const result = applySubscriptionEvent(record, event, current, now);
  const stamp = Timestamp.fromMillis(now);
  if (result.ignored) {
    tx.set(evRef, { type: event.type, subscriptionId: event.subscriptionId, outcome: result.ignored, receivedAt: stamp });
    return { status: 200, outcome: result.ignored };
  }
  const { record: next, entitlement } = result;
  tx.set(subRef, { status: next.status, currentEnd: next.currentEnd, lastEventAt: next.lastEventAt, updatedAt: stamp }, { merge: true });
  tx.set(entRef!, {
    plan: entitlement.plan,
    expiresAt: entitlement.expiresAt === null ? null : Timestamp.fromMillis(entitlement.expiresAt),
    source: entitlement.source,
    ...(entitlement.source === "razorpay" ? { subscriptionId: next.subscriptionId } : {}),
    updatedAt: stamp,
  });
  tx.set(db.doc(`${BILLING_ACCOUNTS}/${next.uid}`), { subscriptionId: next.subscriptionId, status: next.status, currentEnd: next.currentEnd, updatedAt: stamp }, { merge: true });
  if (payment) {
    tx.set(db.doc(`${BILLING_ACCOUNTS}/${next.uid}/payments/${payment.id}`), {
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      subscriptionId: next.subscriptionId,
      createdAt: Timestamp.fromMillis(payment.createdAt),
    });
  }
  tx.set(evRef, { type: event.type, subscriptionId: event.subscriptionId, outcome: "applied", receivedAt: stamp });
  return { status: 200, outcome: "applied" };
}

// ------------------------------------------------------------------ cancel

/** Cancels at the end of the paid period (Pro stays until then; the webhook then ends it). */
export async function cancelSubscription(db: Firestore, client: RazorpayClient, uid: string, now = Date.now()) {
  const account = await db.doc(`${BILLING_ACCOUNTS}/${uid}`).get();
  const subscriptionId = account.get("subscriptionId") as string | undefined;
  const status = account.get("status") as string | undefined;
  if (!subscriptionId || !status || !LIVE_STATUSES.includes(status) || account.get("cancelRequested") === true) {
    throw new BillingError("no_subscription");
  }
  // Only a subscription recorded as this user's can be cancelled by them.
  const sub = await db.doc(`${SUBSCRIPTIONS}/${subscriptionId}`).get();
  if (!sub.exists || sub.get("uid") !== uid) throw new BillingError("no_subscription");
  await client.cancelSubscription(subscriptionId, true);
  const stamp = Timestamp.fromMillis(now);
  await db.runTransaction(async (tx) => {
    tx.set(db.doc(`${SUBSCRIPTIONS}/${subscriptionId}`), { cancelRequested: true, updatedAt: stamp }, { merge: true });
    tx.set(db.doc(`${BILLING_ACCOUNTS}/${uid}`), { cancelRequested: true, updatedAt: stamp }, { merge: true });
  });
  return { subscriptionId };
}

// ------------------------------------------------------------------ overview (status + history)

export interface BillingOverview {
  subscription: { status: string; currentEnd: string | null; cancelRequested: boolean } | null;
  payments: { id: string; amount: number; currency: string; status: string; createdAt: string }[];
}

export async function billingOverview(db: Firestore, uid: string): Promise<BillingOverview> {
  const ref = db.doc(`${BILLING_ACCOUNTS}/${uid}`);
  const [acc, pays] = await Promise.all([ref.get(), ref.collection("payments").orderBy("createdAt", "desc").limit(24).get()]);
  const end = acc.get("currentEnd") as number | null | undefined;
  return {
    subscription: acc.exists
      ? { status: String(acc.get("status") ?? "unknown"), currentEnd: end ? new Date(end).toISOString() : null, cancelRequested: acc.get("cancelRequested") === true }
      : null,
    payments: pays.docs.map((d) => ({
      id: d.id,
      amount: Number(d.get("amount")) || 0,
      currency: String(d.get("currency") ?? "INR"),
      status: String(d.get("status") ?? "unknown"),
      createdAt: (d.get("createdAt") as Timestamp).toDate().toISOString(),
    })),
  };
}

// ------------------------------------------------------------------ reconciliation

/**
 * Re-reads a subscription from Razorpay's API and applies its current state (covers missed or
 * delayed webhooks). Uses the same transaction and rules as the webhook; the synthetic event id
 * makes a repeated run in the same second a no-op.
 */
export async function reconcileSubscription(db: Firestore, client: RazorpayClient, subscriptionId: string, now = Date.now()): Promise<WebhookResult> {
  const sub = await client.fetchSubscription(subscriptionId);
  const status = sub.status as RazorpayStatus;
  const event: SubscriptionEvent = {
    eventId: `reconcile_${subscriptionId}_${Math.floor(now / 1000)}`,
    type: "subscription.reconciled",
    createdAt: now,
    subscriptionId,
    status,
    currentEnd: typeof sub.current_end === "number" && sub.current_end > 0 ? sub.current_end * 1000 : null,
  };
  const parsed = parseSubscriptionEvent(
    { event: event.type, created_at: Math.floor(now / 1000), payload: { subscription: { entity: { id: subscriptionId, status, current_end: sub.current_end ?? null } } } },
    event.eventId
  );
  if (!parsed) return { status: 200, outcome: "ignored" };
  return db.runTransaction((tx) => applyEvent(db, tx, { ...parsed, createdAt: now }, null, now));
}

/** Our subscriptions that could still change (for reconciliation runs). */
export async function openSubscriptionIds(db: Firestore): Promise<string[]> {
  const snap = await db.collection(SUBSCRIPTIONS).where("status", "in", [...LIVE_STATUSES]).limit(500).get();
  return snap.docs.map((d) => d.id);
}
