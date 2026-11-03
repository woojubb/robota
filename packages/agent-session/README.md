# @robota-sdk/agent-session

Session lifecycle for the Robota SDK. A `Session` wraps a `ConversationAgent` agent from
`@robota-sdk/agent-core` and adds permission-gated tool execution, lifecycle hooks, context-window
tracking, conversation compaction, session logs and optional persistence.

Most applications use `InteractiveSession` or `createQuery()` from `@robota-sdk/agent-framework`,
which build a `Session` with tools, provider and system prompt already wired. Use this package
directly when you assemble a session yourself.

The main entry is platform-neutral: it runs in a browser, a Web Worker, Node, Deno and Bun and never
reaches the file system or the process. What needs a Node host — the file-backed store, log sink and
source, the spill store, the prompt-history file and the process hooks — is on
`@robota-sdk/agent-session/node`, and the session takes what it needs from its host by injection.

## Installation

```bash
npm install @robota-sdk/agent-session @robota-sdk/agent-core
```

Requires Node.js 22.12 or later for the `@robota-sdk/agent-session/node` adapters.

## Quick Start

```typescript
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';

import { Session } from '@robota-sdk/agent-session';
import { createNodeWorkspacePathResolver } from '@robota-sdk/agent-session/node';
import { CommandExecutor, HttpExecutor } from '@robota-sdk/agent-core/node';
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
  // Required. The hook handlers this host can run; `[]` runs none. The session has no host default.
  hookTypeExecutors: [new CommandExecutor(), new HttpExecutor()],
  // Optional on any host; a Node host passes all three so the permission gate knows the home
  // directory, follows symlinks out of the workspace and compares directories as the filesystem does.
  homeDirectory: homedir(),
  resolveInWorkspace: createNodeWorkspacePathResolver(process.cwd()),
  canonicalizePath: (path) => realpathSync(path),
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
it. A failure after its rounds settled ends it like an ordinary turn once its configured checkpoint accepts the settled snapshot.
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

### Save and reconstruct a pending conversation

Use `getConversationSnapshot()` to capture messages and pending discovery together. A configured
`sessionStore` does this automatically; framework persistence uses the same projection. Restore the
complete saved record into a pristine Session with the same ID and canonical workspace:

```typescript
const loaded = store.load(session.getSessionId());
if (loaded.status === 'valid') {
  // Construct restoredSession with loaded.record.id and loaded.record.cwd first.
  restoredSession.restoreConversation(loaded.record);
  const pending = restoredSession.getPendingExecution();
  // New input is refused until the host resumes this exact execution with its journal,
  // or calls restoredSession.abandonPendingExecution(pending.executionId).
}
```

Saved requests are discovery only. They do not retain consent, live resolvers, provider objects or
proof that an effect never started. Abandoning restored discovery records unknown outcomes.

`checkpointHistory?: () => void` takes precedence over the lower Session store. Its successful return
must synchronously acknowledge the complete current snapshot; store ports obey the same rule.
Returned thenables are rejected and observed. A callback that secretly queues writes or omits pending
discovery is incompatible with this guarantee. Without a persistence sink, journal execution remains
process scoped; `checkpoint()` refuses to imply a saved snapshot.

A failed waiting save rejects instead of returning `waiting`. A failed settled or abandonment save
keeps admission blocked. Repair the sink and call `checkpoint(): void` to retry only the settled bytes;
it never repeats provider calls or effects. Repeating the same abandonment can retry its failed save
without duplicating receipts. Public conversation mutations remain blocked during unresolved recovery.
`abandonPendingExecution` retains its synchronous `void` signature and now throws when its configured
save cannot acknowledge closure. An original execution error remains primary if a secondary save fails.

Coordinated readers accept strict v1 and v2 envelopes; all new file/workspace/artifact writes use v2.
Older readers report v2 as unsupported and preserve its bytes, including settled records. Roll back
these packages together or retain a compatible reader; do not strip recovery fields or downgrade the
header. Available acknowledged snapshots carry this guarantee. Missing snapshots and history-only
replay cannot rediscover pending identity; marker-free legacy interrupted-call repair remains unchanged.
This does not add cross-process fencing, power-loss/fsync guarantees, arbitrary-effect recovery or
durable Roundtable execution. Unresolved forks and workspace copies are refused before destination writes.

## Features

| Feature                    | Description                                                                                                                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Permission enforcement** | Every tool call is decided by `evaluatePermission` from `agent-core` (deny, ask and allow rules plus the permission mode). Approvals go to `permissionHandler` or `promptForApproval`; with neither, the call is denied.                                             |
| **`auto` mode**            | `AutoModeGate` sends calls the mode would ask about to a `permissionClassifier`; after repeated blocks it falls back to asking a person                                                                                                                              |
| **Hooks**                  | Fires `PreToolUse`, `PostToolUse`, `PermissionDecision`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `Stop`, `StopFailure`, `PreCompact`, `PostCompact`, `PreModelCall` and `PostModelCall`. See the [hook event catalog](../agent-core/docs/HOOK-CATALOG.md). |
| **Context tracking**       | Token usage from the shared core estimator, with a configurable auto-compact threshold (default 83.5% of the context window)                                                                                                                                         |
| **Compaction**             | A model-written summary replaces the history to free context space; an invalid summary throws `CompactionError` and leaves the history untouched                                                                                                                     |
| **Persistence**            | Inject an `IInteractiveSessionStore`; each completed `run()` and `shutdown()` save the record. `NodeSessionStore` (on `/node`) writes JSON files atomically (temp file + rename)                                                                                     |
| **Abort**                  | `session.abort()` stops the running turn; `run()` then rejects with an `AbortError`                                                                                                                                                                                  |
| **One turn at a time**     | A concurrent `run()` is refused with `SessionBusyError`; `isRunning()` is true until the running turn has fully unwound                                                                                                                                              |
| **Session logging**        | `FileSessionLogger` writes versioned JSONL through an injected sink; `NodeSessionLogSink` (on `/node`) is the file-system sink                                                                                                                                       |
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

| Export                                                                                   | Kind                | Description                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `Session`                                                                                | Class               | Wraps `ConversationAgent` with permissions, hooks, compaction, logging and persistence   |
| `ISessionOptions`, `ISessionRunOptions`, `ISessionShutdownOptions`                       | Types               | Constructor, run and shutdown options                                                    |
| `SessionBusyError`, `TurnClaim`                                                          | Classes             | The refusal of a concurrent turn, and the identity of the running turn                   |
| `PermissionEnforcer`                                                                     | Class               | Tool permission checks, hook execution and output truncation                             |
| `consentScopeFor`                                                                        | Function            | The permission pattern an "allow for this session/project" answer grants                 |
| `AutoModeGate`, `IPermissionClassifier`                                                  | Class, type         | The `auto` permission mode and the classifier port it calls                              |
| `ContextWindowTracker`, `AUTO_COMPACT_THRESHOLD`                                         | Class, const        | Token usage tracking and the default auto-compact threshold                              |
| `CompactionOrchestrator`, `CompactionError`, `DEFAULT_COMPACTION_PROMPT`                 | Class, error, const | Conversation compaction                                                                  |
| `TPermissionHandler`, `TPermissionResult`                                                | Types               | Approval callback and its answer (`true`, `false`, `'allow-session'`, `'allow-project'`) |
| `ITerminalOutput`, `ISpinner`                                                            | Types               | Terminal I/O used for approval prompts                                                   |
| `IInteractiveSessionRecord`, `IInteractiveSessionStore`                                  | Types               | The persisted session record and store port (from `@robota-sdk/agent-interface-session`) |
| `decodeInteractiveSessionRecord`, `decodeVersionedInteractiveSessionRecord`              | Functions           | Validate a stored record before use                                                      |
| `serializeSessionArtifact`, `deserializeSessionArtifact`                                 | Functions           | Export a session record to a portable artifact and import it again                       |
| `scrubSensitiveKeys`, `isSensitiveKey`                                                   | Functions           | Redact secret-looking keys (used by the logger; optional for artifacts)                  |
| `CheckpointTree`                                                                         | Class               | In-memory branching tree of checkpoint IDs (fork and switch between branches)            |
| `FileSessionLogger`, `SilentSessionLogger`, `ISessionLogger`                             | Class, type         | JSONL session logger and the logger port                                                 |
| `ISessionLogSink`, `ISessionLogSource`, `IExternalPayloadSink`, `IExternalPayloadSource` | Types               | The ports a log is written and read through                                              |
| `loadSessionLogEntries`, `decodeSessionLogEntries`, `SessionLogDecodeError`              | Functions, error    | Read and validate a session log                                                          |
| `replaySessionLogEntries`, `validateSessionReplayLogEntries`                             | Functions           | Rebuild history from a log and report gaps                                               |
| `SESSION_LOG_EVENT`, `SESSION_LOG_SCHEMA_VERSION`                                        | Consts              | The log event vocabulary and schema version                                              |
| `resolveSessionLogExternalPayloads`, `createSessionLogExternalPayloadReference`          | Functions           | Large log fields stored as separate payload files                                        |

`IContextWindowState` (the `getContextState()` result) is exported by `@robota-sdk/agent-core`.

`@robota-sdk/agent-session/node` holds what only a Node host provides:

| Export                                             | Kind            | Description                                                                      |
| -------------------------------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `NodeSessionStore`                                 | Class           | File-system JSON store for session records                                       |
| `NodeSessionLogSink`, `NodeSessionLogSource`       | Classes         | File-system log writer and reader                                                |
| `NodeExternalPayloadSource`                        | Class           | Reads a log's payload files from a base directory                                |
| `NodeToolResultSpillStore`, `ToolResultSpillError` | Class, error    | Stores oversized tool results in files for the life of the session               |
| `sweepStaleToolResultSpillDirectories`             | Function        | Removes spill directories left behind by a process that is no longer running     |
| `NodePromptHistoryFile`, `parsePromptHistoryLine`  | Class, function | Append-only prompt history file that can be read newest-first                    |
| `createNodeWorkspacePathResolver`                  | Function        | The `resolveInWorkspace` option, for a host with a file system                   |
| `registerProcessExitFlush`                         | Function        | The `registerExitFlush` option of `FileSessionLogger`, for a host with a process |

## Session vs ConversationAgent

- **`ConversationAgent`** (`agent-core`): the raw agent — conversation, tools and plugins. No permissions, no
  hooks.
- **`Session`** (this package): `ConversationAgent` plus permissions, hooks, compaction, logging and
  persistence. `@robota-sdk/agent-framework` builds its sessions from it.

## What the host supplies

The session reads nothing from the machine it runs on. The composition root passes:

| Option                                     | Without it                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `hookTypeExecutors` (required)             | Construction throws. `[]` runs no hook handler; on Node pass the command and HTTP executors from `agent-core/node` |
| `homeDirectory`                            | The home directory is unknown: `~`, and a home-relative target that may climb out of it (`~/..`), are refused      |
| `resolveInWorkspace`                       | A shell command with a path operand is not judged read-only                                                        |
| `canonicalizePath`                         | A directory is compared as written, with no symlinks followed (`realpathSync` on Node)                             |
| `registerExitFlush` of `FileSessionLogger` | A stream's buffered tail is not flushed when the process exits mid-stream                                          |

## Persistence

`IInteractiveSessionRecord` carries the full conversation and resumable state. `NodeSessionStore`
(from `@robota-sdk/agent-session/node`) saves the record without inspecting its payload. It is a
host adapter: passing it a directory does not establish workspace trust. It is built with a sealing
decision: `{ sealing: { sealer } }` seals each record, `{ sealing: 'plain' }` keeps plain JSON.
`@robota-sdk/agent-framework` instead adapts a trusted project's state storage to the same store
port.

When a `Session` re-saves an existing record, it keeps the fields it does not own and refreshes only
its live conversation, history, prompt, schema, path and timestamp fields. A resumed session must
reuse the record ID for its new turns to update that record; a session without a store stays
transient.

## Session logs and replay

`FileSessionLogger` writes versioned JSONL through an injected `ISessionLogSink`. It redacts common
secret fields and stores large fields as content-addressed JSON payload files under
`{sessionId}.payloads/`. Streaming text deltas go to the log as `text_delta` events; keep
high-frequency output in logs and the session record focused on resumable state.

`NodeSessionLogSink`, `NodeSessionLogSource` and `NodePromptHistoryFile` are built with a sealing
decision too. With `{ sealing: { sealer } }` each append is one sealed line and each payload file is
sealed under a random name; with `{ sealing: 'plain' }` they write plain lines. A source reads plain
and sealed lines alike, and `readStoredLines()` says which lines it could not open (locked, damaged,
or sealed by a newer build) where `readText()` throws. `NodeToolResultSpillStore` takes the same
decision and the host directory it lives in.

`Session.run()` forwards core execution events into the log, including `provider_request`,
`provider_native_raw_payload`, `provider_stream_raw_delta`, `provider_response_raw`,
`provider_response_normalized`, `assistant_message_committed`, `tool_batch_started`,
`tool_execution_request`, `tool_execution_result`, `tool_message_committed` and `history_mutation`.
`SESSION_LOG_EVENT` is the complete vocabulary that writers and readers share.

Reading is source-driven: `loadSessionLogEntries(source)` takes an explicit `ISessionLogSource` and
never turns a filename into file-system access on its own. Use `NodeSessionLogSource` from
`@robota-sdk/agent-session/node` when the application owns the path. Every declared event is
validated before replay, nested messages included; unknown events, malformed fields and unsupported
versions raise `SessionLogDecodeError`, and unversioned logs are not accepted. Payload files are
read with an aggregate byte budget and checked for path escape, symlink replacement, size and hash
mismatch; a failure is reported rather than skipped. `replaySessionLogEntries` rebuilds the chat
history from `history_mutation` events, and `validateSessionReplayLogEntries` reports missing
provider or tool events.

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
- `@robota-sdk/agent-file-authority` — bounded, root-relative file reads for log payloads, used only
  by `@robota-sdk/agent-session/node`

## Documentation

- [docs/SPEC.md](./docs/SPEC.md) — package contract, invariants and design decisions
- [Hook event catalog](../agent-core/docs/HOOK-CATALOG.md)

## License

This package is dual-licensed under the [GNU AGPL-3.0](../../LICENSE) or a [commercial license](../../COMMERCIAL.md). See [LICENSING.md](../../LICENSING.md).
