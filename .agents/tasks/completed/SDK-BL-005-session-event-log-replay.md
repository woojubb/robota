# Session Event Log Replay

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: feat/session-event-log-replay
- **Scope**: packages/agent-sessions, packages/agent-core, packages/agent-sdk

## What

Make `.robota/logs/*.jsonl` the append-only source of truth for session replay so `/resume` can reconstruct a session from raw execution events without relying on incomplete snapshots or inferred state.

## Why

Recent agent parallel-call investigation showed that the current logs preserve normalized history and some tool execution observations, but they do not preserve every raw boundary needed to answer what actually happened:

- what request payload was sent to the provider;
- what raw provider response or stream chunks came back;
- how provider output was normalized into `TUniversalMessage`;
- which tool execution requests were derived from assistant tool calls;
- which tool invocations actually ran and what raw results they returned;
- which history mutations were committed for replay.

This makes root-cause analysis depend on inference. It also conflicts with the stronger requirement that session logs are not merely diagnostics: they are durable replay data for 100% session restoration.

## Current Gap

`packages/agent-sessions/docs/SPEC.md` says session logs must preserve enough raw data to reconstruct what was sent to the model and what came back. Current implementation only partially satisfies that contract:

- `pre_run` logs enriched input and pre-run history.
- `text_delta` logs streamed visible text deltas.
- `assistant` logs final response text, post-run history, and `historyStructure`.
- `tool_call` logs the actual wrapped tool invocation name and args.
- `tool_result` logs success and size metadata, but not the full raw result payload.

Missing raw provenance:

- provider request options and tool schemas as actually passed to the provider call;
- raw provider non-streaming response payloads;
- raw provider streaming chunks, including tool-call deltas;
- normalized provider response immediately after adapter parsing;
- execution-round assistant message before and after history commit;
- tool execution batch metadata, request index, batch mode, and parsed arguments;
- full tool result payload or a deterministic external reference when too large;
- append-only history mutation events suitable for deterministic replay.

## Scope

- Define a canonical event-log schema for replay-grade session logs.
- Update specs for `agent-sessions`, `agent-core`, and `agent-sdk` to distinguish:
  - diagnostic display logs;
  - raw provider/tool provenance;
  - replay events;
  - snapshot persistence.
- Add event logging at provider-call boundaries in `agent-core` without adding provider-specific branches.
- Add event logging at tool batch/request/result boundaries, including parallel execution metadata.
- Preserve large payloads through bounded inline data plus content-addressed file references or another deterministic storage strategy.
- Make `/resume` able to rebuild session state from append-only replay events, with session JSON snapshots used only as acceleration/cache.
- Add validation tooling that checks a session log has no unmatched assistant tool calls, tool requests, or tool results.
- Add regression coverage for multi-tool and multi-agent tool-call turns.

## Non-Goals

- Do not add provider-specific logic to `agent-core`.
- Do not rely on final `history` snapshots as the only source of replay truth.
- Do not silently omit raw payloads because they are large; use references when inline storage is too expensive.
- Do not store secrets in plaintext logs. Define redaction rules for provider requests and tool args/results that may contain credentials.
- Do not make high-frequency streaming writes rewrite the main session JSON file.

## Proposed Event Families

The exact schema should be finalized in the spec before implementation, but the replay model should include at least:

| Event                          | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `provider_request`             | Exact provider-neutral request envelope before adapter/provider call |
| `provider_response_raw`        | Raw non-streaming provider response or reference                     |
| `provider_stream_raw_delta`    | Raw streaming provider chunk or reference                            |
| `provider_response_normalized` | Parsed `TUniversalMessage` returned by provider adapter              |
| `assistant_message_committed`  | Assistant message appended to canonical history                      |
| `tool_batch_started`           | Tool batch mode, concurrency, request count, round/execution IDs     |
| `tool_execution_request`       | Tool name, toolCallId, parsed args, batch index, owner path          |
| `tool_execution_result`        | Full raw tool result or reference, success/error metadata            |
| `tool_message_committed`       | Tool message appended to canonical history                           |
| `history_mutation`             | Append-only canonical history mutation for replay                    |

## Acceptance Criteria

