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

| Type                         | Kind      | File                         | Description                                                         |
| ---------------------------- | --------- | ---------------------------- | ------------------------------------------------------------------- |
| `ISessionOptions`            | Interface | `session.ts`                 | Constructor options for Session (tools, provider, systemMessage)    |
| `TPermissionHandler`         | Type      | `permission-enforcer.ts`     | Async callback `(toolName, toolArgs) => Promise<TPermissionResult>` |
| `TPermissionResult`          | Type      | `permission-enforcer.ts`     | `boolean \| 'allow-session'`                                        |
| `ITerminalOutput`            | Interface | `permission-enforcer.ts`     | Terminal I/O abstraction (write, prompt, select, spinner)           |
| `ISpinner`                   | Interface | `permission-enforcer.ts`     | Spinner handle returned by `ITerminalOutput.spinner()`              |
| `IPermissionEnforcerOptions` | Interface | `permission-enforcer.ts`     | Options for constructing PermissionEnforcer                         |
| `ICompactionOptions`         | Interface | `compaction-orchestrator.ts` | Options for constructing CompactionOrchestrator                     |
| `ISessionLogger`             | Interface | `session-logger.ts`          | Pluggable session event logger interface                            |
| `TSessionLogData`            | Type      | `session-logger.ts`          | Structured log event data (`Record<string, unknown>`)               |
| `ISessionRecord`             | Interface | `session-store.ts`           | Persisted session record (id, cwd, timestamps, messages)            |

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

## Public API Surface

| Export                   | Kind      | Description                                                            |
| ------------------------ | --------- | ---------------------------------------------------------------------- |
| `Session`                | Class     | Wraps Robota agent with permissions, hooks, streaming, and persistence |
| `PermissionEnforcer`     | Class     | Tool permission checking, hook execution, output truncation            |
| `ContextWindowTracker`   | Class     | Token usage tracking and auto-compact threshold                        |
| `CompactionOrchestrator` | Class     | Conversation compaction via LLM summary                                |
| `SessionStore`           | Class     | JSON file persistence for session records (`~/.robota/sessions/`)      |
| `FileSessionLogger`      | Class     | JSONL file-based session event logger                                  |
| `SilentSessionLogger`    | Class     | No-op session logger                                                   |
| `ISessionOptions`        | Interface | Constructor options for Session                                        |
| `TPermissionHandler`     | Type      | Custom permission approval callback                                    |
| `TPermissionResult`      | Type      | Permission decision result                                             |
| `ITerminalOutput`        | Interface | Terminal I/O abstraction                                               |
| `ISpinner`               | Interface | Spinner handle                                                         |
| `ISessionLogger`         | Interface | Pluggable session event logger interface                               |
| `TSessionLogData`        | Type      | Structured log event data                                              |
| `ISessionRecord`         | Interface | Persisted session record shape                                         |
| `IContextWindowState`    | Type      | Context window usage state (re-exported from agent-core)               |

### Key Session Methods

| Method                     | Signature                                  | Description                                                                  |
| -------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| `run`                      | `(message: string) => Promise<string>`     | Send a message; returns AI response. Persists session if store exists.       |
| `getPermissionMode`        | `() => TPermissionMode`                    | Returns the active permission mode.                                          |
| `setPermissionMode`        | `(mode: TPermissionMode) => void`          | Changes the permission mode for future tool calls.                           |
| `getSessionId`             | `() => string`                             | Returns the stable session identifier.                                       |
| `getMessageCount`          | `() => number`                             | Returns the number of completed `run()` calls.                               |
| `clearHistory`             | `() => void`                               | Clears the underlying Robota conversation history and resets token usage.    |
| `getHistory`               | `() => TUniversalMessage[]`                | Returns the current conversation history.                                    |
| `getContextState`          | `() => IContextWindowState`                | Returns real-time context window usage (tokens, percentage).                 |
| `compact`                  | `(instructions?: string) => Promise<void>` | Compresses conversation via LLM summary. Fires PreCompact/PostCompact hooks. |
| `abort`                    | `() => void`                               | Cancels the currently running `run()` call. No-op if not running.            |
| `isRunning`                | `() => boolean`                            | Returns true if a `run()` call is in progress.                               |
| `getSessionAllowedTools`   | `() => string[]`                           | Returns tools that were session-approved ("Allow always").                   |
| `clearSessionAllowedTools` | `() => void`                               | Clears all session-scoped allow rules.                                       |

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

1. **`ISessionOptions.tools`** -- Inject any set of `IToolWithEventService[]`. The consuming layer (agent-sdk) provides the default 8 tools + agent-tool.

2. **`ISessionOptions.provider`** -- Inject any `IAIProvider`. The consuming layer (agent-sdk) creates the appropriate provider from config.

3. **`ISessionOptions.systemMessage`** -- Inject the pre-built system prompt string. The consuming layer (agent-sdk) builds this from AGENTS.md, CLAUDE.md, tool descriptions, and trust level.

4. **`ISessionOptions.permissionHandler`** -- Inject a custom permission approval callback (used by Ink-based UI to show approval prompts in React components).

5. **`ISessionOptions.promptForApproval`** -- Alternative approval function that receives the terminal handle.

6. **`ISessionOptions.onTextDelta`** -- Streaming callback for real-time text output to the UI.

7. **`ISessionOptions.onCompact`** -- Callback invoked when compaction occurs (auto or manual), receives the generated summary string.

8. **`ISessionOptions.compactInstructions`** -- Custom instructions for the compaction summary prompt (e.g., extracted from CLAUDE.md "Compact Instructions" section).

9. **`SessionStore` constructor** -- Accept a custom `baseDir` to redirect storage location (useful in tests).

## Error Taxonomy

This package does not define a custom error hierarchy. All errors are thrown as standard `Error` instances. Error scenarios include:

| Error Condition        | Thrown By            | Message Pattern                                             |
| ---------------------- | -------------------- | ----------------------------------------------------------- |
| Tool permission denied | `PermissionEnforcer` | Returns `IToolResult` with `"Permission denied"` (no throw) |
| Hook blocked tool      | `PermissionEnforcer` | Returns `IToolResult` with `"Blocked by hook: {reason}"`    |
| Tool execution error   | `PermissionEnforcer` | Returns `IToolResult` with error message (never throws)     |

The permission wrapper deliberately catches all errors and returns them as `IToolResult` objects to avoid corrupting the conversation history with unmatched tool_use/tool_result pairs.

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
- All classes should be testable with mock `IAIProvider` and mock `ITerminalOutput` injections.

## Dependencies

### Production (1)

- `@robota-sdk/agent-core` -- Robota agent, permission system, hook system, core types
