---
name: CricketLive
description: Live cricket scores, fixtures and results, dressed as the cricket ball itself.
colors:
  leather-950: "#3d0710"
  leather-900: "#5c0a15"
  leather-800: "#7d0f1d"
  leather-700: "#9b1426"
  leather-600: "#b3172b"
  thread: "#f3e3c6"
  pinkball: "#e8508a"
  pinkball-ink: "#b4235e"
  live: "#c8285f"
  brand-50: "#fcf1f2"
  brand-100: "#f8dde1"
  brand-600: "#b3172b"
  brand-700: "#9b1426"
  brand-900: "#5c0a15"
  white-ball: "#eceff3"
  ink: "#151820"
  muted: "#59616e"
  stitch-idle: "#b9c0ca"
  stitch-paused: "#8a93a0"
  line: "#dde1e7"
  surface: "#ffffff"
  canvas: "#f3f5f8"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, 1.5rem + 1.5vw, 2.25rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 112"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 1.1rem + 0.5vw, 1.5rem)"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.025em"
    fontVariation: "'wdth' 112"
  score:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 1.2rem + 1vw, 1.875rem)"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "'tnum' 1"
    fontVariation: "'wdth' 82"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.12em"
    fontVariation: "'wdth' 112"
rounded:
  inner: "8px"
  card: "16px"
  pill: "9999px"
spacing:
  row-y: "12px"
  gutter: "16px"
  card-pad: "20px"
  column-gap: "48px"
  section-gap: "56px"
components:
  site-header:
    backgroundColor: "{colors.leather-800}"
    textColor: "{colors.thread}"
    height: "64px"
  nav-link:
    textColor: "{colors.thread}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  search-field:
    backgroundColor: "{colors.leather-950}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
  search-field-focus:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
  match-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px"
  match-card-feature:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  status-chip-live:
    textColor: "{colors.pinkball-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  list-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "12px 16px"
  list-row-hover:
    backgroundColor: "{colors.brand-50}"
  rail-arrow:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    size: "36px"
  rail-arrow-hover:
    backgroundColor: "{colors.brand-50}"
  footer:
    backgroundColor: "{colors.leather-950}"
    textColor: "{colors.thread}"
---

# Design System: CricketLive

## Overview

**Creative North Star: "The Seam"**

The cricket ball is the brand. The shell of every page is its leather: a deep red header and footer, each edged with a row of cream thread stitches. Inside, the ground is the cool grey-white of a white ball, and match content sits on plain white cards and divided lists. The seam is the system's one signature device: stitches drawn as short paired slants carry match progress, and the form of a stitch (solid, dashed, struck) carries state.

Every match is coded by the ball it is played with. A red ball marks Tests and first-class cricket; a white ball with a red seam marks limited overs. Pink is the colour of live play and is reserved for it. Colour is flat throughout: no gradients, no glass, no imagery standing in for data. One variable family (Archivo) does all the work by changing width: wide for headings and the wordmark, condensed and tabular for big scores.

Motion is mostly ease-out. A single bounce (a 380 ms overshoot, like a ball off the pitch) belongs to a score that has just changed and to the brand ball spinning on hover; nothing else bounces.

**Key Characteristics:**
- Leather-red shell (header, footer) edged with a cream thread seam strip.
- Cool white-ball canvas with white cards and divided lists.
- Ball-coded matches: red ball = long format, white ball = limited overs.
- Stitch form carries state, never colour alone.
- One family, three widths: wide headings, normal body, condensed tabular scores.
- Pink means live and nothing else.

## Colors

A leather-and-thread palette over a cool, nearly colourless ground, with one pink reserved for live play.

### Primary
- **Match Leather** (leather-800): the header bar, browser theme colour, and text selection. The surface the brand lives on.
- **Seam Red** (leather-700 / brand-700): ball-coded card edges for red-ball matches, the red ball body, accent text (section links, day labels, chase lines, result lines), hover text on links.
- **Bright Leather** (leather-600 / brand-600): focus ring, bowled stitches in the seam bar, the white ball's seam, the colour a bumped score flashes to.
- **Dark Leather** (leather-900, leather-950): the seam strip behind the thread stitches (900) and the footer ground (950). The search field sits on 950 at 40%.
- **Thread Cream** (thread): stitches on leather, header and footer text, the red ball's seam.

