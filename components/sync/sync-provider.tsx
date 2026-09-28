"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import { useTheme } from "@/components/providers/theme-provider";
import type { ThemePreference } from "@/lib/theme";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EntitlementsView } from "@/lib/plans";
import {
  declineSync,
  ensureJournal,
  recordPreference,
  registerPreferencesHandler,
  setSyncIdentity,
  importDeviceAndStart,
  isSyncRunning,
  localHasData,
  readMeta,
  snapshotFromStore,
  startSync,
  stopSync,
  switchToCloudAndStart,
} from "@/lib/sync/engine";

/**
 * Starts/stops cloud sync for the signed-in user (Pro only — decided by the server) and asks the
 * documented first-login question when this device already holds progress:
 *   device never synced + has data   → Import and merge / Keep on this device only / Decide later
 *   device holds ANOTHER account     → Use this account's cloud data (device data backed up) /
 *                                      Merge this device into this account / Not now
 * Nothing is ever deleted; signing out just stops syncing.
 */
type Prompt = null | "import" | "other-owner";

interface SyncContextValue {
  entitlements: EntitlementsView | null;
  /** Re-open the first-login choice (e.g. after "Keep on this device only"). */
  openSetup: () => void;
  /** Sync is available for this account but not running on this device. */
  pausedOnDevice: boolean;
}

const SyncContext = React.createContext<SyncContextValue>({ entitlements: null, openSetup: () => {}, pausedOnDevice: false });

export function useSyncSetup() {
  return React.useContext(SyncContext);
}

