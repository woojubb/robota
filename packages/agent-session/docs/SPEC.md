# Sessions Specification

## Scope

Owns the CLI session lifecycle for the Robota SDK. This package provides the `Session` class that wraps a `Robota` agent instance with permission-gated tool execution, hook-based lifecycle events, context window tracking, conversation compaction, and optional JSON file persistence via `SessionStore`. It is the primary runtime used by the CLI application (`agent-cli`) via the assembly layer (`agent-framework`).

## Boundaries

- Does not own AI provider creation. Accepts a pre-constructed `IAIProvider` via injection.
- Does not own tool implementations. Accepts pre-constructed `IToolWithEventService[]` via injection.
- Does not own system prompt building. Accepts a pre-built `systemMessage` string.
- Does not own configuration resolution or context loading. Those belong to `agent-framework`.
- Does not own the permission evaluation algorithm or hook execution engine. Those belong to `@robota-sdk/agent-core` (`evaluatePermission`, `runHooks`).
- **Owns the storage-neutral persistence primitive.** `SessionStore` and `ISessionRecord` are the
  SSOT for the storage-neutral conversation persistence primitive — opaque payloads with no typed
  resumable-session shape. Storage adapters implement these interfaces. The **typed
  resumable-session contract** (`IInteractiveSessionRecord` / `IInteractiveSessionStore`), which the
  consumer-facing store actually returns, is owned by `@robota-sdk/agent-interface-transport`
  (DATA-001) and adapted by `agent-framework`; it is not duplicated here. Consumers obtain a session
  store through SDK facades (`createProjectSessionStore`) rather than constructing `SessionStore`
  directly.

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
session-logger.ts         -- ISessionLogger interface + FileSessionLogger / SilentSessionLogger
session-store.ts          -- SessionStore: JSON file persistence for conversation sessions
```

**Design patterns used:**

- **Facade** -- `Session` hides Robota agent creation, tool registration, permission wiring, and hook execution behind a single `run()` method.
- **Decorator** -- Each tool is wrapped with a permission-checking proxy via `PermissionEnforcer.wrapTools()` before being registered with the Robota agent.
- **Adapter** -- `session-tool-execution-bridge` adapts core replay events for unregistered tool calls into the same UI callback shape used by wrapped registered tools.
- **Strategy (injected)** -- Permission approval can be handled by a `TPermissionHandler` callback, an injected `promptForApproval` function, or denied by default.
- **Composition** -- Session delegates to PermissionEnforcer, ContextWindowTracker, and CompactionOrchestrator rather than implementing everything inline.
- **Null Object** -- When no `SessionStore` is provided, persistence is silently skipped.

**Dependency direction:**

- `@robota-sdk/agent-session` depends on `@robota-sdk/agent-core` and `@robota-sdk/agent-interface-transport` (SSOT for `ICompactEvent`/`TCompactTrigger`).
- No dependency on `@robota-sdk/agent-tools` or `@robota-sdk/agent-provider/anthropic`.
- Tool and provider assembly is the responsibility of the consuming layer (`agent-framework`).

## Type Ownership

Types owned by this package (SSOT):

| Type                         | Kind      | File                         | Description                                                                                           |
| ---------------------------- | --------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ISessionOptions`            | Interface | `session-types.ts`           | Constructor options for Session (tools, provider, systemMessage, providerTimeout, optional sessionId) |
| `ISessionShutdownOptions`    | Interface | `session-types.ts`           | Graceful shutdown options, including Claude-compatible `reason`                                       |
| `TPermissionHandler`         | Type      | `permission-types.ts`        | Async callback `(toolName, toolArgs) => Promise<TPermissionResult>`                                   |
| `TPermissionResult`          | Type      | `permission-types.ts`        | `boolean \| 'allow-session' \| 'allow-project'`                                                       |
| `IPermissionEnforcerOptions` | Interface | `permission-types.ts`        | Options for constructing PermissionEnforcer                                                           |
| `ICompactionOptions`         | Interface | `compaction-orchestrator.ts` | Options for constructing CompactionOrchestrator                                                       |
| `ISessionLogger`             | Interface | `session-logger.ts`          | Pluggable session event logger interface                                                              |
| `TSessionLogData`            | Type      | `session-logger.ts`          | Structured log event data (`Record<string, string \| number \| boolean \| object \| null>`)           |
| `IExternalPayloadReference`  | Interface | `session-logger.ts`          | Content-addressed JSON payload reference used when a log field exceeds inline size policy             |
| `ISessionReplayRecord`       | Interface | `session-log-replay.ts`      | Reconstructed replay state from append-only JSONL logs                                                |
| `ISessionRecord`             | Interface | `session-store.ts`           | Persisted session record (id, cwd, timestamps, messages, history, opaque diagnostic extension fields) |