### Secondary
- **Pink Ball** (pinkball): the live dot and its pulse ring, and a 12% tint behind the live status chip. Nothing else.
- **Pink Ball Ink** (pinkball-ink): text that says something is live (the "Live" chip label, the live match count beside "Live now").
- **Live** (live): the incumbent live token, remapped into the pink family; inherited pages use it for live badges and text.

### Neutral
- **Scoreboard Ink** (ink): all primary text and leading scores; trailing scores and inactive sides use ink at 55-75% opacity.
- **Muted Slate** (muted): meta text (series, overs, times, captions).
- **White-Ball Ground** (canvas): the page background.
- **Card White** (surface): cards, list panels, rail arrows.
- **Hairline** (line): card and panel borders, list dividers, the unbowled seam line.
- **White Ball** (white-ball): the white-ball body and the limited-overs card edge.
- **Idle Stitch** (stitch-idle) and **Paused Stitch** (stitch-paused): decorative stitch colours for overs still to come, upcoming fixtures, and a paused seam. Graphic use only, never text.
- **Brand tints** (brand-50, brand-100): row and button hover washes.

### Named Rules
**The Pink Is Live Rule.** The pink family (pinkball, pinkball-ink, live) appears only where play is live right now. It is never decoration, never a second accent.

**The Ball Code Rule.** A match's format is always shown by its ball (red or white) next to a text label naming the format. The ball never stands alone.

**The Flat Leather Rule.** Colours are flat fills. No gradients or glass on the shell or cards.

## Typography

**Display Font:** Archivo (variable, wdth axis), self-hosted via next/font, with ui-sans-serif / system-ui fallback.
**Body Font:** Archivo.

**Character:** One grotesque stretched to three widths. Wide (112%) for the wordmark and headings gives the voice a broadcast-graphic swagger; condensed (82-88%) tabular figures make scores read like a scoreboard and never jitter as they change.

### Hierarchy
- **Display** (800, 30px to 36px, wide, tight tracking): the page h1 ("Live now").
- **Headline** (700, 20px to 24px, wide, tight tracking): section headings, paired with a right-aligned leather-700 "more" link.
- **Score** (800, 24px to 30px, condensed 82%, tabular, line-height 1): the big scores on live cards. Compact cards and result rows use the same tabular `.score` treatment at 15-18px, weight 700-800.
- **Title** (600, 16px): team names on live cards, story titles, fixture team names (500).
- **Body** (400, 15px): list rows and compact cards; 14px for card meta lines; long-form articles at 17px / 1.75, max 70ch.
- **Label** (600, 12px, wide, uppercase, 0.12em tracking): fixture day headings ("Today", "Tomorrow") in leather-700. The live chip uses 11px, uppercase, wide tracking.

### Named Rules
**The Scoreboard Rule.** Every number that can change while someone watches (scores, overs, counts, times) is tabular.

**The One Family Rule.** Hierarchy comes from width, weight and size within Archivo. No second display face.

## Layout

A single centred column (max 72rem / 1152px) with 16px gutters; sections stack 56px apart. The first viewport opens with "Live now" and a horizontal snap rail of live cards: 85% of the width per card on phones (the next one peeks), 46% at sm, exactly three across at lg with prev/next arrows when more than three are live. The rail bleeds to the screen edge on phones and snaps flush at desktop.

Below the rail, a two-column split at lg (1.6fr : 1fr, 48px gap): fixtures grouped by day on the left; stories and results on the right. Phones stack it. Highlights run as a three-up grid. Lists use 16px horizontal and 12px vertical row padding; live cards use 20px padding, compact cards 16px.

## Elevation & Depth

Mostly flat: depth comes from the white card on the cool canvas and from hairline borders. Shadows are soft and leather-tinted, never hard offsets, and appear in only two places.

### Shadow Vocabulary
- **Header lift** (`box-shadow: 0 6px 18px -10px rgba(61,7,16,0.6)`): under the sticky leather header, so content scrolls beneath it.
- **Card hover** (`box-shadow: 0 12px 28px -14px rgba(93,10,21,0.4)`): match cards on hover, together with a 2px rise.

