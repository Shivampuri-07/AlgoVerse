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

export function deploymentInfo(): DeploymentInfo | null {
  if (!allowSetupDetails()) return null;
  return {
    env: vercelEnv() ?? (env["NODE_ENV"] === "production" ? "local production build" : "local development"),
    branch: env["VERCEL_GIT_COMMIT_REF"] || null,
    commit: env["VERCEL_GIT_COMMIT_SHA"]?.slice(0, 7) || null,
  };
}
