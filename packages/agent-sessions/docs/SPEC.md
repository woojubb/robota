# Sessions Specification

## Scope

Owns the CLI session lifecycle for the Robota SDK. This package provides the `Session` class that wraps a `Robota` agent instance with permission-gated tool execution, hook-based lifecycle events, context window tracking, conversation compaction, and optional JSON file persistence via `SessionStore`. It is the primary runtime used by the CLI application (`agent-cli`) via the assembly layer (`agent-sdk`).

## Boundaries

- Does not own AI provider creation. Accepts a pre-constructed `IAIProvider` via injection.
- Does not own tool implementations. Accepts pre-constructed `IToolWithEventService[]` via injection.
- Does not own system prompt building. Accepts a pre-built `systemMessage` string.
- Does not own configuration resolution or context loading. Those belong to `agent-sdk`.
- Does not own the permission evaluation algorithm or hook execution engine. Those belong to `@robota-sdk/agent-core` (`evaluatePermission`, `runHooks`).

## Architecture Overview

The package follows a modular structure with Session delegating to focused sub-components:

```
session.ts                -- Session class: orchestrates run loop, delegates to sub-components
permission-enforcer.ts    -- PermissionEnforcer: tool wrapping, permission checks, hooks, truncation
context-window-tracker.ts -- ContextWindowTracker: token usage tracking, auto-compact threshold
compaction-orchestrator.ts -- CompactionOrchestrator: conversation summarization via LLM
session-logger.ts         -- ISessionLogger interface + FileSessionLogger / SilentSessionLogger
session-store.ts          -- SessionStore: JSON file persistence for conversation sessions
```

**Design patterns used:**

- **Facade** -- `Session` hides Robota agent creation, tool registration, permission wiring, and hook execution behind a single `run()` method.
- **Decorator** -- Each tool is wrapped with a permission-checking proxy via `PermissionEnforcer.wrapTools()` before being registered with the Robota agent.
- **Strategy (injected)** -- Permission approval can be handled by a `TPermissionHandler` callback, an injected `promptForApproval` function, or denied by default.
- **Composition** -- Session delegates to PermissionEnforcer, ContextWindowTracker, and CompactionOrchestrator rather than implementing everything inline.
- **Null Object** -- When no `SessionStore` is provided, persistence is silently skipped.

**Dependency direction:**

- `@robota-sdk/agent-sessions` depends on `@robota-sdk/agent-core` only.
- No dependency on `@robota-sdk/agent-tools` or `@robota-sdk/agent-provider-anthropic`.
- Tool and provider assembly is the responsibility of the consuming layer (`agent-sdk`).

## Type Ownership

Types owned by this package (SSOT):

| Type                         | Kind      | File                         | Description                                                                          |
| ---------------------------- | --------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| `ISessionOptions`            | Interface | `session.ts`                 | Constructor options for Session (tools, provider, systemMessage, optional sessionId) |
| `TPermissionHandler`         | Type      | `permission-enforcer.ts`     | Async callback `(toolName, toolArgs) => Promise<TPermissionResult>`                  |
| `TPermissionResult`          | Type      | `permission-enforcer.ts`     | `boolean \| 'allow-session'`                                                         |
| `ITerminalOutput`            | Interface | `permission-enforcer.ts`     | Terminal I/O abstraction (write, prompt, select, spinner)                            |
| `ISpinner`                   | Interface | `permission-enforcer.ts`     | Spinner handle returned by `ITerminalOutput.spinner()`                               |
| `IPermissionEnforcerOptions` | Interface | `permission-enforcer.ts`     | Options for constructing PermissionEnforcer                                          |
| `ICompactionOptions`         | Interface | `compaction-orchestrator.ts` | Options for constructing CompactionOrchestrator                                      |
| `ISessionLogger`             | Interface | `session-logger.ts`          | Pluggable session event logger interface                                             |
| `TSessionLogData`            | Type      | `session-logger.ts`          | Structured log event data (`Record<string, string \| number \| boolean \| object>`)  |
| `ISessionRecord`             | Interface | `session-store.ts`           | Persisted session record (id, cwd, timestamps, messages, history)                    |

