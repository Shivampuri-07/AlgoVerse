# AlgoVerse SaaS Architecture (Phase 0 audit and proposal)

Status: **Phase 0 approved with changes (2026-09-27). Phase 1 (accounts) implemented.**
Nothing in this document is legal, tax or financial advice.

## Decision record (2026-09-27, by the project owner)

| Question | Decision | Consequence |
|---|---|---|
| Database / auth | **Firebase** (Auth + Firestore), project `algoverse-f5b48` | Supersedes the Supabase recommendation below. The Postgres schema in section 4 becomes the Firestore layout further down. |
| Cloud sync | **Pro only** | Free users keep local-only progress (as today). Sync writes go through the server, which checks entitlement. |
| Payments | **Razorpay, monthly only, ₹30/month** | No annual plan. Plan price lives in config and env, not in code. |
| AI helper | **Requires login** | Per-user quotas (Phase 5). |
| Gemini tier | **Free tier** (no paid key) | The privacy policy must disclose that Google may use free-tier prompts to improve its products. Free-tier rate limits cap total AI capacity. |
| Paid infrastructure | **Declined for now** | Stays on Vercel Hobby and the Firebase Spark plan. **Vercel Hobby forbids commercial use, so this must be resolved before live payments** (section 10). |
| Free vs Pro (2026-09-28) | **All 455 DSA problems free; articles and Striver videos Pro** (plus cloud sync). Videos are link-outs to YouTube, with no embedded player (YouTube API policy III.F.3). | Article URLs and video ids are server-only (`data/articles.ts`, `data/striverVideos.ts`), served by `GET /api/resources/[id]` after a session and entitlement check (`learningResources`). The bundle scan verifies they never reach the browser. |
| In-app video player (2026-09-28) | **Pro users get two options: "Watch in AlgoVerse" (official YouTube IFrame Player API, privacy-enhanced host, no autoplay, YouTube controls/branding/ads untouched) and "Watch on YouTube" (unchanged link).** Owner decision, made **knowingly accepting the risk** that this conflicts with YouTube API policy III.F.3.a ("must not charge users to watch content in an embedded YouTube player"). | The video id reaches the browser only through `GET /api/resources/[id]` (session + `learningResources` entitlement). Free, signed-out and expired users never get it, and the player API isn't even loaded for them. Creator-disabled embedding (player errors 101/150) or load failures show a message with the YouTube link. Revisit before live payments. |
| Age | **Any age** | DPDP treats under-18s as children needing verifiable parental consent (obligations from 14 May 2027). Lawyer review needed before launch. |

### Implementation status (2026-09-28)

| Phase | Status |
|---|---|
| 1. Accounts | Done: email/password, verification (fixed-expiry escalating pause), Google Sign-In + linking, server sessions, account page. Tested on the emulators; Google linking confirmed by the owner on a Preview deployment. |
| 2. Cloud sync (Pro) | Done: outbox + change journal, server merge with §5 conflict rules (Firestore transactions), first-login import dialog, other-account switch with local backup, status indicator + account card, sync-aware reset/import, **theme preference sync (last write wins)**, **notes over 50,000 characters kept on the device and listed, never blocking other sync; two versions too long to merge are never truncated (each device keeps its own until the user picks one)**. Two-device, offline, theme and long-note browser tests (emulators). Not yet exercised on the real project. |
| 3. Plans & entitlements | Done: `lib/plans.ts` (APPROVED matrix, ₹30/month monthly, `learningResources` + `cloudSync` Pro features), `lib/entitlements.ts`, `/api/me/entitlements`, `/api/resources/[id]` (Pro articles/videos), `/pricing`, upgrade dialog, `/account/billing` (plan from the server, no real payments), account plan card, nav links. Payments remain Phase 4. |

### Firestore layout (replaces section 4 for implementation)

```
users/{uid}                          displayName, createdAt, updatedAt          client: owner get only
users/{uid}/progress/{problemId}     (Phase 2, Pro)                              client: owner read only
users/{uid}/bookmarks/{problemId}    (Phase 2, Pro)                              client: owner read only
users/{uid}/notes/{problemId_kind}   (Phase 2, Pro)                              client: owner read only
users/{uid}/meta/state               longest streak + legacy (Phase 2, Pro)     client: owner read only
entitlements/{uid}                   { plan, expiresAt, source } (Pro)          server only
subscriptions/{id}, payments/{id}, aiUsage/{uid_period}, webhookEvents/{id}   server only
```
All writes go through Next.js route handlers (Admin SDK) after `requireUser()`. Clients have
no write access anywhere (`firestore.rules`, tested in `scripts/tests/firestore-rules.test.mjs`).
Setup steps: `docs/ACCOUNTS_SETUP.md`.

---

*The original Phase 0 proposal follows, unchanged, for reference.*

Audit date: 2026-09-27. Branch audited: `feat/striver-youtube-integration` @ `f2d2ffe`.
Prices and limits below were read from the providers' official pages on the audit date and
change often. Re-check them before committing money.

