# Agent Parallel Invocation Reliability

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: fix/cli-sdk-backlog-053-006
- **Scope**: packages/agent-sdk, packages/agent-command-agent, packages/agent-sessions

## What

Make explicit multi-agent and parallel-agent requests reliably start the requested number of subagent jobs in the same parent turn.

## Why

A recent CLI session showed the assistant saying it would run agents in parallel while the session history recorded only one `Agent` tool call per round. When challenged, it continued adding one `Agent` call at a time, waiting for each result before starting the next. This breaks the user-visible contract for explicit parallel delegation and makes the current `Agent` tool path unreliable for parallel work.

This backlog item is separate from replay-grade session logging. Better logs should prove what happened, but the runtime and model-invocable surfaces should also make the correct parallel behavior easy and robust.

## Observed Evidence

In `.robota/logs/session_1777720835221_ak6mqwr7b.jsonl` and `.robota/sessions/session_1777720835221_ak6mqwr7b.json`:

- The user requested designer and developer agents to review a document in parallel.
- The assistant said it would run them in parallel.
- The normalized assistant message contained one `Agent` tool call, then a later round contained the second `Agent` tool call.
- The user later asked why four agents were not created after the assistant said it would use four parallel agents.
- Follow-up rounds again contained one `Agent` tool call per round instead of a single parallel batch.

Because raw provider responses are not currently logged, this evidence proves the persisted normalized history and actual tool execution were not parallel. It does not prove whether the provider raw output originally contained one or multiple tool calls.

## Current Gap

Robota has two different parallel-capable paths:

- `/agent parallel ...` command path: parses multiple jobs and starts them with `Promise.all`.
- Direct `Agent` tool path: one `Agent` tool call creates one subagent job.

The model-visible instructions say that for multiple or parallel agents, the model should create one `Agent` tool call per requested role in the current turn. In practice, this is not reliable enough. The model may call only one `Agent` tool and narrate that it started several.

## Scope

- Decide the canonical model-invocable path for explicit parallel subagent requests.
- Make that path robust when the model emits only one tool call.
- Consider adding a batch-capable `Agent` tool input, for example `jobs: [...]`, while preserving the existing single-job contract.
- Consider routing explicit parallel requests through `ExecuteCommand(command: "agent", args: "parallel ...")` only if the command surface can be made reliable and testable.
- Ensure parent-turn behavior starts all requested jobs before waiting for terminal summaries.
- Ensure subagent jobs have distinct labels, prompts, agent types, and provenance metadata.
- Add tests covering explicit requests for two, four, and named-role parallel agents.
- Add session-log assertions once replay-grade event logging exists.

## Non-Goals

- Do not rely only on prompt wording to fix this.
- Do not remove the existing single-job `Agent` tool behavior.
- Do not make subagents recursively spawn subagents.
- Do not hide partial failures; if one requested job cannot start, the parent response should report which jobs started and which failed.

## Acceptance Criteria

- [x] An explicit request for N parallel agents starts N subagent jobs before waiting for their results.
- [x] The runtime supports a deterministic batch path that does not depend on the model emitting N separate tool calls.
- [x] The parent turn records one group/provenance object tying the requested jobs together.
- [x] The user-facing response does not claim parallel execution unless the jobs were actually started.
- [x] Tests cover direct `Agent` tool batch behavior or `/agent parallel` model-invocation behavior, whichever becomes canonical.
- [x] Tests cover the regression where the assistant says "4 parallel agents" but only one job is created.
- [x] Session logs can distinguish: provider emitted one batch tool call, provider emitted N direct tool calls, or runtime expanded one request into N jobs.

## Risks & Mitigations

| Risk                                            | Mitigation                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Batch input complicates the `Agent` tool schema | Keep single-job fields backwards compatible and add an explicit `jobs` array contract                              |
| Model still narrates unsupported behavior       | Add runtime-side validation and response metadata so the final response can be checked against actual started jobs |
| `/agent parallel` and `Agent` batch diverge     | Share parser/request-building logic between both paths                                                             |
| Partial startup failure leaves unclear state    | Return structured per-job startup results and group metadata                                                       |

