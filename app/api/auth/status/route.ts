import { jsonResponse } from "@/lib/http";
import { checkCredential } from "@/lib/firebase/admin-credential";
import { loadAdminSdk } from "@/lib/firebase/admin-loader";
import { allowSetupDetails } from "@/lib/firebase/deployment";
import type { AccountSetupStatus } from "@/lib/auth/shared";
import { STATUS_PROBE_PATH } from "@/lib/firebase/status-probe";

/**
 * GET /api/auth/status — is account sign-in usable on this deployment?
 * Reports state names only, never a value. The account pages use it to explain a setup problem
 * before the visitor submits a form. Doesn't import firebase-admin statically, so it still
 * answers (with "sdk_unavailable") when the SDK can't load on this server.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DatabaseState = NonNullable<AccountSetupStatus["database"]>;
let dbCache: { state: DatabaseState; at: number } | undefined;
const DB_CACHE_MS = 60_000;

/** One document read, cached for a minute: tells "database not created yet" apart from other errors. */
async function databaseState(getDb: () => import("firebase-admin/firestore").Firestore | null): Promise<DatabaseState> {
  if (dbCache && Date.now() - dbCache.at < DB_CACHE_MS) return dbCache.state;
  const db = getDb();
  if (!db) return "unknown";
  let state: DatabaseState;
  try {
    await db.doc(STATUS_PROBE_PATH).get();
    state = "ok";
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    state = code === 5 || code === "not-found" ? "missing" : "error";
    console.error(`[auth] status database probe failed (${String(code ?? "unknown")})`);
  }
  dbCache = { state, at: Date.now() };
  return state;
}

export async function GET(): Promise<Response> {
  const details = allowSetupDetails();
  const credential = checkCredential().state;
  if (credential !== "ok") return jsonResponse({ server: credential, details } satisfies AccountSetupStatus);

  const sdk = await loadAdminSdk();
  if (!sdk.ok) {
    const body: AccountSetupStatus = { server: "sdk_unavailable", details };
    if (details) {
      body.node = process.versions.node;
      body.sdkError = sdk.error;
    }
    return jsonResponse(body);
  }
  const body: AccountSetupStatus = { server: sdk.admin.getAdminState(), details };
  if (body.server === "ok" && details) body.database = await databaseState(sdk.admin.getAdminDb);
  return jsonResponse(body);
}
