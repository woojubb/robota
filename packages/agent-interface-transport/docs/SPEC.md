# agent-interface-transport Specification

## Scope

Owns the transport contract interfaces for the Robota SDK. This package is contracts plus a small
set of pure, dependency-free derivation accessors over its own owned union types (no classes, no
I/O, no side effects) — it defines the standard protocol for transport adapters (WebSocket, HTTP,
MCP, TUI, etc.) and their configurable lifecycle.

## Boundaries

- **Contains type contracts and interfaces plus a small set of pure, dependency-free derivation
  accessors over its own owned union types — no classes, no I/O, no side effects.**
- **Dependencies: `@robota-sdk/agent-core` only (INFRA-025).** The full inversion formerly
  tracked by REFACTOR-018 is DONE: the background-task data contracts, subagent job state
  family, and compaction event contract now live HERE (`background-task-contracts.ts`,
  `subagent-contracts.ts`, `compact-contracts.ts`) and `agent-executor`/`agent-session`
  import them from this package. The only remaining upstream reference is the zero-dep
  foundation `@robota-sdk/agent-core` (`TUniversalValue`, `IHistoryEntry`,
  `IContextWindowState`, …). Mechanized: the `deps` scan fails any `agent-interface-*`
  package whose internal dependencies exceed `{agent-core}`.
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

agent-transport-tui (TuiTransport), agent-transport-ws (WsTransport)
  └── implements IConfigurableTransport<TSession>

agent-transport-http (createHttpTransport), agent-transport-mcp (createMcpTransport),
agent-transport (/headless: createHeadlessTransport), agent-transport-ws (createWsTransport factory)
  └── returns bare ITransportAdapter<TSession>

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

| Contract group                 | File                            | Owns                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability descriptors         | `capability-contracts.ts`       | `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety`                                                                                                                                                                       |
| Command system contracts       | `command-contracts.ts`          | `ICommand`, `ICommandSource`, `ICommandResult`, plugin-adapter + status-line command settings contracts                                                                                                                               |
| Interaction-channel contracts  | `interaction-contracts.ts`      | `IInteractionChannel` (CMD-004 `askUser`), `IAgentDriver`, `InteractionEvent`, `ICommandInfo`                                                                                                                                         |
| Session-event payloads         | `event-contracts.ts`            | Skill-activation, memory, prompt-file-reference, and context-reference event payload contracts                                                                                                                                        |
| Background-task contracts      | `background-task-contracts.ts`  | `TBackgroundTaskRequest` (+ agent/process/scheduled variants), `IBackgroundTaskResult`/`State`/`Schedule`/`Input`/`Usage`/`Error`, log cursor/page + list-filter, event + listener, and the `TBackgroundTask*` enums (INFRA-025 SSOT) |
| Subagent-job contracts         | `subagent-contracts.ts`         | `TSubagentJobStatus`, `TSubagentJobMode`, `ISubagentJobState` (INFRA-025 SSOT)                                                                                                                                                        |
| Context-compaction contracts   | `compact-contracts.ts`          | `TCompactTrigger`, `ICompactEvent` (INFRA-025 SSOT)                                                                                                                                                                                   |
| Background job-group contracts | `background-group-contracts.ts` | `IBackgroundJobGroupState`/`Summary`/`CreateRequest`, `IBackgroundJobResultEnvelope`, job-group event + status/wait contracts                                                                                                         |
| Execution-workspace contracts  | `workspace-contracts.ts`        | `IExecutionWorkspaceEntry`/`Snapshot`/`Event`/`Filter`, execution-detail page/record contracts, and their enum kinds                                                                                                                  |
| Interactive-session contracts  | `session-contracts.ts`          | `IInteractiveSession`, `IInteractiveSessionEvents`, `IExecutionResult`, `IToolState`/`Summary`, `IInteractiveSessionStore`                                                                                                            |

These contract interfaces use generic type parameters where applicable. The package imports a
small number of foundation types from `@robota-sdk/agent-core` only (INFRA-025); all such imports
are type-only (`import type`), so the package emits zero runtime (`@robota-sdk/*`) dependencies.

## Public API Surface

| Export                   | Kind      | Description                                                  |
| ------------------------ | --------- | ------------------------------------------------------------ |
| `ITransportAdapter`      | Interface | Core attach/start/stop lifecycle contract (generic TSession) |
| `ITransportConfig`       | Interface | Persisted enabled + options shape                            |
| `IConfigurableTransport` | Interface | Configurable transport with defaultEnabled + options schema  |
| `ITransportEntry`        | Interface | (transport, config) pair used in registry storage            |
| `ITransportRegistryView` | Interface | Registry management: getAll, setEnabled, startAll, stopAll   |

The package root (`src/index.ts`) additionally re-exports the following contract groups. These
are type-only except for the four pure accessor functions re-exported from `interaction-contracts`
(`readAssistantReplies`, `readLastAssistantText`, `readToolCalls`, `readErrors`):

