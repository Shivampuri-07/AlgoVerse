// Re-reads open Razorpay subscriptions from Razorpay's API and applies their current state with the
// SAME transaction/rules as the webhook (lib/billing/service.ts) — for missed or delayed webhooks.
// TEST mode only; refuses live keys and the Production Firebase project. Prints subscription ids and
// statuses only — never keys.
//
//   npm run billing:reconcile -- --env .env.preview.local --project algoverse-preview            (dry run)
//   npm run billing:reconcile -- --env .env.preview.local --project algoverse-preview --apply    (writes)
import { existsSync, readFileSync } from "node:fs";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const envFile = arg("env") ?? ".env.preview.local";
const expectedProject = arg("project");
const apply = process.argv.includes("--apply");
const PRODUCTION_PROJECT = "algoverse-f5b48";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(2);
}
if (!expectedProject) fail("--project <firebase-project-id> is required.");
if (expectedProject === PRODUCTION_PROJECT) fail("Refusing: billing reconciliation is test-mode only and never runs against Production.");
if (!existsSync(envFile)) fail(`${envFile} not found.`);
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
delete process.env.VERCEL_ENV; // local run

const { billingStatus, razorpaySettings } = await import("@/lib/billing/config");
const status = billingStatus();
if (!status.enabled) fail(`Billing isn't enabled with ${envFile} (${status.reason}). Test-mode Razorpay variables are required.`);
const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ?? "";
const account = JSON.parse(raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as { project_id: string; client_email: string; private_key: string };
if (account.project_id !== expectedProject) fail(`The service account is for "${account.project_id}", not "${expectedProject}". Nothing was read or written.`);

const { cert, initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");
const { razorpayClient } = await import("@/lib/billing/razorpay");
const { openSubscriptionIds, reconcileSubscription } = await import("@/lib/billing/service");
const app = initializeApp({ credential: cert({ projectId: account.project_id, clientEmail: account.client_email, privateKey: account.private_key.replace(/\\n/g, "\n") }), projectId: account.project_id });
const db = getFirestore(app);
const client = razorpayClient(razorpaySettings());

const ids = await openSubscriptionIds(db);
console.log(`Project ${account.project_id} (test mode): ${ids.length} open subscription(s). ${apply ? "Applying." : "Dry run — add --apply to write."}`);
for (const id of ids) {
  try {
    if (!apply) {
      const s = await client.fetchSubscription(id);
      console.log(`  ${id}: Razorpay status ${s.status}${s.current_end ? `, period ends ${new Date(s.current_end * 1000).toISOString()}` : ""}`);
      continue;
    }
    const r = await reconcileSubscription(db, client, id);
    console.log(`  ${id}: ${r.outcome}`);
  } catch (err) {
    console.log(`  ${id}: failed (${(err as { code?: unknown })?.code ?? (err as Error).message})`);
  }
}
