# Agent Executor Specification

## Purpose

`@robota-sdk/agent-executor` owns reusable runtime primitives for long-running Robota work:
background task lifecycle, queueing, cancellation, events, and state snapshots; a subagent job
compatibility facade over the generic background task layer; subagent runner ports and worktree
isolation decoration; and provider factory helpers that construct provider instances from
serializable config or profiles.

It is a composable material layer: it provides stateful runtime services and ports that higher
packages assemble with providers, sessions, processes, transports, and UI. It does not itself
create sessions, tools, prompts, child processes (other than through its own shell/scheduled task
runners), Git worktrees, transports, or TUI state, and it does not read config files or project
context.

The background-task DATA contracts (statuses, states, events, errors, requests, results, log
pages) and the subagent job state family are owned elsewhere (`@robota-sdk/agent-interface-execution`);
this package owns the runtime SPI — the error class, runner/manager ports, and handles — and
imports those contracts rather than redefining them.

## Non-goals / Boundaries

- Does not create sessions, tools, prompts, child processes (except via its own managed shell/scheduled
  runners), Git worktrees, transports, or TUI state.
- Does not read config files or project context.
- Does not import `agent-framework`, `agent-session`, `agent-tools`, provider packages, or `agent-cli`.
- Provider factory helpers depend only on core provider definitions; they do not import
  provider-specific packages.
- Concrete I/O belongs in adapters owned by runtime shells or dedicated adapter packages — this
  package owns ports, not concrete Git/process implementations beyond its own shell and scheduled
  task runners.
- Layer position: below `agent-framework`, which consumes this package's services. `agent-executor`
  must never depend on `agent-framework`. `agent-session` does not depend on `agent-executor`.
  Dependency direction is strictly upward: `agent-core` ← `agent-executor` ← `agent-framework`.
- Does not own command authorization provenance, user-local preference semantics, memory
  inspection, or TUI disclosure policy.
- Does not resolve storage roots, validate repository boundaries, or persist baseline workflow
  state.
- Must not read or write user-local memory, project memory, or command-history preferences, and
  remembered values must not influence runtime command execution.
- Does not own command selection, command meaning, environment-summary presentation, action
  provenance, or correctness interpretation of process tasks.
- Does not own selected workspace entry state, filled/empty UI indicators, presentation grouping,
  archive visibility, or TUI detail rendering.

## Contract stability

Public API shapes are stable runtime lifecycle contracts. Higher-layer packages (`agent-framework`)
depend on them; breaking changes to the public surface require coordinating all consumers before
merging.

## Forked conversations pass through, they are not interpreted

A subagent spawn request carries an optional `resumeSessionId` — the persisted session record a
**fork** job restores before its first turn. This package never reads that record; only the id
passes through it, onto the queued task's state, so a surface can distinguish a fork's task from
an ordinary one and offer an "attach" control. Resolving the id into a conversation is the
runner's job. A fork is a **copy** of a conversation under its own record — the parent's record is
neither read nor written by the job — and attaching to it is a **view switch, not a merge**.

## Tool-invocation runner: adopts, does not start

Unlike the other runner kinds, the tool-invocation runner does not start work when `start()` is
called — it ADOPTS an already-running MCP tool call. A caller registers the in-flight call
(token, settlement, and abort) before the manager ever spawns the task; `start()` looks the
request's adoption token up, and a token not found is treated as a programmer error (spawning
without adopting first), not a restart path. This lets the manager's lifecycle, cancellation, and
event model cover work that began outside it, without a manager-provisioned concurrency slot.

## Non-destructive schedule lifecycle

Scheduled tasks support pause/resume/edit as distinct from the irreversible cancel: a paused
schedule holds no concurrency slot, does not fire, and keeps its identity across pause → resume;
edit re-arms the schedule in place under the same task id. This is a thin lifecycle extension over
the existing scheduled runner, not a new scheduler.

A one-shot schedule that has no next run after firing (and is neither paused nor cancelled)
completes through the ordinary running → completed transition instead of being left running
forever with no next fire time — only a recurring schedule re-arms to sleeping.

The scheduled runner can compute the next eligible fire on or after a boundary without arming a timer,
using the same timezone semantics as the running schedule, so a restored session can tell a skipped
early slot from a genuinely missed wake.

## Shell command resolution

Both concrete shell-backed runners resolve the executable and its matching argument list through a
single shared, pure resolver and pass that pair to `spawn` without replacing either half
afterward — this keeps the two runners' shell-selection behavior identical. An unknown, non-blank
explicit shell fails synchronously with a typed error before any spawn attempt; a blank request
shell is treated as absent. Scheduled agent-wake-only requests do not resolve or spawn a shell at
all.

## Error taxonomy

The package error class carries a category and a recoverability flag. Categories in use: a
validation category for invalid requests or state transitions, a queue/capacity category, a
permission-denial category, a watchdog timeout category
(idle, max runtime, output limit, repetition, or stale worker), a runner-start/cancel/log-operation
category, a non-recoverable crash category for process-crash projection, a provider-failure
category, and a shell/process-failure category. Adapters may map external failures into these
categories but must not expose vendor-specific error objects through public runtime state. Shell
request validation is the one exception to that mapping rule: an unsupported-shell error is owned
upstream and propagates unchanged before spawn so callers can identify and correct the invalid
executable.

## Event architecture

