# AlgoVerse — PWA setup, deployment and troubleshooting

## Branding

| | |
|---|---|
| Name / short name | **AlgoVerse** |
| Short description | A structured DSA learning and problem-solving companion with progress tracking and AI assistance. |
| Long description | AlgoVerse helps students learn Data Structures and Algorithms through a structured roadmap, coding problems, progress tracking, bookmarks, notes, articles, and an AI-powered DSA helper. |
| Icon | An "A" drawn as a small graph (three nodes, three edges) inside an orbit, on an indigo→violet gradient. Original artwork, no third-party logos. |

The name and descriptions live in `lib/constants.ts` (`APP_NAME`, `APP_SHORT_DESCRIPTION`,
`APP_DESCRIPTION`) and are used by the layout metadata, the manifest and the UI. The logo
component is `components/brand/algoverse-logo.tsx`.

The app was previously called "DSA Roadmap". Only the product name changed: the browser
storage key (`dsa-roadmap-storage`) and theme cookie were kept on purpose, so existing
progress, bookmarks, notes and streaks carry over.

## Architecture

```
Browser (installed PWA or tab)
  ├─ pages & JS/CSS ──► service worker (public/sw.js) ──► network / cache
  └─ AI helper ───────► POST /api/ai  (never intercepted by the service worker)
                          └─► Next.js server route ──► GEMINI_API_KEY ──► Google Gemini
```

No PWA library is used: Next.js 15 serves the manifest from `app/manifest.ts`, and the
service worker is a small hand-written file. That means no extra build plugin and no
dependency to keep compatible with Next.js upgrades.

| Piece | File |
|---|---|
| Manifest (`/manifest.webmanifest`) | `app/manifest.ts` |
| Icons | `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png`, `icon.svg`; `app/icon.svg` (favicon), `app/favicon.ico`, `app/apple-icon.png` (180×180) |
| Metadata (title, theme colour, iOS tags, Open Graph) | `app/layout.tsx` |
| Service worker | `public/sw.js` (served with `Cache-Control: no-cache`, see `next.config.mjs`) |
| Registration + install events | `components/pwa/pwa-manager.tsx`, `lib/pwa-store.ts` |
| Install prompt | `components/pwa/install-prompt.tsx` (banner), `components/pwa/install-card.tsx` (Settings) |
| Offline page | `app/offline/page.tsx` |

The service worker is **only registered in production builds** (`npm run build && npm run
start`, or on Vercel). In `npm run dev` it is not registered, so development never serves
stale cached code.

## Caching strategy

| Request | Strategy |
|---|---|
| Page navigations (HTML) | Network-first. A copy of each page you open is kept (max 60) so it opens offline; unvisited pages show `/offline`. |
| `/_next/static/*` (hashed JS/CSS/fonts) | Cache-first (immutable files; max 250 entries). |
| Icons, favicon, manifest | Stale-while-revalidate. |
| `/api/*` — including the Gemini route `/api/ai` | **Not intercepted.** Always the network, never cached. |
| Non-GET requests, other websites (LeetCode, GfG, TakeUForward, the YouTube player…), RSC fetches | Not intercepted. |

On install the worker pre-caches `/offline` together with the CSS/JS files that page
references, plus the icons and manifest. On activate it deletes caches from older versions
(`VERSION` constant at the top of `public/sw.js`; bump it to force a clean cache).

What works offline: pages you've visited (dashboard, problem lists, problem pages…), your
progress, bookmarks, notes and streak (they're in `localStorage`). What needs a connection:
the AI helper, "Solve on …" and "Read Article" links, Striver's videos (the player shows an
"offline" message instead), and pages you haven't opened yet. Videos are never cached or
downloaded — they always stream from YouTube's official embed.

## Gemini security

- The key is read only on the server: `process.env.GEMINI_API_KEY` in `lib/ai/server.ts`,
  used by `app/api/ai/route.ts`. There is no `NEXT_PUBLIC_` variable.
- The key is not in the manifest, the service worker, or any client component. The build
  check in `scripts/mac-verify.command` scans the browser bundle for the key value,
  `GEMINI_API_KEY`, `AIza`, the Gemini endpoint and the SDK name.
- `.env.local` (and every `.env*.local` / `.env`) is git-ignored. `.env.example` only has
  an empty `GEMINI_API_KEY=`.
- AI requests and answers are never cached by the service worker.

## Environment variables

