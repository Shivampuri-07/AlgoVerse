/**
 * Explains Firebase's `auth/unauthorized-domain` error with facts instead of guesses.
 *
 * The Firebase Auth SDK (v12, core/util/validate_origin) rejects a popup/redirect sign-in when
 * the page's `location.hostname` matches none of the authorised domains of the Firebase project
 * that owns the web API key. It reads that list from the public endpoint
 * `GET https://identitytoolkit.googleapis.com/v1/projects?key=<web API key>` — the same endpoint
 * used here — and matches each entry as "exact host OR any subdomain of it", case-insensitively
 * (hostMatchesAuthorizedDomain replicates that rule). Nothing here uses a secret: the web API key
 * and the authorised-domain list are public by design.
 */

const IP_ADDRESS = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Same rule as the Firebase SDK's matchDomain() for http(s) pages. */
export function hostMatchesAuthorizedDomain(hostname: string, domain: string): boolean {
  if (!hostname || !domain) return false;
  if (IP_ADDRESS.test(domain)) return hostname === domain;
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(.+\\.${escaped}|${escaped})$`, "i").test(hostname);
}

/** Entries that can never match a hostname (pasted with a scheme, path, port or spaces). */
export function malformedDomainEntries(domains: string[]): string[] {
  return domains.filter((d) => /:\/\/|\/|:\d+$|\s/.test(d));
}

export interface ProjectConfig {
  /**
   * What the endpoint calls "projectId" — in practice the NUMERIC project number (e.g.
   * "123456789012"), not the project ID string. The Firebase SDK itself only reads
   * authorizedDomains from this response.
   */
  projectId: string | null;
  authorizedDomains: string[];
}

/** The project number embedded in a Firebase web App ID ("1:<project number>:web:<hash>"). */
export function projectNumberFromAppId(appId: string | null | undefined): string | null {
  const m = /^\d+:(\d+):[a-z]+:\w+$/i.exec(appId?.trim() ?? "");
  return m ? m[1] : null;
}

/**
 * Does the project that owns the API key match the app's configuration? Compares like with like:
 * a numeric project number against the App ID's project number, a project ID against the
 * configured project ID. Returns null when it can't tell (never a guess).
 */
export function keyMatchesConfiguredProject(
  keyProject: string | null,
  configured: { projectId: string | null; appId: string | null }
): boolean | null {
  if (!keyProject) return null;
  if (/^\d+$/.test(keyProject)) {
    const number = projectNumberFromAppId(configured.appId);
    return number ? number === keyProject : null;
  }
  return configured.projectId ? configured.projectId === keyProject : null;
}

/** Fetches the authorised domains of the project that owns `apiKey` (public endpoint). */
export async function fetchProjectConfig(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<ProjectConfig | null> {
  try {
    const res = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(apiKey)}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { projectId?: unknown; authorizedDomains?: unknown };
    return {
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      authorizedDomains: Array.isArray(body.authorizedDomains)
        ? body.authorizedDomains.filter((d): d is string => typeof d === "string")
        : [],
    };
  } catch {
    return null;
  }
}

export type DomainProblem =
  /** This exact host isn't listed (typical: a per-deployment *.vercel.app URL). */
  | "host_not_authorized"
  /** The web API key belongs to a different Firebase project than the app is configured for. */
  | "key_project_mismatch"
  /** The host IS authorised according to Firebase — the error came from elsewhere. */
  | "host_authorized"
  /** Couldn't read the project's configuration (offline, key restrictions…). */
  | "unknown";

export interface DomainDiagnosis {
  /** The hostname Firebase compared — what's in the address bar. */
  hostname: string;
  problem: DomainProblem;
  /** Project that owns the API key, per Firebase. */
  keyProjectId: string | null;
  /** Project the app is configured for (NEXT_PUBLIC_FIREBASE_PROJECT_ID). */
  configuredProjectId: string | null;
  /** Project number from NEXT_PUBLIC_FIREBASE_APP_ID, when it has the standard format. */
  configuredProjectNumber: string | null;
  /** true/false when the key's project could be compared with the configuration, null when not. */
  keyMatchesProject: boolean | null;
  authorizedDomains: string[];
  malformedEntries: string[];
  /** A stable URL for this branch (e.g. Vercel's branch URL) that IS authorised, if any. */
  authorizedAlternativeUrl: string | null;
}

export async function diagnoseUnauthorizedDomain(input: {
  hostname: string;
  apiKey: string;
  configuredProjectId: string | null;
  /** NEXT_PUBLIC_FIREBASE_APP_ID (public) — used to compare project numbers. */
  configuredAppId?: string | null;
  /** Candidate stable hosts for this deployment, e.g. Vercel's branch URL host. */
  alternativeHosts?: string[];
  fetchImpl?: typeof fetch;
}): Promise<DomainDiagnosis> {
  const base = {
    hostname: input.hostname,
    configuredProjectId: input.configuredProjectId,
    configuredProjectNumber: projectNumberFromAppId(input.configuredAppId),
    keyMatchesProject: null as boolean | null,
    keyProjectId: null as string | null,
    authorizedDomains: [] as string[],
    malformedEntries: [] as string[],
    authorizedAlternativeUrl: null as string | null,
  };
  const config = await fetchProjectConfig(input.apiKey, input.fetchImpl);
  if (!config) return { ...base, problem: "unknown" };
  const domains = config.authorizedDomains;
  const alternative =
    (input.alternativeHosts ?? []).find(
      (h) => h && h !== input.hostname && domains.some((d) => hostMatchesAuthorizedDomain(h, d))
    ) ?? null;
  const keyMatchesProject = keyMatchesConfiguredProject(config.projectId, {
    projectId: input.configuredProjectId,
    appId: input.configuredAppId ?? null,
  });
  const diagnosis = {
    ...base,
    keyMatchesProject,
    keyProjectId: config.projectId,
    authorizedDomains: domains,
    malformedEntries: malformedDomainEntries(domains),
    authorizedAlternativeUrl: alternative ? `https://${alternative}` : null,
  };
  // Only a CONFIRMED mismatch is reported; "can't compare" is never treated as a mismatch.
  if (keyMatchesProject === false) return { ...diagnosis, problem: "key_project_mismatch" };
  const authorized = domains.some((d) => hostMatchesAuthorizedDomain(input.hostname, d));
  return { ...diagnosis, problem: authorized ? "host_authorized" : "host_not_authorized" };
}

