# AlgoVerse

**A structured DSA learning and problem-solving companion with progress tracking and AI assistance.**

AlgoVerse helps students learn Data Structures and Algorithms through a structured roadmap,
coding problems, progress tracking, bookmarks, notes, articles, and an AI-powered DSA helper.

It follows the **complete Striver A2Z DSA Sheet** (classic 18-step roadmap, 455 items) in its
original order: browse by topic and section, jump straight to the problem on LeetCode /
GeeksforGeeks / TakeUForward, read an explanation article, track completion and streaks,
bookmark problems and keep private notes — all stored locally in your browser. It installs
as an app (PWA) on Android, iPhone and desktop; see [docs/PWA_SETUP.md](docs/PWA_SETUP.md).

*(AlgoVerse was previously called "DSA Roadmap"; saved progress carries over unchanged.)*

The app has its own design; it does not copy any site's UI, branding or problem
statements. Only titles, roadmap structure and links to the original problem pages are
used, and a platform link is shown only when it was verified to be that exact problem.

## Tech stack

- Next.js 15 (App Router) + React 18 + TypeScript
- Tailwind CSS + shadcn/ui-style components (Radix UI primitives)
- Zustand (with a localStorage persistence adapter)
- lucide-react icons, cmdk for the command palette; light/dark/system theme via a cookie read on the server (no pre-hydration script, so no hydration mismatch)
- Google Gemini (official `@google/genai` SDK) behind a server-only API route
- Installable PWA: Next.js `app/manifest.ts` + a hand-written service worker (`public/sw.js`), no extra dependencies

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Other scripts:

```bash
npm run build          # production build
npm run start          # run the production build
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run validate:data  # dataset report + integrity checks (scripts/validate-a2z-data.ts, Node >= 22.6)
npm test               # all tests: AI route (mocked Gemini, no key needed) + service worker
npm run test:ai        # AI route tests only (Node >= 22.6)
npm run test:sw        # service worker tests only
```

On a Mac you can also double-click **`scripts/mac-verify.command`**: it runs
`npm install`, `validate:data`, `test:ai`, `typecheck`, `lint` and `build`, checks that neither your
Gemini key nor the Gemini endpoint/SDK ended up in the browser bundle, then starts a dev
server on http://localhost:3123 (stops by itself after 20 minutes). It builds into a
separate `.next-verify/` folder, so it is safe to run while your own `npm run dev` is
running. Logs land in `.verify/` (git-ignored).

## The dataset

| | |
|---|---|
| Entries | **455** (426 coding problems + 29 theory/lesson items) |
| Topics | 17 (Learn the Basics → Tries, with Step 18 "Strings [Hard]" inside *Strings*) |
| LeetCode links | 250 exact (every slug confirmed) + 22 "related practice" |
| GeeksforGeeks links | 72 exact + 4 related |
| TakeUForward / other practice | 392 |
| Read Article links | 267 (TakeUForward explanations of the same problem) |
| Code360 links | 0 — none could be verified, so none are listed |
| No verified link or article | 15 — left empty instead of guessed |

Why 455 and not ~495, where every number comes from, and the full link audit are in
**[docs/A2Z_DATA_AUDIT.md](docs/A2Z_DATA_AUDIT.md)** (current) and
[docs/A2Z_DATASET.md](docs/A2Z_DATASET.md) (first audit).

Run `npm run validate:data` any time for the report:

```
==============================
A2Z DATASET REPORT
==============================
Total problems: 455
Learn the Basics:             31
Sorting Techniques:           7
Arrays:                       40
...
Duplicate IDs: 0
Duplicate titles: 0
Invalid URLs: 0
```

## Project structure

