import type { Metadata, Viewport } from "next";
import "@mantine/core/styles.css";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "./globals.css";
import "./editor-blocks.css";

export const metadata: Metadata = { title: "Raspberry — Room to think", description: "A quiet home for your notes, ideas, and everything you want to make happen." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content", themeColor: "#f7f7f4" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
