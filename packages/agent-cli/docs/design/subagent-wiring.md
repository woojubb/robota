# agent-cli — subagent and background process wiring

> Whitebox design for `@robota-sdk/agent-cli`. The blackbox contract lives in
> [`../SPEC.md`](../SPEC.md); nothing here is a promise to a consumer. Placement follows the
> consumer-impact test in
> [`design-doc-authoring`](../../../../.agents/skills/design-doc-authoring/SKILL.md).

## Context & Goal

The Node runtime adapters the CLI injects into `InteractiveSession`: the managed shell process runner
and the child-process subagent runner factory. Subagent lifecycle, the runner port, and the agent
definition format are owned by `@robota-sdk/agent-framework`
([`../../../agent-framework/docs/SPEC.md`](../../../agent-framework/docs/SPEC.md)); the CLI owns only
the process adapter, which no consumer observes.

## Constraints

- The CLI owns no subagent lifecycle state — `BackgroundTaskManager` does.
- Only serializable data crosses the IPC boundary; the worker reconstructs its own provider.
- Agent command behaviour belongs to `@robota-sdk/agent-command`, not the TUI.

## Internal Structure

What `agent-framework` owns is not restated here — subagent lifecycle, the runner port, agent
definition loading, and `InteractiveSession`'s handling of both are specified in
[`../../../agent-framework/docs/SPEC.md`](../../../agent-framework/docs/SPEC.md), and agent command
behaviour in `@robota-sdk/agent-command`. A paraphrase of an owner's contract drifts more quietly
than a copy of it. What follows is only what the CLI itself owns: the Node process adapters.

The CLI owns Node runtime process adapters. It injects `createManagedShellProcessRunner()` into `InteractiveSession` as a `kind: 'process'` background task runner. SDK composition then exposes the separate `BackgroundProcess` tool; the existing foreground `Bash` tool remains unchanged.

`createManagedShellProcessRunner()` owns only Node process spawning, stdin forwarding,
termination, and process-environment wiring. Bounded output capture, source-prefixed log line
projection, and cursor-based log pagination come from runtime-owned helpers re-exported by the SDK.

The CLI also injects `createChildProcessSubagentRunnerFactory()` into `InteractiveSession` as the production subagent runner factory. The factory receives SDK-assembled subagent dependencies, but the runner starts a child Node worker and sends only serializable config/context/provider/agent-definition data over IPC. The worker reconstructs its provider inside the child process using the same concrete provider profile the CLI used for the parent session.

`child-process-subagent-runner-result.ts` owns child-worker result orchestration for the adapter: IPC message validation, timeout timer cleanup, early-exit errors, and transcript metadata projection. `child-process-subagent-runner.ts` remains the process factory and payload composer.

Child-process subagent runner responsibilities:

- fork one worker process per subagent job
- pass `ISubagentSpawnRequest`, agent definition, parent config/context, permission mode, and serialized provider profile over IPC
- expose child `pid` on the background task state
- forward worker text/tool IPC messages to `BackgroundTaskManager` progress events
- create an append-only subagent transcript at `.robota/logs/PARENT_SESSION_ID/subagents/AGENT_ID.jsonl` and make `/agent read AGENT_ID` read that transcript while the worker is still running
- forward cancellation to the worker and terminate it after a grace period
- forward follow-up prompts to workers that support input
- keep runtime-owned lifecycle state inside `BackgroundTaskManager`; the CLI owns only the Node process adapter

Subagent transcript pagination uses the same runtime-owned log page helper as process background
tasks. The CLI remains responsible for locating and reading the append-only transcript file.

When an agent request sets `isolation: 'worktree'`, the CLI composes the runtime-owned `WorktreeSubagentRunner` exposed through SDK contracts around the child-process runner and injects a CLI-owned `GitWorktreeIsolationAdapter`. The concrete adapter (git CLI + filesystem I/O) is owned by the CLI at `src/subagents/git-worktree-isolation-adapter.ts` and injected as the required `worktreeAdapter` at the `createChildProcessSubagentRunnerFactory` call in `cli.ts` (INFRA-031 / ARCH-FIX-024). `agent-executor` owns only the `ISubagentWorktreeAdapter` port and the pure `WorktreeSubagentRunner` decorator; `agent-subagent-runner` no longer hard-defaults a concrete git adapter.

The runtime worktree runner owns worktree lifecycle orchestration:

- delegate non-worktree requests unchanged
- run isolated workers with `cwd` set to the prepared worktree path
- remove clean worktrees exactly once on success, worker failure, startup failure, or successful cancellation
- preserve dirty worktrees and return `worktreePath`, `branchName`, `worktreeStatus`, `worktreeNextAction`, `worktreeBaseRevision`, and `parentWorktreeStatus` in result metadata
- fire SDK hook notifications for `WorktreeCreate` and `WorktreeRemove` when configured

The CLI-owned Git adapter implements only local Git/filesystem I/O:

- create a temporary branch and worktree before the worker starts
- retry branch/path collisions with a new short id before failing
- remove the worktree and branch when the worktree remains clean
- support nested repository cwd resolution and detached HEAD worktree creation
- fail non-Git cwd with an actionable worktree-isolation error
- report whether the worktree has local edits and expose `git status --porcelain` output for preserved worktree handoff
- allow dirty parent checkouts while surfacing the base revision and parent `git status --porcelain` in preserved handoff metadata

When a user invokes a skill slash command with `context: fork`, the CLI still calls only `interactiveSession.executeCommand(...)`. The SDK and skills command module handle fork execution deterministically. The CLI may render a `skill-invocation` event, but it must not convert fork skills into plain prompt injection.

When a user asks in normal conversation to call or delegate to an agent, the request is handled through the model-invocable `/agent` built-in command module. The CLI only displays the resulting command/background events and final assistant response.

The CLI may render existing SDK fields and selection indicators now. Any future row fields such as
elapsed time, input-needed reason, terminal result, archive, or clear controls must be introduced in
SDK/runtime projections before TUI components display them.

`BackgroundTaskPanel` renders SDK default-visible background task entries as a one-level tree headed
by `Background work`. Each child row is built by the pure `formatBackgroundTaskRow` formatter from
`IExecutionWorkspaceEntry` data and contains a compact status marker, human-readable task label,
secondary metadata such as task kind/status/attention, and a short whitespace-normalized preview.
Task-ID exposure and the `/background` command grammar are contract — see
[`../SPEC.md`](../SPEC.md) under `User-Facing Contract`.

For implementation details of subagent/background execution (`/agent`, `context: fork` skills, background task manager, agent definition scanning), see the agent-framework and agent-executor SPEC files.

Background job groups are SDK-owned orchestration state. The TUI may render group entries from the
SDK execution workspace snapshot, but it must not decide group completion, aggregate raw logs,
trigger continuations, or own retry/wait behavior. Group waiting and summaries are exposed through
SDK APIs and `/agent wait` command behavior.

## Key Flows

`/agent` → framework spawns a job → the CLI factory forks a worker → config, context, provider
profile, and agent definition go over IPC → worker events are forwarded to `BackgroundTaskManager`
progress events → the transcript is appended to `.robota/logs/…/subagents/AGENT_ID.jsonl`. What the
user sees and controls — the workspace switcher, `/agent read` — is contract in
[`../SPEC.md`](../SPEC.md).

## Test Approach

IPC payload and result-orchestration unit tests; worker lifecycle is covered by the background-task
integration suite.
