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
 */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

const APP_NAME = "algoverse-admin";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  const value = raw?.trim();
  if (!value) return null;
  let text = value;
  if (!value.startsWith("{")) {
    try {
      text = Buffer.from(value, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  try {
    const json = JSON.parse(text) as Partial<ServiceAccount>;
    if (!json.project_id || !json.client_email || !json.private_key) return null;
    return {
      project_id: json.project_id,
      client_email: json.client_email,
      // Some dashboards store the key with literal "\n" sequences.
      private_key: json.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

function usingEmulators(): boolean {
  return Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST);
}

let cached: App | null | undefined;

export function getAdminApp(): App | null {
  if (cached !== undefined) return cached;
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return (cached = existing);

  if (usingEmulators()) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-algoverse";
    return (cached = initializeApp({ projectId }, APP_NAME));
  }
  const account = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  if (!account) return (cached = null);
  return (cached = initializeApp(
    {
      credential: cert({
        projectId: account.project_id,
        clientEmail: account.client_email,
        privateKey: account.private_key,
      }),
      projectId: account.project_id,
    },
    APP_NAME
  ));
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
