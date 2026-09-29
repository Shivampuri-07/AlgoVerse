# Preview testing guide (safe setup)

Goal: test accounts, Pro and the AI helper on a Vercel **Preview** of `feat/accounts-firebase`
without touching Production: no change to Production environment variables, the Production
Firebase project (`algoverse-f5b48`) or its data, and no public access to the Preview.

Everything below is done by the owner in the Vercel, Firebase and Google AI Studio consoles.
Never paste keys or the service-account file into chat, an issue or a commit.

## Why a separate Firebase project

The app talks to whichever Firebase project its environment variables name — nothing is
hard-coded. If the Preview uses the Production variables, then Preview sign-ups, Pro grants,
synced data and **AI usage counters** all land in Production Firestore, and Preview and
Production share one AI daily cap. A separate **Preview project** isolates all of that.

## 1. Create the Preview Firebase project (Firebase console, free Spark plan)

1. **Add project** → e.g. `algoverse-preview` (Analytics not needed). Note its project ID.
2. **Authentication → Get started → Sign-in method**: enable **Email/Password**; enable
   **Google** if you want to test it (choose a support email).
3. **Authentication → Settings → Authorized domains → Add domain**: the branch URL
   `algo-verse-git-feat-accounts-firebase-algo-verse1.vercel.app`. Per-deployment hostnames
   (`algo-verse-<hash>-algo-verse1.vercel.app`) change on every push and are not covered, so
   **always test on the branch URL**. Never add `vercel.app`.
4. **Firestore Database → Create database** → production mode → location `asia-south1`.
5. **Publish the security rules** to this project only:
   `npx firebase-tools deploy --only firestore:rules --project <preview-project-id>`
   (`--project` is essential: `.firebaserc` defaults to the Production project.) Or paste
   `firestore.rules` into the console's Rules tab of the Preview project. No indexes are needed
   (`firestore.indexes.json` is empty).
6. **Project settings → General → Add app → Web** → copy the four config values.
7. **Project settings → Service accounts → Generate new private key** → save it as
   `.secrets/<preview-project-id>-adminsdk.json` (git-ignored). For local scripts, store it in a
   separate git-ignored env file — `.env.local` (the Production key) is left alone:
   `node scripts/set-service-account.mjs .secrets/<file>.json --project <preview-project-id> --env .env.preview.local`

## 2. Gemini key for Preview (Google AI Studio)

Create a key in a **separate Google Cloud project** (AI Studio → Get API key → Create API key
in a new project). Gemini rate limits are applied **per project, not per key**, so a key in the
same project as the Production key would share its free quota. Keep billing off on that project.

## 3. Vercel Preview variables (Settings → Environment Variables)

**Add new** variables with Environment = **Preview** and Git branch = **`feat/accounts-firebase`**.
Do not edit or re-scope existing variables: a branch-specific Preview variable overrides other
Preview variables of the same name, so Production entries stay untouched.

| Variable | Value | Secret? |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Preview web config `apiKey` | public |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `<preview-project-id>.firebaseapp.com` | public |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `<preview-project-id>` | public |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Preview web config `appId` | public |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | base64 of the Preview service-account JSON | **secret** |
| `GEMINI_API_KEY` | the Preview Gemini key | **secret** |
| `AI_GLOBAL_DAILY_LIMIT` | `30` (see §6) | no |

- Copy the base64 without printing it: `base64 -i .secrets/<file>.json | pbcopy` (macOS), then paste into Vercel.
- The four public values and the service account **must be from the same project** — otherwise
  the server reports `project_mismatch` and sign-in fails (a built-in safety check).
- Leave unset on Preview: `CLOUD_SYNC_PREVIEW_OPEN` (test real Pro instead), all `RAZORPAY_*`
  (payments stay off; `PRICING.paymentsEnabled` is false in code anyway), `GEMINI_MODEL`.
- Variable changes apply only to **new** deployments: redeploy the branch's latest Preview
  (Deployments → the Preview → Redeploy). That builds the Preview only.

## 4. Getting into the Preview privately (Vercel Deployment Protection)

Current state (checked): the Preview redirects to Vercel login — **Vercel Authentication** is on.
Keep it on; no setting change is needed:

- Log in at vercel.com in the same browser with the account that owns the `algo-verse1` team,
  then open the branch URL. Vercel remembers the login for that browser.
- **Don't** add the Preview to *Deployment Protection Exceptions* — that makes it public.
- **Shareable Links** give anyone holding the link access — only for someone you trust, and
  revoke it afterwards. **Protection Bypass for Automation** is a secret for scripted tests only.
- Password Protection isn't available on the Hobby plan.

## 5. Check the Preview uses the Preview project (before testing anything)

- `…/api/auth/diagnostics` on the branch URL (Preview only; names and booleans, no secrets):
  `environment: "preview"`, `adminCredentialState: "ok"`, `browserSignInConfigured: true`, and —
  once this repo's diagnostics change is deployed — `firebaseProjectId` = your Preview project,
  `aiGlobalDailyLimit: 30`, `hasGeminiKey: true`.
- Without that change: View Source on any page and search for `projectId` — it is the public
  web config.
- If it shows `algoverse-f5b48`, **stop**: the Preview is still on Production.

