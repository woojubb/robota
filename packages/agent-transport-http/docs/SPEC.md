# agent-transport-http Specification

## Scope

HTTP transport (Hono) for the Robota SDK. Split out of the consolidated `agent-transport` package
(DQ-AUDIT-005) so the `hono` dependency is an isolated unit.

## Boundaries

- Owns the Hono-based HTTP transport adapter and agent route builder.
- Depends only on `agent-interface-transport` (transport contracts).
- No other transport package depends on this one.

## Architecture Overview

```
agent-transport-http
  ├── createHttpTransport   ← ITransportAdapter over Hono
  └── createAgentRoutes     ← Hono route builder for an agent session factory
```

## Type Ownership

Owns `IHttpTransportOptions`, `IAgentRoutesOptions`, `TSessionFactory`.

## Public API Surface

| Export                | Kind     | Description                        |
| --------------------- | -------- | ---------------------------------- |
| `createHttpTransport` | function | Hono-based HTTP transport adapter  |
| `createAgentRoutes`   | function | Build agent routes onto a Hono app |

## Extension Points

New routes extend `createAgentRoutes`; new options extend the option interfaces.

## Error Taxonomy

HTTP errors surface as Hono responses; no new error classes.

## Test Strategy

Route + transport unit tests under `src/__tests__`.

## Dependencies

- `@robota-sdk/agent-interface-transport`.
- External: `hono`.
