// Builds two production bundles and runs the browser account tests against them:
//   .next-e2e       — Firebase web config for the local emulators (demo-algoverse project)
//   .next-e2e-nofb  — no Firebase config at all (what a deployment without the env vars gets)
// then starts the Auth/Firestore emulators and runs scripts/tests/e2e-accounts.mjs inside them.
// Needs Google Chrome installed and Java 21+ (emulators). Run: npm run test:e2e
import { spawnSync } from "node:child_process";

const DEMO_PUBLIC = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-algoverse.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-algoverse",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:demo",
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};
const NO_FIREBASE = Object.fromEntries(Object.keys(DEMO_PUBLIC).map((k) => [k, ""]));

function run(cmd, args, env) {
  // Never let a real credential from .env.local into test builds/runs (see e2e-accounts.mjs).
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, FIREBASE_SERVICE_ACCOUNT_KEY: "", ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!process.argv.includes("--skip-build")) {
  console.log("\n▶ Building with emulator Firebase config (.next-e2e)…");
  run("npx", ["next", "build"], { ...DEMO_PUBLIC, NEXT_DIST_DIR: ".next-e2e" });
  console.log("\n▶ Building without Firebase config (.next-e2e-nofb)…");
  run("npx", ["next", "build"], { ...NO_FIREBASE, NEXT_DIST_DIR: ".next-e2e-nofb" });
}

console.log("\n▶ Running browser tests inside the Firebase emulators…");
run(
  "npx",
  [
    "-y",
    "firebase-tools@15.31.0",
    "emulators:exec",
    "--only",
    "auth,firestore",
    "--project",
    "demo-algoverse",
    "node --test --test-concurrency=1 scripts/tests/e2e-accounts.mjs",
  ],
  {}
);
