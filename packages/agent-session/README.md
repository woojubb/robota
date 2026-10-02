# @robota-sdk/agent-session

Session lifecycle for the Robota SDK. A `Session` wraps a `ConversationAgent` agent from
`@robota-sdk/agent-core` and adds permission-gated tool execution, lifecycle hooks, context-window
tracking, conversation compaction, session logs and optional persistence.

Most applications use `InteractiveSession` or `createQuery()` from `@robota-sdk/agent-framework`,
which build a `Session` with tools, provider and system prompt already wired. Use this package
directly when you assemble a session yourself.

## Installation

```bash
npm install @robota-sdk/agent-session @robota-sdk/agent-core
```

Requires Node.js 22.12 or later.

## Quick Start

```typescript
import { Session } from '@robota-sdk/agent-session';
import type { ITerminalOutput } from '@robota-sdk/agent-session';
import type { IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';

declare const tools: IToolWithEventService[];
declare const provider: IAIProvider;
declare const terminal: ITerminalOutput;

const session = new Session({
  tools,
  provider,
  systemMessage: 'You are a helpful assistant.',
  terminal,
  // Required. The session's root: hook inputs, the permission workspace and the stored record use it.
  cwd: process.cwd(),
  permissions: { allow: ['Read(*)'], deny: [] },
  autoCompactThreshold: 0.75,
});

const response = await session.run('Hello!');

// Context tracking
const state = session.getContextState();
console.log(`${state.usedPercentage.toFixed(1)}% context used`, response);

// Manual compaction
await session.compact('Focus on the API changes');

await session.shutdown();
```

`ITerminalOutput` is a small terminal I/O interface (`write`, `writeLine`, `prompt`, `select`,
`spinner`, …). The session writes notices to it and hands it to an injected `promptForApproval`
function. A tool call that needs approval goes to `permissionHandler` or `promptForApproval`; with
neither, it is denied.

## Checkpointed approval

Use `runRecoverable` when the host must save an approval request and answer it after reopening the
same Session. Supply an `IRecoverableExecutionJournal` from `@robota-sdk/agent-core`; the host owns
exclusive access and durable, idempotent record storage. Ordinary `run` keeps live approval handling.

```typescript
import type { IRecoverableExecutionJournal } from '@robota-sdk/agent-core';

declare const journal: IRecoverableExecutionJournal;
declare const approvedByHost: boolean;
declare const hostResponseId: string; // Persist this ID and reuse it for redelivery.

const result = await session.runRecoverable('Perform the requested task', {
  executionJournal: journal,
});
if (result.status === 'waiting') {
  const request = result.requests.find((value) => value.kind === 'robota-session/approval');
  if (request) {
    // Authenticate the responder and show the exact request.data.arguments before answering.
    const continued = await session.resumeRecoverable({
      executionId: request.executionId,
      journal,
      toolResponses: [
        {
          requestId: request.requestId,
          responseId: hostResponseId,
          response: { approved: approvedByHost },
        },
      ],
    });
    // continued may wait again, including for another action with identical arguments.
  }
}
```

`resumeRecoverable` continues execution without adding another user message. A recreated Session
must use the same session ID, canonical workspace, provider and model. Current hooks, permissions,
task restrictions and peer restrictions are checked again; approval never grants session-wide consent.
A response with a reused ID and different content is refused. Existing saved decisions also bind
ordinary `resume`.

While an execution waits, `run` refuses new input. `getPendingExecution()` returns its
`executionId` and `requests`, including after a cancellation that ended the turn once the wait was
saved. A journaled `run`, `runRecoverable` or resume that fails (a storage failure, an unreconciled
effect) while its tool calls are open in history also leaves the execution pending, with only the
waits whose effect never started in `requests`; resume it once the journal is readable, or abandon
it. A failure after its rounds settled ends it like an ordinary turn.
`abandonPendingExecution(executionId)` gives it up without running anything: its open tool calls
are closed as failed in this Session's history and this Session can no longer resume it, but the
journal is left untouched. Discard that execution's journal records yourself; otherwise a Session
without this history, such as a fresh one, can still resume the execution from them.

Waiting is returned only after request writes are durable and tools already running beside the
waiting one finish; calls not yet started stay pending. Cancellation interrupts running tools but
still waits for them to settle. Storage failures propagate, and uncertain effects raise a
reconciliation error rather than being replayed. Turn-level lifecycle hooks are omitted on
continuation because their effects lack durable receipts; structured-output recovery is unsupported.
This API alone does not provide arbitrary-effect recovery or durable Roundtable execution.

## Features

