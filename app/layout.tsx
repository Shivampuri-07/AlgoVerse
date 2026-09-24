import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";
import { AppProviders } from "@/components/providers/app-providers";
import { AppShell } from "@/components/layout/app-shell";
import { THEME_COOKIE, parseThemePreference, themeClassName } from "@/lib/theme";
import { APP_NAME, APP_SHORT_DESCRIPTION } from "@/lib/constants";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Absolute URLs for Open Graph images: the Vercel production domain when deployed there
// (set automatically by Vercel at build time), otherwise localhost.
const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_SHORT_DESCRIPTION,
  applicationName: APP_NAME,
  // The manifest (app/manifest.ts) and icons (app/icon.svg, app/favicon.ico,
  // app/apple-icon.png) are linked automatically by Next.js.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_SHORT_DESCRIPTION,
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: APP_NAME }],
  },
  twitter: { card: "summary", title: APP_NAME, description: APP_SHORT_DESCRIPTION, images: ["/icons/icon-512.png"] },
  other: {
    // Older iOS versions only read the legacy tag.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout extend under the iPhone notch/home indicator; the bottom navigation pads
  // itself with env(safe-area-inset-bottom).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0e14" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The theme choice is a cookie, so the server renders <html> with the right class and the
  // client hydrates it unchanged — no theme script touching the DOM before React.
  const theme = parseThemePreference((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" className={themeClassName(theme)}>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <AppProviders initialTheme={theme}>
          <AppShell>{children}</AppShell>
        </AppProviders>
      </body>
    </html>
  );
}
