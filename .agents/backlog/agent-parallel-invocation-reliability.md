# Agent Parallel Invocation Reliability

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

- [ ] An explicit request for N parallel agents starts N subagent jobs before waiting for their results.
- [ ] The runtime supports a deterministic batch path that does not depend on the model emitting N separate tool calls.
- [ ] The parent turn records one group/provenance object tying the requested jobs together.
- [ ] The user-facing response does not claim parallel execution unless the jobs were actually started.
- [ ] Tests cover direct `Agent` tool batch behavior or `/agent parallel` model-invocation behavior, whichever becomes canonical.
- [ ] Tests cover the regression where the assistant says "4 parallel agents" but only one job is created.
- [ ] Session logs can distinguish: provider emitted one batch tool call, provider emitted N direct tool calls, or runtime expanded one request into N jobs.

## Risks & Mitigations

| Risk                                            | Mitigation                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Batch input complicates the `Agent` tool schema | Keep single-job fields backwards compatible and add an explicit `jobs` array contract                              |
| Model still narrates unsupported behavior       | Add runtime-side validation and response metadata so the final response can be checked against actual started jobs |
| `/agent parallel` and `Agent` batch diverge     | Share parser/request-building logic between both paths                                                             |
| Partial startup failure leaves unclear state    | Return structured per-job startup results and group metadata                                                       |

## Promotion Path

1. Assign a backlog ID, for example `SDK-BL-0XX-agent-parallel-invocation-reliability`.
2. Move this file to `.agents/tasks/<ID>-agent-parallel-invocation-reliability.md`.
3. Update `packages/agent-sdk/docs/SPEC.md`, `packages/agent-command-agent/docs/SPEC.md`, and relevant session logging specs before implementation.
4. Implement with TDD around two-agent and four-agent explicit parallel requests.