| Feature                    | Description                                                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Permission enforcement** | Every tool call is decided by `evaluatePermission` from `agent-core` (deny, ask and allow rules plus the permission mode). Approvals go to `permissionHandler` or `promptForApproval`; with neither, the call is denied.                                             |
| **`auto` mode**            | `AutoModeGate` sends calls the mode would ask about to a `permissionClassifier`; after repeated blocks it falls back to asking a person                                                                                                                              |
| **Hooks**                  | Fires `PreToolUse`, `PostToolUse`, `PermissionDecision`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PreCompact`, `PostCompact`, `PreModelCall` and `PostModelCall`. See the [hook event catalog](../agent-core/docs/HOOK-CATALOG.md). |
| **Context tracking**       | Token usage from the shared core estimator, with a configurable auto-compact threshold (default 83.5% of the context window)                                                                                                                                         |
| **Compaction**             | A model-written summary replaces the history to free context space; an invalid summary throws `CompactionError` and leaves the history untouched                                                                                                                     |
| **Persistence**            | Inject an `IInteractiveSessionStore`; each completed `run()` and `shutdown()` save the record. `NodeSessionStore` writes JSON files atomically (temp file + rename)                                                                                                  |
| **Abort**                  | `session.abort()` stops the running turn; `run()` then rejects with an `AbortError`                                                                                                                                                                                  |
| **One turn at a time**     | A concurrent `run()` is refused with `SessionBusyError`; `isRunning()` is true until the running turn has fully unwound                                                                                                                                              |
| **Session logging**        | `FileSessionLogger` writes versioned JSONL through an injected sink; `NodeSessionLogSink` is the file-system sink                                                                                                                                                    |
| **Replay events**          | Provider and tool execution events from core are written to the log so a session can be replayed and validated                                                                                                                                                       |

## Key Methods

| Method                                                    | Description                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `constructor(options)`                                    | `ISessionOptions`; pass `sessionId` for a deterministic ID                      |
| `run(message)`                                            | Send a message and return the response                                          |
| `runRecoverable(message, options)`                        | Run with a recovery journal; returns a completed response or saved waits        |
| `resumeRecoverable(options)`                              | Answer saved waits and continue that execution without new input                |
| `getPendingExecution()`                                   | The execution whose saved waits block new input, if any                         |
| `abandonPendingExecution(executionId)`                    | Give up that execution without running it, so new input is accepted             |
| `injectMessage(role, content)`                            | Add a message to the history without running the agent                          |
| `compact(instructions?)`                                  | Summarize the conversation to free context space                                |
| `getContextState()`                                       | `{ usedTokens, maxTokens, usedPercentage, remainingPercentage }`                |
| `getAutoCompactThreshold()`                               | Auto-compact threshold fraction, or `false` when disabled                       |
| `getPermissionMode()` / `setPermissionMode(mode)`         | Read or change the permission mode                                              |
| `getModelEffort()`                                        | The model-effort selection for the next call (`auto` when unset)                |
| `getHistory()` / `clearHistory()`                         | Read or clear the conversation history                                          |
| `addTools(tools)`                                         | Register more tools on a live session                                           |
| `getProvider()` / `swapProvider(provider, model)`         | Read or replace the provider the session uses                                   |
| `abort()`                                                 | Signal the running turn to stop (it holds the session until it unwinds)         |
| `isRunning()`                                             | True while a turn is in flight, including one that was aborted and is unwinding |
| `getSessionId()`                                          | The stable session identifier                                                   |
| `getMessageCount()`                                       | Number of completed `run()` calls                                               |
| `getSessionAllowedTools()` / `clearSessionAllowedTools()` | Approvals remembered for this session                                           |
| `getRecentPermissionDenials()`                            | Calls this session refused, most recent first, with the reason                  |
| `shutdown()`                                              | Fire `SessionEnd`, save the record and release the agent                        |

## Public API

| Export                                                                                                       | Kind                | Description                                                                              |
| ------------------------------------------------------------------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------- |
| `Session`                                                                                                    | Class               | Wraps `ConversationAgent` with permissions, hooks, compaction, logging and persistence              |
| `ISessionOptions`, `ISessionRunOptions`, `ISessionShutdownOptions`                                           | Types               | Constructor, run and shutdown options                                                    |
| `SessionBusyError`, `TurnClaim`                                                                              | Classes             | The refusal of a concurrent turn, and the identity of the running turn                   |
| `PermissionEnforcer`                                                                                         | Class               | Tool permission checks, hook execution and output truncation                             |
| `consentScopeFor`                                                                                            | Function            | The permission pattern an "allow for this session/project" answer grants                 |
| `AutoModeGate`, `IPermissionClassifier`                                                                      | Class, type         | The `auto` permission mode and the classifier port it calls                              |
| `ContextWindowTracker`, `AUTO_COMPACT_THRESHOLD`                                                             | Class, const        | Token usage tracking and the default auto-compact threshold                              |
| `CompactionOrchestrator`, `CompactionError`, `DEFAULT_COMPACTION_PROMPT`                                     | Class, error, const | Conversation compaction                                                                  |
| `TPermissionHandler`, `TPermissionResult`                                                                    | Types               | Approval callback and its answer (`true`, `false`, `'allow-session'`, `'allow-project'`) |
| `ITerminalOutput`, `ISpinner`                                                                                | Types               | Terminal I/O used for approval prompts                                                   |
| `NodeSessionStore`                                                                                           | Class               | File-system JSON store for session records                                               |
| `IInteractiveSessionRecord`, `IInteractiveSessionStore`                                                      | Types               | The persisted session record and store port (from `@robota-sdk/agent-interface-session`) |
| `decodeInteractiveSessionRecord`, `decodeVersionedInteractiveSessionRecord`                                  | Functions           | Validate a stored record before use                                                      |
| `serializeSessionArtifact`, `deserializeSessionArtifact`                                                     | Functions           | Export a session record to a portable artifact and import it again                       |
| `scrubSensitiveKeys`, `isSensitiveKey`                                                                       | Functions           | Redact secret-looking keys (used by the logger; optional for artifacts)                  |
| `CheckpointTree`                                                                                             | Class               | In-memory branching tree of checkpoint IDs (fork and switch between branches)            |
| `FileSessionLogger`, `SilentSessionLogger`, `ISessionLogger`                                                 | Class, type         | JSONL session logger and the logger port                                                 |
| `NodeSessionLogSink`, `NodeSessionLogSource`, `ISessionLogSink`, `ISessionLogSource`                         | Classes, types      | File-system log writer and reader, and their ports                                       |
| `loadSessionLogEntries`, `decodeSessionLogEntries`, `SessionLogDecodeError`                                  | Functions, error    | Read and validate a session log                                                          |
| `replaySessionLogEntries`, `validateSessionReplayLogEntries`                                                 | Functions           | Rebuild history from a log and report gaps                                               |
| `SESSION_LOG_EVENT`, `SESSION_LOG_SCHEMA_VERSION`                                                            | Consts              | The log event vocabulary and schema version                                              |
| `resolveSessionLogExternalPayloads`, `NodeExternalPayloadSource`, `createSessionLogExternalPayloadReference` | Functions, class    | Large log fields stored as separate payload files                                        |
| `NodeToolResultSpillStore`                                                                                   | Class               | Stores oversized tool results in files for the life of the session                       |
| `NodePromptHistoryFile`                                                                                      | Class               | Append-only prompt history file that can be read newest-first                            |

`IContextWindowState` (the `getContextState()` result) is exported by `@robota-sdk/agent-core`.

## Session vs ConversationAgent

- **`ConversationAgent`** (`agent-core`): the raw agent — conversation, tools and plugins. No permissions, no
  hooks.
- **`Session`** (this package): `ConversationAgent` plus permissions, hooks, compaction, logging and
  persistence. `@robota-sdk/agent-framework` builds its sessions from it.

## Persistence

`IInteractiveSessionRecord` carries the full conversation and resumable state. `NodeSessionStore`
saves the record without inspecting its payload. It is a host adapter: passing it a directory does
not establish workspace trust. `@robota-sdk/agent-framework` instead adapts a trusted project's
state storage to the same store port.

When a `Session` re-saves an existing record, it keeps the fields it does not own and refreshes only
its live conversation, history, prompt, schema, path and timestamp fields. A resumed session must
reuse the record ID for its new turns to update that record; a session without a store stays
transient.

## Session logs and replay

`FileSessionLogger` writes versioned JSONL through an injected `ISessionLogSink`. It redacts common
secret fields and stores large fields as content-addressed JSON payload files under
`{sessionId}.payloads/`. Streaming text deltas go to the log as `text_delta` events; keep
high-frequency output in logs and the session record focused on resumable state.

`Session.run()` forwards core execution events into the log, including `provider_request`,
`provider_native_raw_payload`, `provider_stream_raw_delta`, `provider_response_raw`,
`provider_response_normalized`, `assistant_message_committed`, `tool_batch_started`,
`tool_execution_request`, `tool_execution_result`, `tool_message_committed` and `history_mutation`.
`SESSION_LOG_EVENT` is the complete vocabulary that writers and readers share.

Reading is source-driven: `loadSessionLogEntries(source)` takes an explicit `ISessionLogSource` and
never turns a filename into file-system access on its own. Use `NodeSessionLogSource` when the
application owns the path. Every declared event is validated before replay, nested messages
included; unknown events, malformed fields and unsupported versions raise `SessionLogDecodeError`,
and unversioned logs are not accepted. Payload files are read with an aggregate byte budget and
checked for path escape, symlink replacement, size and hash mismatch; a failure is reported rather
than skipped. `replaySessionLogEntries` rebuilds the chat history from `history_mutation` events, and
`validateSessionReplayLogEntries` reports missing provider or tool events.

Manual and automatic compaction carry one trigger value (`manual` or `auto`) to `PreCompact`,
`PostCompact`, the `context_compact` log entry and `onCompactEvent`.

## Legacy session migration

From `packages/agent-session` in the repository, `node scripts/migrate-session-history.mjs
--sessions-dir <absolute-directory>` backfills history in legacy session files. It rewrites the files
in that directory, so back them up first. `node examples/verify-session-history-migration.mjs`
checks the conversion on disposable files without touching your sessions.

## Dependencies

- `@robota-sdk/agent-core` — `ConversationAgent`, permissions, hooks and core types
- `@robota-sdk/agent-interface-session` — the session record and store contracts
- `@robota-sdk/agent-interface-execution` — background task contracts stored in the session record
- `@robota-sdk/agent-file-authority` — bounded, root-relative file reads for log payloads

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract, invariants and design decisions
- [Hook event catalog](../agent-core/docs/HOOK-CATALOG.md)

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
