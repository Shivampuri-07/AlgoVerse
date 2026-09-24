import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";
import { AlgoVerseLogo } from "@/components/brand/algoverse-logo";
import { Button } from "@/components/ui/button";
import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false },
};

/**
 * Shown by the service worker when a page can't be loaded and wasn't saved for offline use.
 * Pre-cached (with its CSS/JS) when the service worker installs.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <AlgoVerseLogo className="mx-auto h-14 w-14" />
        <h1 className="mt-5 text-xl font-bold tracking-tight">You&apos;re currently offline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page isn&apos;t saved on this device yet. Pages you&apos;ve opened before still work, and your
          progress, bookmarks and notes are safe — they&apos;re stored on your device.
        </p>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          <WifiOff className="h-3.5 w-3.5" /> The AI helper and problem links need an internet connection.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <RetryButton />
          <Button asChild variant="outline">
            <Link href="/">Go to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
