/**
 * SERVER-ONLY Firebase Admin SDK. Imported by route handlers and server components only.
 *
 * Credentials come from FIREBASE_SERVICE_ACCOUNT_KEY (the service-account JSON downloaded from
 * the Firebase console, pasted as-is or base64-encoded). It is never prefixed with NEXT_PUBLIC_
 * and never reaches the browser. When the Auth/Firestore emulators are running
 * (FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST), no credentials are needed.
 *
 * The Admin SDK bypasses firestore.rules, so every caller must authorise the request itself
 * (see lib/auth/server.ts) and only ever touch the authenticated user's own documents.
 *
 * Nothing here ever logs or returns a credential value — only a state name.
 */
import { cert, deleteApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  checkCredential,
  readPublicProjectId,
  usingEmulators,
  type AdminState,
} from "@/lib/firebase/admin-credential";

export type { AdminState };
export { parseServiceAccount } from "@/lib/firebase/admin-credential";

const APP_NAME = "algoverse-admin";

let cached: { app: App | null; state: AdminState } | undefined;

function init(): { app: App | null; state: AdminState } {
  if (cached) return cached;
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return (cached = { app: existing, state: "ok" });

  if (usingEmulators()) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID || readPublicProjectId() || "demo-algoverse";
    return (cached = { app: initializeApp({ projectId }, APP_NAME), state: "ok" });
  }

  const check = checkCredential();
  if (check.state !== "ok" || !check.account) return (cached = { app: null, state: check.state === "ok" ? "invalid" : check.state });
  const { account } = check;

  try {
    const app = initializeApp(
      {
        credential: cert({
          projectId: account.project_id,
          clientEmail: account.client_email,
          privateKey: account.private_key,
        }),
        projectId: account.project_id,
      },
      APP_NAME
    );
    return (cached = { app, state: "ok" });
  } catch {
    // e.g. "Failed to parse private key" — the key text is damaged.
    return (cached = { app: null, state: "invalid" });
  }
}

export function getAdminState(): AdminState {
  return init().state;
}

export function getAdminApp(): App | null {
  return init().app;
}

export function getAdminAuth(): Auth | null {
  const app = getAdminApp();
  return app ? getAuth(app) : null;
}

export function getAdminDb(): Firestore | null {
  const app = getAdminApp();
  return app ? getFirestore(app) : null;
}

export function isAdminConfigured(): boolean {
  return getAdminApp() !== null;
}

/** Test hook: delete the app and forget the cached state so env changes are picked up. */
export async function resetAdminForTests(): Promise<void> {
  cached = undefined;
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) await deleteApp(existing);
}
