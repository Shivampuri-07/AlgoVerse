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

const APP_NAME = "algoverse-admin";

/**
 * ok               — ready
 * missing          — FIREBASE_SERVICE_ACCOUNT_KEY is not set
 * invalid          — it is set but is not a usable service-account JSON / private key
 * project_mismatch — the key belongs to a different project than NEXT_PUBLIC_FIREBASE_PROJECT_ID
 */
export type AdminState = "ok" | "missing" | "invalid" | "project_mismatch";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

type Parsed = { ok: true; account: ServiceAccount } | { ok: false; state: "missing" | "invalid" };

export function parseServiceAccount(raw: string | undefined): Parsed {
  const value = raw?.trim();
  if (!value) return { ok: false, state: "missing" };
  let text = value;
  if (!value.startsWith("{")) {
    text = Buffer.from(value, "base64").toString("utf8");
    if (!text.trim().startsWith("{")) return { ok: false, state: "invalid" };
  }
  try {
    const json = JSON.parse(text) as Partial<ServiceAccount>;
    if (
      typeof json.project_id !== "string" ||
      typeof json.client_email !== "string" ||
      typeof json.private_key !== "string" ||
      !json.private_key.includes("PRIVATE KEY")
    ) {
      return { ok: false, state: "invalid" };
    }
    return {
      ok: true,
      account: {
        project_id: json.project_id,
        client_email: json.client_email,
        // Some dashboards store the key with literal "\n" sequences.
        private_key: json.private_key.replace(/\\n/g, "\n"),
      },
    };
  } catch {
    return { ok: false, state: "invalid" };
  }
}

function usingEmulators(): boolean {
  return Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST);
}

let cached: { app: App | null; state: AdminState } | undefined;

function init(): { app: App | null; state: AdminState } {
  if (cached) return cached;
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return (cached = { app: existing, state: "ok" });

  if (usingEmulators()) {
    const projectId =
      process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-algoverse";
    return (cached = { app: initializeApp({ projectId }, APP_NAME), state: "ok" });
  }

  const parsed = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  if (!parsed.ok) return (cached = { app: null, state: parsed.state });
  const { account } = parsed;

  // A key from another project would make every ID token fail the audience check.
  const publicProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (publicProject && publicProject !== account.project_id) {
    return (cached = { app: null, state: "project_mismatch" });
  }

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