### Named Rules
**The Flat-At-Rest Rule.** Cards have no shadow at rest; the leather-tinted shadow only answers hover.

## Shapes

Generous, friendly rounding: cards and list panels use the 16px card radius; interactive chrome (nav links, search, status chips, rail arrows) is pill-shaped; smaller inner media and code blocks use 8px. Feature cards carry an 8px ball-coded strip across the top edge, clipped by the card radius. The recurring geometry is the stitch: short paired slants, all leaning the same way, either side of a hairline seam.

## Components

### Site Header and Footer
Leather to the edge. The header is a sticky 64px leather-800 bar: the red ball mark (which spins 200 degrees with the bounce on hover) beside a wide, extrabold "CricketLive" wordmark, pill nav links in thread at 85% that wash to white/10 on hover, and a pill search field on dark leather that turns white with ink text on focus. On phones the nav becomes a horizontally scrolling pill row. Under the bar, a 10px seam strip: thread stitches on leather-900. The footer reverses this: the seam strip on top, then leather-950 with thread text.

### Match Card
A match read in one glance. White, 16px radius, hairline border (leather-700 at 20% when live). Header row: ball, format label, series, and the live chip at the right. Two team rows: name left, score right; the batting side is semibold ink, the other side ink at 55-75%. The live-rail feature card adds the ball-coded top edge, condensed 24-30px scores, overs in muted 12px, the seam bar, and a leather-700 "Need X off Y" chase line. Hover: rise 2px and the card shadow, 300 ms ease-out-expo. The whole card is one link.

### The Seam (signature)
An innings drawn as a ball's seam: one stitch per over at exact length. Bowled stitches are solid bright leather over a solid seam line; overs still to come are dashed idle stitches on the hairline; a paused match (stumps, delay) turns grey and its seam line is struck with a dashed overlay. Multi-day innings draw an open seam that only grows (8px pitch, one stitch per 5 overs past 60), never implying a target. On first paint the bowled stitches sew in left to right (420 ms, 18 ms stagger). It always carries a text label for assistive tech.

### Stitch Mark
A three-stitch list marker. Upcoming: loose dashed grey stitches with no seam line. Finished: solid seam-red stitches on a closed seam line. Decorative; the row always says the same in text.

### Status Chip
Pill, 11px uppercase semibold. Live: the breathing pink dot plus "Live" in pinkball-ink on a 12% pink tint. Other in-play states (toss, innings break, stumps, delayed) are quiet: muted text on canvas.

### Lists (fixtures, results, stories)
Fixtures and results are white panels with a 16px radius, hairline border and dividers; rows wash to brand-50 at 60% on hover and each row is one link. Fixture rows: stitch mark, tabular start time, teams (stacked on phones so no name is cut), series in muted, ball plus format at the right. Fixtures group under a wide uppercase leather-700 day label. Stories are a borderless divided list whose titles turn leather-700 on hover.

### Buttons
Rail arrows are 36px white circles with a hairline border and an inline chevron; hover lifts 2px and washes brand-50. Focus everywhere is a 2px leather-600 outline offset 2px.

## Do's and Don'ts

### Do:
- **Do** put the leather shell and its thread seam strip on every page; content lives on the canvas between them.
- **Do** code every match by its ball, always beside the format label.
- **Do** show state by stitch form (solid, dashed, struck) and in text, never by colour alone.
- **Do** set every changing number in tabular figures; big live scores condensed.
- **Do** keep the 380 ms bounce for a just-changed score and the brand ball; ease everything else out (cubic-bezier(0.16, 1, 0.3, 1)).
- **Do** draw every stitch as the same paired parallel slant, everywhere it appears.
- **Do** respect reduced motion: no pulse, sew-in, bounce or hover rise.

### Don't:
- **Don't** use pink for anything but live play.
- **Don't** use gradients, glass, or hard offset shadows on the shell or cards.
- **Don't** add a second typeface; use Archivo's width axis instead.
- **Don't** imply a target for an innings that has none (multi-day innings draw an open seam).
- **Don't** return to the retired emerald/slate look: no green bars, no slate chrome.
