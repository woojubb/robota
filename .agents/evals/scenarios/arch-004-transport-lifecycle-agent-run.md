# ARCH-004 — transport lifecycle + abort hardening (agent-run)

**Spec:** ARCH-004 (forward-provisioned transport surface hardening). Proves the WS/HTTP transports survive the
lifecycle edges that previously hung or leaked: WS `stop()` with a live client (RUNTIME-13), HTTP `/submit` SSE
listener teardown (RUNTIME-14), and concurrent-submit rejection (RUNTIME-38).
**Type:** agent-executable (the agent builds the transport packages and drives the real server/routes; no owner
action).

## Scenario

```bash
pnpm --filter @robota-sdk/agent-transport-ws --filter @robota-sdk/agent-transport-http \
  --filter @robota-sdk/agent-framework build

# RUNTIME-13 — bind a real WS server, connect a live client, call stop(): must resolve (previously hung).
npx vitest run packages/agent-transport-ws/src/__tests__/ws-transport-lifecycle.test.ts

# RUNTIME-14 + RUNTIME-38 — /submit SSE teardown balance + 409-on-busy, via Hono's test client.
npx vitest run packages/agent-transport-http/src/__tests__/routes.test.ts
```

**Expected:** builds green; `stop()` resolves with a client still connected; `/submit` removes every listener
it added once the stream ends; a concurrent `/submit` on a busy session returns `409`.

## Observed (2026-07-21)

Build (3 packages) — green.

```
RUNTIME-13:
✓ stop() resolves promptly with a client still connected (previously hung forever)   (elapsed ~15ms, ≪ 5s deadline)

RUNTIME-38 / RUNTIME-14:
✓ POST /submit returns 409 while a turn is already in flight (isExecuting)
✓ POST /submit unsubscribes every listener it added once the stream ends (off count == on count, no leak)
Tests  16 passed (16)   (14 prior + 2 new)
```

✅ PASS — RUNTIME-13: `stop()` sends a `close(1001)` frame to each client and terminates any survivor at a 5s
deadline, so the all-clients-gone server-close callback can never hang (measured ~15ms with a live client).
RUNTIME-14: the `/submit` handler wraps its body in `try/finally` and registers `stream.onAbort` →
`session.abort()`, so the session `off` teardown ALWAYS runs — the on/off counts balance (zero leaked
listeners) on the normal path, and a client disconnect cancels the run + tears down via the abort path.
RUNTIME-38: a concurrent `/submit` while `session.isExecuting()` returns `409` instead of cross-subscribing.

**RUNTIME-54 (doc-only):** subsumed by SEC-001 — the WS token is presented with the upgrade and validated
synchronously on the `connection` event (socket closed `1008` before any session data), so there is no
post-connect auth-message handshake and thus no parked-unauthenticated wait window. No 5s/4001 timeout needed.

**STRUCT-07:** the `@robota-sdk/agent-core/testing` pass-through re-exports were removed from
`agent-framework/src/testing/index.ts`; the importers (agent-command functional tests) use the local
`scriptedSession`/`ScriptedSessionHarness` and stay green (5/5). The same-class load-bearing pass-through in
`agent-transport/src/testing/index.ts` is logged as a separate follow-up.
