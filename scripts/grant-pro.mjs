#!/usr/bin/env node
// Grants (or revokes) AlgoVerse Pro for one account by writing the server-only Firestore document
// `entitlements/{uid}` — the same document Phase 4 (payments) will maintain. For testing cloud
// sync before payments exist. Run it yourself, locally; it never prints the credential.
//
//   node scripts/grant-pro.mjs --project <firebase-project-id> --email you@example.com [--days 30]
//   node scripts/grant-pro.mjs --project <firebase-project-id> --email you@example.com --revoke
//   node scripts/grant-pro.mjs --env .env.preview.local --project <preview-project-id> --email ...
//
// Credentials: FIREBASE_SERVICE_ACCOUNT_KEY from the environment, or from --env <file> (default
// .env.local, same as the app). --project is REQUIRED and must equal the key's project: nothing is
// written unless you name the project you mean (so a Preview test can't write to Production by
// accident). With FIREBASE_AUTH_EMULATOR_HOST/FIRESTORE_EMULATOR_HOST set, it targets the emulators.
import { existsSync, readFileSync } from "node:fs";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const email = arg("email");
const expectedProject = arg("project");
const envFile = arg("env") ?? ".env.local";
const revoke = process.argv.includes("--revoke");
const days = Number(arg("days") ?? "30");
if (!email || !Number.isFinite(days) || days <= 0 || days > 366) {
  console.error("Usage: node scripts/grant-pro.mjs --project <firebase-project-id> --email you@example.com [--days 30] [--revoke] [--env <file>]");
  process.exit(2);
}

if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY && arg("env") && !existsSync(envFile)) {
  console.error(`${envFile} not found.`);
  process.exit(2);
}
const keySource = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ? "the environment" : envFile;
if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY && existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = /^\s*FIREBASE_SERVICE_ACCOUNT_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (m) process.env.FIREBASE_SERVICE_ACCOUNT_KEY = m[1].replace(/^["']|["']$/g, "");
  }
}

const emulated = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST);
let app;
if (emulated) {
  app = initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "demo-algoverse" });
} else {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) {
    console.error("FIREBASE_SERVICE_ACCOUNT_KEY is not set (environment or .env.local).");
    process.exit(2);
  }
  const json = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  if (!expectedProject) {
    console.error(`--project is required. This key is for project "${json.project_id}"; pass --project ${json.project_id} if that is the one you mean.`);
    process.exit(2);
  }
  if (json.project_id !== expectedProject) {
    console.error(`Refusing: the key in ${keySource} is for project "${json.project_id}", not "${expectedProject}". Nothing was written.`);
    process.exit(2);
  }
  console.log(`Target Firebase project: ${json.project_id}`);
  app = initializeApp({
    credential: cert({ projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key.replace(/\\n/g, "\n") }),
    projectId: json.project_id,
  });
}

const user = await getAuth(app).getUserByEmail(email);
const ref = getFirestore(app).collection("entitlements").doc(user.uid);
if (revoke) {
  await ref.set({ plan: "free", source: "manual", updatedAt: Timestamp.now() }, { merge: true });
  console.log(`Revoked Pro for ${email} (${app.options.projectId}${emulated ? ", emulator" : ""}).`);
} else {
  const expiresAt = Timestamp.fromMillis(Date.now() + days * 86_400_000);
  await ref.set({ plan: "pro", source: "manual", expiresAt, updatedAt: Timestamp.now() }, { merge: true });
  console.log(`Granted Pro to ${email} until ${expiresAt.toDate().toISOString()} (${app.options.projectId}${emulated ? ", emulator" : ""}).`);
}
