---
title: 'CORE-032: the public runStream() is a single-round engine that implements none of the documented execution loop — no post-tool model call, no round cap, an aborted stream is committed as complete, and structured-output validation over "final assistant text after tool rounds" is unimplementable'
status: todo
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-core
depends_on: []
---

# CORE-032: streaming and non-streaming are two different engines

## Problem

The agent-core SPEC describes one execution engine with two entry points (`run` and `runStream`), and
documents the round loop, round cap, and post-tool model call as engine contracts. The streaming path
is a separate single-round machine: it makes exactly one provider call per run, executes the tool
batch, commits the results, and returns with no follow-up model call — so a tool-using `runStream`
turn ends with tool results in history and no assistant answer, `maxExecutionRounds`/`maxSameToolInputs`
are accepted and read by nothing, and the documented structured-output-after-tool-rounds contract
cannot hold. An aborted stream is additionally committed as `complete`, not `interrupted`.

## Evidence (round-2 engine audit, 2026-08-13)

- `packages/agent-core/docs/SPEC.md:827` — "`maxExecutionRounds` … Maximum model/tool rounds for one
  run"; `:905-906` — "tools may run within a structured turn; validation applies to the final
  assistant text after tool rounds complete"; `:1109` — callers override via
  `IRunOptions.maxExecutionRounds`.
- `packages/agent-core/src/services/execution-stream.ts:167` — exactly one `chatStream` call per run;
  `execution-stream-tools.ts:15-149` — executes the tool batch, commits results, emits
  `TOOL_RESULTS_READY`, and returns with no follow-up provider call; `execution-stream.ts` never reads
  `maxExecutionRounds` or `maxSameToolInputs`.
- `robotaRunStreamStructured` (`robota-execution.ts:247-252`) validates the concatenation of pre-tool
  text + the injected `\n[Tool: … executed successfully]` notices
  (`execution-stream-tools.ts:86-89,107-110`) — so "validation applies to the final assistant text
  after tool rounds complete" is unimplementable on this path.
- Abort state: `packages/agent-core/docs/SPEC.md:1000-1001` — "Only assistant messages may have
  `state: 'interrupted'` … aborted by the user before natural completion"; `:959` — abort commits via
  `commitAssistant('interrupted')`. But `execution-stream.ts:265-268` calls
  `conversationStore.addAssistantMessage(fullResponse, …)` (never begin/commit), and
  `conversation-message-factory.ts:57` defaults `state: 'complete'` — an aborted partial stream is
  recorded indistinguishably from a natural completion.

## Direction

Route `executeStream` through the same round loop as `execute` (the run-scoped delta callback plumbing
already exists via `wrappedOnTextDelta`), so tool results feed a follow-up model call, the round cap
and same-input guard apply, abort commits `interrupted`, and structured validation sees the real final
text. The alternative — declaring `runStream` single-round in the SPEC — breaks its own
structured-output contract (CORE-015), so the code-side fix is the coherent one. (Replay-event
emission on the streaming path is CORE-033.)

## Test Plan

- Red-first: a `runStream` turn with a tool available and a model that calls the tool — assert the
  model consumes the tool result and produces a final assistant answer (fails today: the turn ends at
  tool results).
- Red-first: an aborted `runStream` commits the partial message with `state: 'interrupted'`.
- Red-first: `robotaRunStreamStructured` validates the post-tool final text, not the pre-tool text +
  notices.
- Red-first: `maxExecutionRounds` caps `runStream` rounds.
- `pnpm harness:verify -- --scope packages/agent-core` green.

## User Execution Test Scenarios

**Applies** — via the public SDK (`runStream`/streaming query).

- Prerequisites: built workspace + provider key; a scratch consumer using the streaming run surface
  with one tool registered; a prompt that requires the tool.
- Steps: run a streaming turn that calls the tool; then abort a long streaming turn mid-way.
- Expected (after fix): the streaming turn calls the tool AND returns a final answer consuming the tool
  result; the aborted turn's stored message is marked interrupted.
- Expected (before fix, contrast): the streaming turn stops at the tool result with no answer; the
  aborted partial is stored as a normal completion.
- Cleanup: delete the scratch project.
- Evidence (fill in after implementation): the streaming transcript showing the post-tool answer, and
  the stored message state after abort.
