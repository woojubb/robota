# Sessions Specification

## Scope

Owns the CLI session lifecycle for the Robota SDK. This package provides the `Session` class that wraps a `Robota` agent instance with project context loading, permission-gated tool execution, hook-based lifecycle events, and optional JSON file persistence via `SessionStore`. It is the primary entry point used by the CLI application (`agent-cli`) to conduct interactive AI conversations.

## Boundaries

- Does not own AI provider behavior. Defaults to `@robota-sdk/agent-provider-anthropic` but accepts any `IAIProvider` via injection.
- Does not own tool implementations. Consumes built-in tools from `@robota-sdk/agent-tools` and the permission/hook systems from `@robota-sdk/agent-core`.
- Does not own configuration resolution. Accepts a pre-resolved `IResolvedConfig` from the consuming application.
- Does not own the permission evaluation algorithm or hook execution engine. Those belong to `@robota-sdk/agent-core` (`evaluatePermission`, `runHooks`).
- Does not own system prompt building logic beyond a minimal fallback. The consuming application can inject a custom `systemPromptBuilder`.

## Architecture Overview

The package follows a flat structure:

```
session.ts        -- Session class: wraps Robota + permission checking + tool wiring + streaming + hooks
session-logger.ts -- ISessionLogger interface + FileSessionLogger / SilentSessionLogger implementations
session-store.ts  -- SessionStore: JSON file persistence for conversation sessions
```

**Design patterns used:**

- **Facade** -- `Session` hides Robota agent creation, tool registration, permission wiring, and hook execution behind a single `run()` method.
- **Decorator** -- Each tool is wrapped with a permission-checking proxy via `wrapToolWithPermission()` before being registered with the Robota agent.
- **Strategy (injected)** -- Permission approval can be handled by a `TPermissionHandler` callback, an injected `promptForApproval` function, or denied by default. The system prompt builder is also replaceable.
- **Null Object** -- When no `SessionStore` is provided, persistence is silently skipped.

**Dependency direction:**

- `@robota-sdk/agent-sessions` depends on `@robota-sdk/agent-core`, `@robota-sdk/agent-tools`, and `@robota-sdk/agent-provider-anthropic`.
- No reverse dependency exists.

## Type Ownership

Types owned by this package (SSOT):

| Type                  | Kind      | File               | Description                                                        |
| --------------------- | --------- | ------------------ | ------------------------------------------------------------------ |
| `ISessionOptions`     | Interface | `session.ts`       | Constructor options for Session (config, context, terminal, hooks) |
| `TPermissionHandler`  | Type      | `session.ts`       | Async callback `(toolName, toolArgs) => Promise<boolean>`          |
| `ITerminalOutput`     | Interface | `session.ts`       | Terminal I/O abstraction (write, prompt, select, spinner)          |
| `ISpinner`            | Interface | `session.ts`       | Spinner handle returned by `ITerminalOutput.spinner()`             |
| `IResolvedConfig`     | Interface | `session.ts`       | Resolved CLI configuration (provider, permissions, trust, env)     |
| `ILoadedContext`      | Interface | `session.ts`       | Loaded AGENTS.md / CLAUDE.md context                               |
| `IProjectInfo`        | Interface | `session.ts`       | Project metadata (type, language)                                  |
| `ISystemPromptParams` | Interface | `session.ts`       | Parameters for system prompt builder function                      |
| `ISessionRecord`      | Interface | `session-store.ts` | Persisted session record (id, cwd, timestamps, messages)           |

Types consumed from other packages (not owned here):

| Type                                                                    | Source                                 |
| ----------------------------------------------------------------------- | -------------------------------------- |
| `Robota`                                                                | `@robota-sdk/agent-core`               |
| `IAgentConfig`                                                          | `@robota-sdk/agent-core`               |
| `IAIProvider`                                                           | `@robota-sdk/agent-core`               |
| `TPermissionMode`                                                       | `@robota-sdk/agent-core`               |
| `TToolArgs`                                                             | `@robota-sdk/agent-core`               |
| `THooksConfig`                                                          | `@robota-sdk/agent-core`               |
| `IHookInput`                                                            | `@robota-sdk/agent-core`               |
| `evaluatePermission`                                                    | `@robota-sdk/agent-core`               |
| `runHooks`                                                              | `@robota-sdk/agent-core`               |
| `TRUST_TO_MODE`                                                         | `@robota-sdk/agent-core`               |
| `TUniversalMessage`                                                     | `@robota-sdk/agent-core`               |
| `AnthropicProvider`                                                     | `@robota-sdk/agent-provider-anthropic` |
| `bashTool`, `readTool`, `writeTool`, `editTool`, `globTool`, `grepTool` | `@robota-sdk/agent-tools`              |

## Public API Surface

