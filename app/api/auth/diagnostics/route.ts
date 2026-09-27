import { jsonResponse } from "@/lib/http";
import { checkCredential } from "@/lib/firebase/admin-credential";
import { loadAdminSdk, nodeSupportsFirebaseAdmin, requireEsmSupported } from "@/lib/firebase/admin-loader";
import { PUBLIC_CONFIG_VARS, readPublicVars } from "@/lib/firebase/config";
import { allowSetupDetails, deploymentInfo, vercelEnv } from "@/lib/firebase/deployment";
import { getPublicConfigState, readRuntimePublicVars } from "@/lib/firebase/runtime-config";
import { unexpectedFirebaseNames } from "@/scripts/firebase-env-report.mjs";

/**
 * GET /api/auth/diagnostics — yes/no answers about this deployment's Firebase setup.
 * Booleans, state names and variable NAMES only; never a value, token, cookie or key.
 *
 * Available on every deployment. On Production it returns only the essentials
 * (browserSignInConfigured, adminCredentialState, missing variable names, SDK/Node support);
 * Preview and local development also get per-variable build/runtime detail, the branch/commit,
 * and any misspelled Firebase-like variable names.
 *
 * Doesn't import firebase-admin statically, so it keeps answering when the SDK can't load.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHORT: Record<(typeof PUBLIC_CONFIG_VARS)[number], string> = {
  NEXT_PUBLIC_FIREBASE_API_KEY: "hasApiKey",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "hasAuthDomain",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "hasProjectId",
  NEXT_PUBLIC_FIREBASE_APP_ID: "hasAppId",
};
const ADMIN_VAR = "FIREBASE_SERVICE_ACCOUNT_KEY";

export async function GET(): Promise<Response> {
  const resolved = getPublicConfigState();
  const credential = checkCredential().state;
  const hasAdminCredential = Boolean(process.env[ADMIN_VAR]?.trim());

  // Only try to load the SDK when there is a credential to use it with.
  let adminCredentialState: string = credential;
  let adminSdk: "ok" | "load_failed" | "not_checked" = "not_checked";
  let adminSdkError: { code: string; message: string } | undefined;
  if (credential === "ok") {
    const sdk = await loadAdminSdk();
    if (sdk.ok) {
      adminSdk = "ok";
      adminCredentialState = sdk.admin.getAdminState(); // may downgrade to "invalid" (damaged key)
    } else {
      adminSdk = "load_failed";
      adminSdkError = sdk.error;
    }
  }

  const essentials = {
    environment: vercelEnv() ?? "local",
    browserSignInConfigured: resolved.config !== null,
    missingPublicVariables: resolved.missing,
    hasAdminCredential,
    adminCredentialState,
    missingServerVariables: hasAdminCredential ? [] : [ADMIN_VAR],
    adminSdk,
    // Production: the error code only; Preview/local also get the sanitised message (below).
    ...(adminSdkError ? { adminSdkError: { code: adminSdkError.code } } : {}),
    node: {
      version: process.versions.node,
      supportedByFirebaseAdmin: nodeSupportsFirebaseAdmin(),
      requireEsmSupported: requireEsmSupported(),
    },
  };
  if (!allowSetupDetails()) return jsonResponse(essentials);

  const build = readPublicVars();
  const runtimeVars = readRuntimePublicVars();
  const publicConfig: Record<string, { inBuild: boolean; atRuntime: boolean; usable: boolean }> = {};
  for (const name of PUBLIC_CONFIG_VARS) {
    publicConfig[SHORT[name]] = {
      inBuild: Boolean(build[name]),
      atRuntime: Boolean(runtimeVars[name]),
      usable: !resolved.missing.includes(name),
    };
  }
  return jsonResponse({
    ...essentials,
    ...(adminSdkError ? { adminSdkError } : {}),
    deployment: deploymentInfo(),
    publicConfig,
    publicConfigSource: resolved.source,
    unrecognisedFirebaseVariableNames: unexpectedFirebaseNames(process.env),
  });
}