```
app/                       Routes (Next.js App Router)
  api/ai/route.ts          POST /api/ai — server-side Google Gemini call (holds the API key)
  manifest.ts              PWA manifest (/manifest.webmanifest)
  offline/page.tsx         Offline fallback page (pre-cached by the service worker)
  icon.svg, favicon.ico, apple-icon.png   App icons (linked automatically by Next.js)
  page.tsx                 Dashboard
  problems/page.tsx        All problems (search + filters)
  problems/[id]/page.tsx   Problem detail (breadcrumb, links, status, notes, prev/next)
  topics/[topic]/page.tsx  One topic, with per-section progress
  bookmarks/page.tsx       Bookmarked problems
  settings/page.tsx        Data management, dataset health, previous-dataset progress

public/
  sw.js                     Service worker (caching + offline fallback; never touches /api)
  icons/                    PWA icons (192/512, maskable)

components/
  ui/                       shadcn/ui-style primitives
  brand/                    AlgoVerse logo
  pwa/                      Service-worker registration, install prompt, offline retry
  layout/                   Sidebar, topbar, mobile nav, command palette, shortcuts dialog
  dashboard/                Stat cards, progress ring, heatmap, continue-learning, recent
  problems/                 Problem table, filters, platform links, bookmark/completion controls
  settings/                 Dataset health card
  providers/                Theme provider + client-side store hydration

data/
  a2zProblems.ts            ⭐ The A2Z dataset (455 items, roadmap order, links + articles)
  a2zLinkReview.ts          Reviewed exceptions the validator checks (shared links, look-alike titles)
  problems.ts               What the app reads (re-exports the A2Z data, sorted by order)
  topics.ts                 Topics + sidebar categories
  legacyIdMap.ts            Old starter-dataset id -> A2Z id (progress migration)

lib/
  types.ts                  Problem / Topic / progress types
  store.ts                  Zustand store + localStorage persistence + versioned migration
  migrate-progress.ts       Re-keys old progress to A2Z ids; keeps unmatched items as "legacy"
  dataset-validation.ts     Checks used by `validate:data` and Settings → Dataset health
  ai/shared.ts              AI types, quick-action prompts, limits (browser-safe)
  ai/server.ts              System prompt, request validation, Gemini model + error mapping (server only)
  ai/client.ts              Streams answers from POST /api/ai
  progress.ts               Totals, per-topic/section progress, next-up, random pick
  use-problem-filters.ts    Search + filters shared by Problems / Topic / Bookmarks

scripts/
  validate-a2z-data.ts      `npm run validate:data`
  a2z-build/                Python used to generate data/a2zProblems.ts (sources in docs)
docs/A2Z_DATA_AUDIT.md      Current audit: counts, verification levels, issues fixed/remaining
docs/A2Z_DATASET.md         First audit: sources and LeetCode link audit
```

## Adding or editing problems

Everything is derived from `data/a2zProblems.ts` — totals, percentages, topic and
section groupings are computed at runtime (`PROBLEMS.length`), never hard-coded.

```ts
{
  id: 456,                 // unique and stable — progress is stored by id
  order: 456,              // position in the roadmap, 1..N with no gaps
  step: 18,
  topic: "strings",        // an id from data/topics.ts
  section: "Hard Problems",
  title: "Your Problem",
  difficulty: "Medium",
  platforms: {
    leetcode: "https://leetcode.com/problems/your-problem-slug/",
    // gfg / code360 / other — only if you have a REAL link to this exact problem
  },
  otherLabel: "TakeUForward",   // required when `other` is set
  article: { url: "https://takeuforward.org/blogs/...", source: "TakeUForward" }, // optional, verified only
  related: [/* optional: similar-but-not-identical practice links */],
  tags: ["String"],
}
```

To insert in the middle of the roadmap, renumber `order` (not `id`) so it stays 1..N,
then run `npm run validate:data`.

## Modifying links

Edit the `platforms` object of the problem in `data/a2zProblems.ts`. If you're not sure
a link is the same problem, put it in `related` instead — related links are shown on the
problem page but never used for the "Solve" button.

## How progress is stored

All personal state (completed problems with timestamps, bookmarks, notes, mistakes,
code, streak) lives in one Zustand store (`lib/store.ts`), persisted to
`localStorage["dsa-roadmap-storage"]` through `lib/storage-adapter.ts` — the only file that
stores progress in `localStorage`.

**Upgrading from the 152-problem version:** the stored data carries a version number.
Data from the earlier version is migrated automatically on first load:

