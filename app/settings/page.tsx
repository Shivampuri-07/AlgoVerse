"use client";

import * as React from "react";
import { Download, Upload, Trash2, KeyRound, Info } from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/lib/store";
import { useSyncStore } from "@/lib/sync/engine";
import { PROBLEMS } from "@/data/problems";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { useUIStore } from "@/lib/ui-store";
import { LEGACY_TITLES } from "@/data/legacyIdMap";
import { DatasetHealth } from "@/components/settings/dataset-health";
import { InstallCard } from "@/components/pwa/install-card";
import type { LegacyProgress, ProgressExport } from "@/lib/types";

function legacyEntries(legacy: LegacyProgress | undefined) {
  if (!legacy) return [];
  const ids = new Set<number>([
    ...Object.keys(legacy.completed).map(Number),
    ...legacy.bookmarked,
    ...Object.keys(legacy.notes).map(Number),
    ...Object.keys(legacy.mistakes).map(Number),
    ...Object.keys(legacy.code).map(Number),
  ]);
  return Array.from(ids)
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      title: LEGACY_TITLES[id] ?? `Problem ${id}`,
      completed: Boolean(legacy.completed[id]),
      bookmarked: legacy.bookmarked.includes(id),
      hasNotes: Boolean(legacy.notes[id] || legacy.mistakes[id] || legacy.code[id]),
    }));
}

export default function SettingsPage() {
  const exportProgress = useAppStore((s) => s.exportProgress);
  const importProgress = useAppStore((s) => s.importProgress);
  const resetProgress = useAppStore((s) => s.resetProgress);
  const completedCount = useAppStore((s) => Object.keys(s.completed).length);
  const bookmarkedCount = useAppStore((s) => s.bookmarked.length);
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const legacy = useAppStore((s) => s.legacy);
  const legacyItems = legacyEntries(legacy);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [resetOpen, setResetOpen] = React.useState(false);
  const syncing = useSyncStore((s) => s.status !== "off");

  function handleExport() {
    const data = exportProgress();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `algoverse-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success("Progress exported");
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (
      syncing &&
      !window.confirm(
        "Cloud sync is on. Importing replaces the progress on this device, and the changes (including removals) sync to your account and your other devices. Continue?"
      )
    )
      return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<ProgressExport>;
        if (typeof parsed !== "object" || parsed === null || !("completed" in parsed)) {
          throw new Error("Missing completed field");
        }
        const result = importProgress(parsed as ProgressExport);
        if (result.migrated || result.keptAsLegacy) {
          toast.success(
            `Imported an older backup: ${result.migrated} problems mapped to the A2Z sheet, ` +
              `${result.keptAsLegacy} kept as previous-dataset progress.`
          );
        } else {
          toast.success("Progress imported successfully");
        }
      } catch {
        toast.error("That file doesn't look like a valid AlgoVerse export.");
      }
    };
    reader.onerror = () => toast.error("Couldn't read that file.");
    reader.readAsText(file);
  }

  function handleReset() {
    resetProgress();
    setResetOpen(false);
    toast.success("Progress reset");
  }

  return (
    <div className="max-w-2xl space-y-6 pb-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your data, appearance and shortcuts.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Switch between light, dark, or match your system.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <InstallCard />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Data Management</CardTitle>
          <CardDescription>
            {syncing
              ? "Your progress is saved in this browser and synced to your account. You can still export a backup file."
              : "Your progress lives only in this browser's local storage. Export it regularly to keep a backup, or move it to another device."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground sm:grid-cols-3">
            <span>{PROBLEMS.length} total problems</span>
            <span>{completedCount} completed</span>
            <span>{bookmarkedCount} bookmarked</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleExport} variant="outline">
              <Download className="h-4 w-4" />
              Export Progress
            </Button>
            <Button onClick={handleImportClick} variant="outline">
              <Upload className="h-4 w-4" />
              Import Progress
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={handleFileChange}
              className="hidden"
              aria-label="Import progress JSON file"
            />
            <Button onClick={() => setResetOpen(true)} variant="destructive">
              <Trash2 className="h-4 w-4" />
              Reset Progress
            </Button>
          </div>
        </CardContent>
      </Card>

      {legacyItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress from the previous problem set</CardTitle>
            <CardDescription>
              These problems from the original 152-problem starter set have no identical problem in the A2Z
              sheet, so their progress couldn&apos;t be moved onto an A2Z problem. It hasn&apos;t been deleted:
              it&apos;s kept here, counts toward your streak history, and is included in exports.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {legacyItems.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-accent/50">
                  <span className="truncate">{item.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {[item.completed && "done", item.bookmarked && "★", item.hasNotes && "notes"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <DatasetHealth />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Keyboard Shortcuts</CardTitle>
          <CardDescription>Navigate AlgoVerse without leaving your keyboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setShortcutsOpen(true)}>
            <KeyRound className="h-4 w-4" />
            View shortcuts
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Info className="h-4 w-4" /> About this data
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          The roadmap order, sections and problem titles follow Striver&apos;s publicly available A2Z DSA
          Sheet. No problem statements, UI or branding are copied — each item links to the original problem
          page, and a platform link is only included when it was verified to be that exact problem. Edit
          the data in <code className="rounded bg-muted px-1 py-0.5">data/a2zProblems.ts</code>; sources and
          the link audit are in <code className="rounded bg-muted px-1 py-0.5">docs/A2Z_DATASET.md</code>.
        </CardContent>
      </Card>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset all progress?</DialogTitle>
            <DialogDescription>
              This permanently clears your completed problems, bookmarks, notes and streak from this browser.
              {syncing && " Cloud sync is on, so they are also cleared from your account and your other synced devices."}{" "}
              This can&apos;t be undone — export a backup first if you want to keep it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleReset}>
              Reset everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
