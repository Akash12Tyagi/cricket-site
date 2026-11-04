// Enriches imported players with public-domain facts from Wikidata (CC0): full name, date of birth, birthplace,
// height. Players are matched via the Cricsheet register's ESPNcricinfo key → Wikidata property P2697.
// Only fills empty fields; safe to re-run. Respects Wikidata's etiquette: batched queries, a pause between them,
// and a descriptive User-Agent.
//
//   pnpm --filter @cricket/db enrich-wikidata ../../data/cricsheet/register/people.csv
import { config } from "dotenv";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createDb, players } from "./index.js";

config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

const BATCH = 150;
const PAUSE_MS = 1500;
const UA = "CricketLive/0.1 (cricket scores site; player enrichment; contact: ops@example.com)";

/** Minimal CSV parser for the Cricsheet register (handles quoted fields). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header!.map((h, k) => [h, r[k] ?? ""])));
}

type Binding = { cricinfo: { value: string }; item: { value: string }; itemLabel?: { value: string }; dob?: { value: string }; birthPlaceLabel?: { value: string }; height?: { value: string }; heightUnit?: { value: string } };

async function query(cricinfoIds: string[]): Promise<Binding[]> {
  const values = cricinfoIds.map((id) => `"${id.replace(/[^0-9]/g, "")}"`).join(" ");
  const sparql = `SELECT ?cricinfo ?item ?itemLabel ?dob ?birthPlaceLabel ?height ?heightUnit WHERE {
    VALUES ?cricinfo { ${values} } ?item wdt:P2697 ?cricinfo .
    OPTIONAL { ?item wdt:P569 ?dob } OPTIONAL { ?item wdt:P19 ?birthPlace }
    OPTIONAL { ?item p:P2048/psv:P2048 [ wikibase:quantityAmount ?height; wikibase:quantityUnit ?heightUnit ] }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": UA }, signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return ((await res.json()) as { results: { bindings: Binding[] } }).results.bindings;
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`Wikidata HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") ?? 10) * 1000));
  }
}

const toCm = (amount: string, unitUri?: string) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  const cm = unitUri?.endsWith("Q174728") ? n : unitUri?.endsWith("Q11573") ? n * 100 : n < 3 ? n * 100 : n; // Q174728 = cm, Q11573 = metre
  return cm >= 140 && cm <= 220 ? Math.round(cm) : null; // ignore implausible values
};

const registerPath = process.argv[2];
if (!registerPath) { process.stderr.write("usage: enrich-wikidata <people.csv>\n"); process.exit(1); }
const cricinfoByCricsheet = new Map(parseCsv(readFileSync(registerPath, "utf8")).filter((r) => r.key_cricinfo).map((r) => [r.identifier!, r.key_cricinfo!]));

const { db, client } = createDb(process.env.DATABASE_URL ?? "", { max: 2 });
const todo = await db.select({ id: players.id, cricsheetId: players.cricsheetId }).from(players)
  .where(and(isNotNull(players.cricsheetId), isNull(players.wikidataId)));
const withKey = todo.filter((p) => cricinfoByCricsheet.has(p.cricsheetId!));
process.stdout.write(`${todo.length} players to enrich; ${withKey.length} have an ESPNcricinfo key in the register\n`);

let matched = 0, updated = 0;
for (let i = 0; i < withKey.length; i += BATCH) {
  const batch = withKey.slice(i, i + BATCH);
  const byCricinfo = new Map(batch.map((p) => [cricinfoByCricsheet.get(p.cricsheetId!)!, p.id]));
  const rows = await query([...byCricinfo.keys()]);
  const first = new Map<string, Binding>();
  for (const r of rows) if (!first.has(r.cricinfo.value)) first.set(r.cricinfo.value, r); // multiple values: keep the first
  for (const [cricinfo, b] of first) {
    const playerId = byCricinfo.get(cricinfo);
    if (!playerId) continue;
    matched++;
    const name = b.itemLabel?.value;
    const [cur] = await db.select().from(players).where(eq(players.id, playerId));
    await db.update(players).set({
      wikidataId: b.item.value.split("/").pop()!,
      // Wikidata's label is the full common name ("Virat Kohli"); the Cricsheet name ("V Kohli") becomes the short form.
      ...(name && !/^Q\d+$/.test(name) ? { fullName: name, knownAs: cur?.knownAs ?? null } : {}),
      ...(b.dob && !cur?.dateOfBirth ? { dateOfBirth: new Date(b.dob.value.slice(0, 10)) } : {}),
      ...(b.birthPlaceLabel && !cur?.birthPlace ? { birthPlace: b.birthPlaceLabel.value.slice(0, 120) } : {}),
      ...(b.height && !cur?.heightCm ? { heightCm: toCm(b.height.value, b.heightUnit?.value) } : {}),
    }).where(eq(players.id, playerId));
    updated++;
  }
  process.stdout.write(`  batch ${i / BATCH + 1}/${Math.ceil(withKey.length / BATCH)}: ${first.size} found\n`);
  await new Promise((r) => setTimeout(r, PAUSE_MS));
}
process.stdout.write(`matched ${matched} of ${withKey.length} players on Wikidata; updated ${updated}\n`);
await client.end();
