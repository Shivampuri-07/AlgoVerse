# Billing plan (Phase 4) — Razorpay, ₹30/month

**Status: not live.** No checkout, no payment route, no Razorpay keys in the codebase.
`PRICING.paymentsEnabled = false` (lib/plans.ts) and `ALLOW_LIVE_PAYMENTS = false`
(lib/billing/config.ts). Pro is granted only manually (`scripts/grant-pro.mjs`).

What exists now is the tested, pure core that the future routes will use:

| Module | Purpose | Tests |
|---|---|---|
| `lib/billing/config.ts` | `billingStatus()` — checkout allowed only if approved in code, test mode, test key, all secrets set, and **not** Production. Live mode can't be switched on from env vars. | `scripts/tests/billing-unit.test.ts` |
| `lib/billing/webhook.ts` | `verifyWebhookSignature()` — HMAC-SHA256 of the raw body, constant-time compare | same |
| `lib/billing/subscription.ts` | `parseSubscriptionEvent()`, `applySubscriptionEvent()` — Razorpay subscription state → `entitlements/{uid}` | same |

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

## Planned flow (to build after approval, in **test mode on Preview only**)

1. **Start checkout** — `POST /api/billing/checkout` (signed-in, same-origin, `billingStatus().enabled`):
   the server creates the Razorpay subscription for `RAZORPAY_PLAN_ID` and writes
   `subscriptions/{sub_id} = { uid, status: "created", lastEventAt: 0 }` **before** returning the
   id. The uid is taken from the session, never from the browser.
2. **Browser** opens Razorpay Checkout with the subscription id and the public key id only.
3. **Checkout callback** — the client posts the payment id / subscription id / signature to the
   server, which verifies it and shows "activating…". It does **not** grant Pro; only the webhook does.
4. **Webhook** — `POST /api/billing/webhook` (no session; authenticated by signature):
   read the raw body → `verifyWebhookSignature` → `parseSubscriptionEvent` with the
   `x-razorpay-event-id` header → one Firestore transaction:
   - `webhookEvents/{eventId}` exists → return 200, do nothing (duplicate delivery);
   - load `subscriptions/{sub_id}` and `entitlements/{uid}` → `applySubscriptionEvent`;
   - write the record, the entitlement and `webhookEvents/{eventId}` together.
   Always return 2xx quickly for verified events (including ignored ones) so Razorpay stops
   retrying; 400 for a bad signature. Log event type and outcome only — never payloads.
5. **Cancel** — `POST /api/billing/cancel` cancels at the end of the cycle; access continues until then.
6. **Reconciliation** — a manual script that lists the account's subscriptions from Razorpay and
   re-applies their current state (covers missed webhooks). No cron needed on the free tier.

All collections involved (`subscriptions`, `webhookEvents`, `entitlements`) are already
server-only in `firestore.rules`.

## Environment variables (server-only; set in Vercel **Preview** scope only for testing)

`RAZORPAY_MODE=test`, `RAZORPAY_KEY_ID=rzp_test_…`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`RAZORPAY_PLAN_ID`. None of these are `NEXT_PUBLIC_`; the key id reaches the browser only in the
checkout response. Never add live keys, and never add any of these to the Production scope, until
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
