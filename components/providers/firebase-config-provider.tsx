"use client";

import * as React from "react";
import { getAuthEmulatorHost, readPublicVars, resolvePublicConfig, type PublicConfigState } from "@/lib/firebase/config";

/** Which deployment the visitor is looking at (non-production diagnostics only). */
export interface DeploymentInfo {
  env: string | null;
  branch: string | null;
  commit: string | null;
}

export interface FirebaseSetup extends PublicConfigState {
  /** Show setup details (variable names, deployment) — false on production. */
  details: boolean;
  deployment: DeploymentInfo | null;
  /** Stable hostnames of this deployment (branch URL, production URL) — public. */
  stableHosts: string[];
}

// Without a provider (e.g. an isolated component test) fall back to the build-time values.
const fallback: FirebaseSetup = {
  ...resolvePublicConfig(readPublicVars(), {}, getAuthEmulatorHost()),
  details: true,
  deployment: null,
  stableHosts: [],
};

const FirebaseConfigContext = React.createContext<FirebaseSetup>(fallback);

/** Receives the config resolved on the server by the root layout (build-time + request-time values). */
export function FirebaseConfigProvider({ value, children }: { value: FirebaseSetup; children: React.ReactNode }) {
  return <FirebaseConfigContext.Provider value={value}>{children}</FirebaseConfigContext.Provider>;
}

export function useFirebaseSetup(): FirebaseSetup {
  return React.useContext(FirebaseConfigContext);
}
