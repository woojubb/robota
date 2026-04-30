---
title: CLI-BL-019 Subagent process manager and parallel execution research
status: completed
priority: high
urgency: now
created: 2026-04-30
branch: feat/subagent-process-manager
packages:
  - agent-sdk
  - agent-cli
  - agent-sessions
---

# CLI-BL-019: Subagent Process Manager and Parallel Execution Research

## Objective

Research the current Robota subagent implementation and define the technical path for managed, parallel subagent execution with visible TUI lifecycle controls.

## Plan

- [x] Create a new branch from `develop`.
- [x] Audit current subagent execution code paths.
- [x] Research process-management and concurrency implementation options.
- [x] Research how comparable products expose background/parallel agents in their UI.
- [x] Produce a design recommendation and implementation sequence.

## Current Code Findings

- Robota already exposes a model-callable `Agent` function tool and loads built-in/custom agent definitions.
- `createSubagentSession()` creates a separate in-process `Session` with isolated conversation history and filtered tools.
- Subagents currently run as awaited tool calls; there is no durable subagent runtime registry, job manager, thread list, or process supervision layer.
- Core tool execution already dispatches multiple tool calls in parallel, so multiple `Agent` tool calls from one model response can run concurrently in the same Node.js process.
- The existing parallel tool execution path does not enforce its `maxConcurrency` field.
- Subagent sessions share the same provider instance as the parent. Provider configuration mutates `provider.onTextDelta` and server-tool callbacks, so concurrent parent/subagent streaming can mix UI output or overwrite callbacks.
- `InteractiveSession` has only parent-level `thinking`, `tool_start`, `tool_end`, `text_delta`, `complete`, `error`, `interrupted` events. It has no subagent lifecycle events.
- The TUI has no subagent panel or subagent state model. It renders tool activity and one global `Thinking...` state only.
- `CLI-BL-013` separately tracks worktree isolation. That remains relevant for write-capable background agents.

## Product Research Notes

### Claude Code subagents

Sources:

- <https://code.claude.com/docs/en/sub-agents>
- <https://code.claude.com/docs/en/agent-teams>

Relevant behavior:

