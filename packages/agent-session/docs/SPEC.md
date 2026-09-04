# Sessions Specification

## Scope

Owns the CLI session lifecycle for the Robota SDK. This package provides the `Session` class that wraps a `Robota` agent instance with permission-gated tool execution, hook-based lifecycle events, context window tracking, conversation compaction, and optional persistence through `IInteractiveSessionStore`. `NodeSessionStore` is the explicitly named host-filesystem adapter. The package is the primary runtime used by the CLI application (`agent-cli`) via the assembly layer (`agent-framework`). It also owns the **runtime codec for the
persisted session record** (TRANS-005): the record's TYPE is owned by
`@robota-sdk/agent-interface-transport`, but a decoder is a mechanism, and an `agent-interface-*`
package publishes contracts, vocabulary and discriminators rather than mechanisms
(`scan-interface-runtime`). The codec therefore lives beside the persistence paths that consume it.

## Boundaries

- Does not own AI provider creation. Accepts a pre-constructed `IAIProvider` via injection.
- Does not own tool implementations. Accepts pre-constructed `IToolWithEventService[]` via injection.
- Does not own system prompt building. Accepts a pre-built `systemMessage` string. It DOES own
  one model-facing prompt surface: the **compaction summarization prompt**. Its base template is
  domain-neutral (`DEFAULT_COMPACTION_PROMPT`, exported) and fully replaceable via
  `ISessionOptions.compactionBasePrompt`; `compactInstructions` appends focus instructions after
  the base template. No other model-facing prompt text originates in this package.
- Does not own configuration resolution or context loading. Those belong to `agent-framework`.
- Does not own the permission evaluation algorithm or hook execution engine. Those belong to `@robota-sdk/agent-core` (`evaluatePermission`, `runHooks`).
- **Owns the file-persistence primitive, not the record or port shape.** `NodeSessionStore` owns atomic
  JSON file persistence and directly implements `IInteractiveSessionStore`; both that port and
  `IInteractiveSessionRecord` are owned by `@robota-sdk/agent-interface-transport` (DATA-001 SSOT). It also owns the record's runtime DECODER (TRANS-005) — the shape is
  declared there, and the mechanism that validates a value against it lives here.
  The former local `ISessionRecord` and `ISessionStore` declarations were removed because they drifted
  from the canonical contract. Public compatibility names are renamed re-exports only. The store remains
  **decodes what it stores, and nothing further (TRANS-007).** It previously kept a
  `JSON.parse(...) as IInteractiveSessionRecord` trust boundary and never inspected the payload; that
  property is retired, because distinguishing a corrupt snapshot from a valid one IS inspection and
  is what stops a damaged file being read as an absent one. **What replaces it:** `load` decodes the
  `{ schemaVersion, record }` envelope and the record against its contract, and reports
  `valid` / `missing` / `corrupt` / `unsupported`. It reads no field for its MEANING — no branch on
  a `cwd`, a `name`, a message body or any other member — so the store still holds no domain policy;
  the boundary moved from "does not look" to "checks the shape and nothing else". Consumers obtain a session store through SDK facades
  (`createProjectSessionStore`) rather than treating a host directory as project authority.
- **Owns the shareable session-artifact envelope (SELFHOST-014).** `session-artifact.ts` — a
  record-**transport** sibling of the file-backed `session-store.ts` — is the neutral export/import envelope
  over `IInteractiveSessionRecord`, the async durable COMPLEMENT to REMOTE-001's live channel (no transport/pairing/wire).
  Two non-conflated operations: (1) `serializeSessionArtifact(record)` — full-fidelity round-trip
  (`deserialize(serialize(record))` deep-equals); (2) `serializeSessionArtifact(record, { redact })` — the
  share path, applying an **app-supplied, policy-free** `redact` transform before writing bytes. A
  schema-version header lets `deserializeSessionArtifact` reject an incompatible artifact, and since
  TRANS-006 the version check is followed by the **same total record decoder** the rest of the
  persistence paths use — an artifact whose envelope is current and whose record is not a record is
  refused with the field path that failed, rather than imported as a partial session.

  **A `redact` must return a record.** "Policy-free" governs which FIELDS the app removes; it has
  never governed whether the result is still an `IInteractiveSessionRecord`, and the seam's own type
  (`(record: IInteractiveSessionRecord) => IInteractiveSessionRecord`) is a total function on
  records. So a required member is BLANKED (`{ ...record, cwd: '' }`), not deleted; an optional one
  may be removed entirely. The share workflow is unchanged — strip the host path, import on the other
  surface, rebind there — and a redact that deletes a required member now fails at import with a
  located reason instead of silently producing a partial session that reaches the store. This is not
  a contract change: it is an input the type never permitted, which nothing used to check.

  The envelope carries
  NO link/cloud/access/redaction-FIELD policy (a product concern owned by the app surfaces) — mechanically
  fenced by `scan-session-artifact-neutrality` and the `deps` scan (no edge to `agent-remote-pairing`/
  `agent-transport-webrtc`). Import = `deserialize → store.save → the existing `loadSessionRecord` resume path`.

- **Owns the sensitive-key scrub SSOT.** `scrub-sensitive.ts` (`SENSITIVE_KEY_PATTERN`, `isSensitiveKey`,
  `scrubSensitiveKeys`) is the single definition of which keys are secrets, consumed by BOTH `FileSessionLogger`
  (persistence-time redaction) and, as an opt-in, the app's share-artifact `redact` transform. It is never
  forced into the full-fidelity local round-trip.

## Architecture Overview

The package follows a modular structure with Session delegating to focused sub-components:

```
session-base.ts           -- SessionBase: abstract base holding shared session state and methods, incl. preset/model/parallel-subagent live state (getActivePresetId/setActivePresetId, getParallelSubagentsEnabled/setParallelSubagentsEnabled, applyModelOptions)
session.ts                -- Session class (extends SessionBase): orchestrates run loop, delegates to sub-components
session-run.ts            -- Per-turn Session.run execution helper and replay-event forwarding
session-tool-execution-bridge.ts -- Bridges unknown-tool replay events to onToolExecution display callbacks
permission-enforcer.ts    -- PermissionEnforcer: tool wrapping, permission checks, hooks, truncation
context-window-tracker.ts -- ContextWindowTracker: token usage tracking, auto-compact threshold
compaction-orchestrator.ts -- CompactionOrchestrator: conversation summarization via LLM
session-logger.ts         -- ISessionLogger interface + sink-driven FileSessionLogger / SilentSessionLogger
session-log-sources.ts    -- neutral log/payload read ports + explicit Node host adapters
session-log-sinks.ts      -- neutral log/payload write ports + explicit Node host adapter
session-log-replay.ts     -- source-driven parsing, hydration, replay, and validation
external-payload-resolution-contracts.ts -- Public resolver options and stable typed error contract
external-payload-file-reader.ts -- Internal exact-shape, containment, I/O, and integrity primitives
external-payload-resolver.ts -- Bounded recursive JSON sidecar hydration at the read boundary
session-store.ts          -- NodeSessionStore: explicit host JSON persistence adapter
```

**Design patterns used:**

- **Facade** -- `Session` hides Robota agent creation, tool registration, permission wiring, and hook execution behind a single `run()` method.
- **Decorator** -- Each tool is wrapped with a permission-checking proxy via `PermissionEnforcer.wrapTools()` before being registered with the Robota agent.
- **Adapter** -- `session-tool-execution-bridge` adapts core replay events for unregistered tool calls into the same UI callback shape used by wrapped registered tools.
- **Strategy (injected)** -- Permission approval can be handled by a `TPermissionHandler` callback, an injected `promptForApproval` function, or denied by default.
- **Composition** -- Session delegates to PermissionEnforcer, ContextWindowTracker, and CompactionOrchestrator rather than implementing everything inline.
- **Null Object** -- When no `IInteractiveSessionStore` is provided, persistence is silently skipped.

**Dependency direction:**

- `@robota-sdk/agent-session` depends on `@robota-sdk/agent-core` and `@robota-sdk/agent-interface-transport` (SSOT for `ICompactEvent`/`TCompactTrigger`).
- No dependency on `@robota-sdk/agent-tools` or `@robota-sdk/agent-provider-anthropic`.
- Tool and provider assembly is the responsibility of the consuming layer (`agent-framework`).
- Workspace trust and project-path interpretation are also framework responsibilities. This package owns only
  neutral session record/log/payload mechanisms and explicit source/sink ports; it never imports or reconstructs
  a workspace authority from a path.

## Type Ownership

Types owned by this package (SSOT):

