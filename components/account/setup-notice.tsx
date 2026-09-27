"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { AuthCard } from "@/components/account/auth-card";
import { Button } from "@/components/ui/button";
import { useFirebaseSetup, type DeploymentInfo } from "@/components/providers/firebase-config-provider";
import type { AccountSetupStatus } from "@/lib/auth/shared";

export interface AccountSetup {
  /** Still asking the server. */
  checking: boolean;
  /** Sign-in and sign-up can be attempted on this deployment. */
  ready: boolean;
  /** Human-readable problems (names only, never values). Empty when ready. */
  problems: string[];
}

function describeDeployment(d: DeploymentInfo | null): string {
  if (!d) return "";
  const parts = [d.env, d.branch && `branch ${d.branch}`, d.commit && `commit ${d.commit}`].filter(Boolean);
  return parts.length ? ` (This page was served by: ${parts.join(", ")}.)` : "";
}

function describe(
  missing: string[],
  status: AccountSetupStatus | null,
  details: boolean,
  deployment: DeploymentInfo | null
): string[] {
  if (!details) {
    return missing.length || (status && status.server !== "ok")
      ? ["Sign-in is temporarily unavailable. Your progress on this device is safe — please try again later."]
      : [];
  }
  const out: string[] = [];
  if (missing.length) {
    out.push(
      `Browser sign-in config not found — this deployment's environment has no value for ${missing.join(", ")}.` +
        ` In Vercel → Settings → Environment Variables, check the exact names, that each is enabled for this` +
        ` environment (and any "Preview branch" restriction matches this branch), then redeploy this branch.` +
        describeDeployment(deployment) +
        " Open /api/auth/diagnostics for a yes/no check of every setting."
    );
  }
  switch (status?.server) {
    case "missing":
      out.push("Server credential FIREBASE_SERVICE_ACCOUNT_KEY is not set, so sign-in sessions can't be created. The browser config is separate and is not affected by this. Add it in Vercel (Sensitive) and redeploy.");
      break;
    case "invalid":
      out.push("FIREBASE_SERVICE_ACCOUNT_KEY is set but isn't a valid service-account JSON (or its private key is damaged). Paste the whole downloaded JSON file content again and redeploy.");
      break;
    case "sdk_unavailable":
      out.push(
        `The server couldn't load the Firebase Admin SDK${status.node ? ` (Node.js ${status.node})` : ""}` +
          (status.sdkError ? `: ${status.sdkError.code} — ${status.sdkError.message}` : ".") +
          " Sign-in sessions can't be created until this is fixed. /api/auth/diagnostics has the details."
      );
      break;
    case "project_mismatch":
      out.push("FIREBASE_SERVICE_ACCOUNT_KEY belongs to a different Firebase project than NEXT_PUBLIC_FIREBASE_PROJECT_ID. Use a key from the same project.");
      break;
  }
  if (status?.database === "missing") {
    out.push("Firestore has no database yet: Firebase console → Firestore Database → Create database (location asia-south1). Sign-in still works; profiles are saved once it exists.");
  }
  return out;
}

/** Checks this deployment's account setup: build-time public config + server credentials. */
export function useAccountSetup(): AccountSetup {
  const { missing, details, deployment } = useFirebaseSetup();
  const [status, setStatus] = React.useState<AccountSetupStatus | null>(null);
  const [checking, setChecking] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/status", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AccountSetupStatus>) : null))
      .catch(() => null)
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const problems = checking ? [] : describe(missing, status, details, deployment);
  // An unreachable status endpoint (offline) doesn't block the form: the submit reports the real error.
  const blocking = missing.length > 0 || (status !== null && status.server !== "ok");
  return { checking, ready: !checking && !blocking, problems };
}

export function SetupNotice({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <div role="status" className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-foreground">
      <p className="flex items-center gap-2 font-medium text-warning">
        <AlertTriangle className="h-4 w-4 shrink-0" /> Accounts aren&apos;t fully set up on this site yet
      </p>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {problems.map((p) => (
          <li key={p} className="break-words">
            {p}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Everything else in AlgoVerse works normally without an account.</p>
    </div>
  );
}

/** Full-page state for /account when this deployment can't verify sessions. */
export function AccountSetupRequired() {
  const setup = useAccountSetup();
  return (
    <AuthCard title="Account" description="Your progress, bookmarks and notes stay saved on this device.">
      <div className="space-y-4">
        {setup.checking ? (
          <p className="text-sm text-muted-foreground">Checking account setup…</p>
        ) : (
          <SetupNotice
            problems={setup.problems.length ? setup.problems : ["Sign-in is temporarily unavailable. Please try again later."]}
          />
        )}
        <Button asChild variant="outline" className="w-full">
          <Link href="/">Back to Dashboard</Link>
        </Button>
      </div>
    </AuthCard>
  );
}
