"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { readConsent, writeConsent, type ConsentLevel } from "@/lib/consent";

const subscribe = () => () => {};

export function ConsentBanner() {
  const stored = useSyncExternalStore(subscribe, readConsent, () => "essential" as const);
  const [chosen, setChosen] = useState<ConsentLevel | null>(null);
  if (stored || chosen) return null;
  const choose = (level: ConsentLevel) => { writeConsent(level); setChosen(level); };
  return (
    <div role="dialog" aria-label="Cookie choices" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface p-4 shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="text-sm">
          We use essential cookies to keep you signed in. With your permission we&apos;d also use privacy-friendly analytics to improve the site.{" "}
          <Link href="/cookies" className="underline">Cookie policy</Link>
        </p>
        <div className="flex shrink-0 gap-2 sm:ml-auto">
          <button onClick={() => choose("essential")} className="rounded-lg border border-line px-4 py-2 text-sm">Essential only</button>
          <button onClick={() => choose("all")} className="rounded-lg bg-brand-700 px-4 py-2 text-sm text-white">Accept all</button>
        </div>
      </div>
    </div>
  );
}