| Contract group (file)                                         | Exported contracts                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability descriptors (`capability-contracts`)               | `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety`                                                                                                                                                                                 |
| Command system (`command-contracts`)                          | `ICommand`, `ICommandSource`, `ICommandResult`, plugin-adapter + status-line command settings contracts                                                                                                                                         |
| Interaction channel (`interaction-contracts`)                 | `IInteractionChannel`, `IAgentDriver`, `IToolCallObservation`, `ITerminalHandoff`, `InteractionEvent`, `ICommandInfo` (+ the accessor functions above)                                                                                          |
| Session-event payloads (`event-contracts`)                    | Skill-activation, memory, prompt-file-reference, and context-reference event payload contracts                                                                                                                                                  |
| Background task (`background-task-contracts`, INFRA-025 SSOT) | `TBackgroundTaskRequest` (+ agent/process/scheduled variants), `IBackgroundTaskResult`/`State`/`Schedule`/`Input`/`Usage`/`Error`, log cursor/page + list-filter, event + listener, and the `TBackgroundTask*` kind/mode/isolation/status enums |
| Subagent jobs (`subagent-contracts`, INFRA-025 SSOT)          | `TSubagentJobStatus`, `TSubagentJobMode`, `ISubagentJobState`                                                                                                                                                                                   |
| Context compaction (`compact-contracts`, INFRA-025 SSOT)      | `TCompactTrigger`, `ICompactEvent`                                                                                                                                                                                                              |
| Background job-group (`background-group-contracts`)           | `IBackgroundJobGroupState`/`Summary`/`CreateRequest`, `IBackgroundJobResultEnvelope`, event + status/wait contracts                                                                                                                             |
| Execution workspace (`workspace-contracts`)                   | `IExecutionWorkspaceEntry`/`Snapshot`/`Event`/`Filter`, execution-detail page/record contracts, and their enum kinds                                                                                                                            |
| Interactive session (`session-contracts`)                     | `IInteractiveSession`, `IInteractiveSessionEvents`, `IExecutionResult`, `IToolState`/`Summary`, `IInteractiveSessionStore`                                                                                                                      |

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
  /** Best-effort: never rejects; per-transport stop failures come back in the result (CORE-013). */
  stopAll(): Promise<IDestroyResult>;
}
```

`IDestroyResult` is imported (type-only) from `@robota-sdk/agent-core`. `stopAll()` is best-effort:
it never rejects — each transport is stopped independently and any per-transport failure is reported
in the returned `IDestroyResult` rather than thrown (CORE-013).

## Extension Points

This package defines contracts that consumers implement or extend:

| Extension Point          | Kind      | Implementor                                                                                                                                                                  | Description                                                      |
| ------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ITransportAdapter`      | Interface | `createHttpTransport` (http), `createMcpTransport` (mcp), `createHeadlessTransport` (agent-transport/headless), `createWsTransport` factory (ws) — all return a bare adapter | Implement to create a transport with attach/start/stop lifecycle |
| `IConfigurableTransport` | Interface | `TuiTransport` (`agent-transport-tui`), `WsTransport` (`agent-transport-ws`)                                                                                                 | Extend `ITransportAdapter` to support enable/disable and options |
| `ITransportRegistryView` | Interface | `agent-transport` (`TransportRegistry`, structurally compatible — no declared `implements`)                                                                                  | Provide registry management for configurable transports          |

No abstract classes or base classes are exported — all extension is through interface implementation.

## Error Taxonomy

This package defines no error types. It contains only interface and type declarations.
Errors arising from transport lifecycle (e.g., failed `start()` or `stop()`) are thrown by
implementing packages (the separate `agent-transport-*` packages and `agent-transport`) and are not part of this package's contract.

## Constraints

- This package MUST NOT contain classes, I/O, or stateful/side-effecting runtime logic.
- Beyond `interface`/`type` declarations, the only runtime allowed is a small set of pure,
  dependency-free derivation accessors over this package's own owned union types (e.g. the `read*`
  helpers over `InteractionEvent` in `interaction-contracts.ts`): no classes, no I/O, no side effects.
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

| Interface                | Implemented By                                                                                                                                                  | Package                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `ITransportAdapter`      | `createHttpTransport`/`createMcpTransport`/`createHeadlessTransport`/`createWsTransport` factories (bare adapters); also satisfied via `IConfigurableTransport` | `agent-transport-*`, `agent-transport` |
| `IConfigurableTransport` | `TuiTransport` (`agent-transport-tui`), `WsTransport` (`agent-transport-ws`)                                                                                    | `agent-transport-*` packages           |
| `ITransportRegistryView` | `TransportRegistry` (structurally compatible, no declared `implements`)                                                                                         | `agent-transport`                      |

No `extends` chains exist within this package — `IConfigurableTransport` extends `ITransportAdapter`
and is the only intra-package inheritance.
