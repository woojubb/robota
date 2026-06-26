# agent-interface-transport Specification

## Scope

Owns the transport contract interfaces for the Robota SDK. This package contains only type
contracts and no runtime implementation. It defines the standard protocol for transport adapters
(WebSocket, HTTP, MCP, TUI, etc.) and their configurable lifecycle.

## Boundaries

- **Contains only type contracts and interfaces — no implementation, no classes, no runtime logic.**
- **Zero runtime (emitted-JS) dependencies.** All `@robota-sdk/*` imports are type-only
  (`import type`); the compiled output carries no `@robota-sdk/*` package at runtime. The package
  imports contract types from `@robota-sdk/agent-core`, `@robota-sdk/agent-executor`, and
  `@robota-sdk/agent-session` (e.g. `TUniversalValue`, `IBackgroundTaskError`, `ICompactEvent`).
- **Downward type references are contract composition, not coupling (justification).** As the SSOT
  for transport-facing contracts (INFRA-010), this package's contracts must _reference_ a few
  domain types owned by lower layers — a session compact event (`ICompactEvent`), background-task
  status/error (`@robota-sdk/agent-executor`), and core primitives (`TUniversalValue`,
  `IHistoryEntry`). It does not _own_ or _re-export_ them; the references are `import type` only, so
  there is no runtime edge and the dependency graph stays acyclic (verified by
  `harness:conformance`). `@robota-sdk/agent-core` is the zero-dep foundation and is always an
  acceptable reference. A future full inversion (relocating the referenced domain types up into this
  package so executor/session import from it) is tracked by backlog REFACTOR-018; it is deliberately
  deferred because those types are genuine executor/session domain types and the current type-only
  references carry no runtime cost.
- Does not depend on `@robota-sdk/agent-framework` or any transport implementation package.
- Implementation packages (the separate `agent-transport-{tui,ws,http,mcp}` packages and
  `agent-transport` for headless) depend on this package for interface types, not on `agent-framework`.
- `agent-framework` depends on this package to consume the transport contracts it wires.

## Architecture Overview

