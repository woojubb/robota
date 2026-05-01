---
title: CLI-BL-036 Background Agent Result Orchestration
status: in-progress
priority: high
urgency: next
created: 2026-05-01
packages:
  - agent-sdk
  - agent-cli
  - agent-command-agent
  - agent-runtime
  - agent-transport-headless
  - agent-transport-ws
related:
  - .agents/tasks/completed/CLI-BL-030-background-agent-jobs.md
  - .agents/tasks/CLI-BL-032-agent-invocation-router.md
  - .agents/tasks/CLI-BL-035-background-agent-watchdogs.md
---

# CLI-BL-036 Background Agent Result Orchestration

## Summary

Design and implement the orchestration layer that lets a parent Robota session spawn background agents, wait for one or more results when the requested task requires consolidation, resume follow-up work after completion, and surface concise TUI notifications without hardcoded prompt directives.

## Problem

Robota can spawn background agent jobs and render live status, but completion handling is still mostly passive. A user can ask for two agents to analyze a backlog item in parallel; Robota may create background jobs, but the parent turn has no explicit contract for waiting, collecting terminal outputs, and producing the consolidated answer.

The current background panel also shows raw streamed text previews. Leading newlines and repeated whitespace can push the preview onto extra terminal lines, making the job status harder to scan.

## Prior Art Research

- Codex subagents explicitly support spawning specialized agents in parallel and collecting their results into one response. Codex docs describe the orchestration loop as spawning agents, routing follow-up instructions, waiting for results, closing threads, and returning a consolidated response. Source: https://developers.openai.com/codex/subagents
- Codex CLI treats `/agent` as a thread-management command for inspecting or continuing spawned subagent threads, and it exposes `/ps` and `/stop` for background terminal visibility/control. Source: https://developers.openai.com/codex/cli/slash-commands
- Claude Code subagents run in separate contexts, return summaries to the main conversation, and use subagent descriptions to decide when delegation is appropriate. Source: https://code.claude.com/docs/en/sub-agents
- Claude Code documents both foreground and background subagent modes. Background subagents run concurrently while the user continues working; when independent subagents finish, their results return to the main conversation and Claude synthesizes them. Source: https://code.claude.com/docs/en/sub-agents
- OpenAI's API background mode models long-running work as asynchronous execution with status polling until a terminal state, then final output retrieval. Source: https://developers.openai.com/api/docs/guides/background
- OpenAI Agents SDK separates orchestration choices into LLM-driven decisions and code-driven deterministic flow. Its "agents as tools" pattern keeps one manager responsible for combining specialist outputs, while code orchestration can run independent work in parallel with primitives like `Promise.all`. Source: https://openai.github.io/openai-agents-js/guides/multi-agent/

## Architecture Recommendation

Add an SDK-owned `BackgroundJobOrchestrator` layer above `BackgroundTaskManager`.

The manager remains responsible for lifecycle, persistence, cancellation, logs, and events. The orchestrator owns higher-level relationships: requested job groups, wait policies, result aggregation, and follow-up triggers. CLI/TUI should only subscribe to view models and invoke SDK APIs.

Recommended core concepts:

- `BackgroundJobGroup`: a parent-session-scoped collection of related jobs spawned from one user request or command execution.
- `WaitPolicy`: `detached`, `wait_all`, `wait_any`, and `manual`. `/agent parallel` should use `wait_all` consolidation by default because model-routed parallel delegation usually implies one parent answer after all specialist agents finish. Detached background execution must be explicit.
- `CompletionSubscription`: an SDK event subscription that fires when a group reaches its policy terminal condition.
- `ResultEnvelope`: normalized terminal result containing `taskId`, `label`, `status`, `summary`, `outputRef`, `error`, and timing metadata.
- `ContinuationRequest`: a structured follow-up payload that can be submitted to the parent session after a group completes, preserving causality in session logs.

The `/agent` command module should expose orchestration usage in its own command/tool descriptor. It may describe that parallel agents should be given self-contained tasks and asked to return concise final summaries, but that guidance must live in the command descriptor owned by `agent-command-agent`, not in `system-prompt-builder` or SDK core.

## Implementation Plan

1. Add `BackgroundJobGroup` and wait-policy contracts to `agent-sdk`.
2. Add a pure reducer for group membership and terminal aggregation.
3. Add `BackgroundJobOrchestrator` that subscribes to `BackgroundTaskManager` events and emits group completion events.
4. Persist group creation, membership, state transitions, terminal envelopes, and continuation requests in `.robota` session data.
5. Extend `agent-command-agent` so `/agent parallel ...` and model-invoked agent command calls can create a group with `wait_all` when the request requires a consolidated answer.
6. Add deterministic group wait and summary support through SDK APIs plus default `/agent parallel` wait behavior, compatibility `/agent parallel --wait`, explicit `/agent parallel --detach`, and `/agent wait GROUP_ID`.
7. Add TUI rendering for group-level status as presentation-only projection of SDK group events: pending/running count, completed count, failed count, and one-line previews.
8. Add notification behavior through SDK group events when a detached background group completes while the user is typing or another turn is active.
9. Add headless and WebSocket event projection for group lifecycle and group completion summaries.
10. Keep raw agent logs out of parent context by default; parent continuation receives `ResultEnvelope` summaries and can fetch detailed logs only when asked.