Types consumed from other packages (not owned here):

| Type                    | Source                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| `Robota`                | `@robota-sdk/agent-core`                                         |
| `IAgentConfig`          | `@robota-sdk/agent-core`                                         |
| `IAIProvider`           | `@robota-sdk/agent-core`                                         |
| `IToolWithEventService` | `@robota-sdk/agent-core`                                         |
| `TPermissionMode`       | `@robota-sdk/agent-core`                                         |
| `TToolArgs`             | `@robota-sdk/agent-core`                                         |
| `THooksConfig`          | `@robota-sdk/agent-core`                                         |
| `IHookInput`            | `@robota-sdk/agent-core`                                         |
| `evaluatePermission`    | `@robota-sdk/agent-core`                                         |
| `runHooks`              | `@robota-sdk/agent-core`                                         |
| `TRUST_TO_MODE`         | `@robota-sdk/agent-core`                                         |
| `TUniversalMessage`     | `@robota-sdk/agent-core`                                         |
| `IHistoryEntry`         | `@robota-sdk/agent-core`                                         |
| `TModelEffort`          | `@robota-sdk/agent-core`                                         |
| `ITerminalOutput`       | `@robota-sdk/agent-core` (re-exported via `permission-types.ts`) |
| `ISpinner`              | `@robota-sdk/agent-core` (re-exported via `permission-types.ts`) |

## Public API Surface

