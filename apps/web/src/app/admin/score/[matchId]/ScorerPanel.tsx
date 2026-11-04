"use client";

import { DISMISSAL_TYPES, type DismissalType, type ExtraType, type LiveSnapshot } from "@cricket/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { oversOf, playerName, score, teamName } from "@/components/match/format";

type Mode = "BAT" | "WIDE" | "NO_BALL" | "BYE" | "LEG_BYE";

const ERRORS: Record<string, string> = {
  same_batters: "Striker and non-striker must be different players.",
  bowler_is_batter: "The bowler can't also be batting.",
  bowler_consecutive_overs: "This bowler bowled the last over. Pick a different bowler.",
  batter_already_out: "That batter is already out. Pick the new batter.",
  invalid_runs: "Those runs aren't valid for this ball.",
  invalid_extra: "That extra isn't valid with those runs.",
  invalid_dismissal_on_extra: "That dismissal isn't possible on this kind of ball.",
  dismissed_not_at_crease: "The dismissed player must be one of the two batters (and the non-striker can only be run out).",
  innings_complete: "This innings is complete.",
  batter_not_in_batting_team: "Batters must be from the batting team.",
  bowler_not_in_bowling_team: "The bowler must be from the fielding team.",
  fielder_not_in_bowling_team: "The fielder must be from the fielding team.",
  no_balls_to_undo: "Nothing to undo.",
  previous_innings_open: "Finish the current innings first.",
  feed_active: "This match is scored automatically by the live data feed. An admin must pause the feed (Media & feed page) before you can score it.",
  forbidden_origin: "Request blocked. Reload the page.",
  unauthenticated: "Your session expired. Log in again.",
  service_unavailable: "The server can't reach the database right now. Your ball may NOT be saved yet. Wait a few seconds and press the same button again (it can't be counted twice).",
};
const message = (code: string | undefined) => (code && ERRORS[code]) ?? "Something went wrong. Your ball was NOT saved. Try again.";

const MODE_KEYS: Record<string, Mode> = { d: "WIDE", n: "NO_BALL", b: "BYE", l: "LEG_BYE" };
const MODE_LABEL: Record<Mode, string> = { BAT: "Off the bat", WIDE: "Wide", NO_BALL: "No-ball", BYE: "Byes", LEG_BYE: "Leg-byes" };

