# ARCH-004 — WS/HTTP transport lifecycle + abort hardening

## STATUS: DONE — merged PR #1260 (squash `420042d1f`) + gate-complete, on develop (2026-07-21)

In-repo mirror (memory-mirroring rule). Host mirror: session memory `arch-004-transport-hardening.md`.

Fixed confirmed runtime defects in the forward-provisioned `agent-transport-ws` / `agent-transport-http`
surfaces:

- **RUNTIME-13** — WS `stop()` no longer hangs. `wss.close(cb)` fires only after all clients close, so a live
  client hung it forever. Now: `close(1001)` each `wss.clients` socket → `terminate()` survivors at a 5s
  deadline (`WS_STOP_TERMINATE_DEADLINE_MS`) → `wss.close`/`httpServer.close`. SEC-001 connect-time auth
  untouched (the token is validated synchronously in `wss.on('connection')`, NOT `verifyClient`).
- **RUNTIME-14** — HTTP `/submit` SSE listener leak. Cleanup ran only after `await done`, which never resolved
  on a mid-stream disconnect. Now: `try/finally` (teardown always runs) + `stream.onAbort` → `session.abort()`
  - every SSE write awaited & `.catch`'d (blessed teardown, `allow-fallback:`).
- **RUNTIME-38** — concurrent `/submit` cross-talk (one shared single-threaded session). Now returns `409`
  gated on the existing `session.isExecuting()`.
- **RUNTIME-54** — doc-only: subsumed by SEC-001 synchronous connect-time token auth (no parked-unauth window).
- **STRUCT-07** — removed the `@robota-sdk/agent-core/testing` pass-through re-exports from
  `agent-framework/src/testing/index.ts`.

Prior-art-anchored (RFC 6455 close→terminate, `ws` close/terminate, Hono `streamSSE.onAbort`, K8s
drain-then-force). proposal-reviewer REVISE resolved; pr-review-reviewer 0 real code defects (the SHOULD was an
accidental-green RUNTIME-14 test → replaced with a real `reader.cancel()` disconnect-path test). Follow-up:
**STRUCT-08** — the same-class load-bearing `agent-transport/src/testing` pass-through
(`.agents/backlog/STRUCT-008-agent-transport-testing-passthrough.md`).