```
agent-interface-transport          ← this package (contracts only, zero deps)
  ├── ITransportAdapter            ← core lifecycle: attach / start / stop
  ├── IConfigurableTransport       ← extends ITransportAdapter with enable/disable + options
  ├── ITransportConfig             ← persisted transport configuration shape
  ├── ITransportEntry              ← (transport, config) pairing for registry storage
  └── ITransportRegistryView       ← read/write registry of IConfigurableTransport instances

agent-transport-tui, agent-transport-ws, agent-transport-http, agent-transport-mcp, agent-transport (/headless)
  └── implements IConfigurableTransport<TSession>

agent-transport
  └── TransportRegistry            ← structurally compatible with ITransportRegistryView (no declared implements)
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

In addition to the transport-adapter contracts above, the package owns several further contract
groups, each in its own file (all re-exported from `src/index.ts`):

| Contract group                 | File                            | Owns                                                                                                                             |
| ------------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Capability descriptors         | `capability-contracts.ts`       | `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety`                                                                  |
| Command system contracts       | `command-contracts.ts`          | `ICommand`, `ICommandSource`, `ICommandResult`, `ICommandInteraction`, plugin-adapter + status-line command settings contracts   |
| Interaction-channel contracts  | `interaction-contracts.ts`      | `IInteractionChannel`, `InteractionEvent`, `IPermissionRequest`, `TActionRequest`/`TActionResponse`, `IPickItem`, `ICommandInfo` |
| Session-event payloads         | `event-contracts.ts`            | Skill-activation, memory, prompt-file-reference, and context-reference event payload contracts                                   |
| Background job-group contracts | `background-group-contracts.ts` | `IBackgroundJobGroupState`/`Summary`/`CreateRequest`, `IBackgroundJobResultEnvelope`, job-group event + status/wait contracts    |
| Execution-workspace contracts  | `workspace-contracts.ts`        | `IExecutionWorkspaceEntry`/`Snapshot`/`Event`/`Filter`, execution-detail page/record contracts, and their enum kinds             |
| Interactive-session contracts  | `session-contracts.ts`          | `IInteractiveSession`, `IInteractiveSessionEvents`, `IExecutionResult`, `IToolState`/`Summary`, `IInteractiveSessionStore`       |

These contract interfaces use generic type parameters where applicable. The package does import a
small number of contract types from `@robota-sdk/agent-core`, `@robota-sdk/agent-executor`, and
`@robota-sdk/agent-session` as documented in the Boundaries section; all such imports are type-only
(`import type`), so the package still emits zero runtime (`@robota-sdk/*`) dependencies.

## Public API Surface

| Export                   | Kind      | Description                                                  |
| ------------------------ | --------- | ------------------------------------------------------------ |
| `ITransportAdapter`      | Interface | Core attach/start/stop lifecycle contract (generic TSession) |
| `ITransportConfig`       | Interface | Persisted enabled + options shape                            |
| `IConfigurableTransport` | Interface | Configurable transport with defaultEnabled + options schema  |
| `ITransportEntry`        | Interface | (transport, config) pair used in registry storage            |
| `ITransportRegistryView` | Interface | Registry management: getAll, setEnabled, startAll, stopAll   |

The package root (`src/index.ts`) additionally re-exports the following contract groups (types only):

| Contract group (file)                               | Exported contracts                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Capability descriptors (`capability-contracts`)     | `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety`                                                                  |
| Command system (`command-contracts`)                | `ICommand`, `ICommandSource`, `ICommandResult`, `ICommandInteraction`, plugin-adapter + status-line command settings contracts   |
| Interaction channel (`interaction-contracts`)       | `IInteractionChannel`, `InteractionEvent`, `IPermissionRequest`, `TActionRequest`/`TActionResponse`, `IPickItem`, `ICommandInfo` |
| Session-event payloads (`event-contracts`)          | Skill-activation, memory, prompt-file-reference, and context-reference event payload contracts                                   |
| Background job-group (`background-group-contracts`) | `IBackgroundJobGroupState`/`Summary`/`CreateRequest`, `IBackgroundJobResultEnvelope`, event + status/wait contracts              |
| Execution workspace (`workspace-contracts`)         | `IExecutionWorkspaceEntry`/`Snapshot`/`Event`/`Filter`, execution-detail page/record contracts, and their enum kinds             |
| Interactive session (`session-contracts`)           | `IInteractiveSession`, `IInteractiveSessionEvents`, `IExecutionResult`, `IToolState`/`Summary`, `IInteractiveSessionStore`       |

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

| Extension Point          | Kind      | Implementor                                                                                 | Description                                                      |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ITransportAdapter`      | Interface | `agent-transport-{tui,ws,http,mcp}`, `agent-transport` (headless)                           | Implement to create a transport with attach/start/stop lifecycle |
| `IConfigurableTransport` | Interface | `agent-transport-{tui,ws,http,mcp}`, `agent-transport` (headless)                           | Extend `ITransportAdapter` to support enable/disable and options |
| `ITransportRegistryView` | Interface | `agent-transport` (`TransportRegistry`, structurally compatible — no declared `implements`) | Provide registry management for configurable transports          |

No abstract classes or base classes are exported — all extension is through interface implementation.

## Error Taxonomy

This package defines no error types. It contains only interface and type declarations.
Errors arising from transport lifecycle (e.g., failed `start()` or `stop()`) are thrown by
implementing packages (the separate `agent-transport-*` packages and `agent-transport`) and are not part of this package's contract.

## Constraints

- This package MUST NOT contain classes, runtime functions, or any executable logic.
- Only `interface` and `type` declarations are allowed (narrow type-guard functions are also prohibited).
- Zero runtime (emitted-JS) dependencies — all `@robota-sdk/*` imports are type-only (`import type`),
  so no `@robota-sdk/*` package is present in the compiled output.
- Any new cross-cutting transport contract must be added here, not in `agent-framework` or individual transport packages.

## Test Strategy

No tests required. This package contains only interface declarations; correctness is verified by
the TypeScript compiler in consumers. The `package.json` configures `vitest run --passWithNoTests`
so the test script succeeds with zero test files.

## Class Contract Registry

This package contains no classes. The following interfaces are the extension contracts that
implementors must satisfy:

| Interface                | Implemented By                                                          | Package                      |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------- |
| `ITransportAdapter`      | concrete transport classes (via `IConfigurableTransport`)               | `agent-transport-*` packages |
| `IConfigurableTransport` | `TuiTransport`, `WsTransport`, `HeadlessTransport`, etc.                | `agent-transport-*` packages |
| `ITransportRegistryView` | `TransportRegistry` (structurally compatible, no declared `implements`) | `agent-transport`            |

No `extends` chains exist within this package — `IConfigurableTransport` extends `ITransportAdapter`
and is the only intra-package inheritance.
