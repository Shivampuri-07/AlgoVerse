"use client";

import * as React from "react";
import { usePwaStore, type BeforeInstallPromptEvent } from "@/lib/pwa-store";

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: window-controls-overlay)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Registers the service worker (production builds only) and tracks installability:
 * captures `beforeinstallprompt` so AlgoVerse can offer its own "Install" button, and
 * notices when the app is running installed. Renders nothing.
 */
export function PwaManager() {
  const setInstallEvent = usePwaStore((s) => s.setInstallEvent);
  const setInstalled = usePwaStore((s) => s.setInstalled);
  const setIsIos = usePwaStore((s) => s.setIsIos);

  React.useEffect(() => {
    setInstalled(isStandalone());
    const ua = navigator.userAgent;
    setIsIos(/iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1));

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep the event; we show our own, dismissible prompt instead
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // Dev builds change constantly and don't use hashed file names, so caching them would
    // serve stale code; the service worker is only registered for production builds.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      const register = () => {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
          /* unsupported or blocked (e.g. private mode) — the app works without it */
        });
      };
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [setInstallEvent, setInstalled, setIsIos]);

  return null;
}
