---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/components/MatchCard.tsx","src/components/SiteHeader.tsx"]
---

# Home (live & upcoming)

Scope: public home page `/` and the shared shell (header, footer, match cards) that every page inherits. Mode: Operate.
Audience/job: fans worldwide on phones and desktops checking what's live, the score of a chase, and what's on next. Success: current state of every live match readable at a glance; next fixtures easy to scan by day.
Constraints: CDN-cacheable identical HTML, own-origin fonts only, no browser storage, reduced-motion respected, live updates via existing polling only where it already exists.
Memorable moment: live chases drawn as a stitched seam filling over by over; matches coded by the ball they are played with.

## Direction contract

THESIS: The cricket ball is the brand. A leather-red shell and a seam that carries match progress; every match is coded by its ball (red = Tests/first-class, white = limited overs); the pink ball marks live play (no day-night flag exists in our data yet). Refuses the category default of identical white score cards in a 3-column grid under a green bar.

OWN-WORLD: Leather red #7d0f1d→#b3172b shell; cool white-ball ground #f4f6f8 with white cards; ink #151820; pink-ball #e8508a for the live pulse only; seam stitches as short dashed strokes (solid = live, dashed = upcoming, struck = finished). Flat colour, no gradients or glass; one family scaled in steps, tabular scores large; one bounce timing (380ms overshoot) used only by a changed score and the brand ball; everything else eases out.

STORY: The visitor sees what is live and how close each game is, taps into a match, then scans today's and tomorrow's fixtures and recent results.

FIRST VIEWPORT: Leather header (wordmark with seam ball mark, nav, search). Below: "Live now" heading with count; a horizontal snap rail of live cards (desktop shows 3–4), each with ball chip, format, series, two team rows with big tabular scores, and a seam bar of overs bowled with stitches; chasing cards show "need X off Y". Right under: Upcoming grouped by day with time column.

FORM: The Seam (cricket ball), grounded list position 4 of 7; seed 602d8f97. Signature move: the stitched seam progress bar.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
