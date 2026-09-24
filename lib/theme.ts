/** Theme preference shared by the server layout (reads the cookie) and the client provider. */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_COOKIE = "dsa-theme";

export function parseThemePreference(value: string | undefined | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

/** Class for <html>: "light"/"dark" for an explicit choice, none for System (CSS media query decides). */
export function themeClassName(pref: ThemePreference): string | undefined {
  return pref === "system" ? undefined : pref;
}
