// Prints, during `next build`, which Firebase settings this build can see — booleans and
// variable NAMES only, never values — so a Vercel build log answers "did this deployment get
// my environment variables?" without anyone needing dashboard access.
// Called from next.config.mjs in the production-build phase. Never fails the build.

export const PUBLIC_FIREBASE_VARS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
];
const SERVER_FIREBASE_VARS = ["FIREBASE_SERVICE_ACCOUNT_KEY"];
const KNOWN = new Set([
  ...PUBLIC_FIREBASE_VARS,
  ...SERVER_FIREBASE_VARS,
  "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_PROJECT_ID",
]);

/** Names of env vars that look Firebase-related but aren't ones the app reads (typos, stray spaces…). */
export function unexpectedFirebaseNames(env = process.env) {
  return Object.keys(env)
    .filter((name) => /fi?re?\s*_?ba?se?/i.test(name) && !KNOWN.has(name))
    .map((name) => JSON.stringify(name)); // quoted, so leading/trailing spaces are visible
}

export function firebaseEnvReport(env = process.env) {
  const has = (name) => typeof env[name] === "string" && env[name].trim() !== "";
  const lines = [
    `[algoverse] Firebase config seen by this build (values are never printed):`,
    `  deployment: VERCEL_ENV=${env.VERCEL_ENV ?? "(not on Vercel)"} branch=${env.VERCEL_GIT_COMMIT_REF ?? "-"} commit=${(env.VERCEL_GIT_COMMIT_SHA ?? "-").slice(0, 7)}`,
  ];
  for (const name of [...PUBLIC_FIREBASE_VARS, ...SERVER_FIREBASE_VARS]) {
    const blankButSet = typeof env[name] === "string" && !has(name) ? " (set but EMPTY)" : "";
    lines.push(`  ${has(name) ? "yes" : "NO "}  ${name}${blankButSet}`);
  }
  // Which Firebase project this build is wired to — project ids/numbers only (public metadata, the
  // same ids every page's web config carries); the service account's key material is never printed.
  const projectId = (env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "").trim();
  const authDomain = (env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "").trim();
  const appNumber = /^1:(\d+):web:/.exec((env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "").trim())?.[1] ?? null;
  let adminProject = null;
  try {
    const raw = (env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "").trim();
    if (raw) adminProject = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")).project_id ?? null;
  } catch {
    adminProject = "(unreadable)";
  }
  lines.push(
    `  Firebase project: web config ${projectId || "-"} | auth domain matches: ${projectId && authDomain === `${projectId}.firebaseapp.com` ? "yes" : "no"} | app project number ${appNumber ?? "-"} | service account ${adminProject ?? "-"} | client and server same project: ${projectId && adminProject === projectId ? "yes" : "no"}`
  );
  // AI helper (non-secret config; the Gemini key itself is only reported as set/unset/placeholder).
  const cap = Number(env.AI_GLOBAL_DAILY_LIMIT);
  const capText = Number.isInteger(cap) && cap > 0 ? String(cap) : `500 (default${has("AI_GLOBAL_DAILY_LIMIT") ? "; AI_GLOBAL_DAILY_LIMIT is not a positive integer" : ""})`;
  const key = (env.GEMINI_API_KEY ?? "").trim();
  const keyState = !key ? "NOT set" : ["your_key_here", "your-key-here", "changeme", "AIza..."].includes(key) ? "placeholder (AI off)" : "set";
  lines.push(`  AI: global daily cap ${capText} | GEMINI_API_KEY ${keyState} | GEMINI_KEY_SCOPE=preview: ${env.GEMINI_KEY_SCOPE?.trim() === "preview" ? "yes" : "no"}`);
  const odd = unexpectedFirebaseNames(env);
  if (odd.length) lines.push(`  Unrecognised Firebase-like variable names (check spelling/spaces): ${odd.join(", ")}`);
  const missingPublic = PUBLIC_FIREBASE_VARS.filter((n) => !has(n));
  if (missingPublic.length) {
    lines.push(
      `  → The browser sign-in config is incomplete in THIS build. On Vercel: Settings → Environment Variables,`,
      `    make sure each name above is saved for the "${env.VERCEL_ENV ?? "preview"}" environment (and, if a`,
      `    custom Preview branch is set on the variable, that it matches "${env.VERCEL_GIT_COMMIT_REF ?? "this branch"}"), then redeploy THIS branch.`
    );
  }
  return lines.join("\n");
}
