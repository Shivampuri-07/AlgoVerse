import { jsonResponse } from "@/lib/auth/server";
import { getAdminDb, getAdminState } from "@/lib/firebase/admin";
import { allowSetupDetails } from "@/lib/firebase/deployment";
import type { AccountSetupStatus } from "@/lib/auth/shared";

/**
 * GET /api/auth/status — is account sign-in usable on this deployment?
 * Reports state names only ("ok" | "missing" | "invalid" | "project_mismatch"), never a value.
 * The account pages use it to explain a setup problem before the visitor submits a form.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DatabaseState = "ok" | "missing" | "error" | "unknown";
let dbCache: { state: DatabaseState; at: number } | undefined;
const DB_CACHE_MS = 60_000;

/** One document read, cached for a minute: tells "database not created yet" apart from other errors. */
async function databaseState(): Promise<DatabaseState> {
  if (dbCache && Date.now() - dbCache.at < DB_CACHE_MS) return dbCache.state;
  const db = getAdminDb();
  if (!db) return "unknown";
  let state: DatabaseState;
  try {
    await db.doc("users/__status_probe__").get();
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
  const server = getAdminState();
  const details = allowSetupDetails();
  const body: AccountSetupStatus = { server, details };
  if (server === "ok" && details) body.database = await databaseState();
  return jsonResponse(body);
}
