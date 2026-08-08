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
  ├── ITransportRegistryView       ← read/write registry of IConfigurableTransport instances
  └── IPayloadChannelHost          ← TRANS-001: consumer-declared binary/event channels carried
                                     alongside a transport's own protocol profile

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

| Type                     | Kind      | File                   | Description                                                                                              |
| ------------------------ | --------- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `ITransportAdapter`      | Interface | `transport-adapter.ts` | Core transport lifecycle: `name`, `attach(session)`, `start()`, `stop()`, `runsToCompletion?` (ARCH-011) |
| `ITransportConfig`       | Interface | `transport-config.ts`  | Persisted config shape: `{ enabled: boolean; options?: Record<string, unknown> }`                        |
| `IConfigurableTransport` | Interface | `transport-config.ts`  | Extends `ITransportAdapter` with `defaultEnabled`, `optionsSchema`, and optional `validateOptions()`     |
| `ITransportEntry`        | Interface | `transport-config.ts`  | `{ transport: IConfigurableTransport<T>; config: ITransportConfig }` — registry item shape               |
| `ITransportRegistryView` | Interface | `transport-config.ts`  | `getAll()`, `setEnabled()`, `startAll()`, `stopAll()` — registry management contract                     |

In addition to the transport-adapter contracts above, the package owns several further contract
groups, each in its own file (all re-exported from `src/index.ts`):

