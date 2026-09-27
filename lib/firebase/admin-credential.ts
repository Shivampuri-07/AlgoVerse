/**
 * SERVER-ONLY: reads FIREBASE_SERVICE_ACCOUNT_KEY and classifies it WITHOUT loading the
 * firebase-admin SDK, so status/diagnostics routes keep answering even if the SDK itself
 * can't load on the server (e.g. an unsupported Node.js version).
 * Never logs or returns a credential value — only a state name.
 */
import { getPublicConfigState } from "@/lib/firebase/runtime-config";

/**
 * ok               — ready
 * missing          — FIREBASE_SERVICE_ACCOUNT_KEY is not set
 * invalid          — it is set but is not a usable service-account JSON / private key
 * project_mismatch — the key belongs to a different project than NEXT_PUBLIC_FIREBASE_PROJECT_ID
 */
export type AdminState = "ok" | "missing" | "invalid" | "project_mismatch";

export interface ServiceAccount {
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

/** The public project id even when the rest of the web config is incomplete. */
export function readPublicProjectId(): string | undefined {
  const name = "NEXT_PUBLIC_FIREBASE_PROJECT_ID";
  return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || process.env[name]?.trim() || undefined;
}

export function usingEmulators(): boolean {
  return Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST);
}

export type CredentialCheck =
  | { state: "ok"; account: ServiceAccount | null }
  | { state: Exclude<AdminState, "ok">; account: null };

/** Credential state before the SDK is involved (the SDK can still reject a damaged key → "invalid"). */
export function checkCredential(): CredentialCheck {
  if (usingEmulators()) return { state: "ok", account: null };
  const parsed = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
  if (!parsed.ok) return { state: parsed.state, account: null };
  // A key from another project would make every ID token fail the audience check.
  const publicProject = getPublicConfigState().config?.projectId ?? readPublicProjectId();
  if (publicProject && publicProject !== parsed.account.project_id) return { state: "project_mismatch", account: null };
  return { state: "ok", account: parsed.account };
}
