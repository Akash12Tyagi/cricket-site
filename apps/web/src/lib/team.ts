/**
 * Team identity for badges. Major national sides use their well-known playing-kit colour (a fact, not a logo); every
 * other team gets a stable colour picked from its name. National sides use their standard 3-letter cricket codes so
 * no two badges share a code and no code names a different team; age, gender and "A"-side suffixes become a marker
 * (AFG + U19) instead of being mangled into the code.
 */
const KIT: Record<string, string> = {
  india: "#1f4fbf", australia: "#c08a00", england: "#1b2a5c", pakistan: "#0f6b3a", "south africa": "#0b6b4d",
  "new zealand": "#16181d", "sri lanka": "#173f8a", "west indies": "#7a1630", bangladesh: "#00684a", afghanistan: "#1f5aa6",
  ireland: "#13804a", zimbabwe: "#b5121b", netherlands: "#c2410c", scotland: "#1d3f8f", nepal: "#b91c3c",
};
const CODE: Record<string, string> = {
  india: "IND", australia: "AUS", england: "ENG", pakistan: "PAK", "south africa": "RSA", "new zealand": "NZ", "sri lanka": "SL",
  "west indies": "WI", bangladesh: "BAN", afghanistan: "AFG", ireland: "IRE", zimbabwe: "ZIM", netherlands: "NED", scotland: "SCO",
  nepal: "NEP", oman: "OMA", "united arab emirates": "UAE", namibia: "NAM", canada: "CAN", "united states of america": "USA", usa: "USA",
  "hong kong": "HK", kenya: "KEN", uganda: "UGA", nigeria: "NGR", jersey: "JER", guernsey: "GUE", kuwait: "KUW", qatar: "QAT",
  "papua new guinea": "PNG", gambia: "GAM", lesotho: "LES", mozambique: "MOZ", zambia: "ZAM", argentina: "ARG", austria: "AUT",
  bahamas: "BHS", bahrain: "BRN", belgium: "BEL", belize: "BLZ", bermuda: "BER", bhutan: "BHU", botswana: "BOT", brazil: "BRA",
  bulgaria: "BUL", cambodia: "KHM", cameroon: "CMR", "cayman islands": "CAY", chile: "CHL", china: "CHN", "cook islands": "COK",
  "costa rica": "CRC", croatia: "CRO", cyprus: "CYP", "czech republic": "CZE", denmark: "DEN", estonia: "EST", fiji: "FIJ",
  finland: "FIN", france: "FRA", germany: "GER", ghana: "GHA", gibraltar: "GIB", greece: "GRE", hungary: "HUN", indonesia: "INA",
  "isle of man": "IOM", israel: "ISR", italy: "ITA", japan: "JPN", luxembourg: "LUX", malawi: "MWI", malaysia: "MAS", maldives: "MDV",
  malta: "MLT", mexico: "MEX", myanmar: "MYA", norway: "NOR", panama: "PAN", peru: "PER", philippines: "PHI", portugal: "POR",
  romania: "ROU", rwanda: "RWA", samoa: "SAM", "saudi arabia": "KSA", serbia: "SRB", "sierra leone": "SLE", singapore: "SIN",
  slovenia: "SLO", spain: "ESP", "st helena": "SHN", sweden: "SWE", switzerland: "SUI", tanzania: "TAN", thailand: "THA",
  turkey: "TUR", vanuatu: "VAN", "africa xi": "AFR", "asia xi": "ASI", "world xi": "WLD", "icc world xi": "WLD",
};
const PALETTE = ["#1d4ed8", "#0f766e", "#7c3aed", "#c2410c", "#15803d", "#be185d", "#0369a1", "#a16207", "#4338ca", "#b91c1c", "#334155", "#0e7490"];
const SUFFIX = /\s+(women|under-?\s?19s?|u-?19s?|under-?\s?23s?|u-?23s?|a|xi)$/i;

function hash(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

/** Splits "Afghanistan Under-19s" into the side ("afghanistan") and a marker ("U19"). */
function parts(name: string) {
  let base = name.trim(), mark: string | null = null;
  const m = SUFFIX.exec(base);
  if (m && !CODE[base.toLowerCase()]) {
    const s = m[1]!.toLowerCase();
    mark = s.startsWith("women") ? "W" : /19/.test(s) ? "U19" : /23/.test(s) ? "U23" : s === "a" ? "A" : "XI";
    base = base.slice(0, m.index).trim();
  }
  return { key: base.toLowerCase(), base, mark };
}

export function teamColor(name: string): string {
  const { key } = parts(name);
  return KIT[key] ?? PALETTE[hash(key) % PALETTE.length]!;
}

/** The badge text: a standard code for national sides; otherwise the short name, or initials of the name. */
export function teamCode(name: string, shortName?: string | null): { code: string; mark: string | null } {
  const { key, base, mark } = parts(name);
  if (CODE[key]) return { code: CODE[key], mark };
  const head = shortName?.split(/[-\s]/)[0];
  if (head && /^[A-Za-z]{2,4}$/.test(head) && !mark) return { code: head.toUpperCase().slice(0, 3), mark };
  const words = base.replace(/\([^)]*\)/g, "").replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  const code = words.length >= 2 ? words.slice(0, 3).map((w) => w[0]).join("") : (base.slice(0, 1) + base.slice(1).replace(/[aeiou\s]/gi, "").slice(0, 2));
  return { code: code.toUpperCase(), mark };
}
