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

### Peer messaging — two axes that must not collapse (PEER-001, #1809/#1810)

A peer message is **not** `TClientMessage.submit`. `submit` is a remote surface DRIVING a host
session — one party operates, the other is operated. A peer message is symmetric: two sessions, each
with its own agent, neither driving the other. Widening `submit` would make those indistinguishable
at the point a session decides how much authority the sender has.

Admission answers **two independent questions**, and `IPeerAdmission` carries both because collapsing
them into one boolean is the defect #1810 exists to remove:

| Question                          | Answered by                                                             | Property                                      |
| --------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| What did the peer **present**?    | `ITransportAdmission` (SEC-008) — a token, or an explicit open decision | Possession, and possession is **copyable**    |
| Where did the peer **come from**? | The environment proof (SEC-010)                                         | Evidence the OS enforces; **nothing to copy** |

`TPeerTrust` names what was established: `same-user-same-host` is what SEC-010's kernel-enforced
rendezvous produces, `token-only` means a credential was presented and nothing about origin was
proven, and the two are not interchangeable however convenient a single flag would be.

`TDriverId` on `IPeerOrigin` is **display and attribution only** and must never become an
authentication or authorization input — asserted in the suite, not merely stated here.

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

In addition to the transport-adapter contracts above, the package owns several further contract
groups, each in its own file (all re-exported from `src/index.ts`):

