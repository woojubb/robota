# agent-transport-ws Specification

## Scope

WebSocket transport and wire protocol for the Robota SDK. Split out of the consolidated
`agent-transport` package (DQ-AUDIT-005) so the `ws` dependency and the WS message types are an
isolated unit — browser/monitor consumers (e.g. `agent-web-ui`) depend on this package's types
without pulling React, Ink, or Hono.

## Boundaries

- Owns the `ws`-based transport adapter and the `TClientMessage`/`TServerMessage` protocol.
- Depends on `agent-interface-transport`, `agent-framework`, and `agent-core`.
- No other transport package depends on this one. The default transport-registry wiring that
  pre-registers `WsTransport` lives in the composition root (the CLI), not in the transport core.

## Architecture Overview

```
agent-transport-ws
  ├── WsTransport            ← IConfigurableTransport (settings-backed)
  ├── createWsTransport      ← functional transport factory
  ├── createWsHandler        ← raw ws connection handler
  └── ws-protocol            ← TClientMessage / TServerMessage
```

## Type Ownership

Owns `IWsHandlerOptions`, `IWsTransportOptions`, `IWsTransportConfig`, `TClientMessage`,
`TServerMessage`. Re-exports execution-workspace snapshot types from `agent-framework` at the WS
boundary for browser consumers.

## Public API Surface

| Export                              | Kind     | Description                               |
| ----------------------------------- | -------- | ----------------------------------------- |
| `WsTransport`                       | class    | Settings-backed configurable WS transport |
| `createWsTransport`                 | function | Functional WS transport factory           |
| `createWsHandler`                   | function | Raw ws connection handler                 |
| `TClientMessage` / `TServerMessage` | types    | WS wire protocol                          |

## Extension Points

New message variants extend the protocol unions; new transport options extend the option interfaces.

## Error Taxonomy

Connection/protocol errors surface as `TServerMessage` error frames; no new error classes.

## Test Strategy

Protocol + handler unit tests under `src/__tests__`.

## Dependencies

- `@robota-sdk/agent-interface-transport`, `@robota-sdk/agent-framework`, `@robota-sdk/agent-core`.
- External: `ws`.
