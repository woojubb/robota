---
status: in-progress
type: BEHAVIOR
tags: [transport, http, websocket, sse, lifecycle, hardening, runtime, capability]
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/arch-004-transport-lifecycle-agent-run.md
---

# ARCH-004: forward-provisioned transport surface hardening (WS/HTTP lifecycle + abort)

## Problem

The `agent-transport-ws` / `agent-transport-http` surfaces are forward-provisioned (kept for external
consumers, not dead code — per the Forward-Provisioned Surface Rule). Their **runtime defects are promoted to
unconditional fixes**. Concrete, code-confirmed defects (re-audit P2-10):

- **RUNTIME-13 — WS `stop()` hangs forever.** `ws-transport-configurable.ts:273-276` stops via
  `wss.close(() => httpServer.close(res))`. The `ws` library's `WebSocketServer.close()` callback fires only
  after **every** client connection has closed — a still-connected client makes `stop()` never resolve. No
  client-close handshake, no forced-terminate deadline.
- **RUNTIME-14 — HTTP `/submit` SSE leaks listeners on client disconnect.** `routes.ts:46-96` runs its
  `cleanup` (session `off`) only at line 95, AFTER `await done`. `done` resolves solely on
  complete/interrupted/error; a client that disconnects mid-stream never resolves it → the session listeners
  leak permanently. There is no `stream.onAbort` teardown, no `try/finally`, and the non-terminal writes
  (text_delta/tool_start/…) are fire-and-forget (unawaited/uncaught → a write to a closed stream throws
  unhandled).
- **RUNTIME-38 — concurrent `/submit` cross-talk.** `http-transport.ts:31` wires
  `sessionFactory: () => session!` — a SINGLE shared session. Two concurrent `/submit` requests both subscribe
  to the same session's events, so each stream receives the other's deltas.
- **RUNTIME-54 — WS auth-wait has no timeout** (a connected-but-not-authenticated peer parks resources).
- **STRUCT-07 — ownership violation.** `agent-framework/src/testing/index.ts:20-21` PASS-THROUGH re-exports
  `createScriptedProvider` + `IScriptedProvider`/`TScriptedTurn` from `@robota-sdk/agent-core/testing`. A
  package must not re-export another package's symbols (no pass-through re-exports rule).

## Prior Art Research

**Topic:** Graceful lifecycle + abort handling in a long-running agent transport server (WebSocket + HTTP/SSE).

### References

- **RFC 6455 §7 (WS closing handshake):** a Close frame is exchanged before TCP close (the TCP FIN is not
  reliable through proxies). https://www.rfc-editor.org/rfc/rfc6455.html#section-7
- **`ws` README:** `close()` sends a close frame and **waits for the close timer**; the documented remedy for a
  peer that never replies is `terminate()` ("immediately destroys the connection"). https://github.com/websockets/ws/blob/master/README.md
