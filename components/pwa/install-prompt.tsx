"use client";

import * as React from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlgoVerseLogo } from "@/components/brand/algoverse-logo";
import { promptInstall, usePwaStore } from "@/lib/pwa-store";

const DISMISS_KEY = "algoverse-install-dismissed-at";
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // ask again after 30 days at most

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * A small, dismissible "Install AlgoVerse" card. Only appears when the browser has actually
 * offered installation (`beforeinstallprompt`), never when already installed, and stays
 * hidden for 30 days after "Not now". Browsers without an install event (iOS Safari,
 * Firefox) get instructions under Settings → Install app instead of a fake prompt.
 */
export function InstallPrompt() {
  const installEvent = usePwaStore((s) => s.installEvent);
  const installed = usePwaStore((s) => s.installed);
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    if (!installEvent || installed) return setHidden(true);
    // Let the page settle before offering installation.
    const t = window.setTimeout(() => setHidden(dismissedRecently()), 4000);
    return () => window.clearTimeout(t);
  }, [installEvent, installed]);

  if (hidden || !installEvent || installed) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage unavailable — just hide for this visit */
    }
    setHidden(true);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="install-algoverse-title"
      className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm rounded-xl border border-border bg-card p-4 shadow-lg animate-in fade-in slide-in-from-bottom-2 lg:bottom-6 lg:left-auto lg:right-6 lg:mx-0"
    >
      <div className="flex items-start gap-3">
        <AlgoVerseLogo className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p id="install-algoverse-title" className="text-sm font-semibold">
            Install AlgoVerse
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Open it from your home screen or dock like an app. Pages you&apos;ve visited keep working offline.
          </p>
        </div>
        <Button variant="ghost" size="icon" className="-mr-2 -mt-2 h-8 w-8" onClick={dismiss} aria-label="Dismiss">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={dismiss}>
          Not now
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            const accepted = await promptInstall();
            if (!accepted) dismiss();
          }}
        >
          <Download className="h-4 w-4" />
          Install
        </Button>
      </div>
    </div>
  );
}
