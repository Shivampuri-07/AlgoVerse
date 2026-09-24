"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useUIStore } from "@/lib/ui-store";

const CHORD_WINDOW_MS = 900;

/**
 * Global keyboard shortcuts, mounted once in the root layout:
 *  - "/"    focus/open the command palette (search)
 *  - "g d"  go to Dashboard
 *  - "g p"  go to Problems
 *  - "g b"  go to Bookmarks
 *  - "g s"  go to Settings
 *  - "?"    open the keyboard-shortcuts dialog
 *
 * Shortcuts are ignored while typing in an input, textarea, select, or any
 * contenteditable element, and while a dialog/command palette is already
 * open (so "/" inside the search box doesn't fight with itself).
 */
export function useGlobalKeyboardShortcuts() {
  const router = useRouter();
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);
  const setShortcutsOpen = useUIStore((s) => s.setShortcutsOpen);
  const commandOpen = useUIStore((s) => s.commandOpen);
  const pendingChord = useRef<{ key: string; time: number } | null>(null);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === "/") {
        e.preventDefault();
        setCommandOpen(true);
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (commandOpen) return;

      const now = Date.now();
      const pending = pendingChord.current;

      if (pending && pending.key === "g" && now - pending.time < CHORD_WINDOW_MS) {
        pendingChord.current = null;
        switch (e.key) {
          case "d":
            router.push("/");
            break;
          case "p":
            router.push("/problems");
            break;
          case "b":
            router.push("/bookmarks");
            break;
          case "s":
            router.push("/settings");
            break;
        }
        return;
      }

      if (e.key === "g") {
        pendingChord.current = { key: "g", time: now };
      } else {
        pendingChord.current = null;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, commandOpen, setCommandOpen, setShortcutsOpen]);
}
