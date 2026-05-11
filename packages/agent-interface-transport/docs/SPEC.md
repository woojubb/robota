# agent-interface-transport Specification

## Scope

Owns the transport contract interfaces for the Robota SDK. This package contains only type contracts and no runtime implementation. It defines the standard protocol for transport adapters (WebSocket, HTTP, MCP, etc.) and their configurable lifecycle.

## Boundaries

- **Contains only type contracts and interfaces — no implementation, no classes, no runtime logic.**
- Depends on `@robota-sdk/agent-sessions` for `ISession` (the minimal session abstraction).
- Does not depend on `@robota-sdk/agent-sdk` or any implementation package.
- Implementation packages (`agent-transport-ws`, `agent-transport-http`, etc.) depend on this package, not on `agent-sdk`, for interface types.
- `agent-sdk` depends on this package to consume the transport contracts it wires.

## Architecture Overview

```
agent-sessions
  └── ISession                    ← minimal session abstraction { readonly sessionId: string }

agent-interface-transport          ← this package (contracts only)
  ├── ITransportAdapter            ← core lifecycle: attach / start / stop
  ├── IConfigurableTransport       ← extends ITransportAdapter with enable/disable + options
  └── ITransportConfig             ← persisted transport configuration shape

agent-transport-ws
  └── WsTransport implements IConfigurableTransport

agent-cli
  └── TransportRegistry            ← manages IConfigurableTransport instances + settings
```

**Dependency direction:**

```
agent-core → agent-sessions → agent-interface-transport → (consumed by) agent-sdk, agent-transport-*
```

## Type Ownership

Types owned by this package (SSOT):

| Type                     | Kind      | File                   | Description                                                                                          |
| ------------------------ | --------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `ITransportAdapter`      | Interface | `transport-adapter.ts` | Core transport lifecycle: `name`, `attach(session: ISession)`, `start()`, `stop()`                   |
| `ITransportConfig`       | Interface | `transport-config.ts`  | Persisted config shape: `{ enabled: boolean; options?: Record<string, unknown> }`                    |
| `IConfigurableTransport` | Interface | `transport-config.ts`  | Extends `ITransportAdapter` with `defaultEnabled`, `optionsSchema`, and optional `validateOptions()` |

Types consumed from other packages (not owned here):

| Type       | Source                       |
| ---------- | ---------------------------- |
| `ISession` | `@robota-sdk/agent-sessions` |

## Public API Surface

| Export                   | Kind      | Description                                         |
| ------------------------ | --------- | --------------------------------------------------- |
| `ITransportAdapter`      | Interface | Core attach/start/stop lifecycle contract           |
| `ITransportConfig`       | Interface | Persisted enabled + options shape                   |
| `IConfigurableTransport` | Interface | Configurable transport with defaultEnabled + schema |

## Interface Contracts

### `ITransportAdapter`

```typescript
export interface ITransportAdapter {
  readonly name: string;
  attach(session: ISession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

- `name` — unique human-readable identifier (e.g., `'ws'`, `'web-monitor'`)
- `attach()` — called before `start()` to bind the transport to a session
- `start()` — begin serving; idempotent
- `stop()` — stop serving and release resources; idempotent

### `ITransportConfig`

```typescript
export interface ITransportConfig {
  enabled: boolean;
  options?: Record<string, unknown>;
}
```

Persisted in `settings.json` under `transports.<name>`.

### `IConfigurableTransport`

```typescript
export interface IConfigurableTransport extends ITransportAdapter {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<string, { type: string; description: string; default?: unknown }>;
  validateOptions?(options: Record<string, unknown>): boolean;
}
```

- `defaultEnabled` — used when no `settings.transports.<name>.enabled` is present
- `optionsSchema` — describes configurable options for the `/settings` TUI
- `validateOptions()` — optional schema validation before applying user options

## Constraints

- This package MUST NOT contain classes, functions, or any runtime logic.
- Only `interface` and `type` declarations are allowed.
- Any new cross-cutting transport contract must be added here, not in `agent-sdk` or individual transport packages.
