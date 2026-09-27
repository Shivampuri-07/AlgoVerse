/**
 * Public Firebase web-app configuration (safe to ship to the browser: these values identify the
 * project, they are not secrets — access is controlled by Firebase Auth and firestore.rules).
 *
 * Each NEXT_PUBLIC_ variable is referenced literally so Next.js can inline it. IMPORTANT: that
 * inlining happens at BUILD time — after adding or changing these in Vercel, redeploy.
 * When they are missing, the Log in / Sign up entry points still show, and the account pages
 * explain what is missing; the rest of the app keeps working (local-only progress).
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

function readPublicVars(): Record<(typeof PUBLIC_CONFIG_VARS)[number], string> {
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

/** Local Auth emulator for development, e.g. "127.0.0.1:9099". Never set this in production. */
export function getAuthEmulatorHost(): string | null {
  return process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?.trim() || null;
}

/**
 * Setup details (variable names, which side is misconfigured) are shown on non-production
 * deployments only; production visitors get a plain "temporarily unavailable" message.
 */
export function showSetupDetails(): boolean {
  return process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";
}
