// Scores a legal delivery every INTERVAL ms through the real admin API (used during load tests so viewers
// see new balls). Needs a session cookie for a scorer/admin: SESSION=<__Host-sid value>.
const API = process.env.API ?? "http://127.0.0.1:4000";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3100";
const MATCH = process.env.MATCH;
const INTERVAL = Number(process.env.INTERVAL ?? 10_000);
const STOP_AFTER = Number(process.env.STOP_AFTER ?? 120_000);
const headers = { cookie: `__Host-sid=${process.env.SESSION}`, origin: ORIGIN, "content-type": "application/json" };
const call = async (path, method = "GET", body) => {
  const r = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

await call(`/v1/admin/matches/${MATCH}/status`, "POST", { status: "LIVE" });
const started = Date.now();
let n = 0;
while (Date.now() - started < STOP_AFTER) {
  const { data: s } = await call(`/v1/admin/matches/${MATCH}/live`);
  const inn = s.innings.at(-1);
  if (!inn || inn.isComplete) { console.log("innings complete; stopping"); break; }
  const xi = (team) => s.players.filter((p) => p.teamId === team && p.isPlayingXi).map((p) => p.playerId);
  const out = new Set(inn.batters.filter((b) => b.out).map((b) => b.playerId));
  const fresh = xi(inn.battingTeamId).filter((id) => !out.has(id) && id !== inn.next.strikerId && id !== inn.next.nonStrikerId);
  const striker = inn.next.strikerId ?? fresh.shift();
  const nonStriker = inn.next.nonStrikerId ?? fresh.shift();
  const bowlers = xi(inn.bowlingTeamId).slice(6);
  const current = inn.bowlers.at(-1)?.playerId;
  const bowler = inn.next.overComplete ? bowlers.find((b) => b !== inn.next.lastBowlerId) : (current ?? bowlers[0]);
  const runs = [0, 1, 1, 2, 4, 0, 1, 6][n % 8];
  const r = await call(`/v1/admin/innings/${inn.id}/balls`, "POST", {
    idempotencyKey: crypto.randomUUID(), strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler,
    runsBat: runs, extraType: null, extraRuns: 0, isBoundary: runs === 4 || runs === 6, dismissal: null, dismissedPlayerId: null, fielderId: null,
  });
  n += 1;
  console.log(`ball ${n}: ${r.status} ${r.status === 201 ? `${r.data.state.runs}/${r.data.state.wickets} (${r.data.state.overs})` : JSON.stringify(r.data)}`);
  await new Promise((res) => setTimeout(res, INTERVAL));
}
