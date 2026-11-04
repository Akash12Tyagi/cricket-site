import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { ConsentBanner } from "@/components/ConsentBanner";
import { SiteHeader } from "@/components/SiteHeader";
import { Archivo } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font (served from our own origin: no third-party font requests, CSP stays strict).
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], display: "swap", variable: "--font-archivo" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3100"),
  title: { default: "CricketLive: Live Cricket Scores, Schedule & Results", template: "%s | CricketLive" },
  description: "Live cricket scores, ball-by-ball commentary, scorecards, schedules and news.",
  robots: { index: true, follow: true },
};
export const viewport: Viewport = { themeColor: "#7d0f1d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-2">Skip to content</a>
        <SiteHeader />
        <main id="main" className="mx-auto max-w-6xl px-4 py-8 sm:py-10">{children}</main>
        <footer className="mt-16 bg-leather-950 text-thread/80">
          <div aria-hidden className="seam-stitch bg-leather-900" />
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-8 text-xs">
            <span className="wide font-bold text-white">CricketLive</span>
            <Link href="/privacy" className="hover:text-white hover:underline">Privacy</Link>
            <Link href="/cookies" className="hover:text-white hover:underline">Cookies</Link>
            <Link href="/terms" className="hover:text-white hover:underline">Terms</Link>
            <Link href="/data" className="hover:text-white hover:underline">Sources &amp; coverage</Link>
            <span className="basis-full text-thread/65 sm:ml-auto sm:basis-auto">
              Match data: <a href="https://cricsheet.org/" className="underline hover:text-white">Cricsheet</a> (<a href="https://opendatacommons.org/licenses/by/1-0/" className="underline hover:text-white">ODC-By 1.0</a>) ·
              Player details: <a href="https://www.wikidata.org/" className="underline hover:text-white">Wikidata</a> (CC0) · © {new Date().getFullYear()} CricketLive
            </span>
          </div>
        </footer>
        <ConsentBanner />
      </body>
    </html>
  );
}
