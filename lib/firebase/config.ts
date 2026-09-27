/**
 * Public Firebase web-app configuration (safe to ship to the browser: these values identify the
 * project, they are not secrets — access is controlled by Firebase Auth and firestore.rules).
 *
 * Each NEXT_PUBLIC_ variable is referenced literally so Next.js can inline it at build time.
 * When they are missing, every account feature reports "not configured" and the rest of the app
 * keeps working exactly as before (local-only progress).
 */
export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export function getFirebasePublicConfig(): FirebasePublicConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return { apiKey, authDomain, projectId, appId };
}

export function isFirebaseConfigured(): boolean {
  return getFirebasePublicConfig() !== null;
}

/** Local Auth emulator for development, e.g. "127.0.0.1:9099". Never set this in production. */
export function getAuthEmulatorHost(): string | null {
  return process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?.trim() || null;
}
