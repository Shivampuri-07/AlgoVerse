# Production release — status and checklist

**Status (2026-09-29): NOT released. Production is unchanged** (latest Production deployment
`7230f26`, 2026-09-28). This file records what has been verified on branch
`feat/accounts-firebase` and what still blocks a Production release. A working Preview is not, by
itself, a reason to release.

## What is on the branch (not in Production yet)

Accounts (Firebase), Pro cloud sync (size-bounded), per-account local workspaces (account
isolation), Pro learning resources (articles + videos + in-app player), plans/pricing UI (no
payments), Razorpay subscription billing in TEST mode (disabled on Production by code; not live), AI helper behind sign-in + verified email with
Free 10/day · Pro 50/day · 5/min · whole-app daily cap, Google sign-in domain diagnostics, and
Preview Gemini-key isolation (`GEMINI_KEY_SCOPE`).

## Verified (with evidence)

| Area | Evidence |
|---|---|
| Unit tests | `npm test` — 149 pass (43 + 9 + 14 + 48 + 15 + billing 8 + 12) |
| Firebase emulator tests | `npm run test:firebase` — rules 9/9, API 32/32 (8 billing) |
| Browser tests | `npm run test:e2e` — 43/43 (incl. mocked-Razorpay checkout → webhook → cancel) |
| Types / lint / data / build | `tsc --noEmit`, `npm run lint`, `npm run validate:data` (RESULT PASS, VIDEOS PASS), `npm run build` — pass |
| Bundle secrets | `npm run check:secrets` — no server secret (Production and Preview keys checked) and none of 643 Pro links in browser files |
| Local browser audit (production build) | manifest + icons, service worker scope/control, dashboard, search, difficulty filter, topics, random problem, practice links, completion/streak/bookmark/note persistence, export → import, dark theme, offline (cached page, `/offline` fallback, `/api` never cached), 390px no horizontal overflow on 10 pages, mobile navigation/scroll |
| Repo secret scan | tracked files: no real API key/private key/token (only test fixtures); local git history (29 commits, all local + remote-tracking branches): none |
| Preview isolation | Firebase `algoverse-preview` (separate web app, service account, rules = repo rules, Email/Password + Google on, stable branch host authorised); Vercel Preview variables branch-scoped; Preview Gemini cannot fall back to the shared key (code guard + placeholder) |
| Production Firebase (read-only) | live Firestore rules identical to repo `firestore.rules`; Email/Password + Google enabled; `algo-verse-phi.vercel.app` authorised |
| Owner-reported | Google sign-in and account isolation on the Preview (tested by the owner) |

## Not yet verified

- **Gemini on the Preview with a real Preview key** — no Preview key exists yet (placeholder).
- Live Preview AI checks: verified user answer, unverified denial, signed-out denial, limits and
  the 30/day cap against real Firestore — covered locally (unit + emulator + e2e), not live.
- Real devices (iOS/Android install, safe-area on a notched phone) — only headless Chrome.
- Billing against the real Razorpay test sandbox (no test keys yet) and webhook delivery through
  Vercel protection — see docs/BILLING.md.
- Remote-only Git refs on GitHub (e.g. PR refs) were not scanned.

## Blockers before a Production release (owner decisions)

1. **Hosting plan:** Vercel Hobby forbids commercial use. A paid product needs a plan that allows it.
2. **YouTube policy:** the Pro in-app player conflicts with YouTube API Services policy III.F.3.a
   (no charging to watch in an embedded player) — decide before charging.
3. **Content rights:** Pro sells access to TakeUForward/Striver links — permission or a different Pro offer.
4. **Legal:** DPDP (any-age sign-ups; under-18 consent), privacy policy, terms, refunds — lawyer review.
5. **Behaviour changes for existing users** (announce them): the AI helper now needs a verified
   account; after logging out, the signed-out view shows signed-out progress (each account's
   progress comes back on login; never deleted).
6. **Production AI cap:** Production has no `AI_GLOBAL_DAILY_LIMIT`, so the default 500/day applies —
   set it to what the Production key's free quota allows.

## Release checklist (when approved)

1. Rerun on the release commit: `npm test`, `npm run test:firebase`, `npm run test:e2e`,
   `npx tsc --noEmit -p .`, `npm run lint`, `npm run validate:data`, `npm run build`, `npm run check:secrets`.
2. Preview: real Preview Gemini key + `GEMINI_KEY_SCOPE=preview`; redeploy; test AI live
   (verified/unverified/signed-out, limits); `/api/auth/diagnostics` all green.
3. Production Firebase: rules already match the repo — confirm again right before release
   (`firestore.rules` unchanged since?); optionally remove the Preview hostnames from Production's
   Authorized domains (Preview now has its own project).
4. Production Vercel variables (Production scope only): add `AI_GLOBAL_DAILY_LIMIT`; do **not** add
   `GEMINI_KEY_SCOPE` (not needed outside Preview); keep payments off (no `RAZORPAY_*`; billing is also code-disabled on Production). Going live
   needs a separate, explicit owner approval and a code change (`ALLOW_LIVE_PAYMENTS`).
5. Open a PR `feat/accounts-firebase → main`; review; merge only with explicit approval.
6. After the Production build: `/api/auth/diagnostics` (essentials only), sign in with email and
   Google on `algo-verse-phi.vercel.app`, open a problem, sync as a Pro test account, ask one AI question.
7. Rollback plan: Vercel → Deployments → promote the previous Production deployment (`7230f26`).
   Local progress is never deleted by the app; Firestore data is additive.
