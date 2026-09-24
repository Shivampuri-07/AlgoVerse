"use client";

import { useGlobalKeyboardShortcuts } from "@/lib/use-keyboard-shortcuts";

/** Mounts the global keydown listener. Renders nothing. */
export function KeyboardShortcutsListener() {
  useGlobalKeyboardShortcuts();
  return null;
}