## Test Plan

- Add unit coverage for direct batch `Agent` tool calls with two and four requested jobs.
- Assert all valid jobs are spawned before the first wait begins, and partial startup failures remain visible per job.
- Add session-log assertions after replay-grade events can distinguish one batch call from N direct tool calls.
- Run affected `agent-sdk` tests, typecheck, and build after changing the model-visible Agent tool contract.

## Promotion Path

1. Assign a backlog ID, for example `SDK-BL-0XX-agent-parallel-invocation-reliability`.
2. Move this file to `.agents/tasks/<ID>-agent-parallel-invocation-reliability.md`.
3. Update `packages/agent-sdk/docs/SPEC.md`, `packages/agent-command-agent/docs/SPEC.md`, and relevant session logging specs before implementation.
4. Implement with TDD around two-agent and four-agent explicit parallel requests.

## Progress

### 2026-05-02

- Promoted from backlog to active task as `SDK-BL-006`.
- Started on branch `feat/session-replay-agent-parallel`.
- Updated `agent-sdk` spec to make one batch `Agent` tool call with `jobs` the canonical model path for explicit parallel subagent requests.
- Added backwards-compatible `jobs` support to the `Agent` tool schema while preserving the single-job `prompt` contract.
- Implemented batch execution so all valid jobs are spawned before any wait begins, with shared `groupId`, ordered per-job results, `agentIds`, and partial failure reporting.
- Updated model-visible Agent tool instructions to prefer `jobs` for explicit multi-agent and parallel-agent requests.
- Added regression coverage proving a batch `Agent` call can start multiple jobs before waiting, including the model-friendly `jobs`-only shape.
- Remaining work: four-agent scenario coverage, user-facing claim validation, command-path convergence, and session-log assertions that distinguish one batch call from N direct calls.

### 2026-05-04

- Resumed on `fix/cli-sdk-backlog-053-006`.
- Recommended completing the existing batch `Agent` tool direction rather than routing model-invoked parallel work through `/agent parallel`, because the direct tool path can deterministically encode the requested job count in one tool call and keeps model-visible delegation provider-neutral.
- Remaining implementation target: strengthen batch result provenance, add four-agent coverage, expose enough structured result metadata for logs/final-response checks, and document the residual response-claim validation boundary.
- Added four-job batch coverage proving all valid jobs spawn before the first wait, job labels flow into spawn requests, and batch results include `mode`, requested/started/failed counts, `agentIds`, `groupId`, and provenance.
- Added single-job regression coverage proving prompt text containing `parallel`/`background`/`detach` remains `mode: "single"` and cannot be mistaken for batch execution.
- Added model-visible claim guidance so final responses must be based on returned mode/count fields rather than narration.
- Split batch execution into `agent-tool-batch.ts` so the public Agent tool factory remains focused on schema/dependency composition.

## Implementation Checklist

- [x] Add RED coverage for four-agent batch execution.
- [x] Add RED coverage for structured batch provenance and requested/started counts.
- [x] Add RED coverage that single-job `Agent` execution reports `mode: "single"` and cannot be mistaken for parallel batch execution.
- [x] Implement structured result metadata without breaking the single-job prompt contract.
- [x] Update specs/task result notes for the response-claim validation boundary.
- [x] Run affected SDK and command-agent checks.

## Result

Completed in `fix/cli-sdk-backlog-053-006`.

- The canonical model-invocable path is one direct `Agent` tool call with `jobs[]` for explicit multi-agent/parallel requests.
- Batch execution starts all valid jobs before waiting and returns per-job results with shared `groupId`, job labels, counts, `agentIds`, and provenance.
- Single-job execution now returns `mode: "single"` plus requested/started/failed counts and provenance, preserving the single `prompt` contract while making it distinguishable from batch.
- Final-response claim guidance is now part of the model-visible Agent tool description and SDK spec.
- Verified with targeted Agent tool tests, full `agent-sdk` tests, `agent-command-agent` tests, typechecks, and lint.