| Variable | Where | Required |
|---|---|---|
| `GEMINI_API_KEY` | `.env.local` locally; Vercel → Settings → Environment Variables in production | Yes, for the AI helper (everything else works without it) |
| `GEMINI_MODEL` | same | No — default `gemini-3.8-flash`, falls back to `gemini-3.5-flash-lite` |
| `VERCEL_PROJECT_PRODUCTION_URL` | set automatically by Vercel | No — used for absolute Open Graph URLs |

## Local development

```bash
npm install
npm run dev            # http://localhost:3000 — no service worker in dev
```

To try the PWA locally (service worker, install, offline):

```bash
npm run build
npm run start          # http://localhost:3000
```

`localhost` counts as a secure origin, so the service worker and the install prompt work
without HTTPS. On a Mac, `scripts/mac-verify.command` runs install, data validation, tests,
typecheck, lint and a production build into `.next-verify/` (so it never disturbs a running
`npm run dev`).

## Installing AlgoVerse

**Android (Chrome, Edge, Samsung Internet):** open the site → AlgoVerse shows an
"Install AlgoVerse" card after a few seconds (or use the menu → *Install app* / *Add to
Home screen*). "Not now" hides the card for 30 days. Settings → *Install app* also has
an Install button whenever the browser allows it.

**iPhone / iPad (Safari):** iOS has no install prompt. Tap **Share** → **Add to Home
Screen** → **Add**. It opens full-screen with the AlgoVerse icon and name (Settings →
*Install app* shows these steps on iOS).

**Desktop (Chrome, Edge):** click the install icon at the right of the address bar, or
the menu → *Install AlgoVerse*, or the in-app card. It opens in its own window and
appears in the Dock / Start menu. (Firefox desktop and Safari macOS < 17 don't install
PWAs; Safari 17+ uses File → *Add to Dock*.)

## Deploying to Vercel (free Hobby plan)

AlgoVerse must run on a Node.js host because `/api/ai` is a server route — don't switch to
`output: "export"`.

**Option A — GitHub + Vercel dashboard (recommended)**

1. Create a GitHub repository and push the project (`.env.local` is git-ignored):
   ```bash
   git init
   git add .
   git commit -m "AlgoVerse"
   git branch -M main
   git remote add origin https://github.com/<you>/algoverse.git
   git push -u origin main
   ```
2. vercel.com → **Add New… → Project** → import the repository. Framework preset:
   Next.js; build command, output and install command: defaults.
3. **Settings → Environment Variables** → add `GEMINI_API_KEY` = your key, environment
   **Production** (and Preview if you like) → Save.
4. **Deployments → Redeploy** (env vars apply to new deployments). Every later `git push`
   to `main` deploys automatically.

**Option B — Vercel CLI (no GitHub)**

```bash
npx vercel login                       # opens the browser to sign in
npx vercel link                        # create/link the project
npx vercel env add GEMINI_API_KEY production   # paste the key when asked
npx vercel --prod                      # deploy
```

After deploying, check on the production URL (`https://<project>.vercel.app`):
`/manifest.webmanifest`, `/icons/icon-512.png`, `/sw.js`, a problem page, and the AI
helper's **Hint** button. Chrome DevTools → Application shows the manifest, the service
worker and installability.

Cost: GitHub free repositories and Vercel Hobby are free; Gemini's free tier is free as long
as billing stays off on your Google AI Studio project. No analytics, ads or paid services
are included.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No install button/card | The browser only offers installation on HTTPS (or localhost) with a production build, after the service worker is active. Reload once; check DevTools → Application → Manifest for errors. Already installed? Then the card is hidden on purpose. |
| Old version still showing | The worker updates on the next visit; close all AlgoVerse tabs/windows and reopen. To force it: DevTools → Application → Service Workers → *Unregister*, or bump `VERSION` in `public/sw.js`. |
| AI helper says it isn't set up | `GEMINI_API_KEY` is missing — add it to `.env.local` (local) or the Vercel project's environment variables (production) and restart/redeploy. |
| "Free AI limit reached temporarily" | Gemini free-tier rate limit; wait a minute. |
| Server log shows `Gemini gemini-3.8-flash failed before streaming (provider_unavailable, HTTP 503)` | Google reports that model as temporarily overloaded ("high demand"). The route automatically retries on `gemini-3.5-flash-lite`, so users still get an answer. If it persists, set `GEMINI_MODEL=gemini-3.5-flash-lite` to skip the first attempt. |
| `ENOENT … .next/server/…` in `npm run dev` | Two Next.js processes shared the `.next` folder. Stop them, `rm -rf .next`, start `npm run dev` again. (`mac-verify.command` builds into `.next-verify` to avoid this.) |
| Offline page appears for a page you visited | It was visited before the service worker was installed, or evicted (the cache keeps the 60 most recent pages). Open it once online. |
