/**
 * SERVER-ONLY, diagnostics only (Preview/local): is a hostname in the Firebase project's
 * Authentication → Authorized domains? Uses the same public project-config lookup the Firebase
 * browser SDK makes before Google sign-in (GET identitytoolkit /v1/projects?key=<web API key>) and
 * the same matching rule (lib/auth/google.ts). The web API key is public (it ships in every page);
 * it is never logged or returned. Informational: nothing here blocks or changes sign-in — Firebase
 * itself enforces the rule and reports auth/unauthorized-domain.
 */
import { isAuthorizedHost } from "@/lib/auth/google";

export type DomainCheck =
  | { checked: true; results: Record<string, boolean> }
  | { checked: false; reason: "emulator" | "no_config" | "lookup_failed" };

export async function checkAuthorizedDomains(
  apiKey: string | null | undefined,
  hosts: (string | null | undefined)[],
  opts: { emulator?: boolean; referer?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<DomainCheck> {
  if (opts.emulator) return { checked: false, reason: "emulator" };
  if (!apiKey) return { checked: false, reason: "no_config" };
  const unique = [...new Set(hosts.filter((h): h is string => !!h))];
  try {
    const res = await (opts.fetchImpl ?? fetch)(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(apiKey)}`, {
      headers: opts.referer ? { Referer: opts.referer } : {},
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
      cache: "no-store",
    });
    if (!res.ok) return { checked: false, reason: "lookup_failed" };
    const body = (await res.json()) as { authorizedDomains?: unknown };
    const domains = Array.isArray(body.authorizedDomains) ? body.authorizedDomains.filter((d): d is string => typeof d === "string") : [];
    return { checked: true, results: Object.fromEntries(unique.map((h) => [h, isAuthorizedHost(h, domains)])) };
  } catch {
    return { checked: false, reason: "lookup_failed" };
  }
}

/** The hostname a request was made to (no port). */
export function requestHostname(req: Request): string | null {
  const raw = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? (() => {
    try {
      return new URL(req.url).host;
    } catch {
      return "";
    }
  })();
  const host = raw.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  return host || null;
}
