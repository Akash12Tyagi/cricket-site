import Link from "next/link";
import { AccountMenu } from "./AccountMenu";
import { Ball } from "./Ball";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/schedule", label: "Schedule" },
  { href: "/series", label: "Series" },
  { href: "/teams", label: "Teams" },
  { href: "/news", label: "News" },
  { href: "/videos", label: "Videos" },
];

/** Identical for every visitor (keeps pages CDN-cacheable); only <AccountMenu> personalises, client-side. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 bg-leather-800 text-thread shadow-[0_6px_18px_-10px_rgba(61,7,16,0.6)]">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="group flex items-center gap-2.5" aria-label="CricketLive home">
          <Ball kind="red" size={28} className="ball-spin drop-shadow-[0_1px_0_rgba(0,0,0,0.25)]" />
          <span className="wide text-xl font-extrabold tracking-tight text-white">Cricket<span className="text-thread">Live</span></span>
        </Link>
        <nav aria-label="Main" className="hidden gap-1 text-sm font-medium md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-full px-3 py-1.5 text-thread/85 transition-colors hover:bg-white/10 hover:text-white">{n.label}</Link>
          ))}
        </nav>
        <form action="/search" role="search" className="ml-auto hidden sm:block">
          <label className="sr-only" htmlFor="site-search">Search players, teams, series, news</label>
          <input id="site-search" name="q" type="search" minLength={2} maxLength={80} placeholder="Search players, teams…"
            className="w-48 rounded-full border border-white/15 bg-leather-950/40 px-4 py-1.5 text-sm text-white placeholder:text-thread/60 focus:border-thread/60 focus:bg-white focus:text-ink focus:outline-none lg:w-64" />
        </form>
        <span className="ml-auto sm:ml-0"><AccountMenu /></span>
      </div>
      <nav aria-label="Main (mobile)" className="flex gap-1 overflow-x-auto px-3 pb-2 text-sm font-medium md:hidden">
        {NAV.map((n) => <Link key={n.href} href={n.href} className="shrink-0 rounded-full px-3 py-1 text-thread/85 hover:bg-white/10">{n.label}</Link>)}
        <Link href="/search" className="shrink-0 rounded-full px-3 py-1 text-thread/85 hover:bg-white/10">Search</Link>
      </nav>
      <div aria-hidden className="seam-stitch bg-leather-900" />
    </header>
  );
}
