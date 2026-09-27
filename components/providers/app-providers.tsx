"use client";

import * as React from "react";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { StoreHydration } from "@/components/providers/store-hydration";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeyboardShortcutsListener } from "@/components/layout/keyboard-shortcuts-listener";
import { PwaManager } from "@/components/pwa/pwa-manager";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import type { ThemePreference } from "@/lib/theme";

export function AppProviders({
  children,
  initialTheme = "system",
}: {
  children: React.ReactNode;
  initialTheme?: ThemePreference;
}) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <AuthProvider>
        <TooltipProvider delayDuration={200}>
          <StoreHydration />
          <KeyboardShortcutsListener />
          <PwaManager />
          {children}
          <InstallPrompt />
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