/** Plain-language explanation. `details` adds the project's domain list (non-production only). */
/** "algoverse-f5b48 (project number 1234…)" when the key's project is confirmed to be the configured one. */
function projectLabel(d: DomainDiagnosis): string {
  if (d.keyMatchesProject && d.configuredProjectId) {
    return d.keyProjectId && /^\d+$/.test(d.keyProjectId)
      ? `${d.configuredProjectId} (project number ${d.keyProjectId})`
      : d.configuredProjectId;
  }
  return d.keyProjectId ?? "(unknown)";
}

export function describeDomainDiagnosis(d: DomainDiagnosis, details: boolean): string {
  const host = `“${d.hostname}”`;
  switch (d.problem) {
    case "host_not_authorized": {
      let text = `Google sign-in can't work on this address: Firebase only allows it on the Authorized domains of project ${projectLabel(d)}, and this page's hostname ${host} isn't one of them (auth/unauthorized-domain).`;
      if (d.authorizedAlternativeUrl) {
        text += ` This branch's stable address ${d.authorizedAlternativeUrl} is authorised — open that instead.`;
      } else {
        text += ` Add ${d.hostname} under Firebase console → Authentication → Settings → Authorized domains.`;
      }
      if (d.malformedEntries.length) {
        text += ` These entries can never match (remove the https:// or path): ${d.malformedEntries.join(", ")}.`;
      }
      if (details) text += ` Currently authorised: ${d.authorizedDomains.join(", ") || "(none)"}.`;
      return text;
    }
    case "key_project_mismatch":
      return `This site's Firebase web API key belongs to a different Firebase project (${d.keyProjectId && /^\d+$/.test(d.keyProjectId) ? `number ${d.keyProjectId}` : d.keyProjectId}) than the web app it's configured with (project ${d.configuredProjectId}${d.configuredProjectNumber ? `, number ${d.configuredProjectNumber}` : ""}). Use the apiKey and appId from the same Firebase web app (Project settings → General → Your apps) and redeploy.`;
    case "host_authorized":
      return `Firebase reported auth/unauthorized-domain, but ${host} is listed in project ${projectLabel(d)}'s Authorized domains now. If you just added it, wait a minute and reload this page.`;
    default:
      return `Firebase rejected this page's hostname ${host} (auth/unauthorized-domain). Add it under Firebase console → Authentication → Settings → Authorized domains.`;
  }
}
