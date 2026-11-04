# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Cricket fans worldwide (all countries and competitions equally: internationals, IPL, BBL, PSL, The Hundred, domestic and associate cricket). They use phones and desktops about equally: checking a live score in a spare moment, following a chase over by over, reading a match report or preview, browsing player careers, and watching official highlights.

## Product Purpose

CricketLive gives fans fast, reliable live scores, scorecards, schedules, player profiles, news and official videos, built to stay up for 10k+ concurrent fans during big matches. Success: fans get the current state of a match at a glance and come back during and after every match.

## Positioning

Every score and statistic is computed by our own scoring engine from ball-by-ball (or licensed scorecard) data; stories are written by editors or generated automatically from that data; videos are official uploads only. No scraped or re-streamed content.

## Operating Context

- Live match pages are polled every ~10 s and served from CDN/ISR cache; pages are identical for every visitor (no per-user rendering).
- Data sources: own scorers, licensed feeds (Highlightly scorecards; Sportmonks ball-by-ball), Cricsheet archive (8,000+ matches), Wikidata player facts, official YouTube channels.
- Some matches have ball-by-ball commentary; scorecard-feed matches have totals and cards only.

## Capabilities and Constraints

- Next.js 16 App Router + Tailwind (apps/web); Fastify API; same-origin `/api`.
- Strict CSP: scripts and fonts from our own origin only; images from self and i.ytimg.com; frames only youtube-nocookie.com. No third-party scripts or CDN fonts.
- Nothing stored in browser storage; no console output in production; passwordless login.
- Pages must remain CDN-cacheable; personalisation only client-side and non-sensitive.
- Must stay fast on slow mobile networks.

## Brand Commitments

- Name: CricketLive (keep).

## Evidence on Hand

- Real match, player and news data in the database; official YouTube videos; Wikidata player facts.
- No player photos or team logos licensed: do not use agency images or invent logos.
- No testimonials, user counts or press to cite.

## Product Principles

1. The live score is the hero: current state readable in one glance on any device.
2. Honest data: show source and coverage limits; never fake liveness or numbers.
3. Built for the spike: every page cacheable and light.
4. Fans first: make following a match enjoyable, not just informative.

## Accessibility & Inclusion

WCAG 2.2 AA: colour is never the only signal for wickets/boundaries, live regions for score updates, keyboard access throughout, reduced-motion respected.
