# @robota-sdk/agent-sessions

Session lifecycle management for the Robota SDK. Wraps a `Robota` agent instance with permission-gated tool execution, hook-based lifecycle events, context window tracking, conversation compaction, and optional persistence.

## Installation

```bash
npm install @robota-sdk/agent-sessions @robota-sdk/agent-core
```

## Quick Start

```typescript
import { Session } from '@robota-sdk/agent-sessions';

const session = new Session({
  tools,
  provider,
  systemMessage: 'You are a helpful assistant.',
  terminal,
  permissions: { allow: ['Read(*)'], deny: [] },
  autoCompactThreshold: 0.75,
});

const response = await session.run('Hello!');

// Context tracking
const state = session.getContextState();
console.log(`${state.usedPercentage.toFixed(1)}% context used`);

// Manual compaction
await session.compact('Focus on the API changes');
```

## Features

| Feature                    | Description                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Permission enforcement** | Tool calls gated by 3-step policy (deny list, allow list, mode policy)                                 |
| **Hook execution**         | PreToolUse, PostToolUse, PreCompact, PostCompact, SessionStart, Stop                                   |
| **Context tracking**       | Token usage from provider metadata, configurable auto-compact threshold (default ~83.5%)               |
| **Compaction**             | LLM-generated conversation summary to free context space                                               |
| **Persistence**            | `SessionStore` for JSON file-based session save/load                                                   |
| **Abort**                  | Cancel via `session.abort()` — propagates AbortSignal to `robota.run()`, throws `AbortError` to caller |
| **Session logging**        | `FileSessionLogger` writes JSONL event logs                                                            |
| **Replay events**          | Provider/tool execution boundary events are forwarded from core into append-only session logs          |

## Key Methods

| Method                                            | Description                                              |
| ------------------------------------------------- | -------------------------------------------------------- |
| `constructor(options)` (with `sessionId`)         | Accepts optional `sessionId` for deterministic IDs       |
| `run(message)`                                    | Send a message, returns AI response                      |
| `injectMessage(message)`                          | Inject a message into history without running the agent  |
| `compact(instructions?)`                          | Compress conversation via LLM summary                    |
| `getContextState()`                               | Token usage: `{ usedTokens, maxTokens, usedPercentage }` |
| `getAutoCompactThreshold()`                       | Auto-compact threshold fraction, or `false` if disabled  |
| `getPermissionMode()` / `setPermissionMode(mode)` | Read/change permission mode                              |
| `getHistory()` / `clearHistory()`                 | Access or clear conversation history                     |
| `abort()`                                         | Cancel running execution                                 |
| `isRunning()`                                     | Returns true if a `run()` call is in progress            |
| `getSessionId()`                                  | Returns the stable session identifier                    |
| `getMessageCount()`                               | Returns the number of completed `run()` calls            |
| `getSessionAllowedTools()`                        | Tools approved for this session                          |
| `clearSessionAllowedTools()`                      | Clears all session-scoped allow rules                    |

## Public API Surface

| Export                   | Kind      | Description                                                  |
| ------------------------ | --------- | ------------------------------------------------------------ |
| `Session`                | Class     | Wraps Robota with permissions, hooks, streaming, persistence |
| `PermissionEnforcer`     | Class     | Tool permission checking, hook execution, output truncation  |
| `ContextWindowTracker`   | Class     | Token usage tracking and auto-compact threshold              |
| `CompactionOrchestrator` | Class     | Conversation compaction via LLM summary                      |
| `SessionStore`           | Class     | JSON file persistence for session records                    |
| `FileSessionLogger`      | Class     | JSONL file-based session event logger                        |
| `SilentSessionLogger`    | Class     | No-op session logger                                         |
| `ISessionOptions`        | Interface | Constructor options for Session                              |
| `TAutoCompactThreshold`  | Type      | Auto-compact threshold fraction, or `false` to disable       |
| `TPermissionHandler`     | Type      | Custom permission approval callback                          |
| `TPermissionResult`      | Type      | Permission decision result (`boolean \| 'allow-session'`)    |
| `ITerminalOutput`        | Interface | Terminal I/O abstraction (write, prompt, select, spinner)    |
| `ISpinner`               | Interface | Spinner handle                                               |
| `ISessionLogger`         | Interface | Pluggable session event logger interface                     |
| `TSessionLogData`        | Type      | Structured log event data                                    |
| `ISessionRecord`         | Interface | Persisted session record shape (includes `history` field)    |
| `IContextWindowState`    | Type      | Context window usage state (re-exported from agent-core)     |

Note: `IPermissionEnforcerOptions` is an internal type and is not exported from the public API.

## Sub-Components

| Component                | Purpose                                                             |
| ------------------------ | ------------------------------------------------------------------- |
| `PermissionEnforcer`     | Tool wrapping, permission checks, hook execution, output truncation |
| `ContextWindowTracker`   | Token usage tracking, auto-compact threshold                        |
| `CompactionOrchestrator` | Conversation summarization via LLM                                  |

## Session vs Robota

- **`Robota`** (agent-core): Raw agent — conversation + tools + plugins. No permissions, no hooks.
- **`Session`** (this package): Wraps Robota with permissions, hooks, compaction, and persistence. Used by the CLI and SDK.

### ISessionRecord

`ISessionRecord` includes a required `history` field (`IHistoryEntry[]`) that stores the full conversation timeline for session persistence, resume, and fork operations. It may also include `backgroundTasks` and `backgroundTaskEvents` so background work can be restored and debugged alongside the conversation. When a session is resumed, history entries are replayed via `Session.injectMessage()`.

Streaming text deltas are written to append-only JSONL session logs as `text_delta` events. Consumers should store high-frequency streaming chunks in JSONL logs/transcripts and keep session JSON focused on resumable snapshots and references.

### Replay-Oriented JSONL Events

`Session.run()` forwards core execution events into the session logger through `onExecutionEvent`. Current events include:

- `provider_request`
- `provider_response_normalized`
- `assistant_message_committed`
- `tool_batch_started`
- `tool_execution_request`
- `tool_execution_result`

These events provide provenance for debugging and future deterministic `/resume` replay. Full replay still requires raw provider payload/chunk storage, redaction rules, content-addressed payload references, history mutation events, and validator tooling.

A migration script is available for upgrading session records from older formats. See the package source for details.

## Assembly

Most users should use `createSession()` from `@robota-sdk/agent-sdk` instead of constructing `Session` directly. The SDK factory wires tools, provider, and system prompt automatically from config and context.

## Dependencies

- `@robota-sdk/agent-core` (production) — Robota agent, permission system, hook system, core types

## License

MIT