- progress on a problem that is the same LeetCode problem in A2Z moves to the A2Z id
  (108 of the old 152 map over — e.g. old *Two Sum* → A2Z #53 *2Sum Problem*);
- the other 44 had no identical A2Z problem; their progress is **kept, not deleted**,
  in a `legacy` section (listed under Settings, counted in your streak history, included
  in exports);
- importing an old export file goes through the same migration.

**Adding Supabase / Firebase later:** implement the same three-method `StateStorage`
interface (`getItem`, `setItem`, `removeItem`) against your backend in
`lib/storage-adapter.ts` and swap it into the `persist(...)` call in `lib/store.ts`.

## AI DSA Helper (free, Google Gemini)

Every problem page has an **AI DSA Helper** that behaves like a tutor: quick buttons for
💡 Hint, 🧠 Approach, ⚡ Optimal, 🐢 Brute Force, ⏱ Complexity and 🐛 Debug My Code, plus a
free-form chat. Answers stream in; you can stop, retry or clear the conversation.

It uses the **Google Gemini API free tier** through Google's official SDK
([`@google/genai`](https://www.npmjs.com/package/@google/genai)). Setup:

1. Create a free API key at <https://aistudio.google.com/apikey>.
2. Put it in `.env.local` (already git-ignored):
   ```env
   GEMINI_API_KEY=your_key_here
   ```
3. Restart `npm run dev`.

**Model:** `gemini-3.8-flash` (current stable Flash model, free tier), with thinking set to
"low" for quick answers. If it is rate-limited or unavailable before any text was sent, the
request is retried once on `gemini-3.5-flash-lite`, which has its own free quota. To use
another model, set `GEMINI_MODEL=...` in `.env.local` — check
<https://ai.google.dev/gemini-api/docs/pricing> that it's on the free tier first. Whether
requests are free is decided by your Google AI Studio project: keep billing off on that
project to stay on the free tier (free-tier prompts may be used by Google to improve its
products).

How it's wired: the browser calls **`POST /api/ai`** (our own Next.js route,
`app/api/ai/route.ts`) with `{ problem, messages, action }` — the problem's metadata
(title, topic, section, difficulty, tags — never a copied problem statement), the
conversation, and for Debug My Code the pasted code attached to the message. The server adds
the tutor system instruction, calls Gemini with the server-side key, and streams the reply
back. The key is read only on the server (`process.env.GEMINI_API_KEY`, no `NEXT_PUBLIC_`
prefix), so it is never in the browser bundle or any response. Pasted code is only sent with
the request; it isn't saved anywhere (the separate *Code / Solution* box on the problem
page is your own saved notes, as before).

Errors are shown in plain language: missing key, rejected key, **free limit / quota reached
(429: "Free AI limit reached temporarily. Please wait a little and try again.")**, region
not supported, timeouts, Gemini outages, blocked answers, and empty or malformed replies.
Raw Gemini error bodies are never sent to the browser. Free models are rate-limited and can
be wrong — treat answers as hints to reason about.

The helper used OpenRouter until this version; that integration has been removed.

## Keyboard shortcuts

`/` search · `g d` Dashboard · `g p` Problems · `g b` Bookmarks · `g s` Settings · `?` help.

## Deploying

AlgoVerse needs a Node.js host because the AI helper is a server route (`/api/ai`) — don't
use `output: "export"`. [Vercel](https://vercel.com)'s free Hobby plan works out of the box:

1. Push the project to a GitHub repository (without `.env.local` — it is git-ignored).
2. On vercel.com → **Add New… → Project**, import the repository (framework: Next.js,
   no settings to change).
3. Under **Settings → Environment Variables** add `GEMINI_API_KEY` (Production, and Preview
   if you want) with your key, then redeploy. Never commit the key.

Or with the Vercel CLI: `npx vercel login`, `npx vercel link`, `npx vercel env add
GEMINI_API_KEY production`, `npx vercel --prod`. Full details and troubleshooting:
[docs/PWA_SETUP.md](docs/PWA_SETUP.md).
