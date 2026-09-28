"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { AlgoVerseLogo } from "@/components/brand/algoverse-logo";
import { APP_NAME } from "@/lib/constants";
import { useUIStore } from "@/lib/ui-store";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { RandomProblemButton } from "@/components/problems/random-problem-button";
import { AccountMenu } from "@/components/account/account-menu";
import { SyncIndicator } from "@/components/sync/sync-status";

export function Topbar() {
  const setCommandOpen = useUIStore((s) => s.setCommandOpen);

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:px-6">
      <Link href="/" className="-m-1.5 flex items-center gap-2 rounded-lg p-1.5 font-semibold tracking-tight lg:hidden" aria-label={`${APP_NAME} home`}>
        <AlgoVerseLogo />
        <span className="hidden sm:inline">{APP_NAME}</span>
      </Link>

      <button
        type="button"
        onClick={() => setCommandOpen(true)}
        className="flex h-9 flex-1 max-w-md items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-accent"
        aria-label="Search problems"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search problems...</span>
        <span className="sm:hidden">Search...</span>
        <kbd className="ml-auto hidden rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium sm:inline">
          /
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden sm:block">
          <RandomProblemButton />
        </div>
        <ThemeToggle />
        <SyncIndicator />
        <AccountMenu />
      </div>
    </header>
  );
}
