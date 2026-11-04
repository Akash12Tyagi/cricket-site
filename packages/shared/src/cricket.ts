export const MATCH_FORMATS = ["TEST", "ODI", "T20I", "T20", "LIST_A", "FIRST_CLASS", "T10", "HUNDRED"] as const;
export type MatchFormat = (typeof MATCH_FORMATS)[number];

/** Display names for formats (one source of truth for every page). */
export const FORMAT_LABELS: Record<MatchFormat, string> = {
  TEST: "Test", ODI: "ODI", T20I: "T20I", T20: "T20", LIST_A: "List A", FIRST_CLASS: "First-class", T10: "T10", HUNDRED: "The Hundred",
};
export const formatLabel = (f: string) => FORMAT_LABELS[f as MatchFormat] ?? f;

/** "Gaddafi Stadium, Lahore" + "Lahore" → don't repeat the city when the venue name already contains it. */
export const venueLabel = (name: string, city: string | null | undefined) => (city && !name.toLowerCase().includes(city.toLowerCase()) ? `${name}, ${city}` : name);

export const MATCH_STATUSES = ["SCHEDULED", "TOSS", "LIVE", "INNINGS_BREAK", "STUMPS", "DELAYED", "COMPLETED", "ABANDONED", "CANCELLED"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const EXTRA_TYPES = ["WIDE", "NO_BALL", "BYE", "LEG_BYE", "PENALTY"] as const;
export type ExtraType = (typeof EXTRA_TYPES)[number];

export const DISMISSAL_TYPES = [
  "BOWLED", "CAUGHT", "LBW", "RUN_OUT", "STUMPED", "HIT_WICKET",
  "HANDLED_BALL", "HIT_BALL_TWICE", "OBSTRUCTING_FIELD", "TIMED_OUT", "RETIRED_HURT", "RETIRED_OUT",
] as const;
export type DismissalType = (typeof DISMISSAL_TYPES)[number];

export const TEAM_KINDS = ["INTERNATIONAL_MEN", "INTERNATIONAL_WOMEN", "LEAGUE", "DOMESTIC"] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];