| Type                                        | Kind      | File                                       | Description                                                                                           |
| ------------------------------------------- | --------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `ISessionRecordDecodeIssue`                 | Interface | `session-record-codec/decode-outcome.ts`   | TRANS-005: one decode failure, located — a machine-readable `path` plus a human `message`             |
| `TSessionRecordDecodeOutcome`               | Type      | `session-record-codec/decode-outcome.ts`   | TRANS-005: `valid` \| `corrupt` \| `unsupported` — deliberately no `missing` member                   |
| `IVersionedInteractiveSessionRecord`        | Interface | `session-record-codec/record-decoder.ts`   | TRANS-005: `{ schemaVersion, record }` — how a persisted record's version travels with its bytes      |
| `ISessionOptions`                           | Interface | `session-types.ts`                         | Constructor options for Session (tools, provider, systemMessage, providerTimeout, optional sessionId) |
| `ISessionShutdownOptions`                   | Interface | `session-types.ts`                         | Graceful shutdown options, including Claude-compatible `reason`                                       |
| `TPermissionHandler`                        | Type      | `permission-types.ts`                      | Async callback `(toolName, toolArgs) => Promise<TPermissionResult>`                                   |
| `TPermissionResult`                         | Type      | `permission-types.ts`                      | `boolean \| 'allow-session' \| 'allow-project'`                                                       |
| `IPermissionEnforcerOptions`                | Interface | `permission-types.ts`                      | Options for constructing PermissionEnforcer                                                           |
| `ICompactionOptions`                        | Interface | `compaction-orchestrator.ts`               | Options for constructing CompactionOrchestrator                                                       |
| `ISessionLogger`                            | Interface | `session-logger.ts`                        | Pluggable session event logger interface                                                              |
| `TSessionLogData`                           | Type      | `session-logger.ts`                        | Structured log event data (`Record<string, string \| number \| boolean \| object \| null>`)           |
| `IExternalPayloadReference`                 | Interface | `session-logger.ts`                        | Content-addressed JSON payload reference used when a log field exceeds inline size policy             |
| `ISessionLogPayloadResolutionOptions`       | Interface | `external-payload-resolution-contracts.ts` | Explicit payload source plus depth and aggregate-byte limits                                          |
| `ISessionLogPayloadResolutionErrorMetadata` | Interface | `external-payload-resolution-contracts.ts` | Optional path, depth, and expected/actual error context                                               |
| `TSessionLogPayloadResolutionErrorCode`     | Type      | `external-payload-resolution-contracts.ts` | Stable fail-closed error code vocabulary for sidecar resolution                                       |
| `ISessionLogLoadOptions`                    | Type      | `session-log-replay.ts`                    | Optional payload-source override plus depth and aggregate-byte limits                                 |
| `ISessionReplayRecord`                      | Interface | `session-log-replay.ts`                    | Reconstructed replay state from append-only JSONL logs                                                |
| `ISessionLogSource`                         | Interface | `session-log-sources.ts`                   | Neutral source of JSONL text and its optional payload source                                          |
| `ISessionLogSink`                           | Interface | `session-log-sinks.ts`                     | Neutral append sink used by live logging                                                              |
| `IExternalPayloadSource`                    | Interface | `session-log-sources.ts`                   | Neutral relative sidecar-byte source that enforces the caller-supplied per-read budget                |
| `IExternalPayloadSink`                      | Interface | `session-log-sinks.ts`                     | Neutral content-addressed sidecar-byte sink                                                           |

Types consumed from other packages (not owned here):

| Type                        | Source                                                           |
| --------------------------- | ---------------------------------------------------------------- |
| `Robota`                    | `@robota-sdk/agent-core`                                         |
| `IAgentConfig`              | `@robota-sdk/agent-core`                                         |
| `IAIProvider`               | `@robota-sdk/agent-core`                                         |
| `IToolWithEventService`     | `@robota-sdk/agent-core`                                         |
| `TPermissionMode`           | `@robota-sdk/agent-core`                                         |
| `TToolArgs`                 | `@robota-sdk/agent-core`                                         |
| `THooksConfig`              | `@robota-sdk/agent-core`                                         |
| `IHookInput`                | `@robota-sdk/agent-core`                                         |
| `evaluatePermission`        | `@robota-sdk/agent-core`                                         |
| `runHooks`                  | `@robota-sdk/agent-core`                                         |
| `TRUST_TO_MODE`             | `@robota-sdk/agent-core`                                         |
| `TUniversalMessage`         | `@robota-sdk/agent-core`                                         |
| `IHistoryEntry`             | `@robota-sdk/agent-core`                                         |
| `IInteractiveSessionRecord` | `@robota-sdk/agent-interface-transport`                          |
| `IInteractiveSessionStore`  | `@robota-sdk/agent-interface-transport`                          |
| `TModelEffort`              | `@robota-sdk/agent-core`                                         |
| `ITerminalOutput`           | `@robota-sdk/agent-core` (re-exported via `permission-types.ts`) |
| `ISpinner`                  | `@robota-sdk/agent-core` (re-exported via `permission-types.ts`) |

## Public API Surface

