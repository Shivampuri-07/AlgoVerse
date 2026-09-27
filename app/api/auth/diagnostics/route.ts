import { jsonResponse } from "@/lib/auth/server";
import { getAdminState } from "@/lib/firebase/admin";
import { PUBLIC_CONFIG_VARS, readPublicVars } from "@/lib/firebase/config";
import { allowSetupDetails, deploymentInfo } from "@/lib/firebase/deployment";
import { getPublicConfigState, readRuntimePublicVars } from "@/lib/firebase/runtime-config";
import { unexpectedFirebaseNames } from "@/scripts/firebase-env-report.mjs";

/**
 * GET /api/auth/diagnostics — yes/no answers about this deployment's Firebase setup.
 * Booleans, state names and variable NAMES only; never a value. Disabled on Production (404).
 *
 *   inBuild   — the value was inlined into this build when `next build` ran
 *   atRuntime — the deployment's environment has the value now (what the app falls back to)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHORT: Record<(typeof PUBLIC_CONFIG_VARS)[number], string> = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "hasApiKey",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "hasAuthDomain",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hasProjectId",
  NEXT_PUBLIC_FIREBASE_APP_ID: "hasAppId",
};

export function GET(): Response {
  if (!allowSetupDetails()) return jsonResponse({ error: { code: "not_found" } }, 404);

  const build = readPublicVars();
  const runtimeVars = readRuntimePublicVars();
  const resolved = getPublicConfigState();
  const publicConfig: Record<string, { inBuild: boolean; atRuntime: boolean; usable: boolean }> = {};
  for (const name of PUBLIC_CONFIG_VARS) {
    publicConfig[SHORT[name]] = {
      inBuild: Boolean(build[name]),
      atRuntime: Boolean(runtimeVars[name]),
      usable: !resolved.missing.includes(name),
    };
  }
  const adminKeyName = "FIREBASE_SERVICE_ACCOUNT_KEY";
  return jsonResponse({
    deployment: deploymentInfo(),
    publicConfig,
    browserSignInConfigured: resolved.config !== null,
    publicConfigSource: resolved.source,
    hasAdminCredential: Boolean(process.env[adminKeyName]?.trim()),
    adminCredentialState: getAdminState(),
    unrecognisedFirebaseVariableNames: unexpectedFirebaseNames(process.env),
  });
}
