# agent-transport-ws Specification

## Scope

WebSocket transport and wire protocol for the Robota SDK. Split out of the consolidated
`agent-transport` package (DQ-AUDIT-005) so the `ws` dependency and the WS message types are an
isolated unit — browser/monitor consumers (e.g. `agent-web-ui`) depend on this package's types
without pulling React, Ink, or Hono.

## Boundaries

- Owns the `ws`-based transport adapter (`WsTransport`, `createWsTransport`). The transport-neutral session
  bridge (`createWsHandler`) + wire protocol (`TClientMessage`/`TServerMessage`) were **extracted to
  `@robota-sdk/agent-transport-protocol`** (REMOTE-002) so a non-WS transport can reuse them; this package
  imports them from there.
- Depends on `agent-interface-transport`, `agent-core`, and `agent-transport-protocol` (INFRA-025: the framework
  edge was deleted — every consumed type is an interface-transport / protocol contract).
- No other transport package depends on this one. The default transport-registry wiring that
  pre-registers `WsTransport` lives in the composition root (the CLI), not in the transport core.

## Architecture Overview

```
agent-transport-ws
  ├── WsTransport            ← IConfigurableTransport (settings-backed)
  └── createWsTransport      ← functional transport factory
  (reuses createWsHandler + TClientMessage/TServerMessage from @robota-sdk/agent-transport-protocol)
```

## Type Ownership

Owns `IWsTransportOptions`, `IWsTransportConfig`. The session bridge (`createWsHandler`/`IWsHandlerOptions`) +
wire protocol (`TClientMessage`/`TServerMessage`) are owned by `@robota-sdk/agent-transport-protocol` and
imported from there. Consumers import execution-workspace contract types from
`@robota-sdk/agent-interface-transport` directly (INFRA-025: no pass-through re-exports).

## Public API Surface

| Export              | Kind     | Description                               |
| ------------------- | -------- | ----------------------------------------- |
| `WsTransport`       | class    | Settings-backed configurable WS transport |
| `createWsTransport` | function | Functional WS transport factory           |

### Loopback auth token (GUI-002)

`IWsTransportConfig.token?: string` — an OPTIONAL per-connection auth token. **When set**, every incoming
connection must present a matching token or the socket is **closed (code 1008) BEFORE any session data
(`messages` / `execution_workspace_event`) is emitted**. The token is read from the upgrade request as the
`?token=` query param (browser `WebSocket` cannot set headers) or, failing that, the first
`Sec-WebSocket-Protocol` subprotocol; comparison is constant-time (`node:crypto` `timingSafeEqual`, length-guarded).
**When unset** (the default, e.g. the local TUI path) the transport is unauthenticated exactly as before — a
backward-compatible no-op. It is a runtime-injected secret (not part of `optionsSchema`, never persisted to
settings). The `agent-cli` composition root passes it from `ROBOTA_WS_TOKEN` (+ optional `ROBOTA_WS_PORT`)
when a host such as the `agent-app` Electron shell spawns the CLI as a loopback sidecar. The pre-existing
unauthenticated default path is tracked for hardening by a companion SECURITY backlog.

## Extension Points

New message variants extend the protocol unions; new transport options extend the option interfaces.

## Error Taxonomy

Connection/protocol errors surface as `TServerMessage` error frames; no new error classes.

## Test Strategy

Protocol + handler unit tests under `src/__tests__`.

## Dependencies

- `@robota-sdk/agent-interface-transport`, `@robota-sdk/agent-core`.
- External: `ws`.
