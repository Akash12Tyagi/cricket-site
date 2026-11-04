# Scorer problems

| Symptom | Cause / fix |
|---|---|
| "Network problem. Press the same button again" | The connection dropped mid-submit. Press the same button: the retry reuses the idempotency key, so the ball is never doubled. |
| "The server can't reach the database…" (503) | See [postgres-down.md](postgres-down.md). Keep a paper record. |
| "This bowler bowled the last over" | Correct: pick a different bowler. |
| "Pick the new batter" / striker box empty | After a wicket, select the incoming batter before the next ball. |
| Wrong ball entered | Undo (press twice, or `u` twice within 4 s), then re-enter. Every undo is in the audit log with who/when. |
| A ball disappeared | Check the audit log for `ball.undo` (`select * from audit_logs where action like 'ball.%' order by created_at desc`). Phase 4 found an undo from an open scorer tab: keyboard shortcuts act on whatever tab is focused. |
| Two scorers on one match | Safe: the innings row is locked per ball, so they can't interleave. Agree who is primary to avoid duplicate *intentions*. |
| Session expired | Log in again; nothing in progress is lost (the server holds all balls). |
