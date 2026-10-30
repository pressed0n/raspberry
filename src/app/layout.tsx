import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "@mantine/core/styles.css";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./theme.css";
import "./shell.css";
import "./document.css";
import "./globals.css";
import "./editor-blocks.css";
import "./database.css";
import "./tabs.css";
import "./settings.css";
import { DEFAULT_THEME, THEME_BOOTSTRAP } from "@/lib/theme";
import { SETTINGS_BOOTSTRAP } from "@/lib/settings";

export const metadata: Metadata = {
  title: "Raspberry",
  description: "A local, single-user notes workspace.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  // Matches --canvas in each theme so the browser chrome does not flash white
  // above a dark page on mobile.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0c0c" },
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // `data-theme` is written again by the bootstrap script before paint; the
    // attribute here is the no-JavaScript fallback and keeps the first paint dark.
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        {/* `beforeInteractive` is the only strategy that runs before hydration and,
            unlike a raw <script> in the React tree, it is not dropped on client
            renders. */}
        <Script id="raspberry-theme" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        {/* Second, and it has to be: the palette cache is keyed by theme, so it
            reads `data-theme`. Both run before paint, so a custom palette never
            flashes the defaults first. */}
        <Script id="raspberry-settings" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: SETTINGS_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
