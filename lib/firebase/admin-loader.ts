/**
 * SERVER-ONLY: loads lib/firebase/admin (and with it the firebase-admin SDK) lazily, so a route
 * that only REPORTS status can say "the SDK can't load here" instead of failing with a 500.
 * Seen in practice: on Node.js 18, firebase-admin's dependency chain (jwks-rsa → jose) throws
 * ERR_REQUIRE_ESM at load time. Only the error CODE is ever returned or logged.
 */
type AdminModule = typeof import("@/lib/firebase/admin");

export type AdminSdkLoad = { ok: true; admin: AdminModule } | { ok: false; errorCode: string };

let loading: Promise<AdminSdkLoad> | null = null;
let loader: () => Promise<AdminModule> = () => import("@/lib/firebase/admin");

export function loadAdminSdk(): Promise<AdminSdkLoad> {
  loading ??= loader().then(
    (admin): AdminSdkLoad => ({ ok: true, admin }),
    (err: unknown): AdminSdkLoad => {
      const code = String((err as { code?: unknown } | null)?.code ?? (err as Error | null)?.name ?? "unknown");
      console.error(`[auth] firebase-admin failed to load (${code}, node ${process.versions.node})`);
      loading = null; // allow a retry on the next request
      return { ok: false, errorCode: code };
    }
  );
  return loading;
}

/** firebase-admin needs require(esm) support: Node.js 22+, or 20.19+. */
export function nodeSupportsFirebaseAdmin(version = process.versions.node): boolean {
  const [major, minor] = version.split(".").map(Number);
  return major >= 22 || (major === 20 && minor >= 19);
}

/** Test hook: replace the module loader (e.g. to simulate a load failure). */
export function setAdminLoaderForTests(fn: (() => Promise<AdminModule>) | null): void {
  loader = fn ?? (() => import("@/lib/firebase/admin"));
  loading = null;
}