| Export                           | Kind                 | Description                                                                                                    |
| -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Session`                        | Class                | Wraps Robota agent with permissions, hooks, streaming, and persistence                                         |
| `PermissionEnforcer`             | Class                | Tool permission checking, hook execution, output truncation                                                    |
| `ContextWindowTracker`           | Class                | Token usage tracking and auto-compact threshold                                                                |
| `CompactionOrchestrator`         | Class                | Conversation compaction via LLM summary                                                                        |
| `CompactionError`                | Class                | Thrown when a compaction summary is invalid — history is preserved untouched (see Compaction Failure Contract) |
| `SessionStore`                   | Class                | JSON file persistence for session records (`~/.robota/sessions/`)                                              |
| `FileSessionLogger`              | Class                | JSONL file-based session event logger                                                                          |
| `SilentSessionLogger`            | Class                | No-op session logger                                                                                           |
| `ISessionOptions`                | Interface            | Constructor options for Session                                                                                |
| `ISessionShutdownOptions`        | Interface            | Graceful shutdown options for `Session.shutdown()`                                                             |
| `TAutoCompactThreshold`          | Type                 | Auto-compact threshold fraction, or `false` to disable automatic compaction                                    |
| `TPermissionHandler`             | Type                 | Custom permission approval callback                                                                            |
| `TPermissionResult`              | Type                 | Permission decision result                                                                                     |
| `ITerminalOutput`                | Interface            | Terminal I/O abstraction                                                                                       |
| `ISpinner`                       | Interface            | Spinner handle                                                                                                 |
| ~~`IPermissionEnforcerOptions`~~ | Interface (internal) | Options for constructing `PermissionEnforcer` — **not exported** from `src/index.ts`. Internal to the package. |
| `ISessionLogger`                 | Interface            | Pluggable session event logger interface                                                                       |
| `TSessionLogData`                | Type                 | Structured log event data                                                                                      |
| `ISessionRecord`                 | Interface            | Persisted session record shape                                                                                 |
| `ISessionStore`                  | Interface            | Minimal persistence port consumed by `Session`; implemented by `SessionStore`                                  |
| `AUTO_COMPACT_THRESHOLD`         | Constant             | Default auto-compact threshold fraction of the context window (exported from `context-window-tracker.ts`)      |
| `SESSION_LOG_EVENT`              | Constant             | Session log event-name enum object (`session-log-events.ts`)                                                   |
| `isSessionLogEvent`              | Function             | Type guard for a `TSessionLogEventName`                                                                        |
| `loadSessionLogEntries`          | Function             | Loads and parses persisted session log entries from a JSONL file                                               |
| `ISessionLogEntry`               | Interface            | One parsed session log entry (`session-log-replay.ts`)                                                         |
| `ISessionReplayValidationResult` | Interface            | Result of validating a session replay log for integrity                                                        |

`ICompactEvent` and `TCompactTrigger` are **not** part of the public API surface. Their SSOT is
`@robota-sdk/agent-interface-transport` (INFRA-025); `src/session-types.ts` re-exports them
intra-package for internal use, but they are not surfaced on the public `src/index.ts`.

### Session Constructor — sessionId Parameter

`ISessionOptions.sessionId` is an optional parameter. When provided, the Session reuses that ID. When omitted, a fresh UUID is generated (default). This allows the consuming layer to control whether a resumed session continues under the same file or creates a new one.

`ISessionOptions.providerTimeout` is an optional provider idle timeout in milliseconds. When provided, `Session` forwards it to the underlying `Robota` `IAgentConfig.timeout`, where `agent-core` enforces it per provider call and refreshes the idle timer on streaming text deltas.

`ISessionOptions.maxTurns` is an optional maximum number of model/tool rounds for one `Session.run()` call. When provided, `Session` forwards it to `Robota.run()` as `maxExecutionRounds`. When omitted, `Session` forwards `maxExecutionRounds: 0`, which means the session run has no core round cap and is instead bounded by abort, context-window checks, provider idle timeout, and runtime-level controls.

`ISessionOptions.onContextUpdate` is an optional callback fired from the session runtime whenever `ContextWindowTracker` is refreshed. It fires before the provider call using the assembled request history estimate and again after the provider response is committed with exact provider usage when available. Consumers such as `InteractiveSession` forward it as `context_update`.

`ISessionOptions.autoCompactThreshold` controls the initial automatic compaction trigger as a `0 < value <= 1` fraction. The default is `0.835`. Set it to `false` when an embedding runtime manages compaction externally. `Session.setAutoCompactThreshold()` may change this policy after construction; subsequent `run()` calls use the new policy immediately.

`ISessionOptions.onCompactEvent` receives structured compaction metadata with `trigger`, `before`, and `after` context-window states. Manual `Session.compact()` calls report `trigger: "manual"` by default; auto-compaction from `Session.run()` reports `trigger: "auto"`. The session logger also writes a `context_compact` event with the same before/after state so headless transports and logs can explain what happened without streaming compaction summary text into the normal answer path.

`ISessionOptions.activePresetId` is the runtime active-preset id selected at startup. It is pure
state surfaced through `getActivePresetId()`/`setActivePresetId()` and is not used to re-apply any
preset options. The default is `'default'`.

`ISessionOptions.enableParallelSubagents` controls the parallel-subagents dispatch gate surfaced
through `getParallelSubagentsEnabled()`/`setParallelSubagentsEnabled()`. It is only meaningful when
the agent runtime was built at assembly. The default is `true`.

### Key Session Methods

| Method                        | Signature                                                                                                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                         | `(message: string) => Promise<string>`                                                                                  | Send a message; returns AI response. Persists session if store exists.                                                                                                                                                                                                                                                                                                                                                                                  |
| `getPermissionMode`           | `() => TPermissionMode`                                                                                                 | Returns the active permission mode.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `setPermissionMode`           | `(mode: TPermissionMode) => void`                                                                                       | Changes the permission mode for future tool calls.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `getSessionId`                | `() => string`                                                                                                          | Returns the stable session identifier.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `getMessageCount`             | `() => number`                                                                                                          | Returns the number of completed `run()` calls.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `clearHistory`                | `() => void`                                                                                                            | Clears the underlying Robota conversation history and resets token usage.                                                                                                                                                                                                                                                                                                                                                                               |
| `getHistory`                  | `() => TUniversalMessage[]`                                                                                             | Returns the current conversation history as `TUniversalMessage[]` (chat entries only). Unchanged.                                                                                                                                                                                                                                                                                                                                                       |
| `getFullHistory`              | `() => IHistoryEntry[]`                                                                                                 | Returns the full history as `IHistoryEntry[]`, including both chat messages and event entries (e.g., tool summaries).                                                                                                                                                                                                                                                                                                                                   |
| `addHistoryEntry`             | `(entry: IHistoryEntry) => void`                                                                                        | Appends a pre-built `IHistoryEntry` (e.g., a tool-summary event entry) to the session history via `ConversationStore.addEntry()`.                                                                                                                                                                                                                                                                                                                       |
| `getContextState`             | `() => IContextWindowState`                                                                                             | Returns real-time effective context window usage (tokens, percentage) from the shared agent-core estimator.                                                                                                                                                                                                                                                                                                                                             |
| `getAutoCompactThreshold`     | `() => TAutoCompactThreshold`                                                                                           | Returns the configured automatic compaction threshold, or `false` when disabled.                                                                                                                                                                                                                                                                                                                                                                        |
| `setAutoCompactThreshold`     | `(threshold: TAutoCompactThreshold) => void`                                                                            | Updates the automatic compaction threshold for subsequent `run()` calls.                                                                                                                                                                                                                                                                                                                                                                                |
| `compact`                     | `(instructions?: string) => Promise<void>`                                                                              | Compresses conversation via LLM summary. System message is preserved across compaction (see below). Fires PreCompact/PostCompact hooks.                                                                                                                                                                                                                                                                                                                 |
| `abort`                       | `() => void`                                                                                                            | Cancels the currently running `run()` call. No-op if not running.                                                                                                                                                                                                                                                                                                                                                                                       |
| `shutdown`                    | `(options?: ISessionShutdownOptions) => Promise<void>`                                                                  | Aborts active work, persists the session when a store exists, logs shutdown, fires `SessionEnd` exactly once, then destroys the wrapped agent (`robota.destroy()`, CORE-022) so no timers or listeners survive shutdown. Each step is best-effort (CORE-013).                                                                                                                                                                                           |
| `isRunning`                   | `() => boolean`                                                                                                         | Returns true if a `run()` call is in progress.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `getSessionAllowedTools`      | `() => string[]`                                                                                                        | Returns tools that were session-approved ("Allow always").                                                                                                                                                                                                                                                                                                                                                                                              |
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

### ISessionRecord Fields

| Field                      | Type        | Required | Description                                                                                                                                                       |
| -------------------------- | ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | `string`    | Yes      | Unique session identifier                                                                                                                                         |
| `cwd`                      | `string`    | Yes      | Working directory where the session was created                                                                                                                   |
| `name`                     | `string`    | No       | User-assigned session name for easy identification                                                                                                                |
| `createdAt`                | `string`    | Yes      | ISO timestamp of session creation                                                                                                                                 |
| `updatedAt`                | `string`    | Yes      | ISO timestamp of last update                                                                                                                                      |
| `messages`                 | `unknown[]` | Yes      | AI provider messages (TUniversalMessage[]) for context restoration. Saved from `session.getHistory()`, replayed via `session.injectMessage()` on resume.          |
| `history`                  | `unknown[]` | Yes      | Full UI timeline (IHistoryEntry[] — chat + events) for rendering restoration. Passed to TuiStateManager on resume.                                                |
| `systemPrompt`             | `string`    | No       | Exact system prompt used to create the session. Duplicates the system message in `messages` intentionally so diagnostics can inspect prompt composition directly. |
| `toolSchemas`              | `unknown[]` | No       | Tool schemas registered for the session, including model-invocable projected command tools such as `robota_command_skills`.                                       |
| `backgroundTasks`          | `unknown[]` | No       | Latest persisted background task snapshots.                                                                                                                       |
| `backgroundTaskEvents`     | `unknown[]` | No       | Durable background task lifecycle/progress events needed for resume/debugging, including text deltas when the SDK persists background streams.                    |
| `backgroundJobGroups`      | `unknown[]` | No       | Latest persisted background job group snapshots for agent/runtime orchestration resume.                                                                           |
| `backgroundJobGroupEvents` | `unknown[]` | No       | Durable background job group lifecycle events needed for resume/debugging.                                                                                        |
| `memoryEvents`             | `unknown[]` | No       | SDK-owned automatic memory audit events such as extracted, queued, saved, skipped, approved, rejected, and retrieved.                                             |
| `usedMemoryReferences`     | `unknown[]` | No       | SDK-owned provenance records for memory topics injected into the latest prompt turn.                                                                              |
| `contextReferences`        | `unknown[]` | No       | SDK-owned context reference inventory for resume/debugging.                                                                                                       |
| `sandboxSnapshotId`        | `string`    | No       | Provider-owned sandbox workspace reference used by SDK resume hydration. `agent-sessions` stores this value opaquely and does not import sandbox packages.        |

Memory event and used-reference fields are audit/debug data, not baseline user-local preferences.
Inspectable user-local memory is governed by
[../../../.agents/specs/user-local-memory.md](../../../.agents/specs/user-local-memory.md). Session
records must not become a command source or hidden preference store.

### Session Data Migration

The repo-root `./scripts/migrate-session-history.mjs` backfills the `history` field for sessions created before this field existed. It converts `messages[]` to `IHistoryEntry[]` format. Safe to run multiple times — skips sessions that already have `history`. Run once after upgrading.

### Key SessionStore Methods

| Method   | Signature                                     | Description                                                                                                                                                            |
| -------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `save`   | `(session: ISessionRecord) => void`           | Persist a session record to disk atomically (same-directory temp file + rename, so a crash mid-write never corrupts the previous record). Creates directory if needed. |
| `load`   | `(id: string) => ISessionRecord \| undefined` | Load a session by ID. Returns undefined if not found.                                                                                                                  |
| `list`   | `() => ISessionRecord[]`                      | List all sessions, sorted by updatedAt descending.                                                                                                                     |
| `delete` | `(id: string) => void`                        | Delete a session file. No-ops if not found.                                                                                                                            |

## Session Logging

The session log records structured events to a JSONL file for diagnostics and replay. Logs must preserve enough raw data to reconstruct what was sent to the model and what came back:

- **`session_init` event** -- Recorded when a session is constructed. Includes `systemPrompt`, `systemPromptLength`, provider/model, cwd, and registered `toolSchemas`.
- **`server_tool` event** -- Recorded when a server-managed tool (e.g., web search) executes during streaming. Includes the tool name and query.
- **`pre_run` event** -- Recorded at the start of each `run()` call. Includes the provider name, provider-native web capability/enabled state, full enriched input, and current message history before the model call.
- **`provider_request` event** -- Recorded before each provider call. Includes the provider-neutral request envelope: provider, model, messages, tool schemas/options, round, and execution identifiers.
- **`provider_native_raw_payload` event** -- Recorded when a provider package reports an SDK-native request, response, or stream event through `IChatOptions.onProviderNativeRawPayload`. Includes provider, optional API surface, payload kind, sequence, payload, round, and execution identifiers. This event is provider-owned at capture time; Session only persists it through the existing logger.
- **`provider_stream_raw_delta` event** -- Recorded for each provider text delta observed by the core streaming callback. Includes sequence, delta, round, and execution identifiers.
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

`session-log-replay.ts` owns replay readers and validators. `replaySessionLogEntries()` reconstructs provider messages and chat history from `history_mutation` events. `validateSessionReplayLogEntries()` reports missing provider-native raw payloads, missing provider-normalized raw responses, missing normalized responses, unmatched tool requests/results, and invalid external payload references. Every `provider_request` must be paired with at least one `provider_native_raw_payload` event for the same `executionId`/`round` whose `payloadKind` is `response` or `stream_event`, plus the existing `provider_response_raw` and `provider_response_normalized` events.

## Hook Lifecycle

`Session` fires Claude Code-compatible lifecycle hooks through `runHooks`:

- `SessionStart` fires once when a `Session` is constructed.
- `UserPromptSubmit` fires before each model turn and may inject stdout into the next prompt.
- `Stop` fires after each successful assistant response and includes `response`, `last_assistant_message`, and `stop_hook_active`.
- `StopFailure` fires when a model turn errors and includes `reason`.
- `SessionEnd` fires exactly once from `Session.shutdown()`, after local persistence, and includes the Claude-compatible `reason`.
- After the `SessionEnd` hook settles, `shutdown()` destroys the wrapped agent (`robota.destroy()`, CORE-022 disposal chain): every registered plugin is disposed, so the process holds no session-owned timers or listeners and can exit naturally.

## Extension Points

1. **`ISessionOptions.terminal`** (required) -- Inject an `ITerminalOutput` implementation for permission prompts and UI output. The consuming layer provides either a real terminal (CLI print mode) or an Ink-based no-op (TUI mode).

2. **`ISessionOptions.tools`** -- Inject any set of `IToolWithEventService[]`. The consuming layer (agent-framework) provides the default 8 tools + agent-tool.

3. **`ISessionOptions.provider`** -- Inject any `IAIProvider`. The consuming layer (agent-framework) creates the appropriate provider from config.

4. **`ISessionOptions.systemMessage`** -- Inject the pre-built system prompt string. The consuming layer (agent-framework) builds this from AGENTS.md, CLAUDE.md, tool descriptions, and trust level. `Session.systemMessage` is the session's live record of the current system prompt and is the value re-injected on compaction.

### Live system prompt updates

`Session.updateSystemMessage(content)` replaces the live system prompt and propagates it so the **next provider request reflects it**. It (1) updates `Session.systemMessage` and (2) calls `Robota.updateSystemPrompt(content)`, which updates the agent's `config.systemMessage` and the live conversation store's single head system message (see agent-core SPEC → _System Prompt (single source of truth)_). It does **not** route through `setModel`: the system prompt is an agent-level concern, not model config, and a config-only update never reaches the model because providers read the system prompt from the messages array. This is the propagation path for persona application, the self-verification toggle, and AGENTS.md/CLAUDE.md staleness refresh.

5. **`ISessionOptions.permissionHandler`** -- Inject a custom permission approval callback (used by Ink-based UI to show approval prompts in React components).

6. **`ISessionOptions.promptForApproval`** -- Alternative approval function that receives the terminal handle.

7. **`ISessionOptions.onTextDelta`** -- Streaming callback for real-time text output to the UI. `Session` stores this callback and passes it to `Robota.run()` as a per-run option; it MUST NOT mutate provider-level `onTextDelta` state because parent/subagent sessions may share the same provider instance.

8. **`ISessionOptions.onToolExecution`** -- Callback for real-time tool execution events. Fires `{ type: 'start', toolName, toolArgs }` when a tool begins and `{ type: 'end', toolName, toolArgs, success, denied?, toolResultData? }` when it completes. `toolResultData` is the serialized, possibly truncated tool result payload used by higher layers for display metadata such as Edit start lines. Registered tool execution is wired through `PermissionEnforcer.wrapToolWithPermission()`. Unregistered tool calls are not wrapped by `PermissionEnforcer`, so `Session` bridges core replay events into the same callback with `success: false`, `errorCode: "unknown_tool"`, and the reason the tool call was not executed. The bridge must not duplicate registered tool events.

9. **`ISessionOptions.onCompact`** -- Callback invoked when compaction occurs (auto or manual), receives the generated summary string.

10. **`ISessionOptions.compactInstructions`** -- Custom instructions for the compaction summary prompt (e.g., extracted from CLAUDE.md "Compact Instructions" section).

11. **`ISessionOptions.maxTurns`** -- Optional model/tool round cap passed to the underlying Robota run. Omitted means unlimited for the session layer.

12. **`ISessionOptions.autoCompactThreshold`** -- Optional automatic compaction threshold. A number is interpreted as a fraction of the context window; `false` disables automatic compaction.

13. **`SessionStore` constructor** -- Accept a custom `baseDir` to redirect storage location (useful in tests).

## Abort Behavior

The `Session` class supports aborting an in-progress `run()` call via `AbortController`.

### Mechanism

- `session.abort()` calls `AbortController.abort()` on the controller created for the current `run()` call.
- `session.isRunning()` returns `true` while a `run()` call is in progress.

### Session.run() Abort Flow

1. `Session.run()` creates an `AbortController` and passes `{ signal }` to `robota.run()`.
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

### Auto-Compaction

Auto-compaction triggers at the **start** of `run()` (before processing the user message) when `ContextWindowTracker.shouldAutoCompact()` returns true. This prevents compaction from interfering with the current response stream. The trigger defaults to 83.5% of the context window and can be configured per session or disabled with `autoCompactThreshold: false`.

`ContextWindowTracker.updateFromHistory()` delegates token estimation to `agent-core`'s shared context estimator. The tracker treats terminal provider usage as exact post-response state; when metadata-free messages follow the latest provider usage, it uses the maximum of serialized-history estimate, latest provider usage, and any future caller floor instead of summing all historical provider input counts. This keeps `/context`, status bars, automatic compaction, and core hard-capacity guards aligned on the same effective context state.

## Error Taxonomy

This package defines one custom error class: `CompactionError` (thrown when a compaction summary
is invalid — see Compaction Failure Contract). All other errors are thrown as standard `Error`
instances. Error scenarios include:

| Error Condition         | Thrown By                | Message Pattern                                                                                       |
| ----------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------- |
| Invalid compact summary | `CompactionOrchestrator` | Throws `CompactionError`; conversation history is preserved untouched                                 |
| Tool permission denied  | `PermissionEnforcer`     | Returns `IToolResult` with `"Permission denied"` (no throw)                                           |
| Hook blocked tool       | `PermissionEnforcer`     | Returns `IToolResult` with `"Blocked by hook: {reason}"`                                              |
| Tool execution error    | `PermissionEnforcer`     | Returns `IToolResult` with error message (never throws)                                               |
| Unknown tool call       | `ExecutionService`       | Returns a failed tool result with `errorCode: "unknown_tool"` and explains that execution was skipped |

The permission wrapper deliberately catches all errors and returns them as `IToolResult` objects to avoid corrupting the conversation history with unmatched tool_use/tool_result pairs.

### Session.run() Error Recovery

When `run()` encounters an error (e.g., from the execution loop or provider), the Session must:

1. **Log the error** — write an `error` event to the session logger with the error details
2. **Preserve history** — conversation history up to the point of failure remains intact
3. **Remain usable** — the session is not corrupted; the user can continue or retry
4. **Propagate the error** — re-throw after logging so the caller can handle it (e.g., display an error message)

## Class Contract Registry

### Interface Implementations

No formal interface implementations. `PermissionEnforcer`, `ContextWindowTracker`, `CompactionOrchestrator`, and `SessionStore` are standalone classes.

### Inheritance Chains

`Session extends SessionBase`. `SessionBase` (`session-base.ts`) is an abstract base that holds the shared session methods and live state, including the preset/model/parallel-subagent state (`getActivePresetId`/`setActivePresetId`, `getParallelSubagentsEnabled`/`setParallelSubagentsEnabled`, `applyModelOptions`); the concrete `Session` (`session.ts`) supplies the `robota`, `permissionEnforcer`, and other abstract members and adds the run loop. The remaining classes are standalone.

### Cross-Package Port Consumers

| Port (Owner)                      | Consumer Class           | Location                         |
| --------------------------------- | ------------------------ | -------------------------------- |
| `Robota` (agent-core)             | `Session`                | `src/session.ts`                 |
| `IAIProvider` (agent-core)        | `Session`                | `src/session.ts`                 |
| `evaluatePermission` (agent-core) | `PermissionEnforcer`     | `src/permission-enforcer.ts`     |
| `runHooks` (agent-core)           | `PermissionEnforcer`     | `src/permission-enforcer.ts`     |
| `runHooks` (agent-core)           | `Session`                | `src/session.ts` (PostCompact)   |
| `runHooks` (agent-core)           | `CompactionOrchestrator` | `src/compaction-orchestrator.ts` |

## Test Strategy

### Current Test Coverage

- **Session system prompt delivery** -- tests verifying the system prompt is passed to Robota as the single-source top-level `config.systemMessage`, and that `updateSystemMessage` propagates a live change to the next provider request via `Robota.updateSystemPrompt`.
- **Session provider callback isolation** -- 1 regression test verifying two sessions sharing one provider keep `onTextDelta` output isolated per run.

### Gaps

- **Session** -- permission mode switching, hook integration, and session persistence are untested.
- **PermissionEnforcer** -- `wrapTools()`, `checkPermission()`, session-scoped allow, tool truncation are untested.
- **ContextWindowTracker** -- `updateFromHistory()`, `shouldAutoCompact()`, metadata vs fallback estimation are untested.
- **CompactionOrchestrator** -- `compact()`, hook firing, prompt building are untested.
- **SessionStore** -- Covered by `agent-framework/src/__tests__/session-store.test.ts` (12 tests: save/load/list/delete/directory creation).
- **FileSessionLogger** -- `log()`, file creation, JSONL formatting, error handling on read-only paths are untested.
- **SilentSessionLogger** -- No-op behavior untested (trivial, low priority).
- All classes should be testable with mock `IAIProvider` and mock `ITerminalOutput` injections.

## Dependencies

### Production (2)

- `@robota-sdk/agent-core` -- Robota agent, permission system, hook system, core types
- `@robota-sdk/agent-interface-transport` -- SSOT for `ICompactEvent`/`TCompactTrigger` (imported/re-exported by `src/session-types.ts`)