| Export                                      | Kind                 | Description                                                                                                                                                                                                                                                             |
| ------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Session`                                   | Class                | Wraps Robota agent with permissions, hooks, streaming, and persistence                                                                                                                                                                                                  |
| `serializeSessionArtifact`                  | Function             | SELFHOST-014: serialize an `IInteractiveSessionRecord` into a portable versioned artifact (round-trip; or share-path via an app `redact`)                                                                                                                               |
| `deserializeSessionArtifact`                | Function             | SELFHOST-014 + TRANS-006: parse a session artifact back to `IInteractiveSessionRecord`, rejecting an incompatible schema version AND any record that does not decode, naming the field paths that failed                                                                |
| `SESSION_RECORD_ENVELOPE_VERSION`           | Constant             | SELFHOST-014: the version of the `{ schemaVersion, record }` envelope AND the record it wraps — one number, read by the artifact path, the stores and the codec (TRANS-006 retired the codec's duplicate; issue #2185 named it for the pair; no alias)                  |
| `scrubSensitiveKeys`                        | Function             | SELFHOST-014: pure recursive redaction of values under sensitive keys (opt-in for a share `redact`; SSOT, also used by the logger)                                                                                                                                      |
| `isSensitiveKey`                            | Function             | SELFHOST-014: the single predicate for a secret-bearing key                                                                                                                                                                                                             |
| `SENSITIVE_KEY_PATTERN`                     | Constant             | SELFHOST-014: the sensitive-key regex SSOT                                                                                                                                                                                                                              |
| `TurnClaim`                                 | Class                | RUNTIME-003: owns the identity of the turn a session is running — claim/release/abort/isRunning (see Turn Identity)                                                                                                                                                     |
| `SessionBusyError`                          | Class                | RUNTIME-003: `run()` rejects with this when the session already has a turn in flight; `recoverable: true`                                                                                                                                                               |
| `PermissionEnforcer`                        | Class                | Tool permission checking, hook execution, output truncation                                                                                                                                                                                                             |
| `ContextWindowTracker`                      | Class                | Token usage tracking and auto-compact threshold                                                                                                                                                                                                                         |
| `CompactionOrchestrator`                    | Class                | Conversation compaction via LLM summary                                                                                                                                                                                                                                 |
| `CompactionError`                           | Class                | Thrown when a compaction summary is invalid — history is preserved untouched (see Compaction Failure Contract)                                                                                                                                                          |
| `DEFAULT_COMPACTION_PROMPT`                 | Constant             | Domain-neutral base template of the compaction summarization prompt; replaceable via `ISessionOptions.compactionBasePrompt`                                                                                                                                             |
| `NodeSessionStore`                          | Class                | Explicit host-filesystem JSON persistence adapter for session records                                                                                                                                                                                                   |
| `decodeInteractiveSessionRecord`            | Function             | TRANS-005: decode `unknown` into a fully validated `IInteractiveSessionRecord`, or report every place it failed                                                                                                                                                         |
| `decodeVersionedInteractiveSessionRecord`   | Function             | TRANS-005: the same behind the schema-version gate — a version this build does not implement stops the decode                                                                                                                                                           |
| `INTERACTIVE_SESSION_RECORD_KEYS`           | Constant             | TRANS-005: the record's declared key set, so a contract member added without a decoder branch is caught by test                                                                                                                                                         |
| `isSafeSessionId`                           | Function             | SEC-006: whether a session id is safe to use as a single filesystem path component                                                                                                                                                                                      |
| `assertSafeSessionId`                       | Function             | SEC-006: throws unless the session id is a safe path component — the guard `NodeSessionStore` applies to every id it joins into a path                                                                                                                                  |
| `CheckpointTree`                            | Class                | SELFHOST-007 neutral, I/O-free branch tree over `{id,parentId}` checkpoint nodes (fork/switch/listBranches/ancestors/activeLeaf)                                                                                                                                        |
| `FileSessionLogger`                         | Class                | Sink-driven JSONL session event logger; it opens no path itself                                                                                                                                                                                                         |
| `NodeSessionLogSource`                      | Class                | Explicit host filesystem adapter for one JSONL file and its relative payload sidecars                                                                                                                                                                                   |
| `NodeSessionLogSink`                        | Class                | Explicit host filesystem adapter for append/flush and owner-only payload sidecars                                                                                                                                                                                       |
| `NodeExternalPayloadSource`                 | Class                | Explicit host filesystem adapter for bounded relative external-payload reads                                                                                                                                                                                            |
| `createSessionLogExternalPayloadReference`  | Function             | SSOT that validates a safe session id and exact lowercase content digest before constructing a sidecar reference                                                                                                                                                        |
| `SilentSessionLogger`                       | Class                | No-op session logger                                                                                                                                                                                                                                                    |
| `ISessionOptions`                           | Interface            | Constructor options for Session                                                                                                                                                                                                                                         |
| `ISessionShutdownOptions`                   | Interface            | Graceful shutdown options for `Session.shutdown()`                                                                                                                                                                                                                      |
| `TAutoCompactThreshold`                     | Type                 | Auto-compact threshold fraction, or `false` to disable automatic compaction                                                                                                                                                                                             |
| `TPermissionHandler`                        | Type                 | Custom permission approval callback                                                                                                                                                                                                                                     |
| `TPermissionResult`                         | Type                 | Permission decision result                                                                                                                                                                                                                                              |
| `ITerminalOutput`                           | Interface            | Terminal I/O abstraction                                                                                                                                                                                                                                                |
| `ISpinner`                                  | Interface            | Spinner handle                                                                                                                                                                                                                                                          |
| ~~`IPermissionEnforcerOptions`~~            | Interface (internal) | Options for constructing `PermissionEnforcer` — **not exported** from `src/index.ts`. Internal to the package.                                                                                                                                                          |
| `ISessionLogger`                            | Interface            | Pluggable session event logger interface                                                                                                                                                                                                                                |
| `TSessionLogData`                           | Type                 | Structured log event data                                                                                                                                                                                                                                               |
| `IInteractiveSessionRecord`                 | Interface            | Canonical resumable-session record, re-exported from `agent-interface-transport`                                                                                                                                                                                        |
| `IInteractiveSessionStore`                  | Interface            | Canonical persistence port, re-exported from `agent-interface-transport`                                                                                                                                                                                                |
| `ISessionRecord`                            | Compatibility export | Renamed re-export of canonical `IInteractiveSessionRecord`; not used internally                                                                                                                                                                                         |
| `ISessionStore`                             | Compatibility export | Renamed re-export of canonical `IInteractiveSessionStore`; not used internally                                                                                                                                                                                          |
| `AUTO_COMPACT_THRESHOLD`                    | Constant             | Default auto-compact threshold fraction of the context window (exported from `context-window-tracker.ts`)                                                                                                                                                               |
| `SESSION_LOG_EVENT`                         | Constant             | Session log event-name enum object (`session-log-events.ts`)                                                                                                                                                                                                            |
| `isSessionLogEvent`                         | Function             | Type guard for a `TSessionLogEventName`                                                                                                                                                                                                                                 |
| `loadSessionLogEntries`                     | Function             | Parses and hydrates entries from an explicit `ISessionLogSource`/`IExternalPayloadSource`; it never opens a path by default                                                                                                                                             |
| `replaySessionLogEntries`                   | Function             | Reconstructs session state from already hydrated entries without performing I/O                                                                                                                                                                                         |
| `validateSessionReplayLogEntries`           | Function             | Validates already hydrated replay entries without opening a file or payload path                                                                                                                                                                                        |
| `resolveSessionLogExternalPayloads`         | Function             | Recursively hydrates content-addressed JSON sidecars under bounded depth/bytes and verified containment/integrity                                                                                                                                                       |
| `SessionLogPayloadResolutionError`          | Class                | Typed fail-closed error with stable `code` and structured resolution metadata                                                                                                                                                                                           |
| `ISessionLogPayloadResolutionOptions`       | Interface            | Explicit payload source and optional `maxDepth` / `maxTotalBytes` limits                                                                                                                                                                                                |
| `ISessionLogPayloadResolutionErrorMetadata` | Interface            | Structured optional path, depth, and expected/actual resolution-failure context                                                                                                                                                                                         |
| `TSessionLogPayloadResolutionErrorCode`     | Type                 | Resolver error-code union                                                                                                                                                                                                                                               |
| `ISessionLogLoadOptions`                    | Type                 | `loadSessionLogEntries` options for depth and aggregate-byte limits                                                                                                                                                                                                     |
| `ISessionLogEntry`                          | Interface            | One parsed session log entry (`session-log-replay.ts`)                                                                                                                                                                                                                  |
| `consentScopeFor`                           | Function             | Issue #2351: the permission pattern a "don't ask again" answer for this invocation grants — the tool name, or the tool's argument-scoped pattern when its permission profile names an argument; the ONE owner of the scope the enforcer remembers and the prompt prints |
| `ISessionReplayValidationResult`            | Interface            | Result of validating a session replay log for integrity                                                                                                                                                                                                                 |

`ICompactEvent` and `TCompactTrigger` are **not** part of the public API surface. Their SSOT is
`@robota-sdk/agent-interface-transport` (INFRA-025); `src/session-types.ts` re-exports them
intra-package for internal use, but they are not surfaced on the public `src/index.ts`.

### Session Constructor — sessionId Parameter

`ISessionOptions.sessionId` is an optional parameter. When provided, the Session reuses that ID. When omitted, a fresh UUID is generated (default). This allows the consuming layer to control whether a resumed session continues under the same file or creates a new one.

`ISessionOptions.providerTimeout` is an optional provider idle timeout in milliseconds. When provided, `Session` forwards it to the underlying `Robota` `IAgentConfig.timeout`, where `agent-core` enforces it per provider call and refreshes the idle timer on streaming text deltas.

`ISessionOptions.maxTurns` is an optional maximum number of model/tool rounds for one `Session.run()` call. When provided, `Session` forwards it to `Robota.run()` as `maxExecutionRounds`. When omitted, `Session` forwards `maxExecutionRounds: 0`, which means the session run has no core round cap and is instead bounded by abort, context-window checks, provider idle timeout, and runtime-level controls.

`ISessionOptions.onContextUpdate` is an optional callback fired from the session runtime whenever `ContextWindowTracker` is refreshed. It fires before the provider call using the assembled request history estimate and again after the provider response is committed with exact provider usage when available. Consumers such as `InteractiveSession` forward it as `context_update`.

`Session.run(message, rawInput?, options?)` accepts an optional third argument `{ ephemeralSystemContext?: string }` (SELFHOST-008 P3). It is a **thin pass-through** into agent-core's `IRunOptions.ephemeralSystemContext`: a transient system-role block included in that turn's model call only and never persisted to history. The session layer owns no part of the guarantee — agent-core (which owns model-call assembly) does; `Session.run` merely forwards it. Absent ⇒ unchanged.

`ISessionOptions.autoCompactThreshold` controls the initial automatic compaction trigger as a `0 < value <= 1` fraction. The default is `0.835`. Set it to `false` when an embedding runtime manages compaction externally. `Session.setAutoCompactThreshold()` may change this policy after construction; subsequent `run()` calls use the new policy immediately.

`ISessionOptions.onCompactEvent` receives structured compaction metadata with `trigger`, `before`, and `after` context-window states. Manual `Session.compact()` calls report `trigger: "manual"` by default; auto-compaction from `Session.run()` reports `trigger: "auto"`. The session-owned `TCompactTrigger` is passed unchanged into `CompactionOrchestrator`, so PreCompact, PostCompact, `context_compact`, and `onCompactEvent` observe one value; the orchestrator never re-derives it from the presence of instructions. The session logger also writes a `context_compact` event with the same before/after state so headless transports and logs can explain what happened without streaming compaction summary text into the normal answer path.

`ISessionOptions.activePresetId` is the runtime active-preset id selected at startup. It is pure
state surfaced through `getActivePresetId()`/`setActivePresetId()` and is not used to re-apply any
preset options. The default is `'default'`.

`ISessionOptions.enableParallelSubagents` controls the parallel-subagents dispatch gate surfaced
through `getParallelSubagentsEnabled()`/`setParallelSubagentsEnabled()`. It is only meaningful when
the agent runtime was built at assembly. The default is `true`.

### Key Session Methods

| Method                        | Signature                                                                                                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                         | `(message: string) => Promise<string>`                                                                                  | Send a message; returns AI response. Persists session if store exists. **One turn at a time** (RUNTIME-003): rejects with `SessionBusyError` if this session already has a turn in flight, including one aborted but not yet unwound. See § Turn Identity.                                                                                                                                                                                              |
| `getPermissionMode`           | `() => TPermissionMode`                                                                                                 | Returns the active permission mode.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `setPermissionMode`           | `(mode: TPermissionMode) => void`                                                                                       | Changes the permission mode for future tool calls.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `getSessionId`                | `() => string`                                                                                                          | Returns the stable session identifier.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `getCwd`                      | `() => string`                                                                                                          | ARCH-010: the session's execution root, as supplied to `ISessionOptions.cwd`. Readable so a fork or subagent derived from this session asks it rather than re-deriving from `process.cwd()`.                                                                                                                                                                                                                                                            |
| `getMessageCount`             | `() => number`                                                                                                          | Returns the number of completed `run()` calls.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `clearHistory`                | `() => void`                                                                                                            | Clears the underlying Robota conversation history and resets token usage.                                                                                                                                                                                                                                                                                                                                                                               |
| `getHistory`                  | `() => TUniversalMessage[]`                                                                                             | Returns the current conversation history as `TUniversalMessage[]` (chat entries only). Unchanged.                                                                                                                                                                                                                                                                                                                                                       |
| `getFullHistory`              | `() => IHistoryEntry[]`                                                                                                 | Returns the full history as `IHistoryEntry[]`, including both chat messages and event entries (e.g., tool summaries).                                                                                                                                                                                                                                                                                                                                   |
| `addHistoryEntry`             | `(entry: IHistoryEntry) => void`                                                                                        | Appends a pre-built `IHistoryEntry` (e.g., a tool-summary event entry) to the session history via `ConversationStore.addEntry()`.                                                                                                                                                                                                                                                                                                                       |
| `getContextState`             | `() => IContextWindowState`                                                                                             | Returns real-time effective context window usage (tokens, percentage) from the shared agent-core estimator.                                                                                                                                                                                                                                                                                                                                             |
| `getAutoCompactThreshold`     | `() => TAutoCompactThreshold`                                                                                           | Returns the configured automatic compaction threshold, or `false` when disabled.                                                                                                                                                                                                                                                                                                                                                                        |
| `setAutoCompactThreshold`     | `(threshold: TAutoCompactThreshold) => void`                                                                            | Updates the automatic compaction threshold for subsequent `run()` calls.                                                                                                                                                                                                                                                                                                                                                                                |
| `compact`                     | `(instructions?: string, trigger?: TCompactTrigger, signal?: AbortSignal) => Promise<void>`                             | Compresses conversation via LLM summary. System message is preserved across compaction (see below). Fires PreCompact/PostCompact hooks.                                                                                                                                                                                                                                                                                                                 |
| `abort`                       | `() => void`                                                                                                            | Signals the currently running `run()` call to stop. No-op if not running. Does NOT free the session — the turn holds its claim until it has finished unwinding (RUNTIME-003); to cancel and restart, `abort()`, AWAIT the turn, then `run()`.                                                                                                                                                                                                           |
| `shutdown`                    | `(options?: ISessionShutdownOptions) => Promise<void>`                                                                  | Aborts active work, persists the session when a store exists, logs shutdown, fires `SessionEnd` exactly once, then destroys the wrapped agent (`robota.destroy()`, CORE-022) so no timers or listeners survive shutdown. Each step is best-effort (CORE-013).                                                                                                                                                                                           |
| `isRunning`                   | `() => boolean`                                                                                                         | Returns true if a `run()` call is in progress — including one that has been aborted and is still unwinding. Authoritative: a consumer does not need its own busy flag (RUNTIME-003).                                                                                                                                                                                                                                                                    |
| `getSessionAllowedTools`      | `() => string[]`                                                                                                        | Returns the consent-scope patterns granted by "Allow always" this session (issue #2351).                                                                                                                                                                                                                                                                                                                                                                |
| `clearSessionAllowedTools`    | `() => void`                                                                                                            | Clears all session-scoped allow rules.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `getActivePresetId`           | `() => string`                                                                                                          | Returns the runtime active-preset id.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `setActivePresetId`           | `(id: string) => void`                                                                                                  | Sets the runtime active-preset id. PURE STATE — records which preset is active; does not re-apply any preset options (permission/model/persona). Higher layers own re-application.                                                                                                                                                                                                                                                                      |
| `getParallelSubagentsEnabled` | `() => boolean`                                                                                                         | Returns whether subagent dispatch is currently allowed for this session (the parallel-subagents dispatch gate).                                                                                                                                                                                                                                                                                                                                         |
| `setParallelSubagentsEnabled` | `(enabled: boolean) => void`                                                                                            | Toggles the subagent dispatch gate live. Only effective when the agent runtime was built at assembly.                                                                                                                                                                                                                                                                                                                                                   |
| `applyModelOptions`           | `(options: { model?: string; effort?: TModelEffort; temperature?: number; maxOutputTokens?: number }) => Promise<void>` | Re-applies model options to the live session. Awaits `robota.ensureReady()` first so it works on a cold (never-run) session — `setModel` requires full initialization, which otherwise only happens lazily on the first `run()`. Then calls `robota.setModel` so the next call reflects the options. Maps `maxOutputTokens` → the agent's `maxTokens` channel; updates `this.model` so `getModelId()` stays accurate. Absent fields are left untouched. |
| `injectMessage`               | `(role: 'user' \| 'assistant' \| 'system', content: string) => void`                                                    | Injects a message into conversation history without triggering an AI response. Used for restoring context on session resume.                                                                                                                                                                                                                                                                                                                            |

### Usage And Context Refresh

`Session.run()` performs two context refreshes per successful prompt:

1. **Pre-send estimate** -- after hooks and request payload assembly, `ContextWindowTracker.updateFromHistory()` receives the current history plus the enriched user message. This emits estimated context usage before the provider responds.
2. **Post-response reconciliation** -- after the assistant response is committed, `ContextWindowTracker.updateFromHistory()` reads exact provider token metadata when available and emits the reconciled context state.

The callback payload is provider-neutral `IContextWindowState`; provider-specific usage details remain in message metadata and are interpreted by higher layers only through normalized token fields.

### Interactive Session Record Fields

`IInteractiveSessionRecord` owns the field inventory in `agent-interface-transport`; this package
consumes it directly. The compatibility `ISessionRecord` export is only a renamed re-export. The inventory is
owned and documented by `@robota-sdk/agent-interface-transport` (`session-contracts.ts`, DATA-001)
and is intentionally NOT duplicated here. Store-relevant invariants:

- The store decodes on load (TRANS-007). It persists `{ schemaVersion, record }` and returns a
  `TSessionLoadOutcome` — `valid` / `missing` / `corrupt` / `unsupported` — rather than
  `record | undefined`. **Scope of the inspection:** the envelope's version and the record's shape,
  and nothing beyond. No persisted field is read for its meaning, so the store still owns no domain
  policy. It previously treated the payload as opaque JSON; that made a damaged file
  indistinguishable from an absent one, and a consumer that read the existing record to preserve
  fields it does not own then OVERWROTE the damaged file with a fresh one. A non-`valid` outcome is
  never treated as "no prior record" on a write path.
- `load`/`list` return `JSON.parse(...) as IInteractiveSessionRecord` — an honest trust boundary with no
  runtime validation (a hand-edited file is the caller's responsibility, unchanged from before).
- `IHistoryEntry.timestamp` is `Date`-typed at compile time but round-trips through JSON as an ISO
  string; consumers of loaded records must not assume a live `Date` instance (pre-existing
  behavior, now visible in the type).

Memory event and used-reference fields are audit/debug data, not baseline user-local preferences.
Inspectable user-local memory is governed by
[../../../.agents/specs/user-local-memory.md](../../../.agents/specs/user-local-memory.md). Session
records must not become a command source or hidden preference store.

### Session Data Migration

The repo-root `./scripts/migrate-session-history.mjs` backfills the `history` field for sessions created before this field existed. It converts `messages[]` to `IHistoryEntry[]` format. Safe to run multiple times — skips sessions that already have `history`. Run once after upgrading.

### Key NodeSessionStore Methods

| Method   | Signature                                                | Description                                                                                                                                                            |
| -------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save`   | `(session: IInteractiveSessionRecord) => void`           | Persist a session record to disk atomically (same-directory temp file + rename, so a crash mid-write never corrupts the previous record). Creates directory if needed. |
| `load`   | `(id: string) => IInteractiveSessionRecord \| undefined` | Load a session by ID. Returns undefined if not found.                                                                                                                  |
| `list`   | `() => IInteractiveSessionRecord[]`                      | List all sessions, sorted by updatedAt descending.                                                                                                                     |
| `delete` | `(id: string) => void`                                   | Delete a session file. No-ops if not found.                                                                                                                            |

