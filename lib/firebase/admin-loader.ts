/**
 * SERVER-ONLY: loads lib/firebase/admin (and with it the firebase-admin SDK) lazily, so a route
 * that only REPORTS status can say exactly why the SDK can't load instead of failing with a 500.
 *
 * The error is reported safely: its code/name and a sanitised first line of the message (file
 * paths shortened to package-relative, anything key-like redacted, length-capped). A module-load
 * error never contains environment values, but the sanitiser is applied regardless.
 */
type AdminModule = typeof import("@/lib/firebase/admin");

export interface AdminSdkError {
  /** e.g. "ERR_REQUIRE_ESM", "MODULE_NOT_FOUND", or the error name when there is no code. */
  code: string;
  /** Sanitised first line of the error message. */
  message: string;
}

export type AdminSdkLoad = { ok: true; admin: AdminModule } | { ok: false; error: AdminSdkError };

const REDACTIONS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[redacted key]"],
  [/"private_key"\s*:\s*"[^"]*"/g, '"private_key":"[redacted]"'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g, "[redacted token]"],
  [/AIza[0-9A-Za-z_-]{20,}/g, "[redacted api key]"],
  [/[A-Za-z0-9+/=_-]{60,}/g, "[redacted]"],
];

/** Safe, short description of an error: no absolute paths, nothing key-like. */
export function describeLoadError(err: unknown): AdminSdkError {
  const e = (err ?? {}) as { code?: unknown; name?: unknown; message?: unknown };
  const code = typeof e.code === "string" ? e.code : typeof e.name === "string" ? e.name : "unknown";
  let message = typeof e.message === "string" ? e.message.split("\n")[0] : String(err).split("\n")[0];
  // Absolute paths → package-relative ("jwks-rsa/src/utils.js"), other paths → basename.
  message = message.replace(/(?:[A-Za-z]:)?[\\/][^\s'"]*node_modules[\\/]/g, "");
  message = message.replace(/(^|[\s'"(])(?:[A-Za-z]:)?(?:[\\/][\w.@-]+){2,}[\\/]([\w.@-]+)/g, "$1$2");
  for (const [re, to] of REDACTIONS) message = message.replace(re, to);
  return { code, message: message.slice(0, 300) };
}

let loading: Promise<AdminSdkLoad> | null = null;
let loader: () => Promise<AdminModule> = () => import("@/lib/firebase/admin");

export function loadAdminSdk(): Promise<AdminSdkLoad> {
  loading ??= loader().then(
    (admin): AdminSdkLoad => ({ ok: true, admin }),
    (err: unknown): AdminSdkLoad => {
      const error = describeLoadError(err);
      console.error(`[auth] firebase-admin failed to load (${error.code}, node ${process.versions.node}): ${error.message}`);
      loading = null; // allow a retry on the next request
      return { ok: false, error };
    }
  );
  return loading;
}

/** firebase-admin's own requirement is Node.js 22+ (its dependencies also accept 20.19+). */
export function nodeSupportsFirebaseAdmin(version = process.versions.node): boolean {
  const [major, minor] = version.split(".").map(Number);
  return major >= 22 || (major === 20 && minor >= 19);
}

/** Whether this runtime lets require() load ES modules (Node's process.features.require_module). */
export function requireEsmSupported(): boolean | null {
  const f = (process as unknown as { features?: { require_module?: unknown } }).features;
  return typeof f?.require_module === "boolean" ? f.require_module : null;
}

/** Test hook: replace the module loader (e.g. to simulate a load failure). */
export function setAdminLoaderForTests(fn: (() => Promise<AdminModule>) | null): void {
  loader = fn ?? (() => import("@/lib/firebase/admin"));
  loading = null;
}
