import { PageHero } from "./PageHero";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="space-y-8">
      <PageHero title={title} subtitle={`Last updated ${updated}`} />
      <article className="article mx-auto max-w-3xl rounded-[var(--radius-card)] border border-line bg-surface p-6 sm:p-10">{children}</article>
    </div>
  );
}