## The Persisted Session Record Is Decoded, Never Cast (TRANS-005)

`IInteractiveSessionRecord` is persisted and transferred, so it needs a RUNTIME owner and not only a
compile-time one. The TYPE is owned by `@robota-sdk/agent-interface-transport`; the DECODER is owned
here, because an `agent-interface-*` package publishes contracts, vocabulary and discriminators and
not mechanisms (`scan-interface-runtime`), and because every consumer that will route through it —
the store, the artifact envelope, the handoff commit and the replay path — is in this package or in
`agent-framework`, which depends on it. `decodeInteractiveSessionRecord(value: unknown)` is that owner: it returns a record
every member of which was checked, or the list of every place the value failed — not the first place.

The outcome has three members and deliberately not a fourth:

| `status`      | Means                                                             | Carries                               |
| ------------- | ----------------------------------------------------------------- | ------------------------------------- |
| `valid`       | Every member decoded                                              | `record: IInteractiveSessionRecord`   |
| `corrupt`     | The value is not a record of this shape                           | `issues: ISessionRecordDecodeIssue[]` |
| `unsupported` | The envelope names a schema version this build does not implement | `schemaVersion: number \| undefined`  |

`missing` is NOT a member. Absence is a property of a store, not of a value — a record that is not
there never reaches a decoder — so a store composes its own `missing` with these three. Collapsing
corruption into absence is what let a damaged file resume as a silently field-stripped session.

