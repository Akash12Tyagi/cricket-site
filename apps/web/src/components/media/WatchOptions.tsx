"use client";

import { useSyncExternalStore } from "react";
import type { WatchOption } from "@/lib/api";

/**
 * Rough country from the browser's time zone, used only to put the visitor's own broadcaster first. Computed in
 * the browser and never stored or sent anywhere, so pages stay identical for everyone (CDN-cacheable) and no
 * location data is collected.
 */
const ZONES: [RegExp, string][] = [
  [/^Asia\/(Kolkata|Calcutta)$/, "IN"], [/^Asia\/Karachi$/, "PK"], [/^Asia\/(Dhaka|Dacca)$/, "BD"], [/^Asia\/Colombo$/, "LK"],
  [/^Asia\/Kabul$/, "AF"], [/^Asia\/Kathmandu$/, "NP"], [/^Asia\/Dubai$/, "AE"], [/^Asia\/(Singapore|Kuala_Lumpur)$/, "SG"],
  [/^Europe\/(London|Belfast)$/, "GB"], [/^Europe\/Dublin$/, "IE"], [/^Australia\//, "AU"], [/^Pacific\/(Auckland|Chatham)$/, "NZ"],
  [/^Africa\/Johannesburg$/, "ZA"], [/^Africa\/Harare$/, "ZW"],
  [/^America\/(Port_of_Spain|Barbados|Jamaica|Guyana|Antigua|St_Lucia|Grenada|St_Vincent|St_Kitts|Dominica)$/, "WI"],
  [/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina)$/, "CA"],
  [/^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit)|Pacific\/Honolulu)$/, "US"],
];
const REGION_NAMES: Record<string, string> = { WW: "Worldwide", WI: "Caribbean" };
export const regionName = (code: string) => {
  if (REGION_NAMES[code]) return REGION_NAMES[code];
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code; } catch { return code; }
};

const subscribe = () => () => {};
export function useVisitorRegion(): string | null {
  return useSyncExternalStore(subscribe, () => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    return ZONES.find(([re]) => re.test(tz))?.[1] ?? null;
  }, () => null);
}

const KIND: Record<WatchOption["kind"], string> = { stream: "Streaming", tv: "TV", radio: "Radio" };

export function WatchOptions({ options }: { options: WatchOption[] }) {
  const mine = useVisitorRegion();
  if (options.length === 0) return null;
  const rank = (o: WatchOption) => (o.region === mine ? 0 : o.region === "WW" ? 1 : 2);
  const sorted = [...options].sort((a, b) => rank(a) - rank(b) || a.region.localeCompare(b.region));
  return (
    <section aria-labelledby="watch" className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-sm">
      <h2 id="watch" className="font-semibold">Where to watch</h2>
      <p className="mb-3 text-xs text-muted">Official broadcasters. Video plays on their site or app.</p>
      <ul className="divide-y divide-line">
        {sorted.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="w-28 shrink-0 text-xs text-muted">{regionName(o.region)}{o.region === mine && <span className="ml-1 rounded bg-brand-100 px-1 text-brand-900">You</span>}</span>
            <a href={o.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline">{o.name}</a>
            <span className="text-xs text-muted">{KIND[o.kind]}{o.note ? ` · ${o.note}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
