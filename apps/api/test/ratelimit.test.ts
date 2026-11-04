import { describe, expect, it } from "vitest";
import { isPublicRead } from "../src/app.js";

describe("rate-limit exemptions are exactly the public read routes", () => {
  it.each([
    ["GET", "/v1/matches/abc/live"], ["GET", "/v1/matches?status=live"], ["GET", "/v1/schedule?kind=upcoming"],
    ["GET", "/v1/series/x"], ["GET", "/v1/teams"], ["GET", "/v1/players/x"], ["GET", "/v1/articles/x"], ["HEAD", "/v1/sitemap"], ["GET", "/healthz"],
  ])("%s %s is exempt", (m, u) => expect(isPublicRead(m, u)).toBe(true));
  it.each([
    ["POST", "/v1/auth/code"], ["GET", "/v1/search?q=ab"], ["GET", "/v1/me"], ["GET", "/v1/admin/articles"],
    ["POST", "/v1/admin/innings/x/balls"], ["DELETE", "/v1/me"], ["GET", "/v1/matchesX"], ["GET", "/v1/teamsecret"],
  ])("%s %s stays limited", (m, u) => expect(isPublicRead(m, u)).toBe(false));
});