| Contract group                         | File                            | Owns                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability descriptors                 | `capability-contracts.ts`       | `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety`                                                                                                                                                                                                                                                                                                                     |
| Command system contracts               | `command-contracts.ts`          | `ICommand`, `ICommandSource`, `ICommandResult`, `TCommandInvocationSource` (REMOTE-003), plugin-adapter + status-line command settings contracts; CMD-004 Phase 2 split contract: host-executed `TCommandHostAction` + surface-rendered `TCommandUiIntent` (UI-neutral names) carried on `ICommandResult.hostActions`/`.uiIntents` (the legacy effect union was deleted in Stage E) |
| Interaction-channel contracts          | `interaction-contracts.ts`      | `IInteractionChannel` (CMD-004 `askUser`), `IAgentDriver`, `InteractionEvent`, `ICommandInfo`                                                                                                                                                                                                                                                                                       |
| Session-event payloads                 | `event-contracts.ts`            | Skill-activation, memory, prompt-file-reference, and context-reference event payload contracts                                                                                                                                                                                                                                                                                      |
| Background-task contracts              | `background-task-contracts.ts`  | `TBackgroundTaskRequest` (+ agent/process/scheduled variants), `IBackgroundTaskResult`/`State`/`Schedule`/`Input`/`Usage`/`Error`, log cursor/page + list-filter, event + listener, and the `TBackgroundTask*` enums (INFRA-025 SSOT; TYPE-003: `IBackgroundTaskUsage` is an alias of agent-core's `ITokenUsage` usage-triple SSOT)                                                 |
| Subagent-job contracts                 | `subagent-contracts.ts`         | `TSubagentJobStatus`, `TSubagentJobMode`, `ISubagentJobState` (INFRA-025 SSOT). TYPE-003: all three DERIVE from the background-task contracts — `Exclude<TBackgroundTaskStatus, 'paused'>`, mode alias, and a `Pick` of `IBackgroundTaskState` for every shared field (only `type`/`status`/`promptPreview`/`currentTool`/`result`/`error` are declared locally)                    |
| Context-compaction contracts           | `compact-contracts.ts`          | `TCompactTrigger`, `ICompactEvent` (INFRA-025 SSOT)                                                                                                                                                                                                                                                                                                                                 |
| Background job-group contracts         | `background-group-contracts.ts` | `IBackgroundJobGroupState`/`Summary`/`CreateRequest`, `IBackgroundJobResultEnvelope`, job-group event + status/wait contracts                                                                                                                                                                                                                                                       |
| Execution-workspace contracts          | `workspace-contracts.ts`        | `IExecutionWorkspaceEntry`/`Snapshot`/`Event`/`Filter`, execution-detail page/record contracts, and their enum kinds                                                                                                                                                                                                                                                                |
| Interactive-session contracts          | `session-contracts.ts`          | `IInteractiveSession` (whose `executeCommand` carries the optional CMD-004 command-origin driver id), `IInteractiveSessionEvents` (incl. the CMD-004 `ui_intent` + `session_renamed` + `history_cleared` events), `IExecutionResult`, `IToolState`/`Summary`, `IInteractiveSessionStore`                                                                                            |
| Payload-agnostic channel contracts     | `channel-contracts.ts`          | TRANS-001: `IBinaryFrame` (opaque bytes + per-channel `seq`), `IChannelEventFrame` (consumer-declared structured event), `TChannelFrame`, `TChannelEventMap`, `IChannelDescriptor`, `IPayloadChannel`, `IPayloadChannelHost`, `TChannelReceiveResult`. Content-neutral carrier mechanics — no payload domain (audio/file/image) appears here                                        |
| Driver identity + driver-routed events | `driver-contracts.ts`           | REMOTE-014 E5 co-drive attribution: `TDriverId`, `ISubmitOptions`, and the runtime driver-id constants `OWNER_DRIVER_ID` / `AGENT_DRIVER_ID` (display-only attribution, never authorization — OWNER PRINCIPLE); CMD-004 Phase 2 driver-routed events `IUiIntentEvent` (requester-routed UI intents) + `ISessionRenamedEvent` (broadcast title update)                               |

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

| Export                         | Kind      | Description                                                                                    |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------- |
| `ITransportAdapter`            | Interface | Core attach/start/stop lifecycle contract (generic TSession)                                   |
| `ITransportConfig`             | Interface | Persisted enabled + options shape                                                              |
| `IConfigurableTransport`       | Interface | Configurable transport with defaultEnabled + options schema                                    |
| `ITransportEntry`              | Interface | (transport, config) pair used in registry storage                                              |
| `ITransportRegistryView`       | Interface | Registry management: getAll, setEnabled, startAll, stopAll                                     |
| `OWNER_DRIVER_ID`              | Constant  | REMOTE-014 E5 driver id for a local/owner turn (display-only attribution, never authorization) |
| `AGENT_DRIVER_ID`              | Constant  | REMOTE-014 E5 driver id for an autonomous (wakeup/goal) turn — never the owner                 |
| `createTestInteractiveSession` | Function  | ARCH-012: the conformant `IInteractiveSession` double — see § Session capability members       |
| <<<<<<< HEAD                   |
| `ITransportAdmission`          | Interface | SEC-008: the resolved decision — a credential, or `null` with a written `openReason`           |
| `ITransportAdmissionConfig`    | Interface | SEC-008: how a caller asks for an admission decision                                           |
| =======                        |
| `ITurnHandle`                  | Interface | RUNTIME-003: a submission's identity and a promise for its own turn                            |
| `ITurnNotRunError`             | Interface | RUNTIME-003: the shape a rejected `completed` carries — constructed in agent-framework         |
| `TTurnNotRunReason`            | Type      | RUNTIME-003: why a submission never became a turn (coalesced/dropped/cancelled)                |
| `isTurnNotRunError`            | Function  | RUNTIME-003: the one narrowing for a rejected `completed` — refusal vs. a failure in the turn  |

> > > > > > > origin/develop

The package root (`src/index.ts`) additionally re-exports the following contract groups. These
are type-only except for the four pure accessor functions re-exported from `interaction-contracts`
(`readAssistantReplies`, `readLastAssistantText`, `readToolCalls`, `readErrors`) and the
`isTurnNotRunError` predicate re-exported from `turn-contracts`:

| Contract group (file)                                         | Exported contracts                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload-agnostic channels (`channel-contracts`, TRANS-001)    | `IBinaryFrame`, `IChannelEventFrame`, `TChannelFrame`, `TChannelEventMap`, `IChannelDescriptor`, `IPayloadChannel`, `IPayloadChannelHost`, `TChannelReceiveResult`                                                                                                                                                     |
| Capability descriptors (`capability-contracts`)               | `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety`                                                                                                                                                                                                                                                        |
| Command system (`command-contracts`)                          | `ICommand`, `ICommandSource`, `ICommandResult` (+ CMD-004 `hostActions`/`uiIntents`), `TCommandInvocationSource` (REMOTE-003), `TCommandHostAction`, `TCommandUiIntent`, plugin-adapter + status-line command settings contracts                                                                                       |
| Interaction channel (`interaction-contracts`)                 | `IInteractionChannel`, `IAgentDriver`, `IToolCallObservation`, `ITerminalHandoff`, `InteractionEvent`, `ICommandInfo` (+ the accessor functions above)                                                                                                                                                                 |
| Session-event payloads (`event-contracts`)                    | Skill-activation, memory, prompt-file-reference, and context-reference event payload contracts                                                                                                                                                                                                                         |
| Background task (`background-task-contracts`, INFRA-025 SSOT) | `TBackgroundTaskRequest` (+ agent/process/scheduled variants), `IBackgroundTaskResult`/`State`/`Schedule`/`Input`/`Usage`/`Error`, log cursor/page + list-filter, event + listener, and the `TBackgroundTask*` kind/mode/isolation/status enums (`IBackgroundTaskUsage` = alias of agent-core `ITokenUsage`, TYPE-003) |
| Subagent jobs (`subagent-contracts`, INFRA-025 SSOT)          | `TSubagentJobStatus`, `TSubagentJobMode`, `ISubagentJobState` — TYPE-003: derived from the background-task contracts (`Exclude` status / mode alias / `Pick` state projection), never a manual mirror                                                                                                                  |
| Context compaction (`compact-contracts`, INFRA-025 SSOT)      | `TCompactTrigger`, `ICompactEvent`                                                                                                                                                                                                                                                                                     |
| Background job-group (`background-group-contracts`)           | `IBackgroundJobGroupState`/`Summary`/`CreateRequest`, `IBackgroundJobResultEnvelope`, event + status/wait contracts                                                                                                                                                                                                    |
| Execution workspace (`workspace-contracts`)                   | `IExecutionWorkspaceEntry`/`Snapshot`/`Event`/`Filter`, execution-detail page/record contracts, and their enum kinds                                                                                                                                                                                                   |
| Interactive session (`session-contracts`)                     | `IInteractiveSession`, `IInteractiveSessionEvents` (incl. `ui_intent`/`session_renamed`/`history_cleared`), `IExecutionResult`, `IToolState`/`Summary`, `IInteractiveSessionStore`                                                                                                                                     |
| Driver identity (`driver-contracts`)                          | `TDriverId`, `ISubmitOptions`, `OWNER_DRIVER_ID`/`AGENT_DRIVER_ID`, `IUiIntentEvent`, `ISessionRenamedEvent`                                                                                                                                                                                                           |

## Interface Contracts

### Session capability members, and why they are not optional (ARCH-012)

`IInteractiveSession`'s `isInitialized`, `getPendingCount` and `getActiveDriverId` were OPTIONAL. The
one consumer read attribution as `session.getActiveDriverId?.() ?? undefined`, and two unrelated
situations arrived as the same `undefined`:

- the host attributes turns and none is active right now, and
- the host cannot attribute turns at all.

The second loses every co-drive attribution with no error, no log and nothing to distinguish it from
the first. They are REQUIRED now: a host either provides the capability or does not claim this
contract, so `null` from `getActiveDriverId()` means exactly one thing.

**`createTestInteractiveSession` lives here, with the contract.** A double existed before, published
from `@robota-sdk/agent-framework` and documented in its SPEC — with zero consumers, because every
transport package sits BELOW `agent-framework` and could not import it. The 41 hand-rolled
`as unknown as IInteractiveSession` partials were not an oversight; they were the only thing those
packages could reach. `agent-framework` re-exports this one rather than keeping a second: two doubles
for one contract can disagree, which is this defect one level down.

The remaining casts are held by a ratchet (`scan-contract-cast-ratchet`) that may fall and never
rise, so the debt cannot grow while the capability-scoped ports are designed.

### `ITransportAdapter<TSession>`

```typescript
export interface ITransportAdapter<TSession = unknown> {
  readonly name: string;
  attach(session: TSession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly runsToCompletion?: boolean;
}
```

- `name` — unique human-readable identifier (e.g., `'ws'`, `'tui'`, `'headless'`)
- `attach()` — called before `start()` to bind the transport to a session
- `start()` — begin serving; idempotent. **Resolves once the transport is SERVING, not when its work
  is done** — unless it declares `runsToCompletion`
- `stop()` — stop serving and release resources; idempotent
- `runsToCompletion` — `true` when `start()` does not return while the transport is alive

#### What `start()` means, and why it had to be said (ARCH-011)

The contract used to say only `start(): Promise<void>`, and two readings coexisted. Four transports
bound a port and returned. `headless` ran the entire prompt inside `start()`; `tui` blocked for the
life of the UI. `TransportRegistry.startAll` awaited each in turn, so registering either of those
first meant **every transport behind it never started** — no crash, no error, simply never reached.

A transport whose whole job happens inside `start()` declares `runsToCompletion: true`, and the
registry starts it without awaiting. Its promise is kept, not dropped: `TransportRegistry.waitForCompletion()`
is where its result and its failure arrive, because the transport whose entire job is inside `start()`
is exactly the one whose failure matters, and an unawaited rejection would be an unhandled promise
rather than a reported error.

The route is wired: `ITransportRegistryView.waitForCompletion()` carries it, and
`IRuntimeHostHandle.waitForCompletion()` exposes it to the caller that owns the process-lifetime
wait.

**What it actually covers**, stated because the apparatus is easy to read as wider than it is: a
transport whose `start()` REJECTS. `headless` — the transport that most obviously runs to completion —
absorbs every failure inside its runner and always resolves, expressing failure through
`getExitCode()` instead; so it does not use this route today, and a non-zero exit code is not a
rejection. Whether a run-to-completion transport should be able to report failure by result as well
as by rejection is an open question recorded on ARCH-011, not something this contract answers. The first draft put the method on the concrete registry alone, where neither production caller
— both hold the view — could reach it; a failure route nothing can call is not a route.

`runsToCompletion` is the ONE optional member on this contract, and deliberately so: "resolves once
serving" is the ordinary case, a transport that omits it is asserting that meaning, and the registry
treats absence as `false` rather than guessing. Contrast `IInteractiveSession`'s capability members
(ARCH-012), where silence had no safe reading and optionality was removed.

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

## Turn identity

`submit()` returns an `ITurnHandle` — `{ turnId, completed }` — so an answer belongs to the caller
who asked for it.

Before RUNTIME-003 it returned nothing, and a caller that needed to know when ITS turn ended had
only the session-global `complete` / `interrupted` / `error` events. Those say that A turn ended and
never which one. A session runs one turn at a time and queues the rest, so two concurrent `submit`
calls did not run concurrently: the second waited and then took the RUNNING turn's response as its
own answer. Both callers were told about one turn; neither was told which.

**The id is minted when a submission is ACCEPTED**, and kept if it waits in the queue. One
submission is one identity from end to end.

**`completed` ALWAYS settles**, and that is the part the contract turns on. A queued submission is
not promised a turn — the co-drive queue coalesces a same-driver input into the one behind it, drops
at capacity, and discards everything when cleared. A handle that settled only for submissions that
RAN would leave the rest waiting forever, which is a worse failure than the ambiguity it replaces.
So each of those rejects with a typed `ITurnNotRunError` naming which happened:

| `TTurnNotRunReason` | When                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `coalesced`         | a later same-driver input replaced it in the queue (tail-coalesce)       |
| `dropped`           | the queue was at capacity when it arrived                                |
| `cancelled`         | the queue was cleared before it ran — abort, cancel, or session shutdown |

There is deliberately no `shutdown` member: shutdown clears the queue through the same path as a
cancel, so it reports as `cancelled`. A reason no code path can emit is a reason a consumer would
write a dead branch for.

**A consumer narrows with `isTurnNotRunError`.** The error is declared here as a shape and
constructed in `@robota-sdk/agent-framework`, so an `instanceof` check is not available to a package
that only depends on this one — narrowing is on `name`, and this package exports the predicate that
does it rather than leaving every consumer to spell it. The distinction it draws is the one that
matters at a transport boundary: a refusal is an OUTCOME to report to the caller, while anything
else escaping `completed` is a failure inside the turn and must keep surfacing as one. The MCP
adapter reported both as a soft tool error for one review round, which hid real failures behind a
message that read like a queue decision.

**Migration.** A caller that ignores the return value is unaffected — `await session.submit(...)`
still means what it did, and the direct path still resolves only when the turn is over. An
IMPLEMENTOR of `IInteractiveSession` must return a handle; `createTestInteractiveSession` already
returns a conforming one, so a double built on it needs no change.

## Extension Points

This package defines contracts that consumers implement or extend:

| Extension Point          | Kind      | Implementor                                                                                                                                                                  | Description                                                      |
| ------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `ITransportAdapter`      | Interface | `createHttpTransport` (http), `createMcpTransport` (mcp), `createHeadlessTransport` (agent-transport/headless), `createWsTransport` factory (ws) — all return a bare adapter | Implement to create a transport with attach/start/stop lifecycle |
| `IConfigurableTransport` | Interface | `TuiTransport` (`agent-transport-tui`), `WsTransport` (`agent-transport-ws`)                                                                                                 | Extend `ITransportAdapter` to support enable/disable and options |
| `ITransportRegistryView` | Interface | `agent-transport` (`TransportRegistry`, structurally compatible — no declared `implements`)                                                                                  | Provide registry management for configurable transports          |
| `IPayloadChannelHost`    | Interface | `WsTransport` (`agent-transport-ws`, via its `PayloadChannelRegistry`)                                                                                                       | Carry consumer-declared binary/event channels on the connection  |

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
| `IPayloadChannelHost`    | `WsTransport` (declared `implements`) and `PayloadChannelRegistry`                                                                                              | `agent-transport-ws`                   |

No `extends` chains exist within this package — `IConfigurableTransport` extends `ITransportAdapter`
and is the only intra-package inheritance.