---

## 1. Current architecture (what the code actually does)

| Area | Finding | Where |
|---|---|---|
| Framework | Next.js 15 (App Router), React 18, TypeScript, Tailwind, Radix/shadcn UI | `package.json` |
| State | One Zustand store with `persist` middleware | `lib/store.ts` |
| Persistence | **Everything personal is in one localStorage key**, `dsa-roadmap-storage` (JSON, `version: 2`). All reads and writes go through `lib/storage-adapter.ts`. | `lib/storage-adapter.ts` |
| Auth / DB | **None.** No auth library, no database, no cookies besides theme. | n/a |
| API routes | Only `app/api/ai/route.ts` (GET = "is AI configured", POST = streamed Gemini answer) | `app/api/ai/route.ts` |
| Gemini auth | None. Anyone can call `POST /api/ai`. Key is server-only (`GEMINI_API_KEY`, no `NEXT_PUBLIC_`). | `lib/ai/server.ts` |
| Gemini rate limit | In-memory sliding window, 15 req/min per IP (`x-forwarded-for`). **Per serverless instance**, so it resets on cold start and is not shared across instances. There is no daily cap and no token accounting. | `lib/ai/server.ts` `allowRequest` |
| AI input limits | Good: 12 messages, 8k chars/message, 12k chars code, 40k total, `maxOutputTokens: 4096`, 58s timeout, provider errors never echoed | `lib/ai/shared.ts`, route |
| AI chat history | React state only; not persisted | `components/ai/ai-helper.tsx` |
| PWA | Hand-written `public/sw.js` (`algoverse-v1`): cache-first `/_next/static`, network-first HTML with a copy of **every visited page** kept for offline, `/api/*` never intercepted | `public/sw.js` |
| Theme | Cookie `dsa-theme` (read on the server in `app/layout.tsx`); one-time migration from old localStorage key `theme` | `lib/theme.ts`, `components/providers/theme-provider.tsx` |
| Hosting | Vercel (README describes the free Hobby plan). No `vercel.json`. | `README.md`, `next.config.mjs` |
| Tests | `npm test` = AI route tests, service-worker tests, video tests (all passing on the audit date), plus `npm run validate:data` (passing) | `scripts/tests/` |

### A. Data stored in the browser

| Storage | Key | Contents | Sync to account? |
|---|---|---|---|
| localStorage | `dsa-roadmap-storage` | `completed` (problemId → ISO timestamp), `bookmarked` (ids), `notes`, `mistakes`, `code` (problemId → text), `streak` (`current`, `longest`, `lastActiveDate`, `activeDates`), `legacy` (progress from the old 152-problem dataset, keyed by **old** ids), `lastVisitedId` | Yes, except `lastVisitedId` (optional) |
| localStorage | `theme` | Legacy theme value, migrated once to the cookie | No |
| localStorage | `algoverse-install-dismissed-at` | PWA install prompt snooze | No (device-specific) |
| Cookie | `dsa-theme` | light / dark / system | Optional (preference) |
| Cache Storage | `algoverse-v1-*` | Static assets, icons, visited HTML pages, `/offline` | No |
| IndexedDB | none | n/a | n/a |

### B. Existing auth / database: none

### C. Problem IDs
455 problems in `data/a2zProblems.ts`, integer ids **1..455, unique, contiguous**, with a
separate `order`. Ids are the stable key for all progress. `data/legacyIdMap.ts` maps the
old starter-dataset ids (1..152) to A2Z ids.
**Old and new id spaces overlap**, so the `legacy` blob must never be merged into the
same table as current progress without a discriminator.

### D. Striver videos
`data/striverVideos.ts` is a static map `problemId → { videoId, title, start?, source }`
(376 of 455 problems mapped, 316 distinct videos). Read via `lib/videos.ts`. It is static
content and stays in the repository; it does not go into the database.

### E. Gemini auth and rate limiting
See the table above: unauthenticated, per-instance in-memory IP limit only. This is the
biggest cost risk once the site gets traffic, and it can't enforce per-user quotas.

### F. What must stay local for offline use
The whole problem dataset and video map (bundled JS), the Zustand store in localStorage
(it stays the **offline cache and source of truth for the UI**), cached pages, theme cookie.

### G. What becomes account-specific and synced
Completions, bookmarks, notes, mistakes, code, legacy progress, longest streak,
preferences (theme). AI usage and subscription records are **server-only**; they are
never written by the client.

### H. What could break when auth and sync are added

1. **Service worker caches every visited HTML page.** Account, billing and settings
   pages would be cached per device and shown to the next person using it, even after
   logout. Fix: exclude `/account`, `/billing`, `/auth/*` and `/api/*` from the page cache,
   and clear `algoverse-*-pages` on logout. Bump `VERSION`.
2. **`resetProgress()`** clears local state only. With sync, the cloud would bring the data
   back. It needs to write tombstones, and ask whether to reset the cloud too.
