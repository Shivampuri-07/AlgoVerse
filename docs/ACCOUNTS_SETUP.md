# Accounts setup (Firebase): steps for the project owner

The code for accounts is in the repository. **Log in / Sign up are always visible.** Until the
environment variables below are set, the account pages explain what is missing (on
non-production deployments; production just says sign-in is temporarily unavailable), and the
rest of the site keeps working exactly as before.
All of these steps happen in the Firebase console or Vercel. **Never paste keys or the
service-account file into chat, an issue, or a commit.**

Firebase project: `algoverse-f5b48` (Spark / free plan is enough for this phase).

## 1. Turn on email sign-in
Firebase console → **Build → Authentication → Get started** → **Sign-in method** →
**Email/Password** → enable the first toggle (leave "Email link" off) → Save.

## 2. Password policy (recommended)
Authentication → **Settings → Password policy** → enforce: minimum length **8**, require a
letter and a number. The app checks this too, but only the Firebase setting also applies to
someone calling Firebase directly.

## 3. Authorised domains
Authentication → **Settings → Authorized domains** → **Add domain** →
`algo-verse-phi.vercel.app` (plus any custom domain later). `localhost` is there by default.
Firebase doesn't accept wildcards, so a Vercel preview URL only works for sign-in if you
add that exact preview domain.

## 4. Create the Firestore database (location is permanent)
**Build → Firestore Database → Create database** → Standard edition → location
**`asia-south1` (Mumbai)** → start in **production mode**.
The location **cannot be changed later**.

## 5. Publish the security rules
Either:
- Console: Firestore → **Rules** tab → replace the content with this repo's `firestore.rules` → **Publish**, or
- Terminal: `npx firebase-tools login`, then
  `npx firebase-tools deploy --only firestore:rules --project algoverse-f5b48`

## 6. Web app config (public values)
Project settings (gear) → **General → Your apps → Add app → Web** (nickname "AlgoVerse web",
no Hosting). Copy the four values from the config snippet:

| Snippet field | Environment variable |
|---|---|
| `apiKey` | `NEXT_PUBLIC_FIREBASE_API_KEY` |
| `authDomain` | `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` |
| `appId` | `NEXT_PUBLIC_FIREBASE_APP_ID` |

These identify the project and are designed to be public. Security comes from Firebase
Auth, the server checks and `firestore.rules`.

## 7. Service-account key (SECRET)
Project settings → **Service accounts → Generate new private key** → a JSON file downloads.
Put its **whole content on one line** into `FIREBASE_SERVICE_ACCOUNT_KEY`. Then delete the
downloaded file or store it somewhere private. Anyone with this file has full admin access
to the project.

## 8. Where to enter the values
- **Local:** add all five variables to `.env.local` (already git-ignored), then restart `npm run dev`.
- **Vercel:** Project → **Settings → Environment Variables** → add each name. Mark
  `FIREBASE_SERVICE_ACCOUNT_KEY` as **Sensitive**. Start with the **Preview** environment,
  test on a preview deployment, and only then add them to **Production**. As soon as the
  `NEXT_PUBLIC_FIREBASE_*` values exist in an environment, its next build shows the
  "Sign in" button.

## Node.js version and the Admin SDK

`package.json` pins `"engines": { "node": "22.x" }`, which matches `firebase-admin`'s own
requirement. Its dependency `jwks-rsa@4` would normally `require()` the ESM-only `jose@6`.
That only works while the runtime supports loading ES modules with `require()`, and it fails
with `ERR_REQUIRE_ESM` otherwise (Node 18, or a runtime with that support disabled). To
remove the dependency on it, `package.json` has an npm override
(`"overrides": { "jwks-rsa": { "jose": "5.10.0" } }`). `jose@5` ships a CommonJS build and
has the same `importJWK`/`exportSPKI` API that `jwks-rsa` uses. The tests prove
`firebase-admin` loads with require-ESM disabled.

If the Admin SDK still can't load, `/api/auth/diagnostics` reports the real, sanitised error
(`adminSdkError.code` and `.message`) plus `node.version` and `node.requireEsmSupported`.
The server log line `[auth] firebase-admin failed to load (…)` has the same information.

## Test on a Preview deployment, not Production

Variables you add for **Preview** only apply to Preview deployments. A deployment of this
branch made to the **Production** environment (by "Promote to Production", or by redeploying
with Environment = Production) uses the **Production** variables instead, so it reports the
config as missing. `/api/auth/diagnostics` shows the deployment's `environment`. Use the branch
URL `https://algo-verse-git-feat-accounts-firebase-algo-verse1.vercel.app`.

## Troubleshooting

Three yes/no checks, none of which print a value:

1. **Build log.** Vercel → Deployments → the deployment → **Build Logs**. Look for
   `[algoverse] Firebase config seen by this build`. It lists `yes`/`NO` for each variable,
   the branch and commit, and any Firebase-like variable names the app doesn't recognise
   (typos, stray spaces).
