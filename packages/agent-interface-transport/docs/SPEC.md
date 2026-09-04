# agent-interface-transport Specification

## Scope

Owns the transport contract interfaces for the Robota SDK. This package is contracts plus a small
set of pure, dependency-free derivation accessors over its own owned union types (no classes, no
I/O, no side effects) — it defines the standard protocol for transport adapters (WebSocket, HTTP,
MCP, TUI, etc.) and their configurable lifecycle.

## Boundaries

- **Contains type contracts and interfaces plus a small set of pure, dependency-free derivation
  accessors over its own owned union types — no classes, no I/O, no side effects.**
- **Dependencies: `@robota-sdk/agent-core` only (INFRA-025).** Mechanized: the `deps` scan fails any
  `agent-interface-*` package whose internal dependencies exceed `{agent-core}`, and
  `interface-family-owner` checks the same boundary one altitude down, at module edges.
- **Layer 0** in [`.agents/specs/contract-family-owner-map.md`](../../../.agents/specs/contract-family-owner-map.md):
  this package depends on no other `agent-interface-*` package, across every published surface
  including `./testing`. It reached layer 0 in ARCH-108 (issue #2113); before that its testing
  subpath imported a session type, which is why the row read 2 while the root barrel already looked
  clean.
- Does not depend on `@robota-sdk/agent-framework` or any transport implementation package.
- Implementation packages (the separate `agent-transport-{ws,http,mcp,webrtc}` packages and
  `agent-transport` for headless) depend on this package for interface types, not on `agent-framework`.
- `agent-framework` depends on this package to consume the transport contracts it wires.

## Architecture Overview

```
agent-interface-transport          ← this package (contracts only, zero deps)
  ├── ITransportAdapter            ← required frozen lifecycle kind + attach / start / stop
  ├── ITransportRunnerAdapter      ← runner launch + typed terminal outcome
  ├── IConfigurableTransport       ← legacy service adapter + settings capability
  ├── TConfigurableTransport       ← any lifecycle adapter + settings capability
  ├── ITransportConfig             ← persisted transport configuration shape
  ├── ITransportEntry              ← configurable-only settings projection
  ├── ITransportLifecycleRegistryView ← base-adapter lifecycle and runner waits
  ├── ITransportSettingsRegistryView  ← configurable-only settings projection
  ├── ITransportRegistryView       ← composition of both views
  └── IPayloadChannelHost          ← TRANS-001: consumer-declared binary/event channels carried
                                     alongside a transport's own protocol profile

agent-transport-ws (WsTransport), agent-transport-webrtc (WebRtcTransport)
  └── implements IConfigurableTransport<TSession>

agent-transport-http (createHttpTransport), agent-transport-mcp (createMcpTransport),
agent-transport (/headless: createHeadlessTransport), agent-transport-ws (createWsTransport factory)
  └── returns bare ITransportAdapter<TSession>

agent-transport
  └── TransportRegistry            ← structurally compatible with ITransportRegistryView (no declared implements)
```

## Type Ownership

Types owned by this package (SSOT):

| Type                              | Kind      | File                   | Description                                                                                     |
| --------------------------------- | --------- | ---------------------- | ----------------------------------------------------------------------------------------------- |
| `ITransportAdapter`               | Interface | `transport-adapter.ts` | Core transport lifecycle: `name`, frozen `lifecycle`, `attach(session)`, `start()`, `stop()`    |
| `ITransportRunnerAdapter`         | Interface | `transport-adapter.ts` | Runner lifecycle plus `waitForCompletion()` and exact typed outcome                             |
| `ITransportConfig`                | Interface | `transport-config.ts`  | Persisted config shape: `{ enabled: boolean; options?: Record<string, unknown> }`               |
| `ITransportSettingsCapability`    | Interface | `transport-config.ts`  | Orthogonal `defaultEnabled`, `optionsSchema`, and optional `validateOptions()` settings shape   |
| `IConfigurableTransport`          | Interface | `transport-config.ts`  | Source-compatible service adapter plus `ITransportSettingsCapability`                           |
| `TConfigurableTransport`          | Type      | `transport-config.ts`  | Any service or runner adapter intersected with the settings capability                          |
| `ITransportEntry`                 | Interface | `transport-config.ts`  | `{ transport: TConfigurableTransport<T>; config: ITransportConfig }` — settings-only projection |
| `ITransportLifecycleRegistryView` | Interface | `transport-config.ts`  | Base registration, start/stop, ordered completion and prompt failure waits                      |
| `ITransportSettingsRegistryView`  | Interface | `transport-config.ts`  | Configurable-only `getAll`, `setEnabled`, and `setOptions` projection                           |
| `ITransportRegistryView`          | Interface | `transport-config.ts`  | Composition of lifecycle and settings views                                                     |

Two further contract groups are declared here, each in its own file and re-exported from
`src/index.ts`:

| Contract group                     | File                   | Owns                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload-agnostic channel contracts | `channel-contracts.ts` | TRANS-001: `IBinaryFrame` (opaque bytes + per-channel `seq`), `IChannelEventFrame` (consumer-declared structured event), `TChannelFrame`, `TChannelEventMap`, `IChannelDescriptor`, `IPayloadChannel`, `IPayloadChannelHost`, `TChannelReceiveResult`. Content-neutral carrier mechanics — no payload domain (audio/file/image) appears here |
| Transport admission                | `admission.ts`         | SEC-008: `ITransportAdmission`, `ITransportAdmissionConfig` — see § Transport Admission below                                                                                                                                                                                                                                                |

Seven groups were listed here before ARCH-108 (issue #2113) — capability descriptors, command
system, background-task, subagent-job, background job-group, execution-workspace, and peer messaging.
Each was declared in this package because this package was the omnibus, not because transport owned
it. They now live with their owners; the owner map is the one place that says which.

These contract interfaces use generic type parameters where applicable. The package imports a
small number of foundation types from `@robota-sdk/agent-core` only (INFRA-025); all such imports
are type-only (`import type`), so the package emits zero runtime (`@robota-sdk/*`) dependencies.

## Transport Admission (SEC-008)

Admission was not a member of any contract, so each transport re-decided it and they disagreed —
two siblings chose opposite defaults for one question, and a third had no gate at all. This package
owns the decision so there is one place to read and one place to change.

`resolveAdmission` is SECURE BY DEFAULT: an explicit token wins, otherwise one is minted. A transport
may still run open, but only by saying so — `open: true` WITH an `openReason`. The reason is required
because "no credential" and "nobody thought about it" were indistinguishable in the code this
replaces, and only one of them is a decision.

Minting throws rather than returning an open admission, so a transport that cannot get entropy fails
to construct instead of binding without a gate.

The functions that produce the decision — `resolveAdmission`, `mintTransportToken`,
`credentialMatches`, `bearerCredential` — live in `@robota-sdk/agent-transport-protocol`, not here.
This package is inert by rule (no runtime dependency edges), and they need `node:crypto`; putting
them here would give every consumer of these types a runtime edge on a Node builtin.

`transport-admission: none — <reason>` in a transport's own SPEC.md is how a package with no remote
peer declares it. `scan-transport-admission` requires every `packages/agent-transport-*` to do one or
the other.

## Public API Surface

| Export                             | Kind      | Description                                                                                                                                             |
| ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTransportFailedOutcome`     | Function  | builds a failed run outcome from a non-zero exit code, refusing anything outside 1–255                                                                  |
| `isTransportRunOutcome`            | Function  | narrows an unknown value to a `TTransportRunOutcome` — the contract's discriminator                                                                     |
| `ITransportAdapter`                | Interface | Core attach/start/stop lifecycle contract (generic TSession)                                                                                            |
| `ITransportRunnerAdapter`          | Interface | Runner adapter with a separate typed terminal-outcome wait                                                                                              |
| `ITransportLifecycleRegistryView`  | Interface | Base-adapter registration, lifecycle, completion, and prompt failure projection                                                                         |
| `ITransportSettingsRegistryView`   | Interface | Configurable-adapter settings projection                                                                                                                |
| `ITransportConfig`                 | Interface | Persisted enabled + options shape                                                                                                                       |
| `IConfigurableTransport`           | Interface | Configurable transport with defaultEnabled + options schema                                                                                             |
| `ITransportEntry`                  | Interface | Configurable-only `(transport, config)` settings projection                                                                                             |
| `ITransportRegistryView`           | Interface | Registry management: getAll, setEnabled, startAll, stopAll                                                                                              |
| `runTransportLifecycleConformance` | Function  | Testing-subpath fixture runner for the shared adapter lifecycle contract                                                                                |
| `ITransportAdmission`              | Interface | SEC-008: the resolved decision — a credential, or `null` with a written `openReason`                                                                    |
| `ITransportAdmissionConfig`        | Interface | SEC-008: how a caller asks for an admission decision                                                                                                    |
| `ITransportSavedConfig`            | Interface | TRANS-010 (issue #2480): what is persisted for one transport — `enabled?` and `options?`                                                                |
| `ITransportSettingsRepository`     | Interface | TRANS-010: the storage port (`readAll`/`write`) the registry's settings view goes through, so no transport package owns a settings file, path or format |

**This package exports what it declares, and nothing else.** Until ARCH-108 (issue #2113) this
section carried a second table listing fourteen re-exported "contract groups" — command, session,
background-task, subagent, compaction, workspace, peer-messaging, analytics. That table was the
omnibus, written down. Waves 1–3 moved each family to the package named for it, and this leaf removed
the table rather than maintaining a directory of other packages' exports.

Where they went is recorded once, in
[`.agents/specs/contract-family-owner-map.md`](../../../.agents/specs/contract-family-owner-map.md),
which is also what the `interface-family-owner` guard parses. A reader who wants a contract looks it
up in the owner map; a reader who wants a re-export list from here is asking this package to be the
omnibus again.

The one group that stayed is declared, not re-exported: payload-agnostic channels
(`channel-contracts`, TRANS-001) — `IBinaryFrame`, `IChannelEventFrame`, `TChannelFrame`,
`TChannelEventMap`, `IChannelDescriptor`, `IPayloadChannel`, `IPayloadChannelHost`,
`TChannelReceiveResult`.

## Interface Contracts

### `ITransportAdapter<TSession>`

```typescript
export interface ITransportAdapter<TSession = unknown> {
  readonly name: string;
  readonly lifecycle: Readonly<{ kind: 'service' | 'runner' }>;
  attach(session: TSession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

- `name` — unique human-readable runtime identifier (e.g., `'ws'`, `'headless'`)
- `lifecycle` — required frozen discriminant; silence is invalid
- `attach()` — called before `start()` to bind the transport to a session
- `start()` — resolves at the concrete package's documented readiness boundary. Starting before
  attach or starting an active adapter rejects `TransportLifecycleError`
- `stop()` — safe and bounded when repeated. A stopped adapter may be attached and started again

#### What `start()` means, and why it had to be said (ARCH-011)

The former contract had one ambiguous `start(): Promise<void>` and an optional
`runsToCompletion` hint. Headless ran the whole prompt inside `start()`, so a registry awaiting it
could never reach a service registered behind it. ARCH-011 replaces that ambiguity with a required
kind. A runner's `start()` launches and returns; `ITransportRunnerAdapter.waitForCompletion()` returns
exactly `{status:'succeeded', exitCode:0}` or `{status:'failed', exitCode:<nonzero>}` with no raw cause.
The registry owns the promise immediately. Adapter results are only `succeeded | failed`; the wider
registry aggregate may also record `abandoned: stopped | startup-rollback` for a pending runner.
The aggregate always contains every runner in registration order. A separate first-failure wait
reports only a real failed runner and does not turn normal stop abandonment into process failure.

`TuiTransport` is not part of this family: it ignored `attach()` and constructed its own session.
The TUI's existing `renderApp` and `TuiInteractionChannel` are presentation/session-owner surfaces.

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
export interface ITransportSettingsCapability {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<string, { type: string; description: string; default?: unknown }>;
  validateOptions?(options: Record<string, unknown>): boolean;
}

export interface IConfigurableTransport<TSession = unknown>
  extends ITransportServiceAdapter<TSession>, ITransportSettingsCapability {}

export type TConfigurableTransport<TSession = unknown> = TTransportAdapter<TSession> &
  ITransportSettingsCapability;
```

- `defaultEnabled` — used when no `settings.transports.<name>.enabled` is present
- `optionsSchema` — describes configurable options (e.g., for a `/settings` TUI panel)
- `validateOptions()` — optional schema validation before applying user options

### Registry views

```typescript
export interface ITransportLifecycleRegistryView<TSession = unknown> {
  register(transport: TTransportAdapter<TSession>): void;
  startAll(session: TSession): Promise<void>;
  waitForCompletion(): Promise<ITransportCompletionRecord[]>;
  waitForFailure(): Promise<ITransportFailureRecord | undefined>;
  stopAll(): Promise<IDestroyResult>;
}

export interface ITransportSettingsRegistryView<TSession = unknown> {
  getAll(): ITransportEntry<TSession>[];
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setOptions(name: string, options: Record<string, unknown>): Promise<void>;
}

export interface ITransportRegistryView<TSession = unknown>
  extends ITransportLifecycleRegistryView<TSession>, ITransportSettingsRegistryView<TSession> {}
```

`IDestroyResult` is imported (type-only) from `@robota-sdk/agent-core`. `stopAll()` is best-effort:
it never rejects — each transport is stopped independently and any per-transport failure is reported
in the returned `IDestroyResult` rather than thrown (CORE-013).

### `IPayloadChannelHost` / `IPayloadChannel<TEvents>` (TRANS-001)

The payload-agnostic carrier seam. A transport that implements `IPayloadChannelHost` can carry
**consumer-declared channels** alongside its own protocol profile, so the text-agent protocol
(`text_delta`/`submit`/… owned by `agent-transport-protocol`) becomes ONE profile on the transport
rather than being the transport itself — the CMD-004 precedent of contracts below, per-environment
behavior above.

```typescript
export interface IPayloadChannelHost {
  registerChannel<TEvents extends TChannelEventMap>(
    descriptor: IChannelDescriptor<TEvents>,
  ): IPayloadChannel<TEvents>;
}
```

- `IChannelDescriptor` — the declaration: channel `name` (1..255 UTF-8 bytes, unique per host), the
  `events` names it carries, and an opt-in `binary` flag for opaque frames.
- `IBinaryFrame` — `{ kind, channel, seq, payload: Uint8Array }`. The `payload` is bytes the
  transport never inspects; `seq` is a sender-assigned monotonic per-channel counter so a chunked
  payload reassembles in order independently of delivery order.
- `IChannelEventFrame` — a structured event on the same `seq` space, so interleaved binary and event
  frames have a total order.
- `TChannelReceiveResult` — routing outcome. An unroutable frame (unknown channel, undeclared event,
  binary on a text-only channel, malformed envelope) is a STATED error, never a silent drop.

Content-neutrality is a hard boundary: nothing here knows about audio, files, or images. Domain
adapters (a voice app's STT/TTS bridge, a file uploader) are assembled by consumers on top —
never inside the library (ROOM-001 principle).

## Extension Points

This package defines contracts that consumers implement or extend:

| Extension Point          | Kind      | Implementor                                                                                                                                                                  | Description                                                      |
| ------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ITransportAdapter`      | Interface | `createHttpTransport` (http), `createMcpTransport` (mcp), `createHeadlessTransport` (agent-transport/headless), `createWsTransport` factory (ws) — all return a bare adapter | Implement to create a transport with attach/start/stop lifecycle |
| `IConfigurableTransport` | Interface | `WsTransport` (`agent-transport-ws`), `WebRtcTransport` (`agent-transport-webrtc`)                                                                                           | Legacy service adapter with settings capability                  |
| `TConfigurableTransport` | Type      | Registry settings projection, including configurable runners                                                                                                                 | Compose any adapter kind with settings capability                |
| Registry views           | Interface | `agent-transport` (`TransportRegistry`, structurally compatible)                                                                                                             | Segregate lifecycle from configurable settings projection        |
| `IPayloadChannelHost`    | Interface | `WsTransport` (`agent-transport-ws`, via its `PayloadChannelRegistry`)                                                                                                       | Carry consumer-declared binary/event channels on the connection  |

No abstract classes or base classes are exported — all extension is through interface implementation.

## Error Taxonomy

This package owns the inert error shapes `ITransportLifecycleError` and
`ITransportConfigurationError`. Implementing packages construct them; consumers discriminate by
stable `name` and `code`. No error class or stateful runtime owner lives here.

## Constraints

- This package MUST NOT contain classes, I/O, or stateful/side-effecting runtime logic.
- Beyond `interface`/`type` declarations, the only runtime allowed is a small set of pure,
  dependency-free derivation accessors over this package's own owned union types (`isTransportRunOutcome`
  and `createTransportFailedOutcome` over `TTransportRunOutcome` in `transport-adapter.ts`): no classes,
  no I/O, no side effects. The `read*` helpers over `InteractionEvent` were named here as the example
  until ARCH-108 (issue #2113) — they belong to `agent-interface-session` and had stopped being an
  example this package could point at.
- Zero runtime (emitted-JS) dependencies — all `@robota-sdk/*` imports are type-only (`import type`),
  so no `@robota-sdk/*` package is present in the compiled output.
- Any new cross-cutting transport contract must be added here, not in `agent-framework` or individual transport packages.

## Test Strategy

Type tests pin the public shapes. The pure `/testing` helper
`runTransportLifecycleConformance()` drives attach/start/readiness/repeated-start/repeated-stop/restart
without importing Vitest or concrete products. Every public adapter subject invokes it in its owner
package, and the harness roster scan requires exactly one invocation for each of the six subjects.

## Class Contract Registry

This package contains no classes. The following interfaces are the extension contracts that
implementors must satisfy:

| Interface                 | Implemented By                                                                                                                                                  | Package                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `ITransportAdapter`       | `createHttpTransport`/`createMcpTransport`/`createHeadlessTransport`/`createWsTransport` factories (bare adapters); also satisfied via `IConfigurableTransport` | `agent-transport-*`, `agent-transport`         |
| `ITransportRunnerAdapter` | `createHeadlessTransport`                                                                                                                                       | `agent-transport`                              |
| `IConfigurableTransport`  | `WsTransport`, `WebRtcTransport`                                                                                                                                | `agent-transport-ws`, `agent-transport-webrtc` |
| Registry views            | `TransportRegistry` (structurally compatible)                                                                                                                   | `agent-transport`                              |
| `IPayloadChannelHost`     | `WsTransport` (declared `implements`) and `PayloadChannelRegistry`                                                                                              | `agent-transport-ws`                           |

The deliberate intra-package extension chains are `ITransportRunnerAdapter` and
`ITransportServiceAdapter` over `ITransportAdapter`, legacy `IConfigurableTransport` over the service
adapter plus settings capability, and `ITransportRegistryView` composing the lifecycle and settings
registry views. `TConfigurableTransport` keeps settings orthogonal to lifecycle kind.