| Export                | Kind      | Description                                                            |
| --------------------- | --------- | ---------------------------------------------------------------------- |
| `Session`             | Class     | Wraps Robota agent with permissions, hooks, streaming, and persistence |
| `SessionStore`        | Class     | JSON file persistence for session records (`~/.robota/sessions/`)      |
| `ISessionOptions`     | Interface | Constructor options for Session                                        |
| `TPermissionHandler`  | Type      | Custom permission approval callback                                    |
| `ITerminalOutput`     | Interface | Terminal I/O abstraction                                               |
| `ISpinner`            | Interface | Spinner handle                                                         |
| `IResolvedConfig`     | Interface | Resolved CLI configuration                                             |
| `ILoadedContext`      | Interface | Loaded project context                                                 |
| `IProjectInfo`        | Interface | Project metadata                                                       |
| `ISystemPromptParams` | Interface | System prompt builder parameters                                       |
| `ISessionRecord`      | Interface | Persisted session record shape                                         |

### Key Session Methods

| Method                     | Signature                                  | Description                                                                  |
| -------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| `run`                      | `(message: string) => Promise<string>`     | Send a message; returns AI response. Persists session if store exists.       |
| `getPermissionMode`        | `() => TPermissionMode`                    | Returns the active permission mode.                                          |
| `setPermissionMode`        | `(mode: TPermissionMode) => void`          | Changes the permission mode for future tool calls.                           |
| `getSessionId`             | `() => string`                             | Returns the stable session identifier.                                       |
| `getMessageCount`          | `() => number`                             | Returns the number of completed `run()` calls.                               |
| `checkPermission`          | `(toolName, toolArgs) => Promise<boolean>` | Evaluates permission and prompts if needed. Used internally.                 |
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

1. **`ISessionOptions.provider`** -- Inject a custom `IAIProvider` to replace the default Anthropic provider (used in tests with mock providers).

2. **`ISessionOptions.permissionHandler`** -- Inject a custom permission approval callback (used by Ink-based UI to show approval prompts in React components).

3. **`ISessionOptions.promptForApproval`** -- Alternative approval function that receives the terminal handle.

4. **`ISessionOptions.systemPromptBuilder`** -- Replace the default system prompt builder with a custom implementation (injected from `agent-sdk`).

5. **`ISessionOptions.onTextDelta`** -- Streaming callback for real-time text output to the UI.

6. **`ISessionOptions.additionalTools`** -- Register additional tools beyond the 6 built-ins (e.g., agent-tool from `agent-sdk`).

7. **`ISessionOptions.onCompact`** -- Callback invoked when compaction occurs (auto or manual), receives the generated summary string.

8. **`ISessionOptions.compactInstructions`** -- Custom instructions for the compaction summary prompt (e.g., extracted from CLAUDE.md "Compact Instructions" section).

9. **`SessionStore` constructor** -- Accept a custom `baseDir` to redirect storage location (useful in tests).

## Error Taxonomy

This package does not define a custom error hierarchy. All errors are thrown as standard `Error` instances. Error scenarios include:

| Error Condition        | Thrown By                | Message Pattern                                             |
| ---------------------- | ------------------------ | ----------------------------------------------------------- |
| Missing API key        | `Session` constructor    | `"ANTHROPIC_API_KEY is not set..."`                         |
| Tool permission denied | `wrapToolWithPermission` | Returns `IToolResult` with `"Permission denied"` (no throw) |
| Hook blocked tool      | `wrapToolWithPermission` | Returns `IToolResult` with `"Blocked by hook: {reason}"`    |
| Tool execution error   | `wrapToolWithPermission` | Returns `IToolResult` with error message (never throws)     |

The permission wrapper deliberately catches all errors and returns them as `IToolResult` objects to avoid corrupting the conversation history with unmatched tool_use/tool_result pairs.

## Class Contract Registry

### Interface Implementations

No formal interface implementations. `Session` and `SessionStore` are standalone classes.

### Inheritance Chains

None. Classes are standalone.

### Cross-Package Port Consumers

| Port (Owner)                                   | Consumer Class | Location         |
| ---------------------------------------------- | -------------- | ---------------- |
| `Robota` (agent-core)                          | `Session`      | `src/session.ts` |
| `IAIProvider` (agent-core)                     | `Session`      | `src/session.ts` |
| `evaluatePermission` (agent-core)              | `Session`      | `src/session.ts` |
| `runHooks` (agent-core)                        | `Session`      | `src/session.ts` |
| `AnthropicProvider` (agent-provider-anthropic) | `Session`      | `src/session.ts` |
| Built-in tools (agent-tools)                   | `Session`      | `src/session.ts` |

## Test Strategy

### Current Test Coverage

No dedicated unit tests exist yet for the new `Session` and `SessionStore` classes.

### Gaps

- **Session** -- `run()`, `checkPermission()`, `wrapToolWithPermission()`, permission mode switching, hook integration, streaming callback wiring, and session persistence are untested.
- **SessionStore** -- `save()`, `load()`, `list()`, `delete()`, directory creation, and malformed file handling are untested.
- Both classes should be testable with mock `IAIProvider` and mock `ITerminalOutput` injections.

## Dependencies

### Production (3)

- `@robota-sdk/agent-core` -- Robota agent, permission system, hook system, core types
- `@robota-sdk/agent-tools` -- Built-in CLI tools (bash, read, write, edit, glob, grep)
- `@robota-sdk/agent-provider-anthropic` -- Default AI provider (Anthropic Claude)