## Progress

### 2026-05-01

- Started implementation after opening PR #107 for the current unmerged branch.
- Updated `agent-sdk` and `agent-command-agent` specs so the first implementation slice has an SDK-owned background job orchestration contract and `/agent parallel` creates a `wait_all` group from command-owned metadata.

### 2026-05-01 continued

- Created `feat/agent-orchestration-completion` after the previous PR was merged.
- Reaffirmed the layer split: SDK owns group wait/summary/orchestration, command modules invoke SDK APIs, transports project SDK events, and TUI renders view models only.
- Added SDK `summarizeBackgroundJobGroup(group)` with status counts and one-line result summaries.
- Added `/agent parallel --wait` and `/agent wait GROUP_ID` command handling through SDK group wait/summary APIs.
- Verified background preview trimming remains a TUI view-model projection, not orchestration logic.

### 2026-05-01 follow-up diagnosis

- Inspected the latest persisted session and confirmed both subagents completed under `group_1` with `wait_all`; the session also contains a normal assistant response after the command tool result.
- Identified the fragile contract behind the reported failure mode: only `parallel --wait` was tested as a consolidation path. Plain `parallel` remained detached, so if a local model omitted `--wait`, completion events were persisted but no same-turn consolidated command result was guaranteed.
- Changed `/agent parallel` to wait for the SDK group summary by default while keeping every spawned agent as a background job. Added explicit `--detach` for intentionally fire-and-return groups.

### 2026-05-01 direct Agent tool diagnosis

- Inspected the next persisted session and found the model did not use `/agent parallel`; it emitted three direct `Agent` tool calls. The tool returned `{ background: true, status: "running" }` immediately for each call, then the parent turn ended before any subagent terminal result was available.
- Confirmed the terminal events were persisted later: one subagent failed with idle timeout and two reached completed states. Because no group or wait contract existed for direct `Agent` tool calls, completed/failed outcomes did not trigger a parent continuation.
- Updated the direct `Agent` tool contract so background runtime mode still waits for a terminal result by default. Completed, failed, and timed-out results now flow back through the tool result channel and trigger the normal parent model continuation. Explicit `detach: true` is required for fire-and-return behavior.

## Test Plan

- Given a group with two running jobs, when both complete successfully, then the orchestrator emits one `group_completed` event with both result envelopes.
- Given a `wait_all` group where one job fails, when remaining jobs finish, then the group completes with mixed terminal state and preserves the failed envelope.
- Given a `wait_any` group, when the first job completes, then the completion subscription fires once and later job completions update stored state without duplicate continuation requests.
- Given a detached group, when all jobs complete, then no automatic parent continuation is enqueued but the TUI notification event is emitted.
- Given a continuation request, when it is enqueued, then session logs contain the source group id, source task ids, and exact result envelopes.
- Given `/agent parallel ...`, when all grouped background agents finish, then the command returns the SDK group summary by default.
- Given `/agent parallel --wait ...`, when all grouped background agents finish, then the command returns the SDK group summary as a compatibility alias.
- Given `/agent parallel --detach ...`, when grouped agents are started, then the command returns `agentId` values and `groupId` immediately without waiting.
- Given a direct `Agent` tool call omits `detach`, when the background subagent completes, then the tool result contains the terminal output and the parent conversation can continue.
- Given a direct `Agent` tool call omits `detach`, when the background subagent fails or times out, then the tool result contains the terminal failure with `agentId` so the parent conversation can explain or recover.
- Given a direct `Agent` tool call includes `detach: true`, when the subagent starts, then the tool result returns `agentId` immediately and no parent continuation is guaranteed until later collection.
- Given `/agent wait GROUP_ID`, when the group exists, then the command waits for completion and returns the same SDK group summary.
- Given `stream-json` is running, when a background job group event fires, then headless output emits `background_job_group_event`.
- Given a WebSocket client is connected, when a group event fires or a group query is received, then the transport forwards SDK group events/snapshots without deriving orchestration state.
- Given the `/agent` command descriptor is inspected, then orchestration guidance comes from `agent-command-agent` descriptor metadata and no SDK prompt builder contains agent-specific instructions.
- Given background task previews contain leading newlines and repeated whitespace, when projected to TUI view models, then preview text is a single trimmed line.
- Given a resumed session with persisted running or completed groups, when the orchestrator starts, then group state is reconstructed from persisted task/group events.

## Acceptance Criteria

- Background agent groups can be created, waited on, and summarized without CLI-owned orchestration logic.
- Parent-session follow-up work can be triggered from SDK-owned group completion events with full session-log provenance.
- TUI can show both individual background tasks and group-level completion notifications.
- `/agent` command/tool descriptors explain orchestration usage without hardcoded global prompt directives.
- Completed background agent outputs are summarized into parent context; verbose logs stay referenced unless explicitly requested.
- Session resume can reconstruct group state and continuation provenance.
