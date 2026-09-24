import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { CommandPalette } from "@/components/layout/command-palette";
import { KeyboardShortcutsDialog } from "@/components/layout/keyboard-shortcuts-dialog";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 px-4 pb-[calc(5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-8 lg:pb-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
      <MobileNav />
      <CommandPalette />
      <KeyboardShortcutsDialog />
    </div>
  );
}
