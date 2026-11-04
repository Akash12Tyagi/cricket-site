// Cross-checks imported innings totals against Cricsheet's raw data (independent arithmetic, not our engine).
//   node scripts/verify-cricsheet.mjs data/cricsheet/recent30
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const dir = process.argv[2];
const rows = execFileSync("docker", ["exec", "cricket-site-postgres-1", "psql", "-U", "cricket", "-tAF", "\t", "-c",
  "select m.cricsheet_id, i.number, i.runs, i.wickets, i.legal_balls from innings i join matches m on m.id = i.match_id where m.cricsheet_id is not null"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
const ours = new Map(rows.map(([id, n, r, w, b]) => [`${id}#${n}`, { runs: +r, wickets: +w, balls: +b }]));
let checked = 0, mismatches = 0;
for (const f of readdirSync(dir).filter((x) => /^\d+\.json$/.test(x))) {
  const id = f.slice(0, -5);
  if (!rows.some((r) => r[0] === id)) continue;
  const m = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  let n = 0;
  for (const inn of m.innings) {
    if (inn.super_over) continue;
    n += 1;
    let runs = 0, wickets = 0, balls = 0;
    for (const o of inn.overs ?? []) for (const d of o.deliveries) {
      runs += d.runs.total;
      if (!d.extras?.wides && !d.extras?.noballs) balls += 1;
      wickets += (d.wickets ?? []).filter((w) => !["retired hurt", "retired not out"].includes(w.kind)).length;
    }
    const o = ours.get(`${id}#${n}`);
    checked++;
    if (!o || o.runs !== runs || o.wickets !== wickets || o.balls !== balls) {
      mismatches++;
      console.log(`MISMATCH ${id} innings ${n}: cricsheet ${runs}/${wickets} (${balls} balls) vs ours ${o ? `${o.runs}/${o.wickets} (${o.balls})` : "missing"}`);
    }
  }
}
console.log(`checked ${checked} innings, ${mismatches} mismatches`);
process.exit(mismatches ? 1 : 0);
