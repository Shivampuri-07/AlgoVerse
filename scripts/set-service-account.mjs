#!/usr/bin/env node
// Stores a Firebase service-account key in .env.local as FIREBASE_SERVICE_ACCOUNT_KEY (base64,
// one line) — the format read by the app and scripts/grant-pro.mjs — without ever printing it.
//
//   node scripts/set-service-account.mjs .secrets/algoverse-f5b48-firebase-adminsdk-XXXX.json
//
// - Checks the file is a service-account key for the expected project (default algoverse-f5b48;
//   override with --project <id>).
// - Keeps every other line of .env.local exactly as it is (e.g. GEMINI_API_KEY); replaces an
//   existing FIREBASE_SERVICE_ACCOUNT_KEY line if there is one.
// - Refuses to run if the key file or .env.local is not git-ignored.
// - Prints only the project id, the client email's domain and "written" — never key material.
// --env <path> writes a different env file (used by tests).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const keyPath = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : undefined;
const envPath = arg("env") ?? ".env.local";
const expectedProject = arg("project") ?? "algoverse-f5b48";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!keyPath) fail("Usage: node scripts/set-service-account.mjs <path-to-service-account.json> [--project <id>]");
if (!existsSync(keyPath)) fail(`File not found: ${keyPath}`);

function gitIgnored(path) {
  try {
    execFileSync("git", ["check-ignore", "-q", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const insideRepo = (() => {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
if (insideRepo) {
  const keyAbs = resolve(keyPath);
  const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  if (keyAbs.startsWith(repoRoot + "/") && !gitIgnored(keyPath)) {
    fail(`${keyPath} is inside the repository but NOT git-ignored. Move it to .secrets/ first.`);
  }
  if (resolve(envPath).startsWith(repoRoot + "/") && !gitIgnored(envPath)) fail(`${envPath} is not git-ignored.`);
}

let json;
try {
  json = JSON.parse(readFileSync(keyPath, "utf8"));
} catch {
  fail("That file isn't valid JSON. Download the key again: Firebase console → Project settings → Service accounts → Generate new private key.");
}
if (json.type !== "service_account" || typeof json.private_key !== "string" || !json.private_key.includes("PRIVATE KEY") || typeof json.client_email !== "string") {
  fail("That JSON isn't a service-account key (missing type/private_key/client_email).");
}
if (json.project_id !== expectedProject) {
  fail(`That key belongs to project "${json.project_id}", expected "${expectedProject}".`);
}

const value = Buffer.from(JSON.stringify(json)).toString("base64");
const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const lines = existing.split("\n");
const kept = lines.filter((l) => !/^\s*FIREBASE_SERVICE_ACCOUNT_KEY\s*=/.test(l));
const replaced = kept.length !== lines.length;
while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
kept.push(
  "",
  "# Firebase Admin service account (server-only secret; base64 of the downloaded JSON). Never commit.",
  `FIREBASE_SERVICE_ACCOUNT_KEY=${value}`,
  ""
);
// Write atomically so a crash can't leave a half-written .env.local.
const tmp = `${envPath}.tmp-${process.pid}`;
writeFileSync(tmp, kept.join("\n"), { mode: 0o600 });
renameSync(tmp, envPath);

const otherVars = kept.filter((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l) && !l.includes("FIREBASE_SERVICE_ACCOUNT_KEY")).map((l) => l.split("=")[0].trim());
console.log(`✓ FIREBASE_SERVICE_ACCOUNT_KEY ${replaced ? "replaced" : "written"} in ${envPath} (project ${json.project_id}, service account @${json.client_email.split("@")[1]}).`);
console.log(`  Other variables kept unchanged: ${otherVars.join(", ") || "(none)"}`);
console.log(`  You can now delete ${keyPath} (or keep it in .secrets/, which is git-ignored).`);
