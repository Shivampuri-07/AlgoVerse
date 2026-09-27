"use client";

import * as React from "react";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AuthProvider } from "@/components/providers/auth-provider";
import { FirebaseConfigProvider, type FirebaseSetup } from "@/components/providers/firebase-config-provider";
import { StoreHydration } from "@/components/providers/store-hydration";
import { TooltipProvider } from "@/components/ui/tooltip";
import { KeyboardShortcutsListener } from "@/components/layout/keyboard-shortcuts-listener";
import { PwaManager } from "@/components/pwa/pwa-manager";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import type { ThemePreference } from "@/lib/theme";

export function AppProviders({
  children,
  initialTheme = "system",
  firebase,
}: {
  children: React.ReactNode;
  initialTheme?: ThemePreference;
  firebase: FirebaseSetup;
}) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <FirebaseConfigProvider value={firebase}>
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
      </FirebaseConfigProvider>
    </ThemeProvider>
  );
}
