"use client";

import * as React from "react";
import { THEME_COOKIE, parseThemePreference, type ThemePreference } from "@/lib/theme";

/**
 * Light / Dark / System theme without a pre-hydration script.
 *
 * The preference lives in a cookie that the root layout reads on the server, so the
 * server-rendered <html> already carries the right class and React hydrates it unchanged
 * (no mismatch, no suppressHydrationWarning). "System" renders no class and lets the
 * `prefers-color-scheme` media query pick the palette, so it needs no script either.
 */
interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = React.createContext<ThemeContextValue>({ theme: "system", setTheme: () => {} });

const ONE_YEAR = 60 * 60 * 24 * 365;
/** Key the previous next-themes version stored the choice under (migrated once). */
const LEGACY_STORAGE_KEY = "theme";

function applyTheme(theme: ThemePreference) {
  const root = document.documentElement;
  // Avoid every element animating its colours at once while switching.
  const style = document.createElement("style");
  style.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(style);
  root.classList.remove("light", "dark");
  if (theme !== "system") root.classList.add(theme);
  void window.getComputedStyle(document.body).opacity; // flush styles
  window.setTimeout(() => style.remove(), 1);
}

function persistTheme(theme: ThemePreference) {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

export function ThemeProvider({
  initialTheme,
  children,
}: {
  initialTheme: ThemePreference;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = React.useState<ThemePreference>(initialTheme);

  const setTheme = React.useCallback((next: ThemePreference) => {
    setThemeState(next);
    applyTheme(next);
    persistTheme(next);
  }, []);

  // One-time migration from the old localStorage-based theme (after hydration, so no mismatch).
  React.useEffect(() => {
    if (document.cookie.split("; ").some((c) => c.startsWith(`${THEME_COOKIE}=`))) return;
    let legacy: string | null = null;
    try {
      legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    const pref = parseThemePreference(legacy);
    if (pref !== initialTheme) setTheme(pref);
    else persistTheme(pref);
  }, [initialTheme, setTheme]);

  const value = React.useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return React.useContext(ThemeContext);
}