3. **`importProgress()`** replaces all state. It must become a merge, or an explicit
   "replace my cloud data" with confirmation.
4. **Shared devices.** Local data has no owner today. If user B logs in on a device that
   has user A's local progress, it must not merge silently. The sync layer needs an owner
   tag on local data.
5. **Hydration.** The store rehydrates manually after mount (`skipHydration`). Sync must
   start only after rehydration, or it will upload an empty state and overwrite the cloud.
6. **Streak `longest`** is `max(computed, previous)` and is not derivable from
   completions alone. It has to be synced as a max-merge value.
7. **Theme** is a server-read cookie. Syncing it needs care so the first paint doesn't flash.
8. **AI helper** currently works for anonymous users. Requiring login for AI changes UX.
   This is a product decision (see section 7).
9. **Vercel Hobby plan** (see section 10): taking payments on Hobby breaks Vercel's terms.

---

## 2. Proposed architecture

```
Browser / PWA (Next.js client)                     Vercel (Next.js server, Pro plan)
┌──────────────────────────────┐                  ┌────────────────────────────────────┐
│ Zustand store (localStorage) │◀── UI reads      │ middleware.ts: refresh auth cookie  │
│   = offline cache            │                  │ /api/sync      (push/pull deltas)   │
│ Sync outbox (localStorage)   │── HTTPS ───────▶ │ /api/ai        (auth + quota)       │
│ Supabase browser client      │   (cookies)      │ /api/billing/* (create subscription)│
│   (auth only, anon key)      │                  │ /api/webhooks/razorpay (HMAC)       │
└──────────────────────────────┘                  │ /api/account/export | delete        │
                                                  │ lib/entitlements.ts (single gate)   │
                                                  └──────────┬──────────────┬──────────┘
                                                             │              │
                                   ┌─────────────────────────▼──┐   ┌───────▼────────┐
                                   │ Supabase (Mumbai region)   │   │ Razorpay       │
                                   │  Auth (email + magic link) │   │ Subscriptions  │
                                   │  Postgres + RLS            │   └────────────────┘
                                   │  SQL functions: quota,     │   ┌────────────────┐
                                   │  entitlement, sync merge   │   │ Google Gemini  │
                                   └────────────────────────────┘   │ (paid tier)    │
                                                                    └────────────────┘
```

Principles:

- **Local-first.** The UI keeps reading the Zustand store, so every existing component
  works unchanged. Sync runs as a background layer: it pushes an outbox of changes and
  pulls newer server rows.
- **Static content stays static.** Problems and videos stay in the bundle. The database
  only stores `problem_id` integers.
- **One gate for paid features.** Every premium route calls
  `requireEntitlement(feature)`, which reads the user from the validated session and the
  plan from the database. The client never sends a user id or plan.
- **Provider-agnostic subscriptions.** A `subscriptions` row has a `provider` column
  (`razorpay` now, `google_play` later). Entitlement is computed from those rows, so an
  Android client can use the same backend.

---

## 3. Database and authentication comparison

| | **A. Supabase** (Auth + Postgres + RLS) | **B. Firebase** (Auth + Firestore) | **C. Clerk + Neon/Postgres** |
|---|---|---|---|
| Next.js integration | `@supabase/ssr` with cookie sessions, validated in middleware and route handlers | Client SDK + `firebase-admin` on the server. Server-side sessions need Admin session cookies (more custom code). | Very polished Next.js SDK. Needs a second vendor for the DB. |
| Auth features | Email/password, magic link, OTP, OAuth, email verification, password reset | Same set, very mature | Richest prebuilt UI |
| Data model fit | **Relational**: `(user_id, problem_id)` rows with unique keys, upserts, joins. Fits the current data exactly. | Document store. Fine for per-user docs; counters and cross-document constraints need transactions and rules. | Relational (Postgres) |
| User isolation | Row Level Security in SQL, testable with SQL tests | Security Rules language, testable with the emulator | App-level only, unless you add RLS yourself |
| Atomic AI quota without extra services | Yes: one SQL function with a row lock (`INSERT … ON CONFLICT … RETURNING`) | Yes: Firestore transaction (billed per read and write) | Yes, in Postgres |
| Webhook idempotency | Unique constraint on the provider event id | Doc id = event id, `create()` fails if it already exists | Unique constraint |
| Free tier (checked 2026-09-27) | 500 MB DB, 50,000 MAU, 5 GB egress, **projects pause after 1 week of inactivity**, **no backups**, 1-hour logs, 2 projects | Firestore 1 GiB stored, 50K reads/day, 20K writes/day, 10 GiB egress/month. Auth free up to 50K MAU. No pausing. | Clerk Hobby: 50,000 MRU/app. Neon: not verified here. |
| First paid step | Pro **$25/month** (includes $10 compute credit), 8 GB disk, 100K MAU, daily backups kept 7 days, PITR is an extra $100/month per 7 days | Blaze pay-as-you-go. Cost scales with reads and writes, so a sync that re-reads 455 rows per device can get expensive. | Clerk Pro $25/month (or $20/month billed annually), plus a DB plan |
| Backup / export | `pg_dump` anytime, standard SQL | Managed export to GCS (Blaze), proprietary format | Standard Postgres |
| Lock-in | Low: Postgres and SQL move to any host. Auth users can be exported. | High: data model and rules are Firestore-specific | Medium: two vendors |
| Android later | Official Kotlin SDK (`supabase-kt`), same RLS, or call the same Next.js APIs | Best-in-class Android SDKs | Clerk Android SDK exists |
| Vendors to manage | 1 | 1 | 2 |