- **WebSocket.org heartbeat guide:** ping ~30s, `terminate()` on missed pong (dead-peer reaping). https://websocket.org/guides/heartbeat/
- **WebSocket.org auth guide:** a **5s** unauthenticated-connection timeout, close code **4001** ("without it,
  unauthenticated connections sit open indefinitely"). https://websocket.org/guides/authentication/
- **Hono streaming helper:** `stream.writeSSE()` (awaitable), `stream.onAbort(cb)`, `stream.aborted`; **errors
  thrown after streaming starts bypass Hono's `onError`** — the producer must guard its own writes. https://hono.dev/docs/helpers/streaming
- **WHATWG SSE + MDN:** `EventSource` auto-reconnects; `id:` + `Last-Event-ID` resume; per-stream identity. https://html.spec.whatwg.org/multipage/server-sent-events.html
- **Node `http` `'close'` / MDN `AbortSignal`:** client disconnect surfaced via req/res `'close'` or an
  `AbortSignal`; teardown in `finally`. https://nodejs.org/api/http.html · https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
- **Kubernetes pod termination:** canonical **drain-then-force** with a default **30s** grace budget. https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination

### Observed common behavior

- **Graceful WS shutdown is ALWAYS bounded by a deadline** — "handshake, then force (`terminate`) after a
  timer." No production doc describes an unbounded graceful close.
- **Client disconnect on HTTP/SSE is an event you must subscribe to, and the write will not reliably throw** —
  frameworks converge on onAbort/`'close'` + `finally` teardown + **awaited** writes in a `try/catch` (post-
  headers errors bypass the framework error hook).
- **Stream isolation is request-scoped** — per-request state in the handler closure, never shared/module state.
- **Auth-wait windows are short + explicit** (~5s, app close code), treated as a resource-exhaustion surface.

### Recommendation (adopted below)

WS `stop()` = `close(1001)` each socket → **terminate at a 5s deadline** → server-close resolves (inside a
30s-style overall budget). HTTP `/submit` = per-request `AbortController` + `onAbort`/`'close'` → cancel the
run + `try/finally` teardown + **awaited/caught** writes. Concurrent streams: request-scoped isolation; since a
Robota `Session` is single-threaded downstream (one turn at a time), **reject a concurrent submit (409)** is the
justified v1. WS auth-wait: 5s / code 4001 — **but check SEC-001**: if the token is verified at `verifyClient`
(upgrade), auth is resolved at handshake and no parked-unauth slot exists (RUNTIME-54 subsumed for the token path).

PRIOR_ART_RESEARCH: FOUND

## Decision (to be finalized against prior art)

1. **RUNTIME-13 — graceful-then-forced WS stop.** On `stop()`: `ws.close(1001, ...)` each `wss.clients` socket,
   start a **5s deadline**, `ws.terminate()` any still-open socket at the deadline; then `wss.close()` +
   `httpServer.close()` resolve promptly. Matches RFC 6455 + `ws` + the Kubernetes drain-then-force convention —
   removes the unbounded-hang failure mode. (Periodic heartbeat ping/pong reaping is a noted follow-up, not v1.)
2. **RUNTIME-14 — guaranteed SSE teardown + run cancellation.** Wrap the stream body in `try/finally` so the
   session `off` cleanup ALWAYS runs; register `stream.onAbort` (Hono `StreamingApi.onAbort`/`aborted`,
   confirmed present in `hono@4.12.25`) to resolve + **cancel the underlying run** via `session.abort()`
   (`session-contracts.ts:357` — not merely stop writing) on client disconnect; `await` writes and `.catch`
   so a write to a closed stream cannot throw unhandled (post-headers errors bypass the framework hook — Hono
   docs). **No-fallback posture:** the write `.catch` is a genuine nothing-to-do teardown on an aborted stream
   and MUST carry a reason comment (HARNESS-028 swallow→default gate) so it reads as blessed teardown, not a
   silent swallow.
3. **RUNTIME-38 — reject concurrent submit (409), gated on the existing `session.isExecuting()`.** A Robota
   `Session` is single-threaded downstream (one turn at a time) and the transport shares ONE session
   (`sessionFactory: () => session!`), so two concurrent `/submit` cross-subscribe to the same global emitter.
   Gate on the ALREADY-EXPOSED `session.isExecuting()` signal (`session-contracts.ts:370` — no new state):
   while a turn is in flight, a second `/submit` returns `409` (busy). Per-turn `id:` correlation would only
   demultiplex events — two turns still cannot run on one single-threaded session — so reject is the correct
   v1 (real per-request concurrency needs `sessionFactory` returning distinct sessions, a larger change out of
   scope). **Known limitation:** the check-then-submit gate has a small TOCTOU window (an `await c.req.json()`
   sits between `isExecuting()` and `submit`); it is dramatically better than cross-talk and acceptable for v1.
   **Interplay with RUNTIME-14:** because concurrency is rejected, the client owning an SSE stream is the SOLE
   in-flight turn, so RUNTIME-14's `onAbort → session.abort()` aborts exactly THAT client's run and nothing
   else — the shared-session abort is safe precisely because RUNTIME-38 rejects concurrency.
4. **RUNTIME-54 — subsumed by SEC-001's synchronous connect-time auth (doc-only, no code).** The token is
   presented WITH the upgrade request (query param / subprotocol) and validated **synchronously in
   `wss.on('connection')`** (`ws-transport-configurable.ts:249`, socket closed `1008` before any session data
   is sent) — NOT at `verifyClient` (which checks only Host/Origin, lines 229-242). Because auth is resolved
   synchronously on connect with no post-connect auth-message handshake, there is no parked-unauthenticated
   wait window, so no 5s / code-4001 timeout is needed. Record RUNTIME-54 as resolved-by-SEC-001.
5. **STRUCT-07 — drop the pass-through.** Remove the `agent-core/testing` re-exports (lines 20-21) from
   `agent-framework/src/testing/index.ts`; consumers import `createScriptedProvider` directly from
   `@robota-sdk/agent-core/testing`. Verified safe: no importer resolves those symbols via
   `@robota-sdk/agent-framework/testing` (the two agent-command functional tests use `scriptedSession`/
   `ScriptedSessionHarness`; the harness itself imports from core/testing directly). **Same-class follow-up
   (out of scope here, LOG only):** `agent-transport/src/testing/index.ts:9-10` has the identical pass-through
   of `createScriptedProvider` and IS load-bearing (agent-transport-tui + agent-cli import it via
   `@robota-sdk/agent-transport/testing`) — removing it is breaking, so it needs its own item to apply the rule
   consistently rather than be silently exempted.
6. **SPEC/README accuracy + missing tests** for both transports; document the consumption entry point (whether
   the surface is wired into a shipped app stays a separate product decision, left open).

## Test Plan

- RUNTIME-13: a test that connects a client, calls `stop()`, and asserts it resolves within the deadline
  (previously hung).
- RUNTIME-14: subscribe count is 0 after a client aborts mid-stream (listener leak regression); writes after
  abort do not throw.
- RUNTIME-38: a concurrent `/submit` on a busy session returns 409; the first stream is uncontaminated.
- STRUCT-07: `check-dependency-direction` / no-pass-through scan stays green; importers resolve.

## User Execution Test Scenarios

- **agent-executable.** Start `agent-transport-http` live → `/submit` stream round-trip; force-disconnect the
  client mid-stream → server healthy, session listener count returns to 0 (measured). Start
  `agent-transport-ws` live, connect a client, call `stop()` → resolves within the deadline with the client
  still connected (measured, previously hung).
- Evidence: `.agents/evals/scenarios/arch-004-transport-lifecycle-agent-run.md` (record after execution).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-21

- Prior Art Research: substantiated (`prior-art-researcher`: RFC 6455 close→terminate-after-deadline, `ws`
  close/terminate, Hono streamSSE onAbort, WHATWG SSE, Node `'close'`/AbortSignal, K8s drain-then-force,
  WS 5s/4001 auth) → `PRIOR_ART_RESEARCH: FOUND`; scan-spec-research green.
- Frontmatter (status/type BEHAVIOR/tags + capability keys): present.
- Decision refined by prior art: WS 5s terminate deadline; SSE onAbort→cancel-run + try/finally + awaited
  writes; RUNTIME-38 reject-409 (single-threaded session); RUNTIME-54 subsumed by SEC-001 connect-time auth.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-21

Independent `proposal-reviewer`: **REVISE → resolved**. Verified all five decisions sound (RUNTIME-13 hang,
RUNTIME-14 leak, RUNTIME-38 crosstalk + `isExecuting()` signal, RUNTIME-54 subsumed, STRUCT-07 removal safe).
REVISE items applied:

1. **RUNTIME-54 mechanism corrected** — the token is validated synchronously in `wss.on('connection')` (line
   249, close `1008`), NOT at `verifyClient` (Host/Origin only). Conclusion (subsumed, no timeout) unchanged;
   rationale now matches the code so no future refactor is built on the false "auth at verifyClient" claim.
2. **RUNTIME-38↔14 interplay stated** + gate uses the existing `session.isExecuting()` (no new state) + the
   check-then-submit TOCTOU window acknowledged.
3. **No-fallback reason requirement** added for RUNTIME-14's caught writes (HARNESS-028 blessed-teardown).
4. **Same-class follow-up logged** — `agent-transport/src/testing/index.ts:9-10` has the identical (but
   load-bearing) pass-through; flagged for its own item so STRUCT-07's rule is applied consistently.

Owner directive ("arch-004 core-026 진행") = GATE-APPROVAL sign-off; REVISE resolved.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-21

- **RUNTIME-13** (`ws-transport-configurable.ts`): `stop()` now `close(1001)` each `wss.clients` socket, then
  `terminate()` survivors at a 5s deadline (`WS_STOP_TERMINATE_DEADLINE_MS`), then `wss.close()`/`httpServer.close()`.
- **RUNTIME-14** (`routes.ts`): `/submit` wrapped in `try/finally` (teardown always runs) + `stream.onAbort`
  → `session.abort()` + resolve; a shared awaited/`.catch`'d `write` helper (blessed teardown, `allow-fallback:`).
- **RUNTIME-38** (`routes.ts`): `/submit` returns `409` when `session.isExecuting()`.
- **RUNTIME-54**: doc-only — subsumed by SEC-001 connect-time auth (no code).
- **STRUCT-07** (`agent-framework/src/testing/index.ts`): the two `agent-core/testing` pass-through re-exports removed.

### [GATE-VERIFY] — ✅ PASS | 2026-07-21

- 3-package build green. RUNTIME-13 lifecycle test (stop resolves ~15ms with a live client, previously hung) +
  routes 16/16 (incl. new RUNTIME-38 `409`-on-busy and RUNTIME-14 listener-balance) + prior ws/http suites
  (34→36) green; agent-command STRUCT-07 importers 5/5 green.
- Scans: no-fallback, dependency-direction, entry-point-only green.
- Agent-run scenario executed — `.agents/evals/scenarios/arch-004-transport-lifecycle-agent-run.md`.