function counts() {
  const s = snapshotFromStore();
  const notes = new Set([...Object.keys(s.notes), ...Object.keys(s.mistakes), ...Object.keys(s.code)]).size;
  return { completed: Object.keys(s.completed).length, bookmarks: s.bookmarked.length, notes };
}

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  const hydrated = useAppStore((s) => s.hydrated);
  const [entitlements, setEntitlements] = React.useState<EntitlementsView | null>(null);
  const [prompt, setPrompt] = React.useState<Prompt>(null);
  const [busy, setBusy] = React.useState(false);
  const [pausedOnDevice, setPausedOnDevice] = React.useState(false);
  const uid = status === "signed-in" ? user?.uid ?? null : null;

  // Theme preference sync (the theme is a cookie, not part of the progress store).
  const { theme, setTheme } = useTheme();
  const themeRef = React.useRef(theme);
  themeRef.current = theme;
  const remoteTheme = React.useRef<ThemePreference | null>(null);
  React.useEffect(() => {
    registerPreferencesHandler({
      current: () => themeRef.current,
      apply: (t) => {
        if (t === themeRef.current) return;
        remoteTheme.current = t; // applied from the cloud: don't send it back
        setTheme(t);
      },
    });
    return () => registerPreferencesHandler(null);
  }, [setTheme]);
  const firstTheme = React.useRef(true);
  React.useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    if (remoteTheme.current === theme) {
      remoteTheme.current = null;
      return;
    }
    recordPreference(theme);
  }, [theme]);

  // The change journal starts as soon as the store is loaded; it knows who's signed in.
  React.useEffect(() => {
    if (hydrated) ensureJournal();
  }, [hydrated]);
  React.useEffect(() => {
    setSyncIdentity(
      status === "signed-in" && user ? { state: "signed-in", uid: user.uid } : status === "loading" ? { state: "loading" } : { state: "signed-out" }
    );
  }, [status, user]);

  // Entitlements come from the server; the browser only displays them. The last answer is cached
  // (display only — every sync request is re-checked by the server) so an offline start still syncs later.
  React.useEffect(() => {
    if (!uid) {
      setEntitlements(null);
      return;
    }
    let cancelled = false;
    const cacheKey = `algoverse-entitlements:${uid}`;
    const load = () =>
      fetch("/api/me/entitlements", { cache: "no-store", credentials: "same-origin" })
        .then(async (r) => {
          if (!r.ok) return r.status === 401 || r.status === 403 ? null : undefined;
          const e = (await r.json()) as EntitlementsView;
          try {
            window.localStorage.setItem(cacheKey, JSON.stringify(e));
          } catch {
            /* ignore */
          }
          return e;
        })
        .catch(() => undefined) // network: fall back to the cached answer
        .then((e) => {
          if (cancelled) return;
          if (e !== undefined) return setEntitlements(e);
          try {
            const cached = window.localStorage.getItem(cacheKey);
            setEntitlements(cached ? (JSON.parse(cached) as EntitlementsView) : null);
          } catch {
            setEntitlements(null);
          }
        });
    void load();
    const onOnline = () => void load();
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
    };
  }, [uid]);

  const decide = React.useCallback(
    (force = false) => {
      if (!uid || !hydrated || !entitlements?.features.cloudSync) return;
      if (isSyncRunning(uid)) return;
      const meta = readMeta();
      if (meta.ownerUserId === uid) {
        setPausedOnDevice(false);
        startSync(uid);
        return;
      }
      if (!force && meta.declinedFor === uid) {
        setPausedOnDevice(true);
        return;
      }
      if (!meta.ownerUserId) {
        if (!localHasData()) {
          setPausedOnDevice(false);
          startSync(uid); // nothing local to merge: just download this account's data
          return;
        }
        setPrompt("import");
        return;
      }
      setPrompt("other-owner");
    },
    [uid, hydrated, entitlements]
  );

  React.useEffect(() => {
    if (!uid || !entitlements?.features.cloudSync) {
      stopSync();
      return;
    }
    decide();
  }, [uid, entitlements, decide]);

  // Signing out stops syncing (local data stays).
  React.useEffect(() => {
    if (status === "signed-out") {
      stopSync();
      setPrompt(null);
      setPausedOnDevice(false);
    }
  }, [status]);

  async function run(action: () => Promise<void> | void) {
    setBusy(true);
    try {
      await action();
      setPrompt(null);
      setPausedOnDevice(false);
    } catch {
      toast.error("That didn't work. Nothing on this device was changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const c = prompt ? counts() : null;
  const value = React.useMemo<SyncContextValue>(
    () => ({ entitlements, openSetup: () => decide(true), pausedOnDevice }),
    [entitlements, decide, pausedOnDevice]
  );

  return (
    <SyncContext.Provider value={value}>
      {children}
      <Dialog open={prompt !== null} onOpenChange={(open) => !open && !busy && setPrompt(null)}>
        <DialogContent>
          {prompt === "import" && c && uid && (
            <>
              <DialogHeader>
                <DialogTitle>Sync this device&apos;s progress to your account?</DialogTitle>
                <DialogDescription>
                  This device has {c.completed} completed problem{c.completed === 1 ? "" : "s"}, {c.bookmarks} bookmark
                  {c.bookmarks === 1 ? "" : "s"} and notes on {c.notes} problem{c.notes === 1 ? "" : "s"}. Importing merges
                  them with anything already in your account — nothing is deleted, and you can run it again safely.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" disabled={busy} onClick={() => setPrompt(null)}>
                  Decide later
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    run(() => {
                      declineSync(uid);
                      toast.message("Sync is off on this device. Your progress stays here; turn sync on from Account anytime.");
                    })
                  }
                >
                  Keep on this device only
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(() => {
                      importDeviceAndStart(uid);
                      toast.success("Importing this device's progress into your account…");
                    })
                  }
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Import and merge
                </Button>
              </DialogFooter>
            </>
          )}
          {prompt === "other-owner" && c && uid && (
            <>
              <DialogHeader>
                <DialogTitle>This device has progress from another account</DialogTitle>
                <DialogDescription>
                  The progress on this device ({c.completed} completed, {c.bookmarks} bookmarks) was last synced with a
                  different AlgoVerse account. It won&apos;t be merged into this account unless you choose to.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  <span className="font-medium text-foreground">Use this account&apos;s cloud data</span> — a full backup of
                  this device&apos;s current progress is kept on this device first.
                </p>
                <p>
                  <span className="font-medium text-foreground">Merge this device into this account</span> — adds this
                  device&apos;s progress to this account.
                </p>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" disabled={busy} onClick={() => setPrompt(null)}>
                  Not now
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => run(() => importDeviceAndStart(uid))}>
                  Merge this device into this account
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await switchToCloudAndStart(uid);
                      toast.success("Switched to this account's cloud data. The previous device data is backed up on this device.");
                    })
                  }
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Use this account&apos;s cloud data
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SyncContext.Provider>
  );
}
