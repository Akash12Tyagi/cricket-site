"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Renders a time in the visitor's own timezone. The server (and first paint) shows UTC so the
 * HTML is identical for everyone and stays CDN-cacheable; the browser then swaps in local time.
 */
export function LocalTime({ iso, style = "datetime" }: { iso: string; style?: "datetime" | "date" | "time" }) {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions =
    style === "date" ? { weekday: "short", day: "numeric", month: "short", year: "numeric" }
    : style === "time" ? { hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
  const text = isClient ? d.toLocaleString(undefined, opts) : `${d.toLocaleString("en-GB", { ...opts, timeZone: "UTC" })} UTC`;
  return <time dateTime={iso}>{text}</time>;
}
