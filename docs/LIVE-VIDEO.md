# Live cricket video: what we found, what is built, what is still needed

Date: 27 Oct 2026. Everything below was observed with plain public requests; nothing was bypassed.

## 1. What MWSGuy's public pages show (and don't)

Observed on `mwsguy.com` (a Blogger-hosted tools/links page) and `v2.mwsguy.com` (a Blogger page with a profile picker):

- The main site is a tools and trading-articles page with ad placements. No video players, no iframes, no `.m3u8` references.
- `v2` is a single static page: "Choose Your Experience" with four tiles (Sports "Live matches | Multiple Server", VIP Cinema, Movies, Cricket Live). Its inline script (~12 KB) has no `fetch`/`XMLHttpRequest`, no iframes, no `.m3u8`; it handles a profile selection screen.
- Its own Disclaimer says: content may be "displayed through an embedded third-party player or accessed through an external service rather than being stored on MWSGuy's own servers"; playback, ads, regional limits and availability are "controlled wholly or partly by the relevant third-party provider"; an embedded player "does not by itself establish that MWSGuy owns, has licensed or has verified the underlying content".

**Not verifiable** from public pages: the match list, the server list and the player behind the tiles (they load after the profile step, from somewhere we can't see without using the site as a logged-in viewer), who the providers are, and whether they hold rights. I did not try to get past the profile screen. So: MWSGuy is a link/embed aggregator that points at third-party players. Its *pattern* (match → list of servers → third-party player, switch if one fails) is reproducible. Its *sources* are unverified and we did not copy them.

## 2. Realistic ways to get live cricket video (authorised only)

| Route | Reality |
|---|---|
| **JioStar/JioHotstar** | No public embed SDK, player API or partner programme found. JioHotstar plays DRM-protected streams in its own apps; a consumer subscription does not allow re-transmission. JioStar holds ICC and (via Viacom18) BCCI India media rights, and sub-licenses by deal (e.g. England tours from Sony). Route is a commercial conversation: `hello@jiostar.com` is the only business address on jiostar.com (contact page: https://www.jiostar.com/contact-us). The Distribution page covers cable/DTH carriage, not web embeds. Expect a sub-licence/distribution deal, territory limits and a fee. |
| **Rights holders directly** | ICC and BCCI media-rights teams (BCCI general address `office@bcci.tv`; icc-cricket.com listed no public rights contact). Boards run their own OTT (e.g. Cricket Australia's Cricket TV) and sell content rights per territory. |
| **Official public live streams** | ICC, boards and leagues stream some matches/pressers free on YouTube with embedding on. **Implemented now** (see below). Availability varies per match and territory. |
| **Licensed video distributors** | Sports video marketplaces and OTT platforms sell licensed HLS feeds per event. I couldn't find a cricket-specific public catalogue or price list; expect a sales conversation. |

Not an option: scraping the JioHotstar player, reusing tokens/cookies, stripping DRM, or proxying a protected feed. None of that is built or planned.

## 3. How the system works

- `stream_sources` (per match or per series): `kind` = `youtube` | `hls` | `embed`, a label, the URL, a territory (`IN`, `GB`, `WW`…), priority, a required **rights note** (who authorised it), and the worker's verdict.
- **Providers** (`apps/api/src/streams/`): one file per kind implementing `validate()` (save-time rules, host allow-lists) and `verify()` (what the worker checks). Add a provider = one file + one line in `index.ts`.
- **Verification, never assumed**: HLS is `live` only when the playlist has no end marker and either its newest segment timestamp is current or its media sequence advanced since the last check; an ended playlist is `vod` ("Replay"); a reachable-but-unproven stream is `unknown`. YouTube is `live` only with `YOUTUBE_API_KEY` set. Embeds are never `live`.
- **Watch tab** (`/match/<slug>/watch`): servers ordered live → available → replay, your country first (browser-side, never sent to us), offline ones hidden. Press play → hls.js loads (only then) → a missing/refused playlist switches server immediately; a start >15 s or stall >25 s also switches; if every server fails you get "We couldn't play this match" + Try again. No sources: an honest message plus the official "Where to watch" links.
- **Secrets**: provider tokens live in server variables named `STREAM_TOKEN_*`; the database stores only the variable *name*. The browser asks `/v1/streams/:id/playback` (no-store) for the tokenised URL; tokens never appear in the public listing, logs or audit records.
- **Hosts are allow-listed**: `STREAM_HLS_HOSTS` / `STREAM_EMBED_HOSTS` gate both the API (save-time) and the site's CSP (only listed hosts open for media/frames).
- **Who can do what**: editors may add official YouTube streams; only admins add licensed HLS/embed sources or delete.

## 4. Setup and testing

```bash
# .env (server)
STREAM_HLS_HOSTS=media.your-provider.com        # host serving the .m3u8 and its segments
STREAM_EMBED_HOSTS=player.board.example         # optional
STREAM_TOKEN_PROVIDER=<token from your licence> # optional; sources reference it by name
YOUTUBE_API_KEY=...                             # optional; lets YouTube streams be proven live
pnpm db:migrate
pnpm --filter @cricket/api feed                 # worker re-verifies sources every 60 s (STREAM_CHECK_SECONDS)
# Admin → Media & feed → <match> → "Live video servers" → add source (needs a rights note)

pnpm --filter @cricket/api test -- streams      # unit + integration tests (28)
pnpm --filter @cricket/web test                 # server ordering / failover logic
```

Rebuild the web app after changing the host lists (they're read into the CSP at build/start).

Verified playback used Mux's public HLS test stream (a developer test asset, not cricket): playlist and 8 segments loaded under the strict CSP and video played; a deliberately broken first server failed over automatically; with only a broken server the error + retry state showed.

## 5. What is still needed for JioHotstar or another licensed live feed

1. A written agreement that permits web retransmission or embedding for your territories: start with `hello@jiostar.com` (and the ICC/BCCI rights teams for the competitions you want).
2. From the provider: the stream delivery format (HLS URLs or a player/embed URL), the host(s) serving it, how access is authorised (token query parameter, signed URLs, IP allow-listing), territories and blackouts, and attribution/ad requirements.
3. Their credentials → `STREAM_TOKEN_*`; their hosts → `STREAM_HLS_HOSTS`/`STREAM_EMBED_HOSTS`. If their feed is DRM-protected (Widevine/FairPlay), the player needs licence-server integration that their documentation must specify: not built, because it can't be done without their keys and terms.
4. A match-id mapping from them, or an admin adds sources per match/series in the admin screen.