An issue locates the failure with a `path` (`messages[2].timestamp`, empty at the root) separate from
its human `message`, because a caller that must CLASSIFY a failure cannot do it by reading prose.

Four decisions a consumer depends on:

- **Dates are revived.** The contract declares `messages[].timestamp` and `history[].timestamp` as
  `Date`, and JSON has no date type. The decoder accepts an ISO-8601 string or a live `Date` and
  produces a `Date`, so a decoded record satisfies its declared type rather than merely resembling it.
- **String timestamps stay strings, but must parse.** `createdAt`, `updatedAt` and the other `…At`
  members are declared `string`. They are still checked as instants, because resume ordering sorts on
  `new Date(updatedAt).getTime()` and an unparseable value sorts as `NaN` rather than failing.
- **Unknown keys on a declared object are a defect.** A persisted record is written by this build's
  own code at a known version, so an unrecognised member means the shape drifted — which is what the
  version gate reports. Maps the contract leaves OPEN (`history[].data`, message `metadata`,
  `memoryEvents[].data`, task `metadata`, a schema's `properties`) accept any key; only their values
  are constrained.
- **`TUniversalValue`'s `Date` member is unreachable through persistence.** Inside an open map a
  persisted date is a string indistinguishable from any other string, and reviving by shape would
  convert a user's date-like text into a `Date`. Open-map contents decode as JSON values.

**Versioning.** `SESSION_RECORD_ENVELOPE_VERSION` names the shape this build reads and writes, and
`IVersionedInteractiveSessionRecord` (`{ schemaVersion, record }`) is how it travels with the bytes. The envelope and the record it wraps are ONE versioned concept: a change to either shape bumps the same number, and the artifact path and the session stores all read it (issue #2185 settled one-vs-two as one and named the constant for the pair; TRANS-005's duplicate was retired by TRANS-006).
The version is NOT a member of `IInteractiveSessionRecord`: required would oblige every producer to
set it, and optional would mean absent-is-acceptable, which is the permissive reader this codec
replaces. `decodeVersionedInteractiveSessionRecord` reads the version FIRST and returns `unsupported`
without nested issues — field defects measured against another version's shape describe the reader's
expectations, not the data's condition.

## Session Logging

The session log records structured events to a JSONL file for diagnostics and replay. Logs must preserve enough raw data to reconstruct what was sent to the model and what came back:

Live logging writes through `ISessionLogSink` and `IExternalPayloadSink`; parsing/hydration reads through
`ISessionLogSource` and `IExternalPayloadSource`. Each payload-source read receives the remaining aggregate
byte budget and must not return bytes that exceed it. A direct host-filesystem source must enforce the budget
before and during the read; it may not fully allocate unbounded bytes and defer the limit check to the resolver.
`NodeSessionLogSource`/`NodeSessionLogSink` are explicitly named host adapters. `NodeSessionLogSource`
rejects an empty or whitespace-only log-file path before deriving sidecar authority from its directory. A
project composition supplies framework authority-backed adapters instead of reopening an absolute path.
Append, hot-path buffering, flush ordering, owner-only Node modes, sidecar integrity, and the warning-only
diagnostic logging failure contract are preserved.

`SESSION_LOG_EVENT` is the complete declared vocabulary for every production session-log event. Direct
logger calls, `onExecutionEvent` literals emitted by agent-core, and replay-reader-only recognized
events must all be members; adding a production literal without adding it to this vocabulary is a
contract violation. The event-name coverage test mechanically scans all three sources.

- **`session_init` event** -- Recorded when a session is constructed. Includes `systemPrompt`, `systemPromptLength`, provider/model, cwd, and registered `toolSchemas`.
- **`server_tool` event** -- Recorded when a server-managed tool (e.g., web search) executes during streaming. Includes the tool name and query.
- **`pre_run` event** -- Recorded at the start of each `run()` call. Includes the provider name, provider-native web capability/enabled state, full enriched input, and current message history before the model call.
- **`provider_request` event** -- Recorded before each provider call. Includes the provider-neutral request envelope: provider, model, messages, tool schemas/options, round, and execution identifiers.
- **`provider_native_raw_payload` event** -- Recorded when a provider package reports an SDK-native request, response, or stream event through `IChatOptions.onProviderNativeRawPayload`. Includes provider, optional API surface, payload kind, sequence, payload, round, and execution identifiers. This event is provider-owned at capture time; Session only persists it through the existing logger.
- **`provider_stream_raw_delta` event** -- Recorded for each provider text delta the turn observes. Includes sequence, delta, round, and execution identifiers. A provider that streams produces one per chunk; a provider that returns only an assembled message produces exactly one per round carrying that text, so a replay never has to distinguish the two cases.
- **`provider_response_raw` event** -- Recorded immediately after provider `chat()` returns and before core validates/extracts the assistant message. Includes the provider-returned response object and `responseKind`.
- **`provider_response_normalized` event** -- Recorded immediately after the provider adapter returns a `TUniversalMessage`. Includes the normalized assistant message, tool call count, provider/model metadata, round, and execution identifiers.
- **`tool_batch_started` event** -- Recorded before a tool batch executes. Includes batch mode, max concurrency, request count, ordered tool names, round, and execution identifiers.
- **`tool_execution_request` event** -- Recorded for each parsed tool request. Includes tool name, toolCallId/executionId, parsed parameters, batch index, owner path, round, and execution identifiers.
- **`tool_execution_result` event** -- Recorded for each terminal tool result. Includes tool name, toolCallId/executionId, success/error, result payload when available, result metadata, batch index, round, and execution identifiers.
- **`tool_message_committed` event** -- Recorded when a tool result message is appended to canonical history.
- **`history_mutation` event** -- Recorded for append-only canonical chat history changes used by replay readers.
- **`text_delta` event** -- Recorded for each streaming text chunk delivered through `ISessionOptions.onTextDelta`. This is append-only JSONL data and must be available while a run is still in progress.
- **`assistant` event** -- Recorded after each assistant response. Includes full assistant content, full post-run history, and `historyStructure`: an array with per-message metadata (role, contentLength, hasToolCalls, toolCallNames, metadata).
- **`session_shutdown` event** -- Recorded once when `Session.shutdown()` begins. Includes the Claude-compatible shutdown reason.
- **Provider-native web configuration** -- Session calls `IAIProvider.configureNativeWebTools?.({ webSearch: true })` during construction. Providers that own auto-enabled hosted web behavior may implement the hook; Session must not branch on concrete provider names or import provider packages.
- **`onServerToolUse` callback wiring** -- When session logging is enabled, the `onServerToolUse` callback from the provider is automatically wired to emit `server_tool` log events.

`FileSessionLogger` applies recursive secret redaction before persistence. Keys such as `apiKey`, `authorization`, `accessToken`, `refreshToken`, `secret`, `password`, and `xApiKey` are replaced with `[REDACTED]`. Log fields larger than the inline threshold are stored as content-addressed JSON payload files in `{sessionId}.payloads/{sha256}.json`, and the JSONL line stores an `IExternalPayloadReference`.

The `external-payload-*` module family is the single sidecar read owner: the public recursive resolver
orchestrates internal file-reader primitives against the public error/options contract. It treats input as untrusted JSON and
recognizes only the exact `IExternalPayloadReference` shape: `kind: "external-payload"`,
`encoding: "json"`, a 64-hex-character sha256, a non-negative safe-integer byte length, and a
non-empty relative path. Resolution rejects absolute paths, traversal, NUL bytes, lexical escape, and
real-path/symlink escape from the supplied base directory. It stats the canonical target before read,
charges its byte length to one aggregate budget, verifies the raw byte length and sha256 before UTF-8
decode/JSON parse, validates the parsed value as JSON-compatible, and recursively hydrates references in
arrays, records, and sidecar contents. A canonical-path active stack rejects cycles. Default limits are
32 nested references and 64 MiB total sidecar bytes per resolution operation; limits must be finite,
non-negative safe integers.

`NodeExternalPayloadSource` rejects an empty explicit base directory. Its current Linux implementation opens
the canonical base once per read and traverses every relative component with no-follow descriptors, verifies
the opened target is a regular file, and performs a budget-bounded read from that same descriptor. A link in
any component fails closed; replacing a pathname after its component is open cannot redirect the held
descriptor. Growth during the read, or a host without the implemented stable no-follow facility, fails closed
without returning bytes.

> **Contained — [ARCH-049](../../../.agents/tasks/completed/ARCH-049-cross-platform-stable-external-payload-replay.md).**
> The current stable external-payload reader is Linux-only, so public Node replay rejects externalized
> payloads on macOS and Windows. ARCH-049 owns an equally strong stable-handle implementation for every
> supported host; this containment must not be replaced with pathname validation followed by pathname I/O.

Resolution fails closed with `SessionLogPayloadResolutionError`. Its stable `code` is one of
`INVALID_LIMIT`, `INVALID_REFERENCE`, `UNRESOLVED_REFERENCE`, `OUTSIDE_ROOT`, `PAYLOAD_NOT_FOUND`,
`PAYLOAD_UNREADABLE`, `BYTE_LENGTH_MISMATCH`, `SHA256_MISMATCH`, `INVALID_JSON`,
`MAX_DEPTH_EXCEEDED`, `MAX_TOTAL_BYTES_EXCEEDED`, or `CIRCULAR_REFERENCE`; structured metadata may
include the relative/canonical path, depth, and expected/actual values, and filesystem/parse failures
retain their cause.

**On-disk permissions (SEC-003).** An explicitly constructed `NodeSessionLogSink(logDir)` treats the
directory as host-owned authority. It creates the log directory and `{sessionId}.payloads/` directory
with mode `0700`, and the `{sessionId}.jsonl` and payload files with mode `0600`, instead of inheriting
the process umask. The public sink validates every direct `sessionId` use as one safe path component;
payload writes additionally require a canonical lowercase 64-hex sha256 that equals the serialized
content digest. `createSessionLogExternalPayloadReference()` owns that validation and reference construction
for every host or authority-backed sink. `FileSessionLogger` receives the sink and never resolves or opens
`logDir` itself.

Externalized payloads are written with the exclusive-create flag (`wx`) rather than an `existsSync`
check followed by a write, which was a TOCTOU race between concurrent sessions externalizing the same
payload. Because the filename is the sha256 of the content, an `EEXIST` failure means the identical
bytes are already on disk and is safely ignored.

`session-log-replay.ts` owns replay readers and validators. `loadSessionLogEntries(source, options?)`
reads only through an explicit `ISessionLogSource`; its attached payload source or an explicit option
hydrates every JSONL line with one shared depth and aggregate-byte state before returning it. The neutral
loader never turns a path into I/O authority. `replaySessionLogEntries()` reconstructs provider messages
and chat history from already-hydrated `history_mutation` events.
`validateSessionReplayLogEntries()` reports missing provider-native raw payloads, missing provider-normalized
raw responses, missing normalized responses, unmatched tool requests/results, malformed references, and
`UNRESOLVED_REPLAY_PAYLOAD` when an unresolved reference remains recursively inside
`history_mutation.message` or `provider_response_normalized.response`. An unresolved normalized response
does not satisfy provider-response completeness. Every `provider_request` must otherwise be paired with
at least one `provider_native_raw_payload` event for the same `executionId`/`round` whose `payloadKind` is
`response` or `stream_event`, plus the existing `provider_response_raw` and resolved
`provider_response_normalized` events. References in unrelated observability/tool payloads do not make the
replay substrate unresolved.

## Hook Lifecycle

`Session` fires Claude Code-compatible lifecycle hooks through `runHooks`:

- `SessionStart` fires once when a `Session` is constructed.
- `UserPromptSubmit` fires before each model turn and may inject stdout into the next prompt.
- `Stop` fires after each successful assistant response and includes `response`, `last_assistant_message`, and `stop_hook_active`.
- `StopFailure` fires when a model turn errors and includes `reason`.
- `SessionEnd` fires exactly once from `Session.shutdown()`, after local persistence, and includes the Claude-compatible `reason`.
- After the `SessionEnd` hook settles, `shutdown()` destroys the wrapped agent (`robota.destroy()`, CORE-022 disposal chain): every registered plugin is disposed, so the process holds no session-owned timers or listeners and can exit naturally.

### PreToolUse enforcement posture (SEC-016)

`PreToolUse` is the one **enforcing** event: a hook that reaches NO verdict there denies the tool
call. Every other event is advisory — a failure is reported on `IRunHooksResult` and the turn
proceeds. `isEnforcing` (`@robota-sdk/agent-core`) is the SSOT; this package reads it rather than
hard-coding the event.

The deny causes are enumerated once, in the catalog SSOT
`packages/agent-core/docs/HOOK-CATALOG.md` § "Blocking semantics" — four of them, cited here rather
than recounted. An earlier version of this section restated them in a different grouping ("two
causes in addition to an explicit `deny`"), which is the same three-versus-four drift the catalog
now records, reproduced one document over by the change that declared the catalog the owner.

The two this package is responsible for producing, with the reason shape each carries:

| cause                                                                                                                          | reason shape                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A hook returned `outcome: 'error'` — timeout, spawn failure, transport failure, HTTP status, malformed response, non-zero exit | `Hook could not evaluate ({kind}, source: {source}): {reason}` — plus ` (+N more hook failure(s))` when several failed                                                                                                            |
| A configured hook type had no registered executor, so nothing evaluated the gate                                               | `Hook type(s) with no registered executor: {types}. Nothing evaluated this gate, so the tool call is denied rather than silently allowed. Remove the hook from the PreToolUse configuration, or supply an executor for its type.` |

When one turn carries both, they appear in a **single** reason. A fail-closed gate that reveals its
reasons one per attempt is a gate the operator debugs by being repeatedly stopped.

Note the availability consequence, because it is reachable from valid configuration: the config
schema accepts `prompt`, `agent` and `guardrail` hook types while no product surface supplies the
factories their executors need, so such a config validates and would deny every tool call. Denying is
deliberate — silently skipping a gate the user wrote is the fail-open SEC-016 closes — and the
composition root now refuses such a config at assembly, before any turn, naming the type and the
option it needs (`agent-framework` `createSession()`, issue #2245); this gate remains the floor.

## Extension Points

1. **`ISessionOptions.terminal`** (required) -- Inject an `ITerminalOutput` implementation for permission prompts and UI output. The consuming layer provides either a real terminal (CLI print mode) or an Ink-based no-op (TUI mode).

2. **`ISessionOptions.tools`** -- Inject any set of `IToolWithEventService[]`. The consuming layer (agent-framework) provides the default 10 built-in tools.

3. **`ISessionOptions.provider`** -- Inject any `IAIProvider`. The consuming layer (agent-framework) creates the appropriate provider from config.

4. **`ISessionOptions.systemMessage`** -- Inject the pre-built system prompt string. The consuming layer (agent-framework) builds this from AGENTS.md, CLAUDE.md, tool descriptions, and trust level. `Session.systemMessage` is the session's live record of the current system prompt and is the value re-injected on compaction.

### Live system prompt updates

`Session.updateSystemMessage(content)` replaces the live system prompt and propagates it so the **next provider request reflects it**. It (1) updates `Session.systemMessage` and (2) calls `Robota.updateSystemPrompt(content)`, which updates the agent's `config.systemMessage` and the live conversation store's single head system message (see agent-core SPEC → _System Prompt (single source of truth)_). It does **not** route through `setModel`: the system prompt is an agent-level concern, not model config, and a config-only update never reaches the model because providers read the system prompt from the messages array. This is the propagation path for persona application, the self-verification toggle, and AGENTS.md/CLAUDE.md staleness refresh.

5. **`ISessionOptions.permissionHandler`** -- Inject a custom permission approval callback (used by Ink-based UI to show approval prompts in React components).

6. **`ISessionOptions.promptForApproval`** -- Alternative approval function that receives the terminal handle.

7. **`ISessionOptions.onTextDelta`** -- Streaming callback for real-time text output to the UI. `Session` stores this callback and passes it to `Robota.run()` as a per-run option; it MUST NOT mutate provider-level `onTextDelta` state because parent/subagent sessions may share the same provider instance.

8. **`ISessionOptions.onToolExecution`** -- Callback for real-time tool execution events. Fires `{ type: 'start', toolName, toolArgs }` when a tool begins and `{ type: 'end', toolName, toolArgs, success, denied?, toolResultData? }` when it completes. `toolResultData` is the serialized, possibly truncated tool result payload used by higher layers for display metadata such as Edit start lines. Registered tool execution is wired through `PermissionEnforcer.wrapToolWithPermission()`. Unregistered tool calls are not wrapped by `PermissionEnforcer`, so `Session` bridges core replay events into the same callback with `success: false`, `errorCode: "unknown_tool"`, and the reason the tool call was not executed. The bridge must not duplicate registered tool events.

9. **`ISessionOptions.onCompact`** -- Callback invoked when compaction occurs (auto or manual), receives the generated summary string.

10. **`ISessionOptions.compactInstructions`** -- Custom instructions for the compaction summary prompt (e.g., extracted from a project context file's "Compact Instructions" section). Appended after the base template.

    **`ISessionOptions.compactionBasePrompt`** -- Replaces the base instruction template of the compaction summarization prompt wholesale (default: the exported, domain-neutral `DEFAULT_COMPACTION_PROMPT`). This is the seam for a consuming layer that wants product- or domain-specific compaction wording.

    **`ISessionOptions.contextCapacityHint`** (NEUT-005) -- Concrete remediation wording forwarded to the Robota agent config as `IAgentConfig.contextCapacityHint`. The zero-dependency `agent-core` layer emits a product-neutral hard-capacity notice; a surface tier that owns a real remediation command (e.g. a `/compact` slash command) injects its actionable hint here. Not model-facing prompt text this package authors -- it is an opaque string passed through to the core seam; absent, the neutral core default (`DEFAULT_CONTEXT_CAPACITY_HINT`) applies.

11. **`ISessionOptions.maxTurns`** -- Optional model/tool round cap passed to the underlying Robota run. Omitted means unlimited for the session layer.

12. **`ISessionOptions.autoCompactThreshold`** -- Optional automatic compaction threshold. A number is interpreted as a fraction of the context window; `false` disables automatic compaction.

13. **`NodeSessionStore` constructor** -- Accept a host-owned `baseDir`; this adapter is explicit and does not establish project trust.

## Abort Behavior

The `Session` class supports aborting an in-progress `run()` call via `AbortController`.

### Execution Root (ARCH-010)

`ISessionOptions.cwd` is REQUIRED. It did not exist: the constructor read `process.cwd()`, and that
ambient value became the session's identity everywhere it matters — every hook input,
`CLAUDE_PROJECT_DIR`, the permission enforcer's root, and the persisted record. A session could not be
told where it ran, so a subagent ran in its parent's directory rather than its own workspace, while
the subagent spawn contract had declared `cwd` required all along.

`getCwd()` exposes it, because a fork or subagent derived from a session must be able to ask which
root that session actually uses instead of re-deriving one that can disagree.

### Malformed permission patterns are refused at construction (issue #2428)

`PermissionEnforcer`'s constructor runs agent-core's `findInvalidPermissionPatterns` over
`permissions.allow` and `permissions.deny` and throws naming every pattern the gate could never
evaluate and why — a URL pattern the URL grammar rejects, an argument-scoped pattern for a declared
tool with no argument key, syntactic junk — before any turn runs. A pattern naming a tool with no
registered profile yet is not refused (a later-loaded pack may declare it); for it the gate's
unevaluable route (CORE-049) remains the floor.

### Consent is scoped to the argument, not the tool (issue #2351)

"Allow always" (session or project) used to be keyed on the tool NAME, so approving `Bash` for one
command allowed every later command. Consent is now remembered as a permission PATTERN that
`consentScopeFor` (`consent-scope.ts`) projects from the invocation's argument by the kind the
tool's permission profile declares: `path` → the containing directory (`Read(/w/src/**)`), `url` →
the origin (`WebFetch(https://h/**)`), `command` → the program (`Bash(git *)`), `text` or no declared
argument → the tool name. "Already allowed" is decided by the gate's own `matchesAnyPattern` over
those records, and `onProjectAllowTool` receives the same pattern to persist — so a materially
different argument prompts again, in the session and across sessions. Both prompt surfaces
(`agent-framework` `promptForApproval`, the TUI prompt) print that scope on the "always" options.

### Path arguments are canonicalised before the gate (issue #2429)

`wrapToolWithPermission` resolves a relative value of a tool's `path`-kind argument (per its
registered permission profile) against the session `cwd` — `tool-argument-canonicalisation.ts` —
before the permission gate, the hooks, the log and the tool see it. An absolute pattern such as
`Read(<cwd>/secrets/**)` therefore judges `secrets/key` rather than reporting it unevaluable, and the
tool receives exactly the path the gate judged. Absolute values, non-path kinds and tools with no
profile pass through unchanged.

### Turn Identity (RUNTIME-003)

`TurnClaim` (`src/turn-claim.ts`) owns the unit of work. Before RUNTIME-003 a bare
`AbortController | null` field on the session stood in for three separate things — cancellation
channel, busy flag and turn identity — and could serve only one turn, so a second concurrent `run()`
orphaned the first: `abort()` reached only whichever turn held the field, the first turn to finish
cleared it, and `isRunning()` answered about whichever turn happened to own it.

The contract this package now publishes:

- A session runs **one turn at a time**. `run()` claims the turn synchronously, before its first
  `await`, and a concurrent `run()` is **refused** with `SessionBusyError` (exported) rather than
  started. Refusal, not pre-emption: a session is a single conversation, and cancelling the running
  turn would discard work the caller never asked to abandon.
- The claim is released **only by the turn that took it**, whether it resolves or rejects. A
  late-finishing turn cannot free a claim a newer one already holds.
- `abort()` **signals**; it does not release. A turn is over when it has stopped, not when it was
  asked to, so `isRunning()` stays `true` while an aborted turn unwinds and a `run()` during that
  window is refused. Cancel-and-restart is `abort()` → await the turn → `run()`.
- `isRunning()` is therefore authoritative for the session, and a consumer does not need to maintain
  a parallel busy flag.

Every wait owned by this package that can park a turn observes the turn signal. In particular,
`PermissionEnforcer` races both a consumer `permissionHandler` and an injected approval prompt against
the signal. Abort resolves that approval decision as **deny** (fail closed), allowing the turn to
unwind and its matching claim to release; it can never convert cancellation into approval.
`isRunning()` remains true between `abort()` and that unwind. A consumer must await the active run
before starting the next one. Long-running tools receive the same signal in their execution context
and are contractually responsible for observing it; tool-cooperation conformance is a separate
cross-tool concern rather than a second cancellation channel.

Concurrency ACROSS transports (MCP request correlation, the HTTP `POST /submit` TOCTOU) rides
`InteractiveSession` in `agent-framework`, a different object, and is not covered by this contract —
tracked as RUNTIME-003 P2.

### Mechanism

- `session.abort()` calls `AbortController.abort()` on the controller held by the current claim.
- `session.isRunning()` returns `true` while a `run()` call is in progress.

### Session.run() Abort Flow

1. `Session.run()` claims the turn (`TurnClaim.claim()`), obtaining an `AbortController`, and passes
   `{ signal }` to `robota.run()`.
2. Signal propagates through `ExecutionService` -> `executeRound` -> `callProviderWithCache` -> `provider.chat()` -> `streamWithAbort`.
3. When abort is signalled, `executeRound` calls `commitAssistant('interrupted')` on `ConversationStore` before returning. This saves the partial response (with `state: 'interrupted'`) to conversation history. Text is ALWAYS preserved (no stripping).
4. `robota.run()` always returns normally on abort — it does not throw. The result includes `interrupted: true`.
5. After `robota.run()` returns, `Session.run()` checks `signal.aborted`. If true, it throws `DOMException('Aborted', 'AbortError')`.
6. The post-run check in `Session.run()` is the **sole source** of `AbortError` — `robota.run()` itself never throws on abort.

## Compaction Behavior

### System Message Preservation

When `compact()` runs, the system message (project context: cwd, AGENTS.md, CLAUDE.md, tool descriptions, etc.) is **preserved across compaction**. The flow:

1. **Exclude** system messages from the summarization input — they are not summarized
2. **Clear** conversation history
3. **Re-inject** the original system message
4. **Inject** the compact summary as an assistant message

Post-compaction history:

```
[system]    Original system prompt (project context, rules, tool descriptions)
[assistant] [Context Summary] Summarized conversation...
```

This ensures the AI retains project context (working directory, coding rules, available tools) after compaction. Without this, the AI loses awareness of the project environment.

### Compaction Failure Contract

Conversation history is append-only source data; a compaction that cannot produce a valid summary
must never destroy it. The contract:

1. **Validate before clearing.** A summary is valid only when the provider returns a non-empty
   string (whitespace-only is invalid). `CompactionOrchestrator.compact()` throws
   `CompactionError` on an invalid summary — it never substitutes a placeholder marker.
2. **History untouched on failure.** `clearHistory()` runs only after a valid summary exists.
   When compaction throws, the conversation history, context tracker state, and persisted session
   file are exactly as they were before the attempt.
3. **Errors propagate.** Manual `Session.compact()` rejects with the `CompactionError`.
   Auto-compaction failure inside `run()` propagates to the `run()` caller the same way — the
   session surfaces the failure instead of silently continuing toward context overflow.
4. **A CANCEL is a failure for this purpose (RUNTIME-004).** `compact()` takes the turn's
   `AbortSignal` and checks it twice: before the provider call, so a turn cancelled before it began
   costs nothing; and after it returns, where it rejects rather than yielding a summary. The
   rejection is an `AbortError`, not a `CompactionError` — `isAbortFailure` (agent-core) is the one
   owner of that distinction, so a user's own cancellation is not reported as a failed turn. History
   is untouched by rule 2, which is the point: an abort during auto-compaction used to run the
   provider anyway and then replace the whole conversation with a summary the user had asked not to
   produce.
5. **Nothing to summarise is a no-op, not a summary (CORE-031).** `Session.compact()` decides
   emptiness against the messages it will actually compact — the history with system messages
   filtered out — and returns without touching the conversation when there are none. Guarding on
   the FULL history instead let a system-messages-only conversation through, which is exactly what a
   fresh session holds before its first turn, and the replacement wrote an empty `[Context Summary]`
   over it. `CompactionOrchestrator.compact()` correspondingly throws `CompactionError` on an empty
   `history` rather than returning `''`: whether there is anything worth compacting is the caller's
   judgement, made before it commits to replacing anything, so an empty history arriving at the
   orchestrator means that judgement was wrong. No hook fires and no `context_compact` event is
   written for a no-op. The abort contract in rule 4 is unaffected: `Session.compact()` checks the
   signal before this guard, so a cancelled turn is reported as cancelled whether or not there was
   anything to compact — the orchestrator used to make that check on the caller's behalf, and the
   no-op return would otherwise have narrowed the promise to "rejects if cancelled AND there was
   work".

### Auto-Compaction

Auto-compaction triggers at the **start** of `run()` (before processing the user message) when `ContextWindowTracker.shouldAutoCompact()` returns true. This prevents compaction from interfering with the current response stream. The trigger defaults to 83.5% of the context window and can be configured per session or disabled with `autoCompactThreshold: false`.

`ContextWindowTracker.updateFromHistory()` delegates token estimation to `agent-core`'s shared context estimator. The tracker treats terminal provider usage as exact post-response state; when metadata-free messages follow the latest provider usage, it uses the maximum of serialized-history estimate, latest provider usage, and any future caller floor instead of summing all historical provider input counts. This keeps `/context`, status bars, automatic compaction, and core hard-capacity guards aligned on the same effective context state.

## Error Taxonomy

This package defines one custom error class: `CompactionError` (thrown when a compaction summary
is invalid — see Compaction Failure Contract). All other errors are thrown as standard `Error`
instances. Error scenarios include:

| Error Condition                         | Thrown By                | Message Pattern                                                                                                                                                                                                |
| --------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid compact summary                 | `CompactionOrchestrator` | Throws `CompactionError`; conversation history is preserved untouched                                                                                                                                          |
| Tool permission denied                  | `PermissionEnforcer`     | Returns `IToolResult` with `"Permission denied"` (no throw)                                                                                                                                                    |
| Hook blocked tool                       | `PermissionEnforcer`     | Returns `IToolResult` with `"Blocked by hook: {reason}"`                                                                                                                                                       |
| Hook reached no verdict on `PreToolUse` | `tool-hook-helpers`      | SEC-016 fail-closed: returns `IToolResult` with failure kind `hook-blocked` and a reason naming the error kind and source, or the hook type(s) with no registered executor. Advisory events report and proceed |
| Tool execution error                    | `PermissionEnforcer`     | Returns `IToolResult` with error message (never throws)                                                                                                                                                        |
| Unknown tool call                       | `ExecutionService`       | Returns a failed tool result with `errorCode: "unknown_tool"` and explains that execution was skipped                                                                                                          |

The permission wrapper deliberately catches all errors and returns them as `IToolResult` objects to avoid corrupting the conversation history with unmatched tool_use/tool_result pairs.

### Session.run() Error Recovery

When `run()` encounters an error (e.g., from the execution loop or provider), the Session must:

1. **Log the error** — write an `error` event to the session logger with the error details
2. **Preserve history** — conversation history up to the point of failure remains intact
3. **Remain usable** — the session is not corrupted; the user can continue or retry
4. **Propagate the error** — re-throw after logging so the caller can handle it (e.g., display an error message)

## Class Contract Registry

### Interface Implementations

`NodeSessionStore` implements the `IInteractiveSessionStore` port owned by `agent-interface-transport`.
`FileSessionLogger` implements `ISessionLogger`; `NodeSessionLogSource`, `NodeExternalPayloadSource`,
and `NodeSessionLogSink` implement this package's neutral source/sink ports. Other runtime classes are
standalone.

### Inheritance Chains

`Session extends SessionBase`. `SessionBase` (`session-base.ts`) is an abstract base that holds the shared session methods and live state, including the preset/model/parallel-subagent state (`getActivePresetId`/`setActivePresetId`, `getParallelSubagentsEnabled`/`setParallelSubagentsEnabled`, `applyModelOptions`); the concrete `Session` (`session.ts`) supplies the `robota`, `permissionEnforcer`, and other abstract members and adds the run loop. The remaining classes are standalone.

### Cross-Package Port Consumers

| Port (Owner)                             | Consumer Class              | Location                                                  |
| ---------------------------------------- | --------------------------- | --------------------------------------------------------- |
| `Robota` (agent-core)                    | `Session`                   | `src/session.ts`                                          |
| `IAIProvider` (agent-core)               | `Session`                   | `src/session.ts`                                          |
| `evaluatePermission` (agent-core)        | `PermissionEnforcer`        | `src/permission-enforcer.ts`                              |
| `runHooks` (agent-core)                  | `PermissionEnforcer`        | `src/permission-enforcer.ts`                              |
| `runHooks` (agent-core)                  | `Session`                   | `src/session.ts` (PostCompact)                            |
| `runHooks` (agent-core)                  | `CompactionOrchestrator`    | `src/compaction-orchestrator.ts`                          |
| `IExternalPayloadSource` (agent-session) | `WorkspaceSessionLogSource` | `agent-framework/src/interactive/workspace-session-io.ts` |
| `IExternalPayloadSink` (agent-session)   | `WorkspaceSessionLogSink`   | `agent-framework/src/interactive/workspace-session-io.ts` |

## Test Strategy

### Current Test Coverage

- **Session system prompt delivery** -- tests verifying the system prompt is passed to Robota as the single-source top-level `config.systemMessage`, and that `updateSystemMessage` propagates a live change to the next provider request via `Robota.updateSystemPrompt`.
- **Session provider callback isolation** -- 1 regression test verifying two sessions sharing one provider keep `onTextDelta` output isolated per run.
- **Approval abort recovery** -- bounded tests cover both approval adapters, wrapper signal wiring,
  fail-closed denial, listener cleanup, and a full `Session.run()` parked on approval through
  `abort()` → rejected turn → `isRunning() === false`.

### Gaps

- **Session** -- permission mode switching, hook integration, and session persistence are untested.
- **PermissionEnforcer** -- `wrapTools()`, `checkPermission()`, session-scoped allow, tool truncation are untested.
- **ContextWindowTracker** -- `updateFromHistory()`, `shouldAutoCompact()`, metadata vs fallback estimation are untested.
- **CompactionOrchestrator** -- hook firing is untested. Prompt building (neutral default template, `basePrompt` injection, instruction appending) is covered by `compaction-prompt-neutrality.test.ts`; the failure contract by `compaction-failure-preservation.test.ts`.
- **NodeSessionStore** -- Covered by package-local atomicity, traversal, and field-preservation tests plus framework facade tests.
- **FileSessionLogger / source-sink adapters** -- Covered for hot-path buffering, source contracts, payload hydration, permissions, and failure degradation.
- **SilentSessionLogger** -- No-op behavior untested (trivial, low priority).
- All classes should be testable with mock `IAIProvider` and mock `ITerminalOutput` injections.

## Dependencies

### Production (2)

- `@robota-sdk/agent-core` -- Robota agent, permission system, hook system, core types
- `@robota-sdk/agent-interface-transport` -- SSOT for `ICompactEvent`/`TCompactTrigger` (imported/re-exported by `src/session-types.ts`)
