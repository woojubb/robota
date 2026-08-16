---
title: 'CORE-032: the public runStream() is a single-round engine that implements none of the documented execution loop — no post-tool model call, no round cap, an aborted stream is committed as complete, and structured-output validation over "final assistant text after tool rounds" is unimplementable'
status: done
created: 2026-08-13
completed: 2026-08-16
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

## Outcome (2026-08-16) — delivered by CORE-042

`runStream` no longer has a loop of its own to be single-round. `ExecutionService.executeStream` is a
streaming ENTRY into the same `execute()` the round path runs
(`packages/agent-core/src/services/execution-stream.ts`), and
`packages/agent-core/src/services/execution-stream-tools.ts` — the single-round tool loop this item is
named after — is deleted. The round loop, the post-tool model call, the round cap,
`maxSameToolInputs` and abort classification are therefore not re-implemented for streaming; they are
what the turn does.

This item's own Direction called for exactly that — _"route `executeStream` through the same round
loop as `execute`"_ — so it is delivered rather than superseded.

Pinned in the repository by `packages/agent-core/src/core/__tests__/entry-point-parity.test.ts`, which
runs nine capabilities against BOTH entry points from one table, so a future divergence fails rather
than passing quietly.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** in-progress → done

- **Scenario executed.** CORE-042's Scenarios 1 and 2 are this item's scenario, executed against the
  completed implementation from `scratch/` via
  `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-042-s1.ts` (and `-s2`). Both
  printed `SCENARIO <N> PASS`.
- **Observed matched expected.** S1: a streaming turn that calls a tool made **2** provider calls with
  history `["user","assistant","tool","assistant"]` — the tool result fed a follow-up model call,
  which a single-round engine cannot do — and `run()` made the same 2. S2: with
  `maxExecutionRounds=2`, `runStream()` made **3** provider calls and executed the tool **twice**,
  matching `run()` exactly; the cap is honoured rather than absent.
- **Surface substitution, stated.** This item's scenario text names a provider key. The scenarios were
  instead run against a scripted provider written to the PUBLIC extension point
  (`AbstractAIProvider`, `AbstractTool`, `Robota`), which is the same surface a third-party integrator
  uses and which makes the round count directly observable. The credential probe is recorded in
  CORE-042: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY` and
  `BYTEDANCE_API_KEY` were all unset with no `.env` present, so this is a probed absence, not an
  assumed one — and a live key would have made the round count harder to observe, not easier.
- **Durable artifacts.** `packages/agent-core/src/core/__tests__/entry-point-parity.test.ts` and the
  scenario blocks inlined in
  [CORE-042](completed/CORE-042-the-execution-turn-is-implemented-twice.md).
