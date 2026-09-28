"use client";

import * as React from "react";
import { AlertTriangle, Cloud, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useSyncSetup } from "@/components/sync/sync-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import Link from "next/link";
import { getProblemById } from "@/data/problems";
import { syncNow, uploadDeviceNote, useSyncStore, type SyncStatus, type UnsyncedNote } from "@/lib/sync/engine";
import { SYNC_LIMITS } from "@/lib/sync/types";

const KIND_LABEL: Record<UnsyncedNote["kind"], string> = { note: "notes", mistakes: "mistakes", code: "code" };

function UnsyncedNotes({ items }: { items: UnsyncedNote[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5" data-testid="unsynced-notes">
      <p className="font-medium">Kept on this device only</p>
      <ul className="space-y-2">
        {items.map((n) => {
          const p = getProblemById(n.id);
          const title = p ? p.title : `Problem ${n.id}`;
          return (
            <li key={n.key} className="space-y-1 text-muted-foreground">
              <p>
                <Link href={`/problems/${n.id}`} className="font-medium text-foreground hover:underline">
                  {title}
                </Link>{" "}
                ({KIND_LABEL[n.kind]}, {n.chars.toLocaleString()} characters):{" "}
                {n.reason === "too_long"
                  ? `longer than the ${SYNC_LIMITS.maxNoteChars.toLocaleString()}-character sync limit. It's saved here; shorten it and it syncs again.`
                  : "changed on another device too, and both versions together are too long to keep in one note. This device keeps its version; your other devices keep theirs."}
              </p>
              {n.reason === "merge_too_long" && n.chars <= SYNC_LIMITS.maxNoteChars && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (uploadDeviceNote(n.key)) void syncNow();
                  }}
                >
                  Use this device&apos;s version everywhere
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const LABEL: Record<SyncStatus, string> = {
  off: "Sync off",
  syncing: "Syncing…",
  synced: "Synced",
  offline: "Offline — changes saved on this device",
  error: "Sync failed",
};

function timeAgo(at: number | null): string {
  if (!at) return "not yet";
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function StatusIcon({ status, className = "h-4 w-4" }: { status: SyncStatus; className?: string }) {
  if (status === "syncing") return <Loader2 className={`${className} animate-spin`} />;
  if (status === "offline") return <CloudOff className={className} />;
  if (status === "error") return <AlertTriangle className={`${className} text-destructive`} />;
  return <Cloud className={className} />;
}

/** Top-bar indicator; only shown while sync is active for this device. */
export function SyncIndicator() {
  const { status, pending } = useSyncStore();
  if (status === "off") return null;
  const label = `${LABEL[status]}${pending && status !== "syncing" ? ` · ${pending} change${pending === 1 ? "" : "s"} waiting` : ""}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => void syncNow()}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Cloud sync: ${label}`}
          data-testid="sync-indicator"
          data-status={status}
        >
          <StatusIcon status={status} />
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Account page card: what sync is doing, or why it's off. */
export function SyncCard() {
  const { entitlements, openSetup, pausedOnDevice } = useSyncSetup();
  const { status, lastSyncedAt, pending, message, conflicts, unsynced } = useSyncStore();
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 30_000);
    return () => clearInterval(id);
  }, []);

  const available = entitlements?.features.cloudSync === true;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <StatusIcon status={available ? status : "off"} /> Cloud sync
        </CardTitle>
        <CardDescription>
          {available
            ? "Keeps your progress, bookmarks, notes, streak and theme the same on every device you sign in on."
            : "Keeps your progress the same on every device. Cloud sync is part of AlgoVerse Pro (coming soon) — your progress stays saved on this device either way."}
        </CardDescription>
      </CardHeader>
      {available && (
        <CardContent className="space-y-3 text-sm">
          {entitlements?.grantedBy === "preview" && (
            <p className="text-xs text-muted-foreground">Enabled for testing on this Preview deployment.</p>
          )}
          {status === "off" ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                {pausedOnDevice ? "Sync is off on this device (you chose to keep this device's progress here only)." : "Sync isn't running on this device yet."}
              </p>
              <Button variant="outline" onClick={openSetup}>
                Set up sync on this device
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p data-testid="sync-status-text">
                <span className="font-medium">{LABEL[status]}</span>
                <span className="text-muted-foreground"> · last synced {timeAgo(lastSyncedAt)}</span>
                {pending > 0 && <span className="text-muted-foreground"> · {pending} change{pending === 1 ? "" : "s"} waiting</span>}
              </p>
              {message && <p className="text-muted-foreground">{message}</p>}
              {conflicts > 0 && (
                <p className="text-muted-foreground">
                  {conflicts} note{conflicts === 1 ? " was" : "s were"} edited on two devices at once — both versions were kept
                  in the note, marked &quot;Conflicting copy&quot;.
                </p>
              )}
              <UnsyncedNotes items={unsynced} />
              <Button variant="outline" size="sm" onClick={() => void syncNow()} disabled={status === "syncing"}>
                <RefreshCw className="h-4 w-4" />
                Sync now
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