- Subagents are Markdown files with YAML frontmatter. Claude Code supports project, user, plugin, managed, and CLI-defined scopes.
- `/agents` has a Running tab for live subagents and a Library tab for definition management.
- The frontmatter surface already includes fields Robota partially mirrors or should consider: `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `isolation`, and `color`.
- Subagents can run in foreground or background. Foreground blocks the main conversation. Background runs concurrently while the main conversation continues.
- Background named subagents pre-approve required permissions before launch and auto-deny unapproved actions.
- Claude Code supports explicit invocation by natural language and `@agent-name` mention.
- Forked subagents inherit the current full conversation and run in the background. Running forks appear in a panel below the prompt with one row per fork; users can move selection, open transcript/follow up, dismiss finished forks, or stop running forks.
- Agent teams are a heavier model: one lead plus separate teammates, task list, mailbox, optional split panes via tmux/iTerm2, and direct teammate steering.

Implication for Robota:

- Robota should first implement "managed subagent threads" rather than full agent teams. The necessary UI minimum is a live subagent list with statuses, stop/dismiss controls, transcript/result visibility, and follow-up routing. A shared task list/mailbox can be a later feature.

### Codex subagents

Source:

- <https://developers.openai.com/codex/subagents>

Relevant behavior:

- Codex can spawn specialized agents in parallel and collect their results in one consolidated response.
- Subagent workflows are enabled by default, but Codex only spawns subagents when explicitly asked.
- Codex manages orchestration: spawning subagents, routing follow-up instructions, waiting for results, and closing agent threads.
- The CLI has `/agent` to switch between active agent threads and inspect ongoing thread state.
- Users can steer, stop, or close running/completed subagents in natural language.
- Subagents inherit sandbox policy and parent runtime overrides. Approval prompts from inactive threads can surface in the active CLI with the source thread label.
- Global settings include `agents.max_threads`, `agents.max_depth`, and worker runtime timeout.

Implication for Robota:

- Robota needs a first-class runtime registry with agent IDs, thread labels, lifecycle state, max-thread limits, depth limits, cancellation, and wait/close semantics. This is more than returning a JSON `agentId` from the existing `Agent` tool.

### Cursor background agents

Source:

- <https://docs.cursor.com/en/background-agents>
- <https://docs.cursor.com/background-agent/api/overview>

Relevant behavior:

- Cursor Background Agents are asynchronous remote agents. The UI exposes a background-agent sidebar/list where users view status, search agents, create new agents, send follow-ups, and take over.
- Agents run in isolated Ubuntu-based machines, clone from GitHub, work on separate branches, and push changes for handoff.
- The API supports programmatic creation/management, follow-up prompts, repository integration, and a high active-agent limit.
- Security posture differs from foreground agents because background agents auto-run terminal commands, which creates data exfiltration and prompt-injection risk.

Implication for Robota:

- Cursor's remote VM model is too large for this immediate local CLI slice, but its UX is directly applicable: background job list, status, log/conversation inspection, follow-up, branch/worktree handoff, and explicit security warnings for autonomous/background execution.

### GitHub Copilot cloud agent

Source:

- <https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent>

Relevant behavior:

- Copilot cloud agent works asynchronously in a GitHub Actions-powered environment.
- It can research a repository, create a plan, make code changes on a branch, and optionally open a pull request.
- It is distinct from local IDE agent mode. The handoff unit is a branch/PR plus logs/status, not a local TUI thread.
- Custom agents can be specialized by task with prompts/tools.

Implication for Robota:

- Robota should not copy the cloud workflow now, but should keep the process-manager API compatible with future handoff metadata: branch, worktree path, PR URL, logs, and result summary.

### Gemini CLI subagents

Source:

- <https://github.com/google-gemini/gemini-cli/blob/main/docs/core/subagents.md>

Relevant behavior:

- Gemini CLI exposes subagents as tools to the main agent.
- Subagents have focused context, specialized tool sets, and independent context windows.
- Explicit invocation uses `@subagent_name`.
- Custom subagents are Markdown files under `.gemini/agents/*.md` or `~/.gemini/agents/*.md`.
- Subagents cannot call other subagents.
- The schema includes `timeout_mins`, tool wildcards, model overrides, max turns, and subagent-specific policies.

Implication for Robota:

- Robota already has the "subagent as model-callable tool" shape. The missing part is lifecycle management, timeout, policy attribution, and UI visibility.

## Technical Research Notes

### Current Robota implementation level

Robota currently has "in-process awaited subagent calls", not a managed process/thread system.

- `packages/agent-sdk/src/tools/agent-tool.ts`
  - `createAgentTool(deps)` exposes an `Agent` tool.
  - `runAgent()` resolves a built-in/custom agent definition, creates a subagent session, awaits `session.run(args.prompt)`, then returns a JSON string.
  - An `agentId` is generated only for the return payload. There is no registry, durable transcript, lifecycle state, cancellation handle, or follow-up route.
- `packages/agent-sdk/src/assembly/create-subagent-session.ts`
  - Creates a separate `Session` with separate conversation history and filtered tools.
  - Always removes `Agent`, so subagents cannot spawn subagents.
  - Reuses the parent provider instance.
- `packages/agent-sdk/src/interactive/interactive-session.ts`
  - Fork skill execution also creates a subagent session and awaits its result.
  - `executeForkSkillCommand()` refuses to run while the parent session is executing.
  - Events are parent-level only: text delta, tool start/end, thinking, complete, error, context update, interrupted.
- `packages/agent-core/src/services/execution-round-tools.ts`
  - Tool batches run in `parallel` mode with `maxConcurrency: 5`.
- `packages/agent-core/src/services/tool-execution-batch.ts`
  - `executeParallel()` uses `Promise.allSettled()` over every request. The `maxConcurrency` value is currently ignored.
- `packages/agent-sessions/src/session-lifecycle.ts`
  - `configureProvider()` mutates the provider instance by setting streaming/server-tool callbacks.
  - Because parent and child sessions share the same provider object, concurrent sessions can mix or overwrite callback state.
- `packages/agent-cli/src/ui/tui-state-manager.ts`
  - TUI state has no subagent model.
- `packages/agent-cli/src/ui/StatusBar.tsx`
  - Shows one global thinking state only.
- `packages/agent-cli/src/ui/MessageList.tsx`
  - Renders chat and tool summaries, but no subagent lifecycle/transcript entries.

### Implementation options

#### Option A: in-process scheduler only

Shape:

- Add `SubagentManager` with job registry, bounded concurrency, events, cancellation, and result collection.
- Keep each child as a `Session` object in the same process.

Pros:

- Lowest implementation cost.
- Easy to unit test with fake sessions/providers.
- Good first step for TUI lifecycle events and Codex-like thread semantics.

Cons:

- Does not satisfy the separate-process requirement by itself.
- Shared provider mutation must be fixed first.
- A runaway subagent can still affect the parent event loop and memory.

Use:

- Build this as the functional core and API contract. Do not stop here for the final feature.

#### Option B: Node child process worker

Shape:

- Parent creates a managed job and starts a Node worker entrypoint with `child_process.fork()` or `spawn(process.execPath, [...])`.
- Parent/child communicate through IPC messages: start, text_delta, tool_start, tool_end, permission_request, result, error, cancel, heartbeat.
- Parent owns lifecycle: pid, status, startedAt, updatedAt, timeout, logs, transcript path, exit code, signal code.
- Child creates its own provider and `Session`, runs the assigned prompt, and sends structured events back.

Pros:

- Best fit for "subagent has separate process management".
- Node docs explicitly support `fork()` with IPC for parent/child messages.
- AbortSignal/kill support can map cleanly to cancel/stop.
- Crash isolation is better than in-process sessions.
- Stdout/stderr can be captured into per-agent logs.

Cons:

- Requires serializable worker config and a provider factory/adapter boundary.
- Requires careful permission routing and prompt approval UX.
- Requires stronger cleanup to avoid orphan processes.

Use:

- Recommended implementation target after the in-process manager contract is defined.

#### Option C: Worker Threads

Shape:

- Spawn `Worker` instances for subagents and communicate with message ports.

Pros:

- Lower overhead than processes.
- Useful for CPU-bound JS work.

Cons:

- Node docs state workers are useful for CPU-intensive JavaScript and do not help much with I/O-heavy work.
- LLM calls, tool calls, file I/O, and shell commands are I/O-heavy.
- Weaker fault isolation than child processes.

Use:

- Not recommended for this feature.

#### Option D: remote/cloud agents

Shape:

- External workers in remote VMs or CI, branch/PR handoff.

Pros:

- Strong isolation and durable handoff.

Cons:

- Too large for this local CLI milestone.
- Requires auth, remote environment setup, secrets, repo integration, and cost controls.

Use:

- Future direction only.

### Recommended architecture

Use a layered design:

1. `SubagentManager` functional core in `agent-sdk`
   - Owns job registry and state transitions.
   - Supports foreground and background execution.
   - Enforces `maxConcurrent`, `maxDepth`, and timeout.
   - Emits explicit lifecycle events.
   - Provides APIs equivalent to spawn, wait, list, get, cancel, dismiss/close, send follow-up.
2. `SubagentRunner` port
   - Interface for starting a job and streaming events back.
   - Initial adapter can be `InProcessSubagentRunner` for unit tests and low-risk migration.
   - Production adapter should be `ChildProcessSubagentRunner`.
3. `ChildProcessSubagentRunner` in the CLI composition layer
   - Owns Node process creation because CLI knows provider construction and local env.
   - Uses IPC for structured events.
   - Captures stdout/stderr to per-agent logs.
   - Kills/aborts on cancel and timeout.
4. Provider isolation
   - Do not share the same mutable provider object between parent and child sessions.
   - Either create a new provider per session/job or change provider callback wiring so callbacks are per request rather than mutable provider properties.
5. TUI state and rendering
   - Extend `TuiStateManager` with `subagents: ISubagentViewState[]`.
   - Add a compact panel below the streaming/tool area or above input:
     - label/color
     - status: queued, running, waiting_permission, completed, failed, cancelled
     - elapsed time
     - current tool/action
     - unread result/error marker
   - Add commands/key handling later:
     - list/open selected agent transcript
     - stop running agent
     - dismiss completed agent
     - send follow-up to an open agent
   - Keep Ink components thin; unit-test TUI state transitions in the manager.
6. Worktree isolation
   - Keep `CLI-BL-013` separate but design job metadata now for `cwd`, `worktreePath`, `branchName`, and cleanup state.

### Event model proposal

Add SDK-visible event types:

- `subagent_created`
- `subagent_started`
- `subagent_delta`
- `subagent_tool_start`
- `subagent_tool_end`
- `subagent_permission_request`
- `subagent_completed`
- `subagent_failed`
- `subagent_cancelled`
- `subagent_closed`

Minimum job state:

```ts
interface ISubagentJobState {
  id: string;
  type: string;
  label: string;
  parentSessionId: string;
  status: 'queued' | 'running' | 'waiting_permission' | 'completed' | 'failed' | 'cancelled';
  mode: 'foreground' | 'background';
  depth: number;
  pid?: number;
  cwd: string;
  worktreePath?: string;
  branchName?: string;
  promptPreview: string;
  currentTool?: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  result?: string;
  error?: string;
}
```

### Implementation sequence

1. Add failing unit tests for subagent lifecycle, bounded concurrency, cancellation, and provider isolation.
2. Add core types and `SubagentManager` with an in-memory registry and fake runner tests.
3. Replace direct awaited `Agent` tool execution with manager-backed foreground execution while preserving current return JSON shape.
4. Add background execution mode and non-blocking return semantics.
5. Add `ChildProcessSubagentRunner` and worker entrypoint.
6. Fix provider isolation by creating per-job providers or per-request callback binding.
7. Add `InteractiveSession` subagent lifecycle events.
8. Add TUI state manager tests and TUI panel rendering.
9. Add CLI commands/slash handling for list/open/cancel/dismiss/follow-up.
10. Integrate worktree metadata and later connect to `CLI-BL-013`.

### Key risks

- Provider construction currently belongs to CLI composition while subagent creation lives in SDK. A child process cannot receive a live provider object, so the process runner needs serializable provider config plus a CLI-owned provider factory.
- Permission prompts from background agents need attribution and an explicit policy. Claude Code pre-approves named background subagents; Codex surfaces inactive-thread approvals with source labels. Robota should not let background workers silently request arbitrary tool approvals without UI attribution.
- Current tool parallelism is unbounded despite `maxConcurrency`. This must be fixed before relying on multi-agent fan-out.
- Process cleanup must handle normal completion, user cancel, timeout, parent shutdown, and child crash.
- Parallel write-capable agents will conflict in the same worktree. Start read-only/background research first or pair write-capable jobs with worktree isolation.

## Test Plan

- Unit-test `SubagentManager` state transitions.
  - Given a spawn request, when the runner starts successfully, then state moves `queued -> running`.
  - Given a successful runner result, when the promise resolves, then state moves to `completed` and stores result.
  - Given a runner error, when the promise rejects, then state moves to `failed` and stores error.
  - Given a running job, when cancel is requested, then the runner receives abort/kill and state moves to `cancelled`.
- Unit-test bounded concurrency.
  - Given `maxConcurrent = 2` and four jobs, when all are spawned, then only two start before either completes.
  - Given a queued job and one running job completes, then the next queued job starts.
- Unit-test foreground/background behavior.
  - Given foreground mode, when the Agent tool invokes a subagent, then it awaits completion and returns the result payload.
  - Given background mode, when the Agent tool invokes a subagent, then it returns the job ID immediately and leaves the job running.
- Unit-test provider callback isolation.
  - Given parent and child sessions stream concurrently, when child text deltas arrive, then parent `text_delta` subscribers do not receive them unless explicitly subscribed to child events.
- Unit-test process runner protocol with a fake child transport.
  - Given worker emits `delta`, `tool_start`, `tool_end`, and `result`, when parent receives IPC messages, then the manager emits matching lifecycle events in order.
  - Given worker exits non-zero before result, when parent receives exit, then the job fails with exit metadata.
- Unit-test TUI state manager subagent state independently of Ink.
  - Given `subagent_started`, when state manager handles it, then the subagent row appears with running status.
  - Given `subagent_tool_start`, then `currentTool` is updated.
  - Given `subagent_completed`, then status and unread result marker are updated without clearing parent streaming text.
- Add focused integration tests for model-requested multiple `Agent` calls and slash/fork-driven background execution after the manager API lands.

## Blockers

- None.

## Result

Research complete. Recommendation: implement a manager/runner split, first with a testable in-process runner and then with a CLI-owned child-process runner. TUI should represent subagents as explicit managed rows/threads instead of treating them as ordinary tool calls.
