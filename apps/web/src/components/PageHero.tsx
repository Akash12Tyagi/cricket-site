/** Floodlit page header used across the site: one night-time band with the page's title at display size. */
export function PageHero({ title, subtitle, lead, aside, size = "md" }: {
  title: React.ReactNode; subtitle?: React.ReactNode; lead?: React.ReactNode; aside?: React.ReactNode; size?: "md" | "lg";
}) {
  return (
    <header className="floodlit relative isolate overflow-hidden rounded-[28px] px-5 py-7 sm:px-9 sm:py-10">
      <div aria-hidden className="seam-stitch absolute inset-x-0 bottom-0 opacity-60" />
      <div className="relative flex flex-wrap items-center gap-5">
        {lead}
        <div className="min-w-0 flex-1">
          <h1 className={`wide font-black tracking-tight text-white ${size === "lg" ? "text-4xl sm:text-6xl" : "text-3xl sm:text-5xl"}`}>{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl text-sm text-white/75 sm:text-base">{subtitle}</p>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
    </header>
  );
}

/** Section heading inside pages: wide display type with an optional link on the right. */
export function SectionTitle({ id, children, more }: { id?: string; children: React.ReactNode; more?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end gap-4">
      <h2 id={id} className="wide text-xl font-bold tracking-tight sm:text-2xl">{children}</h2>
      {more && <div className="ml-auto text-sm font-medium text-leather-700">{more}</div>}
    </div>
  );
}
