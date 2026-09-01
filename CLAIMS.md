# Work division (photo-sorter-v3) - two Rouge sessions, one MacBook

> Read before touching anything. Update your line when you switch files.
> Main checkout ~/photo-sorter-v3 = branch v4-ipc (frontend/IPC session).
> Worktree  ~/photo-sorter-v3-restructure = branch v4-restructure (tests/backend session).

| territory | owner | branch | dir |
|---|---|---|---|
| src/*.ts, main.rs command handlers, raw IPC | session A (started IPC work) | v4-ipc | ~/photo-sorter-v3 |
| export.rs, state.rs, database.rs, tests, zsort | session B (this one, 2026-09-01) | v4-restructure | ~/photo-sorter-v3-restructure |

Rules: git add per-file (NEVER -A), pull --ff-only before starting, merge via PR not shared checkout.

## Session mailbox (direct A<->B channel, no user relay)
~/.hermes/mailbox/photo-sorter/ — A writes from-A.md, reads from-B.md; B vice versa.
Check at session start, before big commits, and on any scope conflict. Append-only, ACK by reply.
Protocol: PROTOCOL.md in that dir. First message from A is waiting (status + rumahberkat hazard).
