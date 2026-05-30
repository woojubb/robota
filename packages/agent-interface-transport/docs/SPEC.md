# agent-interface-transport Specification

## Scope

Owns the transport contract interfaces for the Robota SDK. This package contains only type
contracts and no runtime implementation. It defines the standard protocol for transport adapters
(WebSocket, HTTP, MCP, TUI, etc.) and their configurable lifecycle.

## Boundaries

- **Contains only type contracts and interfaces — no implementation, no classes, no runtime logic.**
- **Zero runtime dependencies.** All type parameters use generics (`TSession = unknown`).
- Does not depend on `@robota-sdk/agent-framework` or any implementation package.
- Implementation packages (`agent-transport` subpaths: `/tui`, `/headless`, `/ws`, `/http`, `/mcp`)
  depend on this package for interface types, not on `agent-framework`.
- `agent-framework` depends on this package to consume the transport contracts it wires.

## Architecture Overview

```
agent-interface-transport          ← this package (contracts only, zero deps)
  ├── ITransportAdapter            ← core lifecycle: attach / start / stop
  ├── IConfigurableTransport       ← extends ITransportAdapter with enable/disable + options
  ├── ITransportConfig             ← persisted transport configuration shape
  ├── ITransportEntry              ← (transport, config) pairing for registry storage
  └── ITransportRegistryView       ← read/write registry of IConfigurableTransport instances

agent-transport/tui, /ws, /http, /mcp, /headless
  └── implements IConfigurableTransport<TSession>

agent-framework
  └── TransportRegistry            ← implements ITransportRegistryView
```

## Type Ownership

Types owned by this package (SSOT):

| Type                     | Kind      | File                   | Description                                                                                          |
| ------------------------ | --------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `ITransportAdapter`      | Interface | `transport-adapter.ts` | Core transport lifecycle: `name`, `attach(session: TSession)`, `start()`, `stop()`                   |
| `ITransportConfig`       | Interface | `transport-config.ts`  | Persisted config shape: `{ enabled: boolean; options?: Record<string, unknown> }`                    |
| `IConfigurableTransport` | Interface | `transport-config.ts`  | Extends `ITransportAdapter` with `defaultEnabled`, `optionsSchema`, and optional `validateOptions()` |
| `ITransportEntry`        | Interface | `transport-config.ts`  | `{ transport: IConfigurableTransport<T>; config: ITransportConfig }` — registry item shape           |
| `ITransportRegistryView` | Interface | `transport-config.ts`  | `getAll()`, `setEnabled()`, `startAll()`, `stopAll()` — registry management contract                 |

No types are imported from other packages; all interfaces use generic type parameters.

## Public API Surface

| Export                   | Kind      | Description                                                  |
| ------------------------ | --------- | ------------------------------------------------------------ |
| `ITransportAdapter`      | Interface | Core attach/start/stop lifecycle contract (generic TSession) |
| `ITransportConfig`       | Interface | Persisted enabled + options shape                            |
| `IConfigurableTransport` | Interface | Configurable transport with defaultEnabled + options schema  |
| `ITransportEntry`        | Interface | (transport, config) pair used in registry storage            |
| `ITransportRegistryView` | Interface | Registry management: getAll, setEnabled, startAll, stopAll   |

## Interface Contracts

### `ITransportAdapter<TSession>`

```typescript
export interface ITransportAdapter<TSession = unknown> {
  readonly name: string;
  attach(session: TSession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

- `name` — unique human-readable identifier (e.g., `'ws'`, `'tui'`, `'headless'`)
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

### `IConfigurableTransport<TSession>`

```typescript
export interface IConfigurableTransport<TSession = unknown> extends ITransportAdapter<TSession> {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<string, { type: string; description: string; default?: unknown }>;
  validateOptions?(options: Record<string, unknown>): boolean;
}
```

- `defaultEnabled` — used when no `settings.transports.<name>.enabled` is present
- `optionsSchema` — describes configurable options (e.g., for a `/settings` TUI panel)
- `validateOptions()` — optional schema validation before applying user options

### `ITransportRegistryView<TSession>`

```typescript
export interface ITransportRegistryView<TSession = unknown> {
  getAll(): ITransportEntry<TSession>[];
  setEnabled(name: string, enabled: boolean): Promise<void>;
  startAll(session: TSession): Promise<void>;
  stopAll(): Promise<void>;
}
```

## Extension Points

This package defines contracts that consumers implement or extend:

| Extension Point          | Kind      | Implementor                                                | Description                                                          |
| ------------------------ | --------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `ITransportAdapter`      | Interface | `agent-transport/tui`, `/ws`, `/http`, `/mcp`, `/headless` | Implement to create a transport with attach/start/stop lifecycle     |
| `IConfigurableTransport` | Interface | `agent-transport/tui`, `/ws`, `/http`, `/mcp`, `/headless` | Extend `ITransportAdapter` to support enable/disable and options     |
| `ITransportRegistryView` | Interface | `agent-framework` (`TransportRegistry`)                    | Implement to provide registry management for configurable transports |

No abstract classes or base classes are exported — all extension is through interface implementation.

## Error Taxonomy

This package defines no error types. It contains only interface and type declarations.
Errors arising from transport lifecycle (e.g., failed `start()` or `stop()`) are thrown by
implementing packages (`agent-transport/*`) and are not part of this package's contract.

## Constraints

- This package MUST NOT contain classes, runtime functions, or any executable logic.
- Only `interface` and `type` declarations are allowed (narrow type-guard functions are also prohibited).
- Zero runtime dependencies — no imports from any `@robota-sdk/*` package.
- Any new cross-cutting transport contract must be added here, not in `agent-framework` or individual transport packages.

## Test Strategy

No tests required. This package contains only interface declarations; correctness is verified by
the TypeScript compiler in consumers. The `package.json` configures `vitest run --passWithNoTests`
so the test script succeeds with zero test files.

## Class Contract Registry

This package contains no classes. The following interfaces are the extension contracts that
implementors must satisfy:

| Interface                | Implemented By                                            | Package             |
| ------------------------ | --------------------------------------------------------- | ------------------- |
| `ITransportAdapter`      | concrete transport classes (via `IConfigurableTransport`) | `agent-transport/*` |
| `IConfigurableTransport` | `TuiTransport`, `WsTransport`, `HeadlessTransport`, etc.  | `agent-transport/*` |
| `ITransportRegistryView` | `TransportRegistry`                                       | `agent-framework`   |

No `extends` chains exist within this package — `IConfigurableTransport` extends `ITransportAdapter`
and is the only intra-package inheritance.