- [x] Specs define replay-grade event log ownership, event ordering, redaction, payload reference policy, and compatibility with existing session JSON records.
- [x] Every provider turn logs the provider-neutral request envelope and the provider-returned response before core validation. Exact native SDK payload capture remains provider-owned and is tracked separately.
- [x] Every provider response logs the normalized assistant message, including all tool calls and provider-supplied tool call IDs.
- [x] Every tool batch logs batch mode (`parallel` or `sequential`), concurrency, ordered requests, and terminal results.
- [x] Full tool results are recoverable from the log stream or referenced payload files.
- [x] `/resume` can rebuild messages, chat history, and background task/group snapshots from replay events when the session JSON snapshot is missing.
- [x] Tests prove replay-grade provider/tool events and history mutations are emitted without losing committed chat messages.
- [x] Tests prove streaming provider deltas are recorded with deterministic sequence numbers.
- [x] A validator API reports missing raw provider responses, unmatched tool calls/results, and non-replayable payload references.

## Risks & Mitigations

| Risk                                       | Mitigation                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| Logs grow too large                        | Use append-only JSONL plus content-addressed payload files for large raw data      |
| Secrets leak into durable logs             | Apply explicit redaction at provider request and tool boundary before persistence  |
| Replay schema drifts from runtime behavior | Add contract tests that replay logs generated by real execution paths              |
| Existing sessions cannot replay fully      | Mark legacy logs as snapshot-only and migrate only what can be proven              |
| Core gains provider-specific behavior      | Log provider-neutral envelopes in core and raw provider-owned payloads in adapters |

## Test Plan

- Add unit coverage for `agent-sessions` forwarding core execution boundary events into the append-only session logger.
- Add targeted `agent-core` coverage for provider request/response and tool batch/request/result event ordering as the replay schema expands.
- Add replay fixture tests for multi-tool and Agent batch turns before marking this task complete.
- Run affected `agent-core`, `agent-sessions`, and `agent-sdk` typecheck/build targets after each replay-event contract change.

## Promotion Path

1. Assign a backlog ID, for example `SDK-BL-0XX-session-event-log-replay`.
2. Move this file to `.agents/tasks/<ID>-session-event-log-replay.md`.
3. Update `packages/agent-sessions/docs/SPEC.md`, `packages/agent-core/docs/SPEC.md`, and `packages/agent-sdk/docs/SPEC.md` before code changes.
4. Implement with TDD around replay, multi-tool turns, and parallel `Agent` tool-call provenance.

## Progress

### 2026-05-02

- Promoted from backlog to active task as `SDK-BL-005`.
- Started on branch `feat/session-replay-agent-parallel`.
- Updated `agent-sessions`, `agent-core`, and `agent-sdk` specs with replay-grade execution boundary events.
- Added `IRunOptions.onExecutionEvent` / `IExecutionContext.onExecutionEvent` so core execution can emit append-only session events without depending on session storage.
- Added core event emission for provider request envelopes, normalized provider responses, assistant commits, tool batch starts, tool execution requests, and tool execution results.
- Wired `agent-sessions` run execution to persist core execution events through the existing session log path.
- Added session test coverage for forwarding core execution boundary events into session logs.
- Remaining work: raw provider responses/stream chunks, content-addressed payload references, redaction policy, deterministic `/resume` replay, history mutation events, validator command.

### 2026-05-05

- Resumed from `develop` after the earlier partial implementation was merged in PR #147.
- Recommendation: finish the provider-neutral replay contract first by adding common execution boundary events, session-log redaction/payload references, replay readers, validators, and SDK resume fallback. Provider-specific raw SDK payload capture remains provider-owned and can be tightened incrementally without making `agent-core` branch on providers.
- Added replay-grade `provider_response_raw`, `provider_stream_raw_delta`, and `history_mutation` events in `agent-core`.
- Added redaction and content-addressed external payload references to `FileSessionLogger`.
- Added `session-log-replay` readers and `session-log-validation` validators for append-only JSONL logs.
- Added SDK project session-store fallback that rebuilds sessions from `.robota/logs/{id}.jsonl` when `.robota/sessions/{id}.json` is missing, including background task/group snapshots when replay events include them.
- Added regression coverage for provider replay events, stream deltas, log replay validation, payload externalization, and SDK log-only resume fallback.

## Decisions

- Provider-native SDK response and stream object capture belongs in provider packages through a shared callback contract. `agent-core` should only emit provider-neutral execution events and must not branch on concrete provider SDK response types. A separate backlog tracks provider-owned native raw payload hooks and CLI-facing validation command work.

## Result

Completed the provider-neutral replay foundation:

- append-only history mutations can reconstruct chat messages/history;
- provider/tool boundary events are validated for missing terminal events;
- large/sensitive session-log payloads are handled by redaction and content-addressed references;
- SDK resume can recover from JSONL logs when session JSON snapshots are absent.
