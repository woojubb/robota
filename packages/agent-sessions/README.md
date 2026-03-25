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
| **Context tracking**       | Token usage from provider metadata, auto-compact at ~83.5%                                             |
| **Compaction**             | LLM-generated conversation summary to free context space                                               |
| **Persistence**            | `SessionStore` for JSON file-based session save/load                                                   |
| **Abort**                  | Cancel via `session.abort()` — propagates AbortSignal to `robota.run()`, throws `AbortError` to caller |
| **Session logging**        | `FileSessionLogger` writes JSONL event logs                                                            |

## Key Methods

| Method                                            | Description                                              |
| ------------------------------------------------- | -------------------------------------------------------- |
| `run(message)`                                    | Send a message, returns AI response                      |
| `compact(instructions?)`                          | Compress conversation via LLM summary                    |
| `getContextState()`                               | Token usage: `{ usedTokens, maxTokens, usedPercentage }` |
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
| `TPermissionHandler`     | Type      | Custom permission approval callback                          |
| `TPermissionResult`      | Type      | Permission decision result (`boolean \| 'allow-session'`)    |
| `ITerminalOutput`        | Interface | Terminal I/O abstraction (write, prompt, select, spinner)    |
| `ISpinner`               | Interface | Spinner handle                                               |
| `ISessionLogger`         | Interface | Pluggable session event logger interface                     |
| `TSessionLogData`        | Type      | Structured log event data                                    |
| `ISessionRecord`         | Interface | Persisted session record shape                               |
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

## Assembly

Most users should use `createSession()` from `@robota-sdk/agent-sdk` instead of constructing `Session` directly. The SDK factory wires tools, provider, and system prompt automatically from config and context.

## Dependencies

- `@robota-sdk/agent-core` (production) — Robota agent, permission system, hook system, core types

## License

MIT