The manager emits lifecycle/progress events only after the authoritative state transition is
already committed, so an observer must never be able to unwind the emitter by throwing. Delivery
isolates each observer (an optional sink first, then subscribers in registration order); a
throwing observer does not stop delivery to the rest, and each failure is reported through a
caller-supplied hook (default: a process warning) rather than propagated. Event payloads are
cloned task snapshots or primitive progress data; consumers may project them into UI rows,
transport messages, or logs, but must not mutate manager state directly from a listener.

## Watchdog and shutdown contract

- An idle timeout means no new runner progress event has arrived within the configured window;
  text deltas, tool start/end events, and permission requests all refresh the activity clock.
- A max-runtime timeout is a separate wall-clock cap, defaulting to no cap (`0`) so background
  agents are not bounded unless a caller opts in. A legacy agent-level timeout maps to the idle
  timeout; a process task's timeout remains its own runner-owned wall-clock timeout.
- Agent requests may bound output size, text-delta count, and repetition to stop runaway streams.
- A watchdog failure records which kind fired (idle, max runtime, output limit, repetition, or
  stale worker), cancels the runner handle when possible, and fails the task with the timeout error
  category.
- Terminal task records, logs, and transcript paths remain in the registry until explicitly closed.

Shutdown is idempotent, rejects new spawns once started, cancels all queued/running tasks through
their handles, emits terminal events before resolving when possible, and never deletes terminal
records.

## Concurrency and slot accounting

The manager admits at most a configured number of actively-executing tasks (default 4); the rest
queue. A slot is held only while a task is doing work, never while it merely exists: a task
acquires a slot when it starts executing and releases it when it moves to a non-executing state —
terminal, or sleeping. Scheduled tasks in particular must release their slot while sleeping,
because a cron task spends nearly all its life sleeping between fires; holding a slot there would
permanently starve the concurrency budget. Slot accounting is idempotent and keyed by task id, so a
release for a task that already released is a no-op, and releasing a slot drains the queue.

The scheduled runner uses croner's own overlap protection, which skips a fire while the previous
one is still running — so a hung fire would otherwise starve every subsequent fire. Each fire is
therefore bounded by its own per-fire timeout (the request's timeout when set); a fire that exceeds
it is killed as a process-group and the schedule returns to sleeping so the next fire can run. This
fire watchdog is independent of the manager-level agent watchdogs above.

## Worktree runner contract

The worktree subagent runner delegates non-worktree requests unchanged. For a worktree-isolated
request it must: prepare a worktree through an injected adapter; hand the inner runner the prepared
worktree path/branch on the job envelope rather than rewriting the request (the request's working
directory stays the parent checkout; a single execution-root helper is the sole reader of which
directory a job actually runs in); remove a clean worktree exactly once, whether preparation
succeeded and the job completed, failed asynchronously, failed synchronously at start, or was
cancelled successfully; preserve a dirty worktree instead of removing it, and surface enough
metadata (path, branch, status, next action) for a caller to act on it; and propagate
adapter-provided base-revision/parent-status metadata when available without discarding existing
result metadata.

The concrete Git worktree adapter itself lives outside this package, in the composition root that
performs Git operations; this package owns only the adapter port and the pure runner decorator, so
its "does not create Git worktrees" boundary is literally true (it still legitimately shells out for
its own managed-shell and scheduled-task runners, which is unrelated to worktree creation).

## Provider factory

Provider factory helpers resolve serializable provider config or profiles into live provider
instances, depending only on core provider definitions so they stay provider-package-agnostic. Both
the direct-key and the key-by-environment-variable-name resolution paths route through an injected
environment resolver rather than reading `process.env` directly, so tests can inject a fake resolver
instead of mutating the process environment; this is enforced by a repository-wide scan barring
direct `process.env` reads in this module.

## Transparent workflow relationship

This package owns the mechanical background task lifecycle state machine and transition validation
for agent/process work; it does not own command authorization provenance, user-local preference
semantics, memory inspection, or TUI disclosure policy. A "waiting for permission" status and an
"archived" designation are both projections a higher layer may rename or add for display — archived
in particular is a visibility/retention projection over terminal records, not a state that restarts
execution, and the runtime's `close()` is the mechanical terminal-record dismissal operation
underneath it.

## Extension points

Consumers extend the runtime by implementing its ports: a task runner (executes one task kind and
returns a cancellable handle), a subagent runner (executes one subagent job and reports structured
progress), a worktree adapter (creates, inspects, and removes concrete worktrees), and an event
listener (receives lifecycle/progress events without mutating runtime state). Adapter packages own
concrete I/O and must not add global task registries outside the manager.

Runner handles may expose paths for append-only log/transcript streams; the manager projects those
into task state immediately after runner start and preserves matching metadata on completion.

Task requests may carry opaque primitive metadata. The runtime clones it into task state and
preserves it across snapshots, but never interprets caller-specific keys — lifecycle transitions,
queueing, cancellation, and runner behavior must not depend on metadata contents. Higher layers may
use it for origin projection, grouping, or workspace read models.

## Package integration

- `agent-framework` imports this package and composes it with config/context/session assembly.
- `agent-cli` injects concrete adapters such as child-process runners and Git worktree adapters
  through SDK/runtime ports.
- Transport packages consume task events and controls but do not own task transitions.

## Dependencies

This package must not depend on SDK, sessions, tool, concrete-provider, concrete-transport, or CLI
packages. Its own production dependencies are limited to core hook/provider types, the contract SSOT
package for background-task/subagent state, a process-tree teardown helper, and a cron-parsing
library used only by the scheduled task runner.