### If Google says "This site's domain isn't authorised for Google sign-in"

That message is Firebase's `auth/unauthorized-domain`: before opening Google, the Firebase SDK
checks the page's **hostname** against Authentication → Settings → **Authorized domains** of the
project whose web API key the page uses (exact hostname, or a subdomain of an entry). It is not an
OAuth-client problem, and it never reaches Google.

Open `/api/auth/diagnostics` **on the exact address you used** (logged in to Vercel) and read
`googleSignIn`:

| Field | Meaning → fix |
|---|---|
| `requestHostAuthorized: false`, `stableHostAuthorized: true` | You're on a per-deployment address (`algo-verse-<hash>-algo-verse1.vercel.app`, new on every push). Use the stable address in `stableHost` — the sign-in page now offers a button for it. Don't add every deployment hash. |
| `stableHostAuthorized: false` | Add `stableHost` (hostname only — no `https://`, path or port) under Authorized domains of the project named in `firebaseProjectId`. |
| `firebaseProjectId: "algoverse-f5b48"` | The Preview still uses **Production**. Stop; set the Preview-only variables (§3) and redeploy. |
| `clientAndServerSameProject: false` | `NEXT_PUBLIC_FIREBASE_*` and `FIREBASE_SERVICE_ACCOUNT_KEY` are from different projects (`adminProjectId` shows the key's). Fix the Preview-scoped variables, redeploy. |
| `buildProjectId` ≠ `runtimeProjectId` | Variables changed after this deployment was built: redeploy the Preview. |
| `authDomainMatchesProject: false` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` must be `<firebaseProjectId>.firebaseapp.com`. |
| `authorizedDomains.checked: false` | The lookup couldn't run (`reason`); check in the Firebase console instead. |

OAuth: with Firebase's built-in Google provider (enabled in *that* project → Authentication →
Sign-in method → Google), Firebase creates and manages the OAuth client and its redirect URI
`https://<authDomain>/__/auth/handler`. No Google Cloud Console change is needed unless you
replaced it with your own client ID.

## 6. Gemini quota safeguards

- `AI_GLOBAL_DAILY_LIMIT` caps AI questions for the whole deployment per day. It is counted in
  Firestore `aiUsageGlobal/{YYYY-MM-DD}` of **the deployment's Firebase project**, one document
  per India-time day (a new day = a new document; nothing is deleted).
- **30/day on Preview** covers a full test pass: Free daily limit (10), the per-minute burst
  check (≈5), and a few Pro and error-path questions. Reach Pro's 50/day limit by seeding the
  counter (§8), not by asking 50 real questions. When the cap is hit, everyone gets
  "shared limit for today" (429 `busy`) until 00:00 IST.
- Google's own daily quota resets at **midnight Pacific time**, not IST; if Gemini itself
  runs out, users see 429 `rate_limited` and the question is not counted.

## 7. Test accounts

Use addresses you control (plus-addressing like `you+free@gmail.com` works with Firebase).

- **Free:** sign up → verify → the AI helper shows "10 of 10 AI questions left today (Free)".
- **Pro:** sign up and verify, then
  `node scripts/grant-pro.mjs --env .env.preview.local --project <preview-project-id> --email you+pro@gmail.com --days 7`.
  The script refuses unless `--project` equals the key's project, and prints the target project.
  **Never run it with the Production key for a Preview test.**
- **Email verification:** Firebase's free email sender is rate-limited; the app pauses resends
  (15 min → 1 h → 4 h → 24 h). Check Spam. Google sign-in marks the email verified immediately.
- **Signed out:** a problem page shows "Log in or create a free account…" in the AI card; the
  problem, progress and notes keep working.

## 8. AI limits: what to check

| Check | Expected |
|---|---|
| Signed out, or a direct `POST /api/ai` | 401 `sign_in_required` |
| Signed in, email not verified | 403 `verify_email` (card links to Account) |
| Verified Free | answers stream; the count goes down by 1 per answer |
| 6 questions within a minute | 6th: "sending questions too quickly" (429 `slow_down`) |
| 11th Free question today | "used all of today's AI questions" + a Pro link, no Retry |
| Pro | "50 of 50"; set its counter to 49 (below) → one more works, the next is refused |
| Whole-app cap reached | "shared limit for today" (429 `busy`) |

**Firestore counters** (Preview project → Firestore → Data; server-only, clients can't read them):

- `aiUsage/{uid}`: `{ day, count, minuteStart, minuteCount, updatedAt }`. Editing `count` (e.g.
  to 49 for the Pro test, or 0 to reset) is fine **in the Preview project only**.
- `aiUsageGlobal/{YYYY-MM-DD}`: `{ count }` for the whole deployment that day.
- A question that fails at Gemini before any answer is refunded (the count doesn't move).

## 9. What stays unchanged in Production

- Firebase project `algoverse-f5b48`: not touched (new project, rules deployed with an explicit `--project`).
- Vercel Production variables: not edited (only new, branch-scoped Preview variables).
- Production deployment: not rebuilt (redeploying a Preview builds that Preview only; Production
  is built from `main`, which is not merged).
- The Production Gemini key and its quota: untouched (a separate Google Cloud project).
- Payments: off (`PRICING.paymentsEnabled = false`; no Razorpay variables).