Sources: [Supabase pricing](https://supabase.com/pricing),
[Supabase SMTP limits](https://supabase.com/docs/guides/auth/auth-smtp),
[Firebase pricing](https://firebase.google.com/pricing), [Clerk pricing](https://clerk.com/pricing).

### Recommendation: **Option A, Supabase**, in the Mumbai (`ap-south-1`) region

Why it fits this project:

- The data is naturally relational and small: rows keyed by `(user, problem)`. Unique
  constraints make migration **idempotent for free**: re-importing is just an upsert.
- RLS gives database-level isolation, **and** all writes go through our Next.js API, so
  we get two layers of defence.
- AI quotas, webhook deduplication and entitlement checks are each one SQL function, so
  no Redis/Upstash is needed (and no extra cost or vendor).
- Plain Postgres means low lock-in and easy backups.
- One vendor for auth and data, separate from payments (Razorpay).

Caveats you should know about:

1. **The free tier is not suitable for paying customers.** Projects pause after 1 week of
   inactivity and have **no backups**. Plan to use the free tier for development and
   preview, and **Pro ($25/month) before launch**.
2. **The default email sender is limited to 2 emails/hour, and only to your own team's
   addresses.** Real signups need a custom SMTP provider (for example Resend, Postmark,
   Amazon SES or Brevo). This is a new vendor and a new cost/privacy item, which needs
   your approval. Their free tiers were not verified in this audit.
3. Supabase does not do rate limiting of our API. We do it in SQL (see section 8).

When Firebase would be the better choice: if the Android app were the main product, or
if you wanted zero fixed monthly cost for a long time and accepted Firestore's per-read
pricing and data-model lock-in.

---

## 4. Data model (Postgres, Supabase)

All tables have RLS enabled. Personal tables allow `select` only where
`user_id = auth.uid()`. **Writes to personal tables happen through the server's sync API**
(which uses the user's own session, so RLS still applies). Billing and usage tables
have **no client write policies at all**; only the service role writes them, from webhooks
and server functions.

```sql
profiles            (user_id uuid PK → auth.users ON DELETE CASCADE, display_name text,
                     created_at, updated_at, deletion_requested_at timestamptz,
                     age_confirmed_at timestamptz, marketing_consent boolean default false,
                     longest_streak int default 0, preferences jsonb default '{}')

user_progress       (user_id, problem_id smallint CHECK 1..455*, completed_at timestamptz,
                     deleted boolean default false,   -- tombstone for "un-complete"
                     client_updated_at timestamptz, updated_at timestamptz default now(),
                     PRIMARY KEY (user_id, problem_id))

user_bookmarks      (user_id, problem_id, deleted boolean, client_updated_at, updated_at,
                     created_at, PRIMARY KEY (user_id, problem_id))

user_notes          (user_id, problem_id, kind text CHECK (kind IN ('note','mistakes','code')),
                     content text CHECK (length(content) <= 20000),
                     version int default 1, deleted boolean,
                     client_updated_at, created_at, updated_at,
                     PRIMARY KEY (user_id, problem_id, kind))

user_legacy_progress(user_id PK, data jsonb, updated_at)   -- old 152-problem ids, kept verbatim

user_activity       -- NOT stored: active dates are derived from user_progress.completed_at
                    -- (same as today's lib/migrate-progress.ts collectActiveDates). Only
                    -- longest_streak is stored (max-merge), on profiles.

subscriptions       (id uuid PK, user_id, provider text ('razorpay'|'google_play'|'manual'),
                     provider_customer_id, provider_subscription_id UNIQUE, plan_id text,
                     status text, current_period_start, current_period_end,
                     cancel_at_period_end boolean, cancelled_at, ended_at,
                     raw_last_event jsonb, created_at, updated_at)

payments            (id, user_id, subscription_id, provider_payment_id UNIQUE, amount_paise int,
                     currency, status, method text, invoice_id, created_at)   -- no card data, ever

webhook_events      (provider, event_id, received_at, processed_at, error text,
                     PRIMARY KEY (provider, event_id))

ai_usage            (user_id, period_key text, -- e.g. '2026-09-27' (IST day) or '2026-09'
                     requests int, input_tokens bigint, output_tokens bigint, updated_at,
                     PRIMARY KEY (user_id, period_key))

ai_requests_inflight(user_id, started_at)   -- optional concurrency cap (max 2 in flight)
```

\* Keep the problem-id check loose (`> 0`) or source it from a `problem_ids` reference
table, so adding problems later doesn't need a migration of user data.

Size estimate: a heavy user has at most 455 progress rows + 455 bookmarks + notes. That
is roughly tens of KB, and far less when notes are small. The 500 MB free DB is
comfortable for development; exact user capacity depends on note sizes.

---

## 5. Cloud sync and migration of existing local data

**Keep `dsa-roadmap-storage` exactly as it is.** It stays the offline cache. Add:

- `algoverse-sync-meta`: `{ ownerUserId, lastPulledAt, importedAt }`
- `algoverse-sync-outbox`: queue of pending changes `{ entity, problemId, kind?, value, clientUpdatedAt }`

Store actions (`setCompleted`, `toggleBookmark`, `setNote` …) keep their signatures; a
small subscriber records each change in the outbox. Nothing is ever cleared from
localStorage by sync.

### First login on a device that has local data
1. After rehydration, detect local data (`completed`, `bookmarked`, notes, legacy non-empty).
2. If `ownerUserId` is empty: show **"Import this device's progress into your account?"**
   with counts. Choices: *Import and merge* (default) / *Keep on this device only* /
   *Decide later*. Nothing is deleted either way.
3. If `ownerUserId` is a **different** user: never auto-merge. Offer to *switch to
   the cloud data for this account* (local data for the other user is kept in a backup key)
   or to *import anyway*.
4. Import = POST the full local snapshot to `/api/sync/import`. The server runs a merge
   in one transaction (rules below). Because every row has a natural key, **re-running the
   import is harmless** (idempotent). If the network fails midway, nothing is committed, and
   the client retries.

### Conflict rules
| Data | Rule |
|---|---|
| Completion | Completed wins over "never touched". Keep the **earliest** `completed_at`. An explicit un-complete is a tombstone with a timestamp, and it wins only if it is newer than the completion. |
| Bookmark | Last write wins by `client_updated_at` (tombstones for removal). |
| Notes / mistakes / code | Optimistic versioning: client sends `baseVersion`. If the server version moved **and** the text differs, the server keeps both: newer text first, then `--- Conflicting copy from <device/date> ---` and the other text. Nothing is silently lost. Identical text = no-op (no duplicates). |
| Longest streak | `max(local, cloud)` |
| Active dates / current streak | Recomputed from merged completions (no separate records, so no duplicates) |
| Legacy blob | Union per key, earliest completion wins, notes concatenated when they differ |
| Preferences | Last write wins |

### Ongoing sync
Debounced push of the outbox (~2 s after the last change, plus on `online` and on
visibility change), then pull rows with `updated_at > lastPulledAt`. Timestamps from the
server are used for pulls, and client timestamps only to break ties. Status shows in the UI:
*Synced · Syncing… · Offline, changes saved on this device · Sync failed (Retry)*.
Offline: everything keeps working against localStorage, and the outbox flushes when back
online.

---

## 6. Authentication

- Supabase Auth, **email + password with email verification, plus magic link** as the
  recovery and passwordless option. Google OAuth is optional later.
- `@supabase/ssr`: HTTP-only cookies refreshed in `middleware.ts`. Route handlers call
  `supabase.auth.getUser()` (which validates with the auth server), never trusting a
  decoded cookie or a client-sent id.
- Public pages (dashboard, problems, topics, videos) need **no login**. Login is required
  for sync, AI quotas (see decision 5) and billing.
- Keys: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public by design,
  and protected by RLS). `SUPABASE_SERVICE_ROLE_KEY` is **server only** and used only in
  webhook handlers and account deletion.

---

## 7. Free vs Pro (proposal, not final)

All values live in one file, `lib/plans.ts` (plan ids, quotas, feature flags, display
prices), which the server reads for enforcement and the UI reads for display. Prices
shown on the pricing page come from the Razorpay plan ids configured in env vars, not
from hardcoded numbers.

| Feature | Free | Pro | Recurring value | Extra cost to you |
|---|---|---|---|---|
| 455 problems, search, filters, topics, random | ✓ (no login) | ✓ | – | none (static) |
| Striver videos | ✓ | ✓ | – | none (YouTube embeds) |
| Progress, bookmarks, streaks on this device | ✓ | ✓ | – | none |
| **Account + cloud sync of progress, notes, bookmarks** | ✓ **(recommended free)** | ✓ | High (retention) | very low (tiny rows) |
| Notes / mistakes / code per problem | ✓ (size-limited) | ✓ larger limits | Medium | low |
| AI helper: hints, approach, complexity | e.g. 5/day (dev example) | e.g. 60/day, 1,000/month fair use (dev example) | High | **Gemini tokens (main cost)** |
| AI "Debug my code" (larger inputs) | e.g. 2/day | included in Pro quota | High | higher tokens |
| Advanced progress analytics (topic weakness, pace, time-to-finish) | basic stats | ✓ | High | low (server compute) |
| Personalised roadmap (AI-generated plan) | – | ✓ (rate-limited) | High | Gemini tokens |
| Interview prep (mock-interview mode, revision lists from mistakes) | – | ✓ | High | Gemini tokens |
| Data export (JSON), account deletion | ✓ | ✓ | – (legal right) | none |

**Why sync should stay free (recommendation):** the core journey you described ("logs in
on phone, same progress") is the reason to create an account. Putting users' own notes
behind a paywall hurts trust and signups, while costing almost nothing to serve. Pro should
sell **AI depth, analytics and interview prep**, which are the features that actually cost
you money.

**No "unlimited AI" wording.** The pricing page should say "higher daily AI limits
(fair use)" and show the numbers.

### Unit economics check (why the quotas matter)
Gemini paid-tier list prices ([source](https://ai.google.dev/gemini-api/docs/pricing),
2026-09-27):
`gemini-3.8-flash` $0.75 / 1M input and $3.75 / 1M output tokens until 2026-12-31, then
**$1.50 / $7.50 from 2027-01-01**. `gemini-3.5-flash-lite` $0.30 / $2.50.

A typical request here is about 2k input and about 800 output tokens (thinking tokens bill
as output, so this is an assumption to measure). That is roughly **$0.0045 per request now
and $0.009 from 2027** on 3.8 Flash. So a Pro user making 300 requests/month costs about
$1.35 now, or **$2.70 in 2027**. That is a large share of an illustrative ₹99/month price,
before the Razorpay fees of about 2.9% on card subscriptions + 18% GST on fees. **Quotas
and the default model must be set from measured token usage.** The code will record tokens
per request so you can decide with real data.

---

## 8. AI cost control (no new vendors)

- `POST /api/ai` → `requireUser()` → `consume_ai_quota(feature)`: a SQL function that, in
  one statement, increments `ai_usage` for the current IST day and month **only if** under
  the plan limit, and returns allowed/remaining. Row-level locking makes concurrent requests
  unable to overshoot (a test will fire N parallel requests).
- In-flight cap per user (e.g. 2) to stop parallel floods.
- After the stream finishes, record `usageMetadata` token counts. If the request failed before
  any text, refund the request count.
- Keep the existing IP limiter as a cheap first layer for anonymous traffic.
- **Global daily budget breaker:** a sum of today's tokens across users. Above a
  configured ceiling, free-tier AI pauses first. You also need a Google Cloud billing
  budget alert (manual step).
- **Period resets need no cron:** the `period_key` is the date, so a new day is a new row.
- Keep all existing validation (sizes, timeouts, safe errors).
- **Gemini free tier vs paid tier:** Google's pricing page says free-tier content is
  *"used to improve our products"*; paid-tier content is not. Students paste their own
  code and questions. **Recommendation: use a paid (billing-enabled) Gemini key in
  production** and say so in the privacy policy. Keep the free key for development.

---

## 9. Payments

### Provider comparison (India)

| | **Razorpay Subscriptions** | Cashfree Subscriptions | Stripe India |
|---|---|---|---|
| Recurring methods | Cards (tokenised), **UPI AutoPay**, eMandate | Card e-mandate, UPI AutoPay, NACH | Not evaluated: new-account availability in India was not verified |
| Fees (published) | 2% platform fee (domestic), **+0.9% for card subscriptions**, UPI/eMandate subscription pricing "on request", 18% GST on fees, no setup/AMC | 1.95% standard. Subscriptions: per-mandate/per-debit flat fees (e.g. UPI AutoPay ₹7.5 + ₹5 under ₹1000). | – |
| Monthly and annual | Yes (plan `period` + `interval`) | Yes | – |
| Webhooks | `subscription.authenticated/activated/charged/pending/halted/cancelled/completed/updated/paused/resumed` + payment and refund events, HMAC-signed | Yes, signed | – |
| States | created → authenticated → active → (pending → halted) / cancelled / completed / expired / paused | similar | – |
| Individual onboarding | Personal PAN + Aadhaar + bank account accepted for unregistered/individual businesses. KYC is online, typically 1-3 business days (per Razorpay). Website policy pages are usually reviewed. | similar | – |

Sources: [Razorpay pricing](https://razorpay.com/pricing/),
[Razorpay Subscriptions](https://razorpay.com/docs/payments/subscriptions/),
[states](https://razorpay.com/docs/payments/subscriptions/states/),
[webhooks](https://razorpay.com/docs/payments/subscriptions/subscribe-to-webhooks/),
[payment methods](https://razorpay.com/docs/payments/subscriptions/supported-payment-methods/),
[KYC docs](https://razorpay.com/docs/payments/business-types-kyc-documents/?preferred-country=IN),
[Cashfree pricing](https://www.cashfree.com/payment-gateway-charges/).

UPI AutoPay: mandates up to ₹1,00,000, frictionless (no extra authentication) debits up to
₹15,000, per Razorpay's docs. The illustrative prices are well within that.

**Recommendation: Razorpay Subscriptions.** It has the most mature docs and test mode, a
subscription state machine that maps cleanly to entitlements, and support for individuals.
Cashfree's flat per-debit subscription fees could be cheaper at ₹99 price points. Worth a
quote comparison once you have volume. Because of the provider-agnostic design, switching
later only means one new adapter.

Simpler alternative for launch: **annual plan as a one-time payment** (Razorpay Orders),
with no mandate and no renewal failures, plus a monthly subscription added later. Your call.

### Flow
1. The logged-in user clicks *Upgrade (monthly/annual)*. `POST /api/billing/subscribe`
   `{ planKey }` goes out. The server maps `planKey` → Razorpay `plan_id` (from env), creates
   the subscription with `notes.user_id`, and stores a `created` row.
2. The client opens Razorpay Checkout with the `subscription_id`. On success, the client
   posts `{payment_id, subscription_id, signature}` to `/api/billing/verify`, and the server
   verifies the HMAC with the key secret. This only produces a quick "processing" UI.
   **Access is granted from the webhook, or from the server re-fetching the subscription
   from the Razorpay API.** A redirect or client callback is never enough.
3. `POST /api/webhooks/razorpay`: verify `X-Razorpay-Signature` (HMAC-SHA256 of the **raw
   body** with the webhook secret) and insert the event id into `webhook_events`. A duplicate
   id gets a 200 and is ignored. For ordering, **re-fetch the subscription from the Razorpay
   API** and store its canonical state, so late or out-of-order events can't regress status.
4. Entitlement (`lib/entitlements.ts`, mirrored as a SQL function):

| Provider status | Pro access |
|---|---|
| created / authenticated (not yet charged) | No |
| active | Yes, until `current_period_end` |
| pending (retrying failed charge) | Yes, grace until `current_period_end` + N days (configurable, e.g. 3) |
| halted | No (show "payment failed, update method") |
| cancelled with `cancel_at_cycle_end` / cancelled after paying | Yes **until `current_period_end`**, then no |
| completed / expired | No |
| refunded (full) | No, from refund time |

5. The billing page shows plan, status, period end, payment history from `payments`, and
   cancel (at period end) through Razorpay's API.

---

## 10. Hosting: action required

Vercel's fair-use guidelines: *"Hobby teams are restricted to non-commercial personal use
only"*, and *"any method of requesting or processing payment from visitors"* counts as
commercial ([source](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)).
**Before the pricing page or checkout goes live, the Vercel project must be on Pro
($20 per developer seat per month, plus usage beyond included credit)**
([source](https://vercel.com/docs/plans/hobby)). Development and test-mode work can
continue on Hobby.

---

## 11. Privacy and security

Legal context (not legal advice; a lawyer must review):

- **DPDP Act 2023 + DPDP Rules 2025** (notified 13 Nov 2025). Commencement is phased:
  Board-related rules from 14 Nov 2025, consent-manager provisions from 14 Nov 2026, and
  **most data-fiduciary obligations from 14 May 2027** (notice, consent, security
  safeguards, breach intimation to the Board and affected users with a detailed report
  within 72 hours, grievance redressal, children's data). Sources:
  [PIB](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2190014),
  [EY summary](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025).
  Building to these standards now is cheaper than retrofitting later.
- **Children: this matters for a student product.** Under DPDP a "child" is under 18,
  and processing their data requires verifiable parental consent. Many DSA learners are
  18+, but school students exist. At minimum: an age confirmation at signup, and a lawyer's
  advice on whether to restrict accounts to 18+ or build a parental-consent flow.
- Consumer protection (e-commerce rules: grievance officer, clear pricing and refund
  terms), GST invoicing and record retention: CA and lawyer review.

Technical measures planned:

- Minimal data: email, optional display name, learning data. No phone, location or contacts.
- RLS + server-side checks. There are no client write policies on subscriptions, payments or
  usage.
- Secrets only in Vercel env vars (separate Development / Preview / Production values).
  Add a build check that fails if `GEMINI|SERVICE_ROLE|RAZORPAY_KEY_SECRET|WEBHOOK_SECRET`
  names or values appear in `.next/static`.
- Logs contain codes and ids only: no emails, note contents, prompts or payment payloads.
- Service worker: never cache account/billing pages or `/api/*`, and clear the page cache on logout.
- Security headers: add CSP (allowing Razorpay checkout and youtube-nocookie), HSTS,
  `frame-ancestors`.
- Export: `GET /api/account/export` returns JSON of the user's own rows (profile,
  progress, bookmarks, notes, legacy, subscription summary, AI usage counts). It does not
  include secrets or raw provider payloads.
- Deletion: re-authenticate (recent login or email OTP), cancel the Razorpay subscription
  through the API, and delete personal rows plus the auth user. **Payment and invoice
  records needed for tax are kept**, pseudonymised by removing the email and name link
  (retention period to be confirmed by your CA). The UI explains this.
- Third-party processors to list in the privacy policy: Vercel (hosting), Supabase
  (auth/DB), Razorpay (payments), Google Gemini (AI prompts: problem metadata, the student's
  questions and code), the email/SMTP provider, and YouTube (embedded videos, nocookie mode).
  No analytics or ads are planned without your approval.

---

## 12. Estimated monthly costs

| Item | Development | Launch (small) | Notes |
|---|---|---|---|
| Vercel | $0 (Hobby) | **$20+** (Pro, 1 seat) | Required for commercial use |
| Supabase | $0 (Free, pauses when idle) | **$25** (Pro) | Needed for backups and no pausing |
| SMTP provider | $0 (test) | $0-? | Not verified; choose after approval |
| Gemini | $0 (free key) | usage-based, see section 7 | Set a Google Cloud budget alert |
| Razorpay | $0 | ~2% (+0.9% card subscriptions) + GST on fees, per transaction | Per their pricing page |
| Domain | – | optional | The `*.vercel.app` domain works, but a custom domain looks more trustworthy |

**Fixed cost before the first rupee: about $45/month (~₹4,000; exchange rate varies) plus
Gemini usage.** At an illustrative ₹99/month, break-even on fixed costs is roughly 40-45
paying users, before AI costs.

---

## 13. Migrations, backups, rollback

- SQL migrations in `supabase/migrations/` (Supabase CLI), version-controlled. They are
  applied to a **separate dev project** first, then production. No destructive changes;
  columns are added, never dropped, in the same release.
- RLS tests with pgTAP (`supabase test db`) or the Node test runner against a local
  Supabase (`supabase start`, Docker).
- Backups: Pro daily backups kept for 7 days, plus a weekly `pg_dump` from GitHub Actions to
  private storage (optional, needs approval).
- App rollback: Vercel instant rollback to the previous deployment. Sync is additive, so
  rolling back the app never deletes cloud data, and localStorage is untouched.

---

## 14. Future Android

- The same Supabase Auth accounts (email, magic link, Google) through `supabase-kt`, or
  through the Next.js APIs with a bearer token (`Authorization: Bearer <access_token>`
  validated by `getUser(token)`).
- Entitlement is one server function, so Android asks `/api/me/entitlements`.
- Google Play: India has an **alternative billing program**, where the Play service fee is
  reduced by 4% when the user picks the alternative biller, with API integration and
  reporting requirements ([source](https://support.google.com/googleplay/android-developer/answer/13306652)).
  Whether web-bought Pro can simply unlock the app, or whether in-app purchase must also be
  offered, depends on current Play Payments policy. **Re-check this when the Android
  work starts.** Do not assume that Razorpay purchases exempt the app. Play purchases would
  become `provider='google_play'` rows, verified through the Play Developer API and Real-time
  Developer Notifications.

---

## 15. Implementation phases (after approval)

| Phase | Deliverable | Needs from you |
|---|---|---|
| 1 | Supabase client/server helpers, middleware, migrations (profiles + personal tables + RLS), login/signup/magic link/reset/logout, `/account`, SW cache exclusions, RLS isolation tests | Create a **dev** Supabase project and add its keys in Vercel/`.env.local`; SMTP choice |
| 2 | Sync engine (outbox, import dialog, merge SQL, status indicator), reset/import updated, two-session tests | – |
| 3 | `lib/plans.ts`, `lib/entitlements.ts`, pricing page, upgrade dialog, billing page (test data), `/api/me/entitlements` | Confirm feature matrix |
| 4 | Razorpay test-mode subscriptions, verify, webhooks, cancel, payment history, lifecycle tests | Razorpay account + test keys + test plans |
| 5 | Auth-aware AI quotas, token accounting, in-flight cap, budget breaker, premium AI endpoints | Paid Gemini key decision |
| 6 | Privacy, Terms, Refund pages (placeholders), export, deletion, consent at signup, launch checklist | Business details, lawyer/CA review |
| 7 | Preview testing, production Supabase, Vercel Pro, live keys **only on your explicit go-ahead** | Approvals |

---

## 16. Decisions needed from you

1. **Stack:** Supabase (recommended) or Firebase?
2. **Cloud sync free for all logged-in users** (recommended), or Pro-only?
3. **Payment provider:** Razorpay Subscriptions (recommended). Also: recurring monthly +
   annual, or start with a one-time annual pass?
4. **AI and login:** require login for any AI use (recommended: it enables per-user
   quotas; anonymous users can get e.g. 2 tries/day by IP), or keep anonymous AI?
5. **Gemini paid tier** in production (recommended, for privacy and reliability)?
6. **Accept these recurring costs** at launch: Vercel Pro (~$20) + Supabase Pro ($25) + SMTP.
7. **Age policy:** 18+ only, or a parental-consent flow (lawyer input)?
8. **SMTP provider** for auth emails (I'll compare two or three options when you approve).
