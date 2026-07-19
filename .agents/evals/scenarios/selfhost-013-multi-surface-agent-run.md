# SELFHOST-013 — one definition → many channels (AGENT-RUN capability verification)

Closes the capability-reachability done-gate (TC-04): the agent built and ran the `examples/` multi-surface
program, serving **one** live session over **two** transports (WS + HTTP) simultaneously — the documented
one-definition→many-channels pattern, end-to-end over the real transport DIP, no gateway. Per
[`.agents/rules/backlog-execution.md`](../../rules/backlog-execution.md) and the
[SELFHOST-013 spec](../../spec-docs/active/SELFHOST-013-multi-surface-deployment-gateway.md) TC-04.

Run by the agent on 2026-07-19: `pnpm --filter robota-capability-multi-surface-deploy dev`.

## Observed

```
$ ANTHROPIC_API_KEY=… pnpm dev   # examples/capabilities/multi-surface-deploy
One session served over 2 channels: ws, http
Each channel attach()ed the SAME session instance — no per-channel rebuild, no gateway.
$ echo $?
0
```

## What ran

- **One definition → one session**: `createAgentRuntime({ provider }).createSession(...)` built a single
  `InteractiveSession`.
- **Many channels over one registry**: `new WsTransport({ port })` registered + started by
  `registry.startAll(session)` (an `IConfigurableTransport`), and `createHttpTransport()` mounted **out-of-band**
  (`http.attach(session); await http.start()`) — a plain `ITransportAdapter`. Both `attach()`ed the same session
  instance.
- The WS server opened + closed cleanly (`stopAll`), the HTTP Hono app mounted + tore down, the process exited 0.

## Verdict

The one-definition→many-channels deployment pattern works end-to-end over the existing transport DIP: a single
session is fanned to every channel through the `TransportRegistry` (`startAll`) plus out-of-band `attach` for
plain adapters — **no gateway, no per-surface runtime fork**. This complements the reference-identity unit proof
(TC-01, `one-session-many-transports.test.ts`) with a live end-to-end run of the documented example (TC-04).
The deployment matrix (`.agents/specs/deployment-matrix.md`) + its drift scan keep the surface↔transport registry
honest (TC-02); no new transport/package/dependency edge was added (TC-03, `deps` scan green).
