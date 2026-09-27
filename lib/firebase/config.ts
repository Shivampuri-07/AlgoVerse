/**
 * Public Firebase web-app configuration (safe to ship to the browser: these values identify the
 * project, they are not secrets — access is controlled by Firebase Auth and firestore.rules).
 *
 * Two sources, merged per field by resolvePublicConfig():
 *   1. build time — each NEXT_PUBLIC_ variable is referenced literally below, so Next.js inlines
 *      it into the bundle when `next build` runs;
 *   2. request time — the root layout (server) reads the deployment's environment and hands the
 *      values to the browser (lib/firebase/runtime-config.ts). This keeps sign-in working even
 *      when a build didn't get the variables inlined.
 * When neither has them, Log in / Sign up still show and the account pages explain what is
 * missing; the rest of the app keeps working (local-only progress).
 */
export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export const PUBLIC_CONFIG_VARS = [
  "NEXT_PUBLIC_FIREBASE_API_KEY",
  "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  "NEXT_PUBLIC_FIREBASE_APP_ID",
] as const;

export type PublicConfigVar = (typeof PUBLIC_CONFIG_VARS)[number];
export type PublicConfigValues = Record<PublicConfigVar, string>;

/** Values inlined into this build (empty string when the build didn't have them). */
export function readPublicVars(): PublicConfigValues {
  return {
    NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() ?? "",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim() ?? "",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ?? "",
    NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim() ?? "",
  };
}

/** Names (never values) of required public variables that are empty in this build. */
export function missingPublicConfigVars(): string[] {
  const vars = readPublicVars();
  return PUBLIC_CONFIG_VARS.filter((name) => !vars[name]);
}

export function getFirebasePublicConfig(): FirebasePublicConfig | null {
  const v = readPublicVars();
  if (missingPublicConfigVars().length) return null;
  return {
    apiKey: v.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: v.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: v.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: v.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
}

export function isFirebaseConfigured(): boolean {
  return getFirebasePublicConfig() !== null;
}

export interface PublicConfigState {
  config: FirebasePublicConfig | null;
  /** Names of required variables available from neither source. */
  missing: PublicConfigVar[];
  /** Where the values came from — shown in setup diagnostics. */
  source: "build" | "runtime" | "mixed" | "none";
  /** Local Auth emulator host (development/tests only). */
  authEmulatorHost: string | null;
}

/** Merges build-time and request-time values field by field (build time wins when both exist). */
export function resolvePublicConfig(
  build: Partial<PublicConfigValues>,
  runtime: Partial<PublicConfigValues>,
  authEmulatorHost: string | null = null
): PublicConfigState {
  const values = {} as PublicConfigValues;
  let fromBuild = 0;
  let fromRuntime = 0;
  for (const name of PUBLIC_CONFIG_VARS) {
    const b = build[name]?.trim() ?? "";
    const r = runtime[name]?.trim() ?? "";
    values[name] = b || r;
    if (b) fromBuild++;
    else if (r) fromRuntime++;
  }
  const missing = PUBLIC_CONFIG_VARS.filter((n) => !values[n]);
  const source = fromBuild && fromRuntime ? "mixed" : fromBuild ? "build" : fromRuntime ? "runtime" : "none";
  return {
    config: missing.length
      ? null
      : {
          apiKey: values.NEXT_PUBLIC_FIREBASE_API_KEY,
          authDomain: values.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
          projectId: values.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          appId: values.NEXT_PUBLIC_FIREBASE_APP_ID,
        },
    missing,
    source,
    authEmulatorHost,
  };
}

/** Local Auth emulator for development, e.g. "127.0.0.1:9099". Never set this in production. */
export function getAuthEmulatorHost(): string | null {
  return process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?.trim() || null;
}