2. **`/api/auth/diagnostics`** on the deployment. Production shows only the essentials:
   `browserSignInConfigured`, `missingPublicVariables`, `adminCredentialState`,
   `missingServerVariables`, `adminSdk` and `node`. Preview adds per-variable detail.
   For each public value it shows `inBuild` / `atRuntime`, plus `hasAdminCredential` and
   `adminCredentialState` (`ok` / `missing` / `invalid` / `project_mismatch`).
3. **`/signup`** shows the same problems in plain words, including which deployment
   (branch and commit) served the page.

The browser config is read at request time as well as build time. If the deployment's
environment has the four `NEXT_PUBLIC_FIREBASE_*` values, sign-in works even if the build
didn't inline them. If `atRuntime` is `false`, that deployment's environment really doesn't
have them. Check:

| Check | Where |
|---|---|
| The exact variable names (no spaces, no typos) | Settings → Environment Variables |
| Each variable is enabled for **Preview** | the variable's Environments column |
| The variable's **Preview branch** field is empty, or set to `feat/accounts-firebase` | edit the variable → "Preview" → branch field |
| The right Vercel project (the one deploying `algo-verse-git-feat-accounts-firebase-…`) | project name at the top of the dashboard |
| A **new** deployment of the **feat/accounts-firebase** branch, created after saving | Deployments → filter by branch. Redeploying a `main` deployment doesn't build this branch. |

Vercel applies variable changes only to deployments created after the change.

| `/signup` message | Fix |
|---|---|
| "Browser sign-in config not found … NEXT_PUBLIC_…" | See the table above |
| "Server credential FIREBASE_SERVICE_ACCOUNT_KEY is not set" | Add it (step 7) and redeploy. This is separate from the browser config. |
| "…isn't a valid service-account JSON" | Paste the **entire** downloaded JSON again (including `{` `}`), or its base64 |
| "…belongs to a different Firebase project" | The key and `NEXT_PUBLIC_FIREBASE_PROJECT_ID` must both be `algoverse-f5b48` |
| "Firestore has no database yet" | Step 4 |

## Verification email doesn't arrive

The account page shows what actually happened to the last request:

- **"Firebase accepted the request at HH:MM"**: Firebase's `sendOobCode` call returned 200,
  so the email was queued. Delivery happens afterwards on Firebase's mail servers and can't be
  observed from the app. Check **Spam** and **Promotions** for a message from
  `noreply@algoverse-f5b48.firebaseapp.com`.
- **"The email was not sent: … (auth/…)"**: Firebase rejected the request, and the code says
  why. For example, `auth/too-many-requests` means wait (sometimes up to an hour), and
  `auth/unauthorized-continue-uri` means the preview domain isn't authorised (the email is then
  sent again without the return link automatically).

On Preview and local builds, the browser console also logs
`[auth] verification email request` with the result and error code. It never logs the email
address or any token.

If requests are accepted but nothing arrives after about 10 minutes (including Spam):
1. Firebase console → Authentication → **Templates → Email address verification**: the
   template is enabled and the sender shows `noreply@algoverse-f5b48.firebaseapp.com`.
2. Authentication → **Users**: the user exists and "Verified" is still unchecked.
3. Authentication → **Usage**: the send count increases, which shows Firebase processed it.
   The Spark plan allows 1,000 verification emails a day.
4. Try a different mail provider (for example Outlook) to tell a Gmail filter apart from a
   sending problem. If none of them receive it, open a Firebase support case with the time
   of an accepted request. A custom SMTP sender (Templates → SMTP settings) is the next
   option, but it needs your approval and an email provider.

## Local development without touching the real project
```bash
npx -y firebase-tools@15.31.0 emulators:start --only auth,firestore --project demo-algoverse
```
Then use the emulator lines from `.env.example`, with any placeholder public values
(`NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-algoverse`, `NEXT_PUBLIC_FIREBASE_API_KEY=demo-key`,
`NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-algoverse.firebaseapp.com`, `NEXT_PUBLIC_FIREBASE_APP_ID=demo`).
Emulator emails are not sent; their links are printed in the emulator's terminal.

## Tests
- `npm test`: existing suites plus auth unit tests (no emulator needed)
- `npm run test:firebase`: starts the emulators and runs the Firestore rules tests and the
  account API integration tests (needs Java 21+)
- `npm run test:e2e`: builds the app twice (emulator config, and no config) and drives
  Google Chrome through Log in / Sign up visibility, validation, sign-up, session cookie,
  refresh, log out, log in, two isolated users, forgot password, and checks local progress is
  untouched (needs Chrome and Java 21+)
- `npm run build && npm run check:secrets`: fails if a server secret reaches the browser bundle

## How it works (short)
- The browser signs in with Firebase Auth. Passwords go straight to Firebase, never to our server.
- The browser swaps a fresh ID token for an **HTTP-only session cookie**
  (`POST /api/auth/session`, 14 days, only from a sign-in in the last 5 minutes).
- Protected pages and APIs verify that cookie on the server, including a revocation check
  (`lib/auth/server.ts`). API clients such as a future Android app can send
  `Authorization: Bearer <ID token>` instead.
- Clients can't write to Firestore at all. The server writes through the Admin SDK, and
  only to the signed-in user's own documents.
- Signing in or out never changes the progress saved on the device. Cross-device sync is
  a Pro feature (a later phase).
