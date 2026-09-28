/**
 * SERVER-ONLY: which deployment is serving this request (Vercel system variables, read at
 * request time) and whether setup diagnostics may be shown. Names/ids only — no secrets.
 */
import type { DeploymentInfo } from "@/components/providers/firebase-config-provider";

const env = process.env;

export function vercelEnv(): string | null {
  return env["VERCEL_ENV"] || null;
}

/** Diagnostics are hidden on Production; shown on Preview and local development. */
export function allowSetupDetails(): boolean {
  return vercelEnv() !== "production";
}

/**
 * Stable public hostnames for this deployment (Vercel's per-branch URL and the production URL).
 * Used to suggest an authorised address when a per-deployment URL isn't authorised in Firebase.
 */
export function stableHosts(): string[] {
  return [env["VERCEL_BRANCH_URL"], env["VERCEL_PROJECT_PRODUCTION_URL"]]
    .map((h) => h?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") ?? "")
    .filter((h, i, all) => h !== "" && all.indexOf(h) === i);
}

export function deploymentInfo(): DeploymentInfo | null {
  if (!allowSetupDetails()) return null;
  return {
    env: vercelEnv() ?? (env["NODE_ENV"] === "production" ? "local production build" : "local development"),
    branch: env["VERCEL_GIT_COMMIT_REF"] || null,
    commit: env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 7) || null,
  };
}