export function ScorerPanel({ initial }: { initial: LiveSnapshot }) {
  const [s, setS] = useState(initial);
  const cur = s.innings.at(-1);
  const active = cur && !cur.isComplete ? cur : null;

  const xi = useCallback((teamId: string | undefined) => s.players.filter((p) => p.teamId === teamId && p.isPlayingXi), [s.players]);
  const outIds = useMemo(() => new Set(active?.batters.filter((b) => b.out && b.out !== "RETIRED_HURT").map((b) => b.playerId)), [active]);

  const [striker, setStriker] = useState(active?.next.strikerId ?? "");
  const [nonStriker, setNonStriker] = useState(active?.next.nonStrikerId ?? "");
  const [bowler, setBowler] = useState(active && !active.next.overComplete ? (active.next.lastBowlerId ?? "") : "");
  const [mode, setMode] = useState<Mode>("BAT");
  const [wicket, setWicket] = useState(false);
  const [dismissal, setDismissal] = useState<DismissalType>("CAUGHT");
  const [outPlayer, setOutPlayer] = useState<"striker" | "nonStriker">("striker");
  const [fielder, setFielder] = useState("");
  const [comm, setComm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState(false);
  /** Kept until the server gives a definite answer, so a retry after a network error can't double-score. */
  const pendingKey = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/v1/admin/matches/${s.match.id}/live`, { cache: "no-store" });
    if (!res.ok) return null;
    const next = (await res.json()) as LiveSnapshot;
    setS(next);
    return next;
  }, [s.match.id]);

  /** After every ball, take the engine's suggestion for who's on strike and whether a new bowler is needed. */
  const applySuggestion = useCallback((next: LiveSnapshot) => {
    const i = next.innings.at(-1);
    if (!i || i.isComplete) return;
    setStriker(i.next.strikerId ?? "");
    setNonStriker(i.next.nonStrikerId ?? "");
    if (i.next.overComplete) setBowler("");
  }, []);

  const post = async (url: string, body?: unknown, method = "POST") => {
    const res = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };

  const submit = async (runs: number) => {
    if (!active || busy) return;
    if (!striker || !nonStriker || !bowler) { setError("Pick both batters and the bowler first."); return; }
    if ((mode === "BYE" || mode === "LEG_BYE") && runs === 0) { setError("Byes/leg-byes need at least 1 run."); return; }
    const boundary = (mode === "BAT" || mode === "NO_BALL") && (runs === 4 || runs === 6);
    const delivery = {
      strikerId: striker, nonStrikerId: nonStriker, bowlerId: bowler,
      runsBat: mode === "BAT" || mode === "NO_BALL" ? runs : 0,
      extraType: (mode === "BAT" ? null : mode) as ExtraType | null,
      extraRuns: mode === "WIDE" || mode === "NO_BALL" ? 1 + (mode === "WIDE" ? runs : 0) : mode === "BAT" ? 0 : runs,
      isBoundary: boundary,
      dismissal: wicket ? dismissal : null,
      dismissedPlayerId: wicket ? (outPlayer === "striker" ? striker : nonStriker) : null,
      fielderId: wicket && fielder ? fielder : null,
      commentary: comm.trim() || undefined,
    };
    pendingKey.current ??= crypto.randomUUID();
    setBusy(true); setError(null);
    try {
      const r = await post(`/api/v1/admin/innings/${active.id}/balls`, { ...delivery, idempotencyKey: pendingKey.current });
      // 503 = outcome unknown → keep the key so the retry is safely de-duplicated; any other error is a definite rejection.
      if (!r.ok) { if (r.data.error !== "service_unavailable") pendingKey.current = null; setError(message(r.data.error)); return; }
      pendingKey.current = null;
      setMode("BAT"); setWicket(false); setFielder(""); setComm("");
      const next = await reload();
      if (next) applySuggestion(next);
    } catch {
      setError("Network problem. Press the same button again to retry; the ball won't be counted twice.");
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!active || busy) return;
    if (!confirmUndo) { setConfirmUndo(true); setTimeout(() => setConfirmUndo(false), 4000); return; }
    setConfirmUndo(false); setBusy(true); setError(null);
    try {
      const r = await post(`/api/v1/admin/innings/${active.id}/balls/last`, undefined, "DELETE");
      if (!r.ok) setError(message(r.data.error));
      else { const next = await reload(); if (next) applySuggestion(next); }
    } catch { setError("Network problem. Try again."); } finally { setBusy(false); }
  };

  const startInnings = async (battingTeamId: string) => {
    setBusy(true); setError(null);
    try {
      const r = await post(`/api/v1/admin/matches/${s.match.id}/innings`, { battingTeamId });
      if (!r.ok) setError(message(r.data.error));
      else { await reload(); setStriker(""); setNonStriker(""); setBowler(""); }
    } catch { setError("Network problem. Try again."); } finally { setBusy(false); }
  };

  const setStatus = async (status: string, resultText?: string) => {
    setBusy(true);
    try {
      const r = await post(`/api/v1/admin/matches/${s.match.id}/status`, { status, ...(resultText ? { resultText } : {}) });
      if (!r.ok) setError(message(r.data.error)); else await reload();
    } finally { setBusy(false); }
  };

  // Keyboard-first scoring.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
      if (/^[0-6]$/.test(e.key)) { e.preventDefault(); void submit(Number(e.key)); }
      else if (MODE_KEYS[e.key]) setMode((m) => (m === MODE_KEYS[e.key] ? "BAT" : MODE_KEYS[e.key]!));
      else if (e.key === "w") setWicket((w) => !w);
      else if (e.key === "s") { setStriker(nonStriker); setNonStriker(striker); }
      else if (e.key === "u") void undo();
      else if (e.key === "Escape") { setMode("BAT"); setWicket(false); setError(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const batting = xi(active?.battingTeamId);
  const bowling = xi(active?.bowlingTeamId);
  const select = "w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-sm">
        <header>
          <p className="text-xs text-muted">{s.match.status} · v{s.version}</p>
          <h1 className="text-lg font-semibold">{s.match.title}</h1>
          {s.innings.map((i) => (
            <p key={i.id} className={i === cur ? "text-2xl font-bold tabular-nums" : "text-sm text-muted"}>
              {teamName(s, i.battingTeamId)} {score(i)} ({oversOf(i.legalBalls, s.match.ballsPerOver)}){i.chase && ` · need ${i.chase.runsNeeded}`}{i.isComplete && " · complete"}
            </p>
          ))}
          {active && <p className="mt-1 text-sm">This over: <span className="font-mono">{active.thisOver.join(" ") || "-"}</span></p>}
        </header>

        {s.match.source === "feed" && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Live data feed is scoring this match. Your inputs will be refused until an admin pauses the feed.</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-live">{error}</p>}

        {!active ? (
          <div className="space-y-3">
            <p className="font-medium">{s.innings.length ? "Innings complete. Start the next innings:" : "Who bats first?"}</p>
            <div className="flex gap-2">
              {s.teams.map((t) => <button key={t.id} disabled={busy} onClick={() => startInnings(t.id)} className="rounded-lg bg-brand-700 px-4 py-2 text-white disabled:opacity-50">{t.name} bat</button>)}
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-medium">Striker
                <select className={select} value={striker} onChange={(e) => setStriker(e.target.value)}>
                  <option value="">Select…</option>
                  {batting.filter((p) => !outIds.has(p.playerId)).map((p) => <option key={p.playerId} value={p.playerId}>{p.knownAs ?? p.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium">Non-striker
                <select className={select} value={nonStriker} onChange={(e) => setNonStriker(e.target.value)}>
                  <option value="">Select…</option>
                  {batting.filter((p) => !outIds.has(p.playerId)).map((p) => <option key={p.playerId} value={p.playerId}>{p.knownAs ?? p.name}</option>)}
                </select>
              </label>
              <label className="text-xs font-medium">Bowler {active.next.overComplete && active.legalBalls > 0 && <span className="text-amber-700">(new over)</span>}
                <select className={select} value={bowler} onChange={(e) => setBowler(e.target.value)}>
                  <option value="">Select…</option>
                  {bowling.map((p) => <option key={p.playerId} value={p.playerId} disabled={active.next.overComplete && p.playerId === active.next.lastBowlerId}>{p.knownAs ?? p.name}</option>)}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Ball type">
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m}
                  className={`rounded-full border px-3 py-1 text-sm ${mode === m ? "border-brand-700 bg-brand-700 text-white" : "border-line"}`}>{MODE_LABEL[m]}</button>
              ))}
              <button onClick={() => setWicket((w) => !w)} aria-pressed={wicket}
                className={`rounded-full border px-3 py-1 text-sm ${wicket ? "border-live bg-live text-white" : "border-line"}`}>Wicket</button>
            </div>

            {wicket && (
              <div className="grid gap-3 rounded-lg bg-red-50 p-3 sm:grid-cols-3">
                <label className="text-xs font-medium">How out
                  <select className={select} value={dismissal} onChange={(e) => setDismissal(e.target.value as DismissalType)}>
                    {DISMISSAL_TYPES.map((d) => <option key={d} value={d}>{d.replace(/_/g, " ").toLowerCase()}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium">Who&apos;s out
                  <select className={select} value={outPlayer} onChange={(e) => setOutPlayer(e.target.value as "striker" | "nonStriker")}>
                    <option value="striker">{playerName(s, striker) || "Striker"}</option>
                    <option value="nonStriker">{playerName(s, nonStriker) || "Non-striker"}</option>
                  </select>
                </label>
                <label className="text-xs font-medium">Fielder (optional)
                  <select className={select} value={fielder} onChange={(e) => setFielder(e.target.value)}>
                    <option value="">-</option>
                    {bowling.map((p) => <option key={p.playerId} value={p.playerId}>{p.knownAs ?? p.name}</option>)}
                  </select>
                </label>
              </div>
            )}

            <label className="block text-xs font-medium">Commentary (optional)
              <input className={select} value={comm} maxLength={1000} onChange={(e) => setComm(e.target.value)} placeholder="e.g. Full and wide, driven through covers" />
            </label>

            <div className="grid grid-cols-7 gap-2" role="group" aria-label="Runs">
              {[0, 1, 2, 3, 4, 5, 6].map((r) => (
                <button key={r} disabled={busy} onClick={() => submit(r)}
                  className={`h-14 rounded-xl text-lg font-bold disabled:opacity-50 ${r === 4 || r === 6 ? "bg-brand-700 text-white" : "border border-line bg-canvas"}`}>{r}</button>
              ))}
            </div>
            <p className="text-xs text-muted">
              Runs = {mode === "WIDE" ? "extra runs run (the 1-run wide is added for you)" : mode === "BYE" || mode === "LEG_BYE" ? "byes run" : "runs off the bat"}.
              Keys: 0–6 score · d wide · n no-ball · b bye · l leg-bye · w wicket · s swap strike · u undo · Esc reset
            </p>

            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              <button onClick={undo} disabled={busy} className={`rounded-lg border px-3 py-1.5 text-sm ${confirmUndo ? "border-live bg-live text-white" : "border-line"}`}>
                {confirmUndo ? "Press again to undo last ball" : "Undo last ball"}
              </button>
              <button onClick={() => { setStriker(nonStriker); setNonStriker(striker); }} className="rounded-lg border border-line px-3 py-1.5 text-sm">Swap strike</button>
              <button onClick={() => setStatus("STUMPS")} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm">Stumps</button>
              <button onClick={() => setStatus("LIVE")} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm">Resume</button>
            </div>
          </>
        )}

        <form className="flex gap-2 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); const t = new FormData(e.currentTarget).get("result"); if (t) void setStatus("COMPLETED", String(t)); }}>
          <input name="result" placeholder="Result, e.g. India won by 6 wickets" className={select} maxLength={200} />
          <button disabled={busy} className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm">End match</button>
        </form>
      </section>

      <aside className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-5 text-sm shadow-sm">
        <h2 className="font-semibold">Current</h2>
        {active ? (
          <>
            {active.batters.filter((b) => !b.out && (b.playerId === striker || b.playerId === nonStriker)).map((b) => (
              <p key={b.playerId}>{playerName(s, b.playerId)}{b.playerId === striker && " *"}: {b.runs} ({b.balls})</p>
            ))}
            {active.bowlers.filter((b) => b.playerId === bowler).map((b) => (
              <p key={b.playerId}>{playerName(s, b.playerId)}: {oversOf(b.legalBalls, s.match.ballsPerOver)}-{b.maidens}-{b.runs}-{b.wickets}</p>
            ))}
            <p className="text-muted">Partnership {active.partnership.runs} ({active.partnership.balls}) · Extras {active.extras.total}</p>
          </>
        ) : <p className="text-muted">No innings in progress.</p>}
        <a href={`/match/${s.match.slug}`} target="_blank" rel="noreferrer" className="inline-block text-brand-700 underline">Open public page</a>
      </aside>
    </div>
  );
}
