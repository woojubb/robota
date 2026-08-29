# @robota-sdk/agent-session

Session lifecycle management for the Robota SDK. Wraps a `Robota` agent instance with permission-gated tool execution, hook-based lifecycle events, context window tracking, conversation compaction, and optional persistence.

## Installation

```bash
npm install @robota-sdk/agent-session @robota-sdk/agent-core
```

## Quick Start

```typescript
import { Session } from '@robota-sdk/agent-session';
import type { IAIProvider, IToolWithEventService, ITerminalOutput } from '@robota-sdk/agent-core';

declare const tools: IToolWithEventService[];
declare const provider: IAIProvider;
declare const terminal: ITerminalOutput;

const session = new Session({
  tools,
  provider,
  systemMessage: 'You are a helpful assistant.',
  terminal,
  // ARCH-010: required. The session's execution root feeds every hook input, CLAUDE_PROJECT_DIR, the
  // permission root and the persisted record — it is not read from the process any more, so a
  // subagent runs in its own workspace rather than its parent's.
  cwd: process.cwd(),
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

| Feature                    | Description                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Permission enforcement** | Tool calls gated by 3-step policy (deny list, allow list, mode policy)                                                             |
| **Hook execution**         | PreToolUse, PostToolUse, PreCompact, PostCompact, SessionStart, Stop                                                               |
| **Context tracking**       | Effective token usage from the shared core estimator, configurable auto-compact threshold (default ~83.5%)                         |
| **Compaction**             | LLM-generated conversation summary to free context space; an invalid summary throws `CompactionError` and leaves history untouched |
| **Persistence**            | `IInteractiveSessionStore` injection; explicit `NodeSessionStore` host adapter uses atomic temp-file + rename writes               |
| **Abort**                  | Cancel via `session.abort()` — propagates AbortSignal to `robota.run()`, throws `AbortError` to caller                             |
| **One turn at a time**     | A concurrent `run()` is refused with `SessionBusyError` (RUNTIME-003); `isRunning()` is authoritative — see SPEC § Turn Identity   |
| **Session logging**        | `FileSessionLogger` writes JSONL through an injected neutral sink; `NodeSessionLogSink` is the explicit host adapter               |
| **Replay events**          | Provider/tool execution boundary events are forwarded from core into append-only session logs                                      |
| **Provider capabilities**  | Generic native web capability setup is requested through the provider contract, not provider-name branches                         |

## Key Methods

| Method                                            | Description                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `constructor(options)` (with `sessionId`)         | Accepts optional `sessionId` for deterministic IDs                      |
| `run(message)`                                    | Send a message, returns AI response                                     |
| `injectMessage(message)`                          | Inject a message into history without running the agent                 |
| `compact(instructions?)`                          | Compress conversation via LLM summary                                   |
| `getContextState()`                               | Effective token usage: `{ usedTokens, maxTokens, usedPercentage }`      |
| `getAutoCompactThreshold()`                       | Auto-compact threshold fraction, or `false` if disabled                 |
| `getPermissionMode()` / `setPermissionMode(mode)` | Read/change permission mode                                             |
| `getHistory()` / `clearHistory()`                 | Access or clear conversation history                                    |
| `abort()`                                         | Signal the running turn to stop (it holds the session until it unwinds) |
| `isRunning()`                                     | True while a turn is in flight, including one aborted and unwinding     |
| `getSessionId()`                                  | Returns the stable session identifier                                   |
| `getMessageCount()`                               | Returns the number of completed `run()` calls                           |
| `getSessionAllowedTools()`                        | Tools approved for this session                                         |
| `clearSessionAllowedTools()`                      | Clears all session-scoped allow rules                                   |

## Public API Surface

| Export                                     | Kind      | Description                                                                |
| ------------------------------------------ | --------- | -------------------------------------------------------------------------- |
| `Session`                                  | Class     | Wraps Robota with permissions, hooks, streaming, persistence               |
| `PermissionEnforcer`                       | Class     | Tool permission checking, hook execution, output truncation                |
| `ContextWindowTracker`                     | Class     | Effective token usage tracking and auto-compact threshold                  |
| `CompactionOrchestrator`                   | Class     | Conversation compaction via LLM summary                                    |
| `NodeSessionStore`                         | Class     | Explicit host-filesystem JSON persistence adapter                          |
| `FileSessionLogger`                        | Class     | Sink-driven JSONL session event logger                                     |
| `NodeSessionLogSource`                     | Class     | Explicit host adapter for a JSONL log and relative payload sidecars        |
| `NodeSessionLogSink`                       | Class     | Explicit host adapter for JSONL append and payload sidecars                |
| `NodeExternalPayloadSource`                | Class     | Linux stable-handle host adapter for budget-bounded sidecar reads          |
| `createSessionLogExternalPayloadReference` | Function  | Validates and constructs the canonical content-addressed sidecar reference |
| `SilentSessionLogger`                      | Class     | No-op session logger                                                       |
| `ISessionOptions`                          | Interface | Constructor options for Session                                            |
| `TAutoCompactThreshold`                    | Type      | Auto-compact threshold fraction, or `false` to disable                     |
| `TPermissionHandler`                       | Type      | Custom permission approval callback                                        |
| `TPermissionResult`                        | Type      | Permission decision result (`boolean \| 'allow-session'`)                  |
| `ITerminalOutput`                          | Interface | Terminal I/O abstraction (write, prompt, select, spinner)                  |
| `ISpinner`                                 | Interface | Spinner handle                                                             |
| `ISessionLogger`                           | Interface | Pluggable session event logger interface                                   |
| `TSessionLogData`                          | Type      | Structured log event data                                                  |
| `resolveSessionLogExternalPayloads`        | Function  | Bounded, integrity-checked hydration of JSON sidecar references            |
| `SessionLogPayloadResolutionError`         | Class     | Typed sidecar resolution failure with a stable error code                  |
| `IInteractiveSessionRecord`                | Interface | Canonical persisted session record (owned by agent-interface-transport)    |
| `IInteractiveSessionStore`                 | Interface | Canonical persistence port implemented by `NodeSessionStore`               |
| `ISessionLogSource` / `ISessionLogSink`    | Interface | Neutral log read/write ports used by framework authority adapters          |
| `ISessionRecord` / `ISessionStore`         | Type      | Compatibility-only renamed re-exports of the canonical contracts           |
| `IContextWindowState`                      | Type      | Context window usage state (re-exported from agent-core)                   |

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

### Interactive session record

`IInteractiveSessionRecord` is owned by `@robota-sdk/agent-interface-transport` and carries the full conversation and resumable state. `NodeSessionStore` persists this record without inspecting its payload. It is a conspicuously named host adapter: passing a directory does not establish workspace trust. Framework project composition instead adapts an accepted project-authority state facet to the same neutral store port. When a raw `Session` re-saves an existing record, it preserves fields it does not own and refreshes only its live conversation, history, prompt, schema, path, and timestamp fields.

Session-log parsing is source-driven. `loadSessionLogEntries(source)` consumes an explicit
`ISessionLogSource`; it never converts a filename into filesystem authority. Use
`NodeSessionLogSource` only when the application deliberately owns the host path, or provide a
framework authority-backed source for project logs. Empty or whitespace-only Node log paths are
rejected before sidecar authority is derived. Stable no-follow sidecar reads are currently available
only on Linux; macOS and Windows fail closed pending
[ARCH-049](../../.agents/tasks/completed/ARCH-049-cross-platform-stable-external-payload-replay.md).

Streaming text deltas are written to append-only JSONL session logs as `text_delta` events. Consumers should store high-frequency streaming chunks in JSONL logs/transcripts and keep session JSON focused on resumable snapshots and references.

### Replay-Oriented JSONL Events

`Session.run()` forwards core execution events into the session logger through `onExecutionEvent`. Current events include:

- `provider_request`
- `provider_native_raw_payload`
- `provider_stream_raw_delta`
- `provider_response_raw`
- `provider_response_normalized`
- `assistant_message_committed`
- `tool_batch_started`
- `tool_execution_request`
- `tool_execution_result`
- `tool_message_committed`
- `history_mutation`

`SESSION_LOG_EVENT` is the complete production and replay-reader vocabulary. Direct logger calls and core
execution-event literals must be members of that shared list, and the coverage test scans every source so a
new event cannot silently become writer-only or reader-only.

Manual and automatic compaction also share one session-owned trigger value. The same `manual` or `auto`
value reaches PreCompact, PostCompact, the `context_compact` log entry, and `onCompactEvent`; instructions
do not cause the compaction orchestrator to reclassify the trigger.

`FileSessionLogger` redacts common secret fields before writing logs and stores large fields as
content-addressed JSON payload references under `{sessionId}.payloads/`. `loadSessionLogEntries()`
hydrates those sidecars before replay and fails closed on malformed references, path/symlink escape,
missing or unreadable files, byte-length/hash mismatch, invalid JSON, cycles, or configured depth/byte
limits. Each source read receives the remaining aggregate byte budget; the Node adapter checks it before
allocation and reads from the same no-follow descriptor it validated. `session-log-replay` exports replay
readers and validators that reconstruct chat history from
`history_mutation` and report missing provider/tool terminal events; an unresolved history message or
normalized provider response is replay-incomplete. Replay validation also requires provider-native raw
response or stream payload coverage for each `provider_request`. Direct `NodeSessionLogSink` calls reject
unsafe session path components and reject payload digests that are malformed or do not hash the supplied
serialized content. Host and authority-backed sinks share
`createSessionLogExternalPayloadReference()` as the validation and reference-construction SSOT.

A migration script is available for upgrading session records from older formats. See the package source for details.

## Assembly

Most users should use `InteractiveSession` or `createQuery()` from `@robota-sdk/agent-framework` — or `createAgentRuntime().createSession()` for multi-session runtimes — instead of constructing `Session` directly. (`createSession()` itself is an internal assembly factory and is not part of the public entry.) The SDK wires tools, provider, and system prompt automatically from config and context.

## Dependencies

- `@robota-sdk/agent-core` (production) — Robota agent, permission system, hook system, core types

## License

Robota is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
