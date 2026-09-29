# Billing plan (Phase 4) — Razorpay, ₹30/month

**Status: TEST mode on Preview only — not live.** Checkout, webhook, cancellation, payment history
and reconciliation are built and tested against a mocked Razorpay API and signed test events.
Live payments are impossible from configuration: `ALLOW_LIVE_PAYMENTS = false` and
`PRICING.paymentsEnabled = false` in code, any `rzp_live_` key or `RAZORPAY_MODE=live` disables
billing, and `VERCEL_ENV=production` disables billing entirely (every billing route returns 404).
Manual grants (`scripts/grant-pro.mjs`) keep working and are never shortened by billing.

| Module | Purpose | Tests |
|---|---|---|
| `lib/billing/config.ts` | `billingStatus()` — enabled only with `RAZORPAY_MODE=test`, an `rzp_test_` key, key secret, webhook secret and plan id, and **not** Production | `billing-unit.test.ts` |
| `lib/billing/webhook.ts` | `verifyWebhookSignature()` — HMAC-SHA256 of the raw body, constant-time compare | same |
| `lib/billing/subscription.ts` | `parseSubscriptionEvent()`, `applySubscriptionEvent()` — subscription state → entitlement | same |
| `lib/billing/razorpay.ts` | minimal REST client: create / fetch / cancel subscription (errors carry codes only) | same |
| `lib/billing/service.ts` | checkout, idempotent webhook transaction, cancel, overview, reconcile | `auth-emulator.test.ts` (Firestore emulator) |
| `app/api/billing/{status,checkout,webhook,cancel}` | routes (404 when billing is disabled) | emulator + `e2e-accounts.mjs` |
| `lib/billing/client.ts`, upgrade dialog, `/account/billing` | Razorpay Checkout, "activating…", status, cancel, payment history | e2e |
| `scripts/billing-reconcile.ts` | `npm run billing:reconcile -- --project algoverse-preview [--apply]` (refuses the Production project; dry run by default) | manual |

## Entitlement rules

| Razorpay subscription status | AlgoVerse |
|---|---|
| created, authenticated | Free (not charged yet) |
| active | Pro until `current_end` + 3-day grace |
| pending (renewal being retried) | Pro until `current_end` + 3-day grace |
| cancelled | Pro until `current_end` (the paid period), then Free |
| halted, paused, completed, expired | Free |

- Events older than the last one applied are ignored (webhooks can arrive out of order).
- A longer manual/comp grant is never shortened by billing.
- The Firestore `entitlements/{uid}` document keeps its current shape
  `{ plan, expiresAt, source }`, so `lib/entitlements.ts` and every Pro check stay unchanged.

## Flow (implemented; TEST mode on Preview only)

1. **Checkout** — `POST /api/billing/checkout` (signed in, same-origin, **verified email**, no
   active subscription already): the server creates the Razorpay subscription for
   `RAZORPAY_PLAN_ID` and, in one transaction, writes `subscriptions/{sub_id} = { uid, status:
   "created", lastEventAt: 0 }` and `billingAccounts/{uid}`. The uid comes from the session only.
2. **Browser** opens Razorpay Checkout with the subscription id and the public key id only.
3. **Checkout callback** grants nothing. The dialog shows "activating…" and polls
   `/api/me/entitlements` for up to 60 s; if the webhook hasn't arrived it says Pro switches on
   when Razorpay confirms.
4. **Webhook** — `POST /api/billing/webhook` (no session; authenticated by signature). Raw body
   (max 256 KB) → signature check (400 if bad/missing) → `x-razorpay-event-id` required → one
   Firestore transaction:
   - `webhookEvents/{eventId}` exists → 200 `duplicate`, nothing changes;
   - the uid comes from **our** `subscriptions/{sub_id}` record — a signed event for an unknown
     subscription changes nothing;
   - `applySubscriptionEvent` (stale/out-of-order events ignored) → write the subscription,
     `entitlements/{uid}`, `billingAccounts/{uid}`, the payment row
     (`billingAccounts/{uid}/payments/{pay_id}`) and `webhookEvents/{eventId}` together.
   Non-subscription events are acknowledged and ignored. Logs contain event type and outcome only.
5. **Cancel** — `POST /api/billing/cancel` (own subscription only) asks Razorpay to cancel at the
   end of the cycle; Pro continues until `current_end`, then the `subscription.cancelled`/
   `completed` webhook (or reconciliation) ends it.
6. **Reconciliation** — `npm run billing:reconcile` fetches each open subscription from Razorpay and
   applies its current state through the same transaction (covers missed webhooks). No cron.

All billing collections (`subscriptions`, `billingAccounts` + `payments`, `webhookEvents`,
`entitlements`) are server-only in `firestore.rules` (catch-all deny; tested).

## Razorpay test dashboard setup (owner)

1. Razorpay Dashboard in **Test mode** → Subscriptions → Plans → create ₹30 / monthly → copy the plan id.
2. Settings → API Keys (Test) → generate `rzp_test_…` key id + secret.
3. Settings → Webhooks (Test) → URL `https://algo-verse-git-feat-accounts-firebase-algo-verse1.vercel.app/api/billing/webhook`,
   a new random secret, events: `subscription.authenticated`, `.activated`, `.charged`, `.pending`,
   `.halted`, `.cancelled`, `.completed`, `.paused`, `.resumed`.
4. Vercel → Environment Variables → **Preview**, branch `feat/accounts-firebase` only → the five
   variables below (paste values in the dashboard; never in chat or files in the repo). Redeploy the Preview.
5. **Webhook reachability:** the Preview is behind Vercel Authentication, so Razorpay's POST
   gets 401 until the owner decides how to let it through (e.g. Vercel's Protection Bypass for
   Automation appended to the webhook URL, or a deployment-protection exception). Until then,
   Pro after a Preview test payment arrives only via `npm run billing:reconcile -- --project algoverse-preview --apply`.

## Environment variables (server-only; set in Vercel **Preview** scope only for testing)

`RAZORPAY_MODE=test`, `RAZORPAY_KEY_ID=rzp_test_…`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`RAZORPAY_PLAN_ID`. Optional `RAZORPAY_API_BASE` is honoured only for `http://127.0.0.1`/`localhost` (tests) and never
on Production. None of these are `NEXT_PUBLIC_`; the key id reaches the browser only in the
status/checkout responses. Never add live keys, and never add any of these to the Production scope, until
the owner approves going live.

## Before live payments — owner decisions / verification (not legal advice)

- **Hosting:** Vercel Hobby is for non-commercial use. A paid product needs a plan that allows
  commercial use (e.g. Vercel Pro) or another host. This conflicts with "no paid infrastructure".
- **Razorpay account:** KYC/activation; Razorpay's website requirements (typically terms, privacy,
  refund/cancellation and contact pages) — verify on their current checklist.
- **Content rights:** Pro sells access to links to TakeUForward articles and Striver's YouTube
  videos, and an embedded YouTube player. YouTube API Services policy III.F.3.a says you must
  not charge users to watch content in an embedded player. Get permission or change what Pro
  includes before charging. See docs/SAAS_ARCHITECTURE.md.
- **DPDP Act (India):** any-age sign-ups; under-18 users need verifiable parental consent — lawyer review.
- **GST / invoices / refunds policy** — accountant review.
