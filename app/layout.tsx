import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { cn } from "@/lib/utils";

// globals.css maps --font-sans -> Inter and --font-mono -> Geist Mono.
// Geist Sans was loaded here but never referenced by the theme, so it is not
// declared: every family listed costs a build-time fetch and bytes on the wire.
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Sari-Sari Store POS",
  description: "Ralph's Sari-Sari Store POS System",
};

// Without viewport-fit=cover, every env(safe-area-inset-*) used across the
// app's bottom sheets/FABs (see components/pageShell.tsx and friends)
// resolves to 0 — the notch/home-indicator inset never actually applies,
// and each spot silently falls back to its static padding instead.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full",
        "antialiased",
        "font-sans",
        inter.variable,
        geistMono.variable
      )}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
