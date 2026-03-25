# @robota-sdk/agent-sessions

Session lifecycle management for the Robota SDK. Wraps a `Robota` agent instance with permission-gated tool execution, hook-based lifecycle events, context window tracking, conversation compaction, and optional persistence.

## Installation

```bash
npm install @robota-sdk/agent-sessions
```

Peer dependency: `@robota-sdk/agent-core`

## Quick Start

```typescript
import { Session } from '@robota-sdk/agent-sessions';

// Session accepts pre-constructed tools, provider, and systemMessage
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

| Feature                    | Description                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Permission enforcement** | Tool calls gated by 3-step policy (deny list, allow list, mode policy)                                           |
| **Hook execution**         | PreToolUse, PostToolUse, PreCompact, PostCompact, SessionStart, Stop                                             |
| **Context tracking**       | Token usage from provider metadata, auto-compact at ~83.5%                                                       |
| **Compaction**             | LLM-generated conversation summary to free context space                                                         |
| **Persistence**            | `SessionStore` for JSON file-based session save/load                                                             |
| **Abort**                  | Cancel via AbortSignal — `session.abort()` propagates signal to `robota.run()` and checks `signal.aborted` after |
| **Session logging**        | `FileSessionLogger` writes JSONL event logs                                                                      |

## Key Methods

| Method                                            | Description                                              |
| ------------------------------------------------- | -------------------------------------------------------- |
| `run(message)`                                    | Send a message, returns AI response                      |
| `compact(instructions?)`                          | Compress conversation via LLM summary                    |
| `getContextState()`                               | Token usage: `{ usedTokens, maxTokens, usedPercentage }` |
| `getPermissionMode()` / `setPermissionMode(mode)` | Read/change permission mode                              |
| `getHistory()` / `clearHistory()`                 | Access or clear conversation history                     |
| `abort()`                                         | Cancel running execution                                 |
| `getSessionAllowedTools()`                        | Tools approved for this session                          |

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

## License

MIT
