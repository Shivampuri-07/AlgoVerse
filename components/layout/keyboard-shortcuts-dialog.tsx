"use client";

import { useUIStore } from "@/lib/ui-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: "/", description: "Open search" },
  { keys: "g d", description: "Go to Dashboard" },
  { keys: "g p", description: "Go to Problems" },
  { keys: "g b", description: "Go to Bookmarks" },
  { keys: "g s", description: "Go to Settings" },
  { keys: "?", description: "Show this dialog" },
  { keys: "Esc", description: "Close dialog / search" },
];

export function KeyboardShortcutsDialog() {
  const open = useUIStore((s) => s.shortcutsOpen);
  const setOpen = useUIStore((s) => s.setShortcutsOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Move around AlgoVerse without touching your mouse.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{s.description}</span>
              <kbd className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
