"use client";

import { create } from "zustand";

/** The non-standard `beforeinstallprompt` event (Chromium browsers: Chrome, Edge, Samsung Internet…). */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface PwaState {
  /** Saved install event — only set when the browser says the app can be installed. */
  installEvent: BeforeInstallPromptEvent | null;
  /** Running as an installed app (standalone window / home-screen launch). */
  installed: boolean;
  /** iPhone/iPad Safari: no install event exists, users add it via Share → Add to Home Screen. */
  isIos: boolean;
  setInstallEvent: (e: BeforeInstallPromptEvent | null) => void;
  setInstalled: (v: boolean) => void;
  setIsIos: (v: boolean) => void;
}

export const usePwaStore = create<PwaState>((set) => ({
  installEvent: null,
  installed: false,
  isIos: false,
  setInstallEvent: (installEvent) => set({ installEvent }),
  setInstalled: (installed) => set(installed ? { installed, installEvent: null } : { installed }),
  setIsIos: (isIos) => set({ isIos }),
}));

/** Shows the browser's own install dialog. Returns true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const { installEvent, setInstallEvent } = usePwaStore.getState();
  if (!installEvent) return false;
  await installEvent.prompt();
  const choice = await installEvent.userChoice.catch(() => ({ outcome: "dismissed" as const }));
  // An install event can only be used once.
  setInstallEvent(null);
  return choice.outcome === "accepted";
}