| Contract group                             | File                            | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability descriptors                     | `capability-contracts.ts`       | `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Peer messaging (PEER-001, #1809)           | `peer-message-contracts.ts`     | `IPeerMessage`, `IPeerOrigin`, `IPeerAdmission`, `IPeerMessageAck`, `IPeerMessageIngress`, `ISessionPeerMessagingPort`, `TPeerTrust`, `TPeerDeliveryState`, plus the discriminators `isTerminalPeerDelivery` and `isSameEnvironmentPeer`                                                                                                                                                                                                                                                                                                  |
| Cross-device hand-off (HANDOFF-001, #1811) | `handoff-contracts.ts`          | `IHandoffManifest`, `IHandoffPayload`, `IHandoffCommitAck`, `IHandoffOutcome`, `IHandoffStateItem`, `IHandoffIntegrity`, `THandoffPhase`, `THandoffDisposition`, `THandoffRefusal` (TRANS-006 added `payload-undecodable` — intact bytes that did not decode as a session record, kept apart from `integrity-failed` because integrity PASSED and the two require opposite actions from the source: an integrity failure is retried, this one never is), plus the discriminators `sourceRetainsAuthority` and `isHandoffCommitted`        |
| Command system contracts                   | `command-contracts.ts`          | `ICommand`, `ICommandSource`, `ICommandResult`, `TCommandInvocationSource` (REMOTE-003), plugin-adapter + status-line command settings contracts; CMD-004 Phase 2 split contract: host-executed `TCommandHostAction` + surface-rendered `TCommandUiIntent` (UI-neutral names) carried on `ICommandResult.hostActions`/`.uiIntents` (the legacy effect union was deleted in Stage E)                                                                                                                                                       |
| Interaction-channel contracts              | `interaction-contracts.ts`      | `IInteractionChannel` (CMD-004 `askUser`), `IAgentDriver`, `InteractionEvent`, `ICommandInfo`                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Session-event payloads                     | `event-contracts.ts`            | Skill-activation, memory, prompt-file-reference, and context-reference event payload contracts                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Background-task contracts                  | `background-task-contracts.ts`  | `TBackgroundTaskRequest` (+ agent/process/scheduled variants), `IBackgroundTaskResult`/`State`/`Schedule`/`Input`/`Usage`/`Error`, log cursor/page + list-filter, event + listener, and the `TBackgroundTask*` enums (INFRA-025 SSOT; TYPE-003: `IBackgroundTaskUsage` is an alias of agent-core's `ITokenUsage` usage-triple SSOT)                                                                                                                                                                                                       |
| Subagent-job contracts                     | `subagent-contracts.ts`         | `TSubagentJobStatus`, `TSubagentJobMode`, `ISubagentJobState`, `ISubagentSpawnRequest`, `ISubagentJobResult` (INFRA-025 SSOT). TYPE-003/ARCH-031: all five DERIVE from the background-task contracts — `Exclude<TBackgroundTaskStatus, 'paused'>`, mode alias, a `Pick` of `IBackgroundTaskState` for every shared field (only `type`/`status`/`promptPreview`/`currentTool`/`result`/`error` are declared locally), `Omit<IAgentBackgroundTaskRequest, 'kind'>`, and `Omit<IBackgroundTaskResult, 'kind' \| 'exitCode' \| 'signalCode'>` |
| Context-compaction contracts               | `compact-contracts.ts`          | `TCompactTrigger`, `ICompactEvent` (INFRA-025 SSOT)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Background job-group contracts             | `background-group-contracts.ts` | `IBackgroundJobGroupState`/`Summary`/`CreateRequest`, `IBackgroundJobResultEnvelope`, job-group event + status/wait contracts                                                                                                                                                                                                                                                                                                                                                                                                             |
| Execution-workspace contracts              | `workspace-contracts.ts`        | `IExecutionWorkspaceEntry`/`Snapshot`/`Event`/`Filter`, execution-detail page/record contracts, and their enum kinds                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Interactive-session contracts              | `session-contracts.ts`          | `IInteractiveSession` (whose `executeCommand` carries the optional CMD-004 command-origin driver id), `IInteractiveSessionEvents` (incl. the CMD-004 `ui_intent` + `session_renamed` + `history_cleared` events), `IExecutionResult`, `IToolState`/`Summary`, `IInteractiveSessionStore`                                                                                                                                                                                                                                                  |
| Resume-summary projection                  | `session-summary-contracts.ts`  | `IResumableSessionSummary`, the display projection used by resume pickers                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Payload-agnostic channel contracts         | `channel-contracts.ts`          | TRANS-001: `IBinaryFrame` (opaque bytes + per-channel `seq`), `IChannelEventFrame` (consumer-declared structured event), `TChannelFrame`, `TChannelEventMap`, `IChannelDescriptor`, `IPayloadChannel`, `IPayloadChannelHost`, `TChannelReceiveResult`. Content-neutral carrier mechanics — no payload domain (audio/file/image) appears here                                                                                                                                                                                              |
| Driver identity + driver-routed events     | `driver-contracts.ts`           | REMOTE-014 E5 co-drive attribution: `TDriverId`, `ISubmitOptions`, and the runtime driver-id constants `OWNER_DRIVER_ID` / `AGENT_DRIVER_ID` (display-only attribution, never authorization — OWNER PRINCIPLE); CMD-004 Phase 2 driver-routed events `IUiIntentEvent` (requester-routed UI intents) + `ISessionRenamedEvent` (broadcast title update)                                                                                                                                                                                     |

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

| Export                             | Kind      | Description                                                                                     |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------- |
| `ITransportAdapter`                | Interface | Core attach/start/stop lifecycle contract (generic TSession)                                    |
| `isTerminalPeerDelivery`           | Function  | Discriminator: is a `TPeerDeliveryState` settled? Narrows away `pending` (PEER-001)             |
| `isSameEnvironmentPeer`            | Function  | Discriminator: did admission prove same machine AND same user? Narrows `origin` to present      |
| `sourceRetainsAuthority`           | Function  | Discriminator: is the SOURCE still in charge? True in every phase but `committed` (HANDOFF-001) |
| `isHandoffCommitted`               | Function  | Discriminator: did the transfer complete? Deliberately not `!refusal` — `staged` is in progress |
| `ITransportRunnerAdapter`          | Interface | Runner adapter with a separate typed terminal-outcome wait                                      |
| `ITransportLifecycleRegistryView`  | Interface | Base-adapter registration, lifecycle, completion, and prompt failure projection                 |
| `ITransportSettingsRegistryView`   | Interface | Configurable-adapter settings projection                                                        |
| `ITransportConfig`                 | Interface | Persisted enabled + options shape                                                               |
| `IConfigurableTransport`           | Interface | Configurable transport with defaultEnabled + options schema                                     |
| `ITransportEntry`                  | Interface | Configurable-only `(transport, config)` settings projection                                     |
| `ITransportRegistryView`           | Interface | Registry management: getAll, setEnabled, startAll, stopAll                                      |
| `OWNER_DRIVER_ID`                  | Constant  | REMOTE-014 E5 driver id for a local/owner turn (display-only attribution, never authorization)  |
| `AGENT_DRIVER_ID`                  | Constant  | REMOTE-014 E5 driver id for an autonomous (wakeup/goal) turn — never the owner                  |
| `createTestInteractiveSession`     | Function  | ARCH-012: the conformant `IInteractiveSession` double — see § Session capability members        |
| `createTestSessionCapabilityHost`  | Function  | ARCH-012 testing-subpath alias for constructing a typed subset capability host                  |
| `runTransportLifecycleConformance` | Function  | Testing-subpath fixture runner for the shared adapter lifecycle contract                        |
| `createSessionCapabilityHost`      | Function  | ARCH-012: construct a flattened host from one typed session capability map                      |
| `readSessionCapability`            | Function  | ARCH-012: distinguish an absent role from a present role whose method returns an empty value    |
| `SESSION_CAPABILITY_MEMBER_KEYS`   | Constant  | Frozen runtime SSOT mapping the 16 session roles to their exact 39 legacy members               |
| `readAssistantReplies`             | Function  | Pure interaction-event accessor for assistant reply records                                     |
| `readLastAssistantText`            | Function  | Pure interaction-event accessor for the latest assistant text                                   |
| `readToolCalls`                    | Function  | Pure interaction-event accessor for tool-call observations                                      |
| `readErrors`                       | Function  | Pure interaction-event accessor for recorded errors                                             |
| `ITransportAdmission`              | Interface | SEC-008: the resolved decision — a credential, or `null` with a written `openReason`            |
| `ITransportAdmissionConfig`        | Interface | SEC-008: how a caller asks for an admission decision                                            |
| `ITurnHandle`                      | Interface | RUNTIME-003: a submission's identity and a promise for its own turn                             |
| `ITurnNotRunError`                 | Interface | RUNTIME-003: the shape a rejected `completed` carries — constructed in agent-framework          |
| `TTurnNotRunReason`                | Type      | RUNTIME-003: why a submission never became a turn (coalesced/dropped/cancelled)                 |
| `isTurnNotRunError`                | Function  | RUNTIME-003: the one narrowing for a rejected `completed` — refusal vs. a failure in the turn   |

The package root (`src/index.ts`) additionally re-exports the following contract groups. These
are type-only except for the four pure accessor functions re-exported from `interaction-contracts`
(`readAssistantReplies`, `readLastAssistantText`, `readToolCalls`, `readErrors`) and the
`isTurnNotRunError` predicate re-exported from `turn-contracts`:

| Contract group (file)                                                                                | Exported contracts                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payload-agnostic channels (`channel-contracts`, TRANS-001)                                           | `IBinaryFrame`, `IChannelEventFrame`, `TChannelFrame`, `TChannelEventMap`, `IChannelDescriptor`, `IPayloadChannel`, `IPayloadChannelHost`, `TChannelReceiveResult`                                                                                                                                                                                                                       |
| Capability descriptors (`capability-contracts`)                                                      | `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety`                                                                                                                                                                                                                                                                                                                          |
| Peer messaging (`peer-message-contracts`, PEER-001)                                                  | `IPeerMessage`, `IPeerOrigin`, `IPeerAdmission`, `IPeerMessageAck`, `IPeerMessageIngress`, `ISessionPeerMessagingPort`, `TPeerTrust`, `TPeerDeliveryState`, `isTerminalPeerDelivery`, `isSameEnvironmentPeer`                                                                                                                                                                            |
| Command system (`command-contracts`)                                                                 | `ICommand`, `ICommandSource`, `ICommandResult` (+ CMD-004 `hostActions`/`uiIntents`), `TCommandInvocationSource` (REMOTE-003), `TCommandHostAction`, `TCommandUiIntent`, plugin-adapter + status-line command settings contracts                                                                                                                                                         |
| Interaction channel (`interaction-contracts`)                                                        | `IInteractionChannel`, `IAgentDriver`, `IToolCallObservation`, `ITerminalHandoff`, `InteractionEvent`, `ICommandInfo` (+ the accessor functions above)                                                                                                                                                                                                                                   |
| Session-event payloads (`event-contracts`)                                                           | Skill-activation, memory, prompt-file-reference, and context-reference event payload contracts                                                                                                                                                                                                                                                                                           |
| Background task (`background-task-contracts`, INFRA-025 SSOT)                                        | `TBackgroundTaskRequest` (+ agent/process/scheduled variants), `IBackgroundTaskResult`/`State`/`Schedule`/`Input`/`Usage`/`Error`, log cursor/page + list-filter, event + listener, and the `TBackgroundTask*` kind/mode/isolation/status enums (`IBackgroundTaskUsage` = alias of agent-core `ITokenUsage`, TYPE-003)                                                                   |
| Subagent jobs (`subagent-contracts`, INFRA-025 SSOT)                                                 | `TSubagentJobStatus`, `TSubagentJobMode`, `ISubagentJobState`, `ISubagentSpawnRequest`, `ISubagentJobResult` — TYPE-003/ARCH-031: all derived from the background-task contracts (`Exclude` status / mode alias / `Pick` state projection / `Omit` request / `Omit` result), never a manual mirror                                                                                       |
| Context compaction (`compact-contracts`, INFRA-025 SSOT)                                             | `TCompactTrigger`, `ICompactEvent`                                                                                                                                                                                                                                                                                                                                                       |
| Background job-group (`background-group-contracts`)                                                  | `IBackgroundJobGroupState`/`Summary`/`CreateRequest`, `IBackgroundJobResultEnvelope`, event + status/wait contracts                                                                                                                                                                                                                                                                      |
| Execution workspace (`workspace-contracts`)                                                          | `IExecutionWorkspaceEntry`/`Snapshot`/`Event`/`Filter`, execution-detail page/record contracts, and their enum kinds                                                                                                                                                                                                                                                                     |
| Interactive session (`session-contracts`, `session-capability-contracts`, `session-capability-host`) | 16 named `ISession*` role ports, `ISessionCapabilityMap`/`ISessionCapabilityHost`, flattened `TSessionCapabilityHost`, `createSessionCapabilityHost`/`readSessionCapability`, compatibility aggregate `IInteractiveSession`, `IInteractiveSessionEvents` (incl. `ui_intent`/`session_renamed`/`history_cleared`), `IExecutionResult`, `IToolState`/`Summary`, `IInteractiveSessionStore` |
| Resume picker summary (`session-summary-contracts`)                                                  | `IResumableSessionSummary`                                                                                                                                                                                                                                                                                                                                                               |
| Driver identity (`driver-contracts`)                                                                 | `TDriverId`, `ISubmitOptions`, `OWNER_DRIVER_ID`/`AGENT_DRIVER_ID`, `IUiIntentEvent`, `ISessionRenamedEvent`                                                                                                                                                                                                                                                                             |

## Interface Contracts

### Interaction channel scope

`IInteractionChannel` is the in-process port consumed by `createInteractiveRuntime`; today
`ProgrammaticInteractionChannel` is its production implementation. It is not the universal transport
contract. The TUI owns an `IInteractiveSession` and subscribes to its full event map directly, while
headless and remote transports use the session capability/configurable-transport families. A surface
must not nominally implement `IInteractionChannel` while making its central `write()` operation a no-op.

Prompt settlement belongs to the interactive-session event/capability family, not `InteractionEvent`:
surfaces receive `permission_request` / `ask_request`, answer through `resolvePermission` /
`resolveAsk`, and dismiss on the single canonical `prompt_resolved` event. The obsolete
`permission-resolved` interaction variant is not part of the contract.

Checkpoint surfaces consume `branch_event` after a transition is persisted. Its kinds cover checkpoint
creation, restoration, rollback, explicit branch fork, and branch switch. Resume-pointer hydration is
not an event. Shared keys and serializable payloads live here; subscription, rendering, delivery-failure
isolation, and fan-out policy remain owned by transport implementations.

### Interactive session persistence

`IInteractiveSessionRecord` is the complete resumable-record SSOT and
`IInteractiveSessionStore` is its canonical persistence port. The port owns CRUD only. It never exposes a
reusable absolute record path: transcript references belong to the logger/source owner and a trusted host hook
adapter may resolve one only at the hook execution boundary. A writer that updates only part of a loaded record
must preserve every field it does not own before overwriting its authoritative fields.

### Session role contracts and explicit capability presence (ARCH-012)

`IInteractiveSession`'s `isInitialized`, `getPendingCount` and `getActiveDriverId` were OPTIONAL. The
one consumer read attribution as `session.getActiveDriverId?.() ?? undefined`, and two unrelated
situations arrived as the same `undefined`:

- the host attributes turns and none is active right now, and
- the host cannot attribute turns at all.

The second loses every co-drive attribution with no error, no log and nothing to distinguish it from
the first. They are REQUIRED now: a host either provides the capability or does not claim this
contract, so `null` from `getActiveDriverId()` means exactly one thing.

The 39-member legacy interface remains an exported `interface` and extends 16 named role ports. Its
member shape and declaration-merging behavior are unchanged, so existing full implementations remain
source-compatible. `ISessionCapabilityHost` is the genuine interface that owns the canonical map;
`TSessionCapabilityHost` is the flattened selected-port intersection returned by the factory. New
consumers depend on only the roles they use. Optional capability hosts use one
typed `ISessionCapabilityMap`; `readSessionCapability(host, key)` returns `{ provided: false }` when a
role is absent and `{ provided: true, value }` when present. A present role may legitimately return
`null`, `undefined`, or an empty array from one of its methods; that result is not confused with an
absent role. Capability objects are local function-valued ports and are never serialized over a
transport protocol.

`SESSION_CAPABILITY_MEMBER_KEYS` is the runtime SSOT for flattening: its 16 rows are checked in exact
`keyof` parity with all 39 role members. `createSessionCapabilityHost` forwards only those canonical
members from own or prototype implementations, binds methods to their original receiver, treats an
explicit `undefined` role as absent in both runtime and type algebra, and rejects missing/duplicate or
reserved members. The flattened host has a null prototype and a final non-overridable canonical
`capabilities` property, so extra role properties cannot replace the map or trigger prototype setters.

**`createTestInteractiveSession` lives here, with the contract.** A double existed before, published
from `@robota-sdk/agent-framework` and documented in its SPEC — with zero consumers, because every
transport package sits BELOW `agent-framework` and could not import it. The hand-rolled
`as unknown as IInteractiveSession` partials were not an oversight; they were the only thing those
packages could reach.

**Two figures are on record for those partials, and they measure different things** — quote whichever
you mean, never one as the other:

| Figure             | What it measures                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| **37**             | The AST ratchet baseline ARCH-012's TC-04 actually drove to zero. This is the number that was MIGRATED. |
| 41 across 29 files | The corrected pre-work audit count, taken by hand before the ratchet existed.                           |

This SPEC previously carried the 41 alone. A package SPEC is a package-level SSOT, so a reader
comparing a later migration against ARCH-012 would have taken 41 as the number that was migrated; it
was not.

The sole published owner is
`@robota-sdk/agent-interface-transport/testing`; `agent-framework` intentionally does not re-export it,
because pass-through re-exports would create two apparent owners for one contract.

The default double preserves identity semantics rather than only type shape. Each factory instance has
one deterministic session id, and its successive default submissions return
`<session-id>-turn-1`, `<session-id>-turn-2`, and so on. Another double restarts its own counter under
its distinct session id. A custom `submit` override remains authoritative. The nested object returned
from default `getSession()` exposes only the transport contract's `getSessionId`; framework-only
`Session` services do not leak into this lower contract fixture.

`createTestSessionCapabilityHost` on the same testing subpath builds honest subset hosts. The
contract-cast scanner now freezes the direct `IInteractiveSession` cast floor at zero: a future
canonical aggregate cast fails the harness instead of restoring partial implementations.

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
  dependency-free derivation accessors over this package's own owned union types (e.g. the `read*`
  helpers over `InteractionEvent` in `interaction-contracts.ts`): no classes, no I/O, no side effects.
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