Types consumed from other packages (not owned here):

| Type                    | Source                   |
| ----------------------- | ------------------------ |
| `Robota`                | `@robota-sdk/agent-core` |
| `IAgentConfig`          | `@robota-sdk/agent-core` |
| `IAIProvider`           | `@robota-sdk/agent-core` |
| `IToolWithEventService` | `@robota-sdk/agent-core` |
| `TPermissionMode`       | `@robota-sdk/agent-core` |
| `TToolArgs`             | `@robota-sdk/agent-core` |
| `THooksConfig`          | `@robota-sdk/agent-core` |
| `IHookInput`            | `@robota-sdk/agent-core` |
| `evaluatePermission`    | `@robota-sdk/agent-core` |
| `runHooks`              | `@robota-sdk/agent-core` |
| `TRUST_TO_MODE`         | `@robota-sdk/agent-core` |
| `TUniversalMessage`     | `@robota-sdk/agent-core` |
| `IHistoryEntry`         | `@robota-sdk/agent-core` |

## Public API Surface

| Export                           | Kind                 | Description                                                                                                    |
| -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Session`                        | Class                | Wraps Robota agent with permissions, hooks, streaming, and persistence                                         |
| `PermissionEnforcer`             | Class                | Tool permission checking, hook execution, output truncation                                                    |
| `ContextWindowTracker`           | Class                | Token usage tracking and auto-compact threshold                                                                |
| `CompactionOrchestrator`         | Class                | Conversation compaction via LLM summary                                                                        |
| `SessionStore`                   | Class                | JSON file persistence for session records (`~/.robota/sessions/`)                                              |
| `FileSessionLogger`              | Class                | JSONL file-based session event logger                                                                          |
| `SilentSessionLogger`            | Class                | No-op session logger                                                                                           |
| `ISessionOptions`                | Interface            | Constructor options for Session                                                                                |
| `TPermissionHandler`             | Type                 | Custom permission approval callback                                                                            |
| `TPermissionResult`              | Type                 | Permission decision result                                                                                     |
| `ITerminalOutput`                | Interface            | Terminal I/O abstraction                                                                                       |
| `ISpinner`                       | Interface            | Spinner handle                                                                                                 |
| ~~`IPermissionEnforcerOptions`~~ | Interface (internal) | Options for constructing `PermissionEnforcer` — **not exported** from `src/index.ts`. Internal to the package. |
| `ISessionLogger`                 | Interface            | Pluggable session event logger interface                                                                       |
| `TSessionLogData`                | Type                 | Structured log event data                                                                                      |
| `ISessionRecord`                 | Interface            | Persisted session record shape                                                                                 |
| `IContextWindowState`            | Type                 | Context window usage state (re-exported from agent-core)                                                       |

### Session Constructor — sessionId Parameter

`ISessionOptions.sessionId` is an optional parameter. When provided, the Session reuses that ID (resume mode). When omitted, a fresh UUID is generated (fork mode, default). This allows the consuming layer to control whether a resumed session continues under the same file or creates a new one.

### Key Session Methods

| Method                     | Signature                                  | Description                                                                                                                             |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `run`                      | `(message: string) => Promise<string>`     | Send a message; returns AI response. Persists session if store exists.                                                                  |
| `getPermissionMode`        | `() => TPermissionMode`                    | Returns the active permission mode.                                                                                                     |
| `setPermissionMode`        | `(mode: TPermissionMode) => void`          | Changes the permission mode for future tool calls.                                                                                      |
| `getSessionId`             | `() => string`                             | Returns the stable session identifier.                                                                                                  |
| `getMessageCount`          | `() => number`                             | Returns the number of completed `run()` calls.                                                                                          |
| `clearHistory`             | `() => void`                               | Clears the underlying Robota conversation history and resets token usage.                                                               |
| `getHistory`               | `() => TUniversalMessage[]`                | Returns the current conversation history as `TUniversalMessage[]` (chat entries only). Unchanged.                                       |
| `getFullHistory`           | `() => IHistoryEntry[]`                    | Returns the full history as `IHistoryEntry[]`, including both chat messages and event entries (e.g., tool summaries).                   |
| `addHistoryEntry`          | `(entry: IHistoryEntry) => void`           | Appends a pre-built `IHistoryEntry` (e.g., a tool-summary event entry) to the session history via `ConversationStore.addEntry()`.       |
| `getContextState`          | `() => IContextWindowState`                | Returns real-time context window usage (tokens, percentage).                                                                            |
| `compact`                  | `(instructions?: string) => Promise<void>` | Compresses conversation via LLM summary. System message is preserved across compaction (see below). Fires PreCompact/PostCompact hooks. |
| `abort`                    | `() => void`                               | Cancels the currently running `run()` call. No-op if not running.                                                                       |
| `isRunning`                | `() => boolean`                            | Returns true if a `run()` call is in progress.                                                                                          |
| `getSessionAllowedTools`   | `() => string[]`                           | Returns tools that were session-approved ("Allow always").                                                                              |
| `clearSessionAllowedTools` | `() => void`                               | Clears all session-scoped allow rules.                                                                                                  |
| `injectMessage`            | `(role: string, content: string) => void`  | Injects a message into conversation history without triggering an AI response. Used for restoring context on session resume.            |

### ISessionRecord Fields

| Field       | Type        | Required | Description                                                                                                                                              |
| ----------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | `string`    | Yes      | Unique session identifier                                                                                                                                |
| `cwd`       | `string`    | Yes      | Working directory where the session was created                                                                                                          |
| `name`      | `string`    | No       | User-assigned session name for easy identification                                                                                                       |
| `createdAt` | `string`    | Yes      | ISO timestamp of session creation                                                                                                                        |
| `updatedAt` | `string`    | Yes      | ISO timestamp of last update                                                                                                                             |
| `messages`  | `unknown[]` | Yes      | AI provider messages (TUniversalMessage[]) for context restoration. Saved from `session.getHistory()`, replayed via `session.injectMessage()` on resume. |
| `history`   | `unknown[]` | No       | Full UI timeline (IHistoryEntry[] — chat + events) for rendering restoration. Passed to TuiStateManager on resume.                                       |

### Key SessionStore Methods

| Method   | Signature                                     | Description                                                    |
| -------- | --------------------------------------------- | -------------------------------------------------------------- |
| `save`   | `(session: ISessionRecord) => void`           | Persist a session record to disk. Creates directory if needed. |
| `load`   | `(id: string) => ISessionRecord \| undefined` | Load a session by ID. Returns undefined if not found.          |
| `list`   | `() => ISessionRecord[]`                      | List all sessions, sorted by updatedAt descending.             |
| `delete` | `(id: string) => void`                        | Delete a session file. No-ops if not found.                    |

## Session Logging

The session log records structured events to a JSONL file for diagnostics and replay:

- **`server_tool` event** -- Recorded when a server-managed tool (e.g., web search) executes during streaming. Includes the tool name and query.
- **`pre_run` event** -- Recorded at the start of each `run()` call. Includes the provider name and `webToolsEnabled` flag.
- **`assistant` event** -- Recorded after each assistant response. Includes `historyStructure`: an array with per-message metadata (role, contentLength, hasToolCalls, toolCallNames, metadata).
- **`onServerToolUse` callback wiring** -- When session logging is enabled, the `onServerToolUse` callback from the provider is automatically wired to emit `server_tool` log events.

## Extension Points

1. **`ISessionOptions.terminal`** (required) -- Inject an `ITerminalOutput` implementation for permission prompts and UI output. The consuming layer provides either a real terminal (CLI print mode) or an Ink-based no-op (TUI mode).

2. **`ISessionOptions.tools`** -- Inject any set of `IToolWithEventService[]`. The consuming layer (agent-sdk) provides the default 8 tools + agent-tool.

3. **`ISessionOptions.provider`** -- Inject any `IAIProvider`. The consuming layer (agent-sdk) creates the appropriate provider from config.

4. **`ISessionOptions.systemMessage`** -- Inject the pre-built system prompt string. The consuming layer (agent-sdk) builds this from AGENTS.md, CLAUDE.md, tool descriptions, and trust level.

5. **`ISessionOptions.permissionHandler`** -- Inject a custom permission approval callback (used by Ink-based UI to show approval prompts in React components).

6. **`ISessionOptions.promptForApproval`** -- Alternative approval function that receives the terminal handle.

7. **`ISessionOptions.onTextDelta`** -- Streaming callback for real-time text output to the UI.

8. **`ISessionOptions.onToolExecution`** -- Callback for real-time tool execution events. Fires `{ type: 'start', toolName }` when a tool begins and `{ type: 'end', toolName, success }` when it completes. Wired through `PermissionEnforcer.wrapToolWithPermission()`.

9. **`ISessionOptions.onCompact`** -- Callback invoked when compaction occurs (auto or manual), receives the generated summary string.

10. **`ISessionOptions.compactInstructions`** -- Custom instructions for the compaction summary prompt (e.g., extracted from CLAUDE.md "Compact Instructions" section).

11. **`SessionStore` constructor** -- Accept a custom `baseDir` to redirect storage location (useful in tests).

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

### Auto-Compaction

Auto-compaction triggers at the **start** of `run()` (before processing the user message) when `ContextWindowTracker.shouldAutoCompact()` returns true. This prevents compaction from interfering with the current response stream.

## Error Taxonomy

This package does not define a custom error hierarchy. All errors are thrown as standard `Error` instances. Error scenarios include:

| Error Condition        | Thrown By            | Message Pattern                                             |
| ---------------------- | -------------------- | ----------------------------------------------------------- |
| Tool permission denied | `PermissionEnforcer` | Returns `IToolResult` with `"Permission denied"` (no throw) |
| Hook blocked tool      | `PermissionEnforcer` | Returns `IToolResult` with `"Blocked by hook: {reason}"`    |
| Tool execution error   | `PermissionEnforcer` | Returns `IToolResult` with error message (never throws)     |

The permission wrapper deliberately catches all errors and returns them as `IToolResult` objects to avoid corrupting the conversation history with unmatched tool_use/tool_result pairs.

### Session.run() Error Recovery

When `run()` encounters an error (e.g., from the execution loop or provider), the Session must:

1. **Log the error** — write an `error` event to the session logger with the error details
2. **Preserve history** — conversation history up to the point of failure remains intact
3. **Remain usable** — the session is not corrupted; the user can continue or retry
4. **Propagate the error** — re-throw after logging so the caller can handle it (e.g., display an error message)

## Class Contract Registry

### Interface Implementations

No formal interface implementations. `Session`, `PermissionEnforcer`, `ContextWindowTracker`, `CompactionOrchestrator`, and `SessionStore` are standalone classes.

### Inheritance Chains

None. Classes are standalone.

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

- **Session system prompt delivery** -- 6 tests verifying system prompt is passed to Robota at both top-level and defaultModel.

### Gaps

- **Session** -- `run()`, permission mode switching, hook integration, streaming callback wiring, and session persistence are untested.
- **PermissionEnforcer** -- `wrapTools()`, `checkPermission()`, session-scoped allow, tool truncation are untested.
- **ContextWindowTracker** -- `updateFromHistory()`, `shouldAutoCompact()`, metadata vs fallback estimation are untested.
- **CompactionOrchestrator** -- `compact()`, hook firing, prompt building are untested.
- **SessionStore** -- Covered by `agent-sdk/src/__tests__/session-store.test.ts` (12 tests: save/load/list/delete/directory creation).
- **FileSessionLogger** -- `log()`, file creation, JSONL formatting, error handling on read-only paths are untested.
- **SilentSessionLogger** -- No-op behavior untested (trivial, low priority).
- All classes should be testable with mock `IAIProvider` and mock `ITerminalOutput` injections.

## Dependencies

### Production (1)

- `@robota-sdk/agent-core` -- Robota agent, permission system, hook system, core types
