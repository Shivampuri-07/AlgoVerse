import { jsonResponse } from "@/lib/http";
import { checkCredential, parseServiceAccount } from "@/lib/firebase/admin-credential";
import { loadAdminSdk, nodeSupportsFirebaseAdmin, requireEsmSupported } from "@/lib/firebase/admin-loader";
import { PUBLIC_CONFIG_VARS, readPublicVars } from "@/lib/firebase/config";
import { allowSetupDetails, deploymentInfo, vercelEnv } from "@/lib/firebase/deployment";
import { getPublicConfigState, readRuntimePublicVars } from "@/lib/firebase/runtime-config";
import { unexpectedFirebaseNames } from "@/scripts/firebase-env-report.mjs";
import { globalDailyLimit } from "@/lib/ai/usage";
import { apiKeyState } from "@/lib/ai/server";
import { checkAuthorizedDomains, requestHostname } from "@/lib/firebase/authorized-domains";
import { stableHost as vercelStableHost } from "@/lib/firebase/deployment";

/**
 * GET /api/auth/diagnostics — yes/no answers about this deployment's Firebase setup.
 * Booleans, state names and variable NAMES only; never a value, token, cookie or key.
 *
 * Available on every deployment. On Production it returns only the essentials
 * (browserSignInConfigured, adminCredentialState, missing variable names, SDK/Node support);
 * Preview and local development also get per-variable build/runtime detail, the branch/commit,
 * any misspelled Firebase-like variable names, the Firebase project id in use (public: it is in
 * every page's web config anyway) and the AI whole-app daily cap — so a tester can confirm a
 * Preview points at the Preview project, not Production (docs/PREVIEW_TESTING.md).
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

export async function GET(req: Request): Promise<Response> {
  const resolved = getPublicConfigState();
  const credentialCheck = checkCredential();
  const credential = credentialCheck.state;
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
  // Google sign-in setup (Preview/local only; public identifiers and booleans — never a key).
  const host = requestHostname(req);
  const stable = vercelStableHost();
  const clientProjectId = resolved.config?.projectId ?? null;
  const authDomain = resolved.config?.authDomain ?? null;
  // The service account's project id (not secret), even when it doesn't match the web config.
  const parsedAccount = parseServiceAccount(process.env[ADMIN_VAR]);
  const adminProjectId = credentialCheck.account?.project_id ?? (parsedAccount.ok ? parsedAccount.account.project_id : null);
  const domains = await checkAuthorizedDomains(resolved.config?.apiKey, [host, stable], {
    emulator: Boolean(resolved.authEmulatorHost),
    referer: host ? `https://${host}/` : undefined,
  });
  const googleSignIn = {
    requestHost: host,
    stableHost: stable,
    firebaseProjectId: clientProjectId,
    // Firebase's OAuth handler lives on the auth domain: https://<authDomain>/__/auth/handler
    authDomainMatchesProject: Boolean(clientProjectId && authDomain && (authDomain === `${clientProjectId}.firebaseapp.com` || authDomain === `${clientProjectId}.web.app`)),
    adminProjectId,
    clientAndServerSameProject: clientProjectId !== null && adminProjectId !== null ? clientProjectId === adminProjectId : null,
    // Differs when Preview variables changed after this deployment was built (redeploy needed).
    buildProjectId: build.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
    runtimeProjectId: runtimeVars.NEXT_PUBLIC_FIREBASE_PROJECT_ID || null,
    authorizedDomains: domains.checked
      ? { checked: true, requestHostAuthorized: host ? domains.results[host] : null, stableHostAuthorized: stable ? domains.results[stable] : null }
      : { checked: false, reason: domains.reason },
  };

  return jsonResponse({
    ...essentials,
    googleSignIn,
    ...(adminSdkError ? { adminSdkError } : {}),
    deployment: deploymentInfo(),
    publicConfig,
    publicConfigSource: resolved.source,
    // Which Firebase project this deployment uses; the service account must match it
    // (adminCredentialState "project_mismatch" otherwise).
    firebaseProjectId: resolved.config?.projectId ?? null,
    aiGlobalDailyLimit: globalDailyLimit(),
    hasGeminiKey: Boolean(process.env["GEMINI_API_KEY"]?.trim()),
    // "ok" | "missing" (unset or a placeholder) | "preview_unscoped" (a Preview without its own key)
    geminiKeyState: apiKeyState(),
    unrecognisedFirebaseVariableNames: unexpectedFirebaseNames(process.env),
  });
}
