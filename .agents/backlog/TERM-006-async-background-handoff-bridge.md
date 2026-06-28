---
title: 'TERM-006: bridge async background children to a foreground terminal handoff (request via wake)'
status: todo
created: 2026-06-28
priority: low
urgency: backlog
area: packages/agent-executor, packages/agent-framework
depends_on: [TERM-001, TERM-002, TERM-007]
---

> **Deferred — blocked on the PTY decision (TERM-007).** The distinctive value here is handing a
> child that is **already running in the background** to the terminal mid-flight (so the user can
> answer a late prompt), then detaching. Attaching a live, already-spawned process to the real TTY
> requires a pseudo-terminal (node-pty / ConPTY), which the macOS/Linux-first scope deferred to
> TERM-007. Without a PTY there is no working body for the handoff request — a child must be spawned
> attached from the start, which is just the foreground `/shell <command>` path (TERM-003) and not
> "background". Building the event plumbing now would be dead code with no consumer, so this waits for
> the PTY evaluation in TERM-007. The event-seam design (a runner emits
> `background_task_handoff_requested` → tracker → `runWithTerminal`) is captured below for when PTY lands.

# Async background → foreground handoff bridge

Unifies the two child-process invocation modes: let a child running **asynchronously** in the
background-task system request a **synchronous foreground terminal handoff** when it needs the user
(e.g. it hit an interactive prompt), using the existing notification/wake channel.

## Background (already built)

The async path exists: `BackgroundTaskManager` (agent-executor) runs a child without blocking; on
completion / output-pattern match / schedule it emits `background_task_waking(+instruction)` →
`SessionBackgroundTaskTracker` → `InteractiveSession.requestWakeup(instruction, taskId)` → an
`agent-wakeup` turn triggers follow-up (FLOW-002/003/004), coalesced by `taskId`.

The foreground interactive handoff exists after TERM-001 (`runWithTerminal`).

This item connects them.

## What

- Add a new background-task event variant (e.g. `background_task_handoff_requested { taskId }`,
  optionally with a reason/instruction) that a runner can emit when its child needs the real terminal.
- Propagate it through the manager → `SessionBackgroundTaskTracker` exactly like the existing wake
  events (no new layering; the executor stays free of any TUI/handoff-impl dependency — it only emits
  an event).
- In the session, on this event, perform a foreground handoff via the TERM-001 `runWithTerminal`
  capability: attach the existing background child to the real TTY for the interaction, then detach
  and let it continue / complete, after which the normal completion → wake → follow-up flow runs.
- Honor exclusivity (one handoff at a time), the permission gate, and `canHandoffTerminal === false`
  (no foreground handoff possible → surface to the agent/user instead of hanging).

## Design notes / to confirm

- Detaching/reattaching a _running_ child to the TTY is the hard part. With `stdio: 'inherit'` the
  child must be spawned attached from the start; mid-run reattach generally needs a PTY. So the first
  cut may be limited to: a background child declared "interactive" is **handed off at spawn time**
  (foreground) rather than reattached later. True mid-run reattach is where `node-pty` would earn its
  keep — defer unless required (see TERM-007 / pty evaluation).
- Keep the platform boundary: the executor only emits the request event; the session + transport own
  the handoff (TERM-001/002).

## Test Plan

- agent-executor unit test: a runner can emit `background_task_handoff_requested`; manager/tracker
  propagate it.
- agent-framework functional test: a scripted background task requests a handoff; the session invokes
  `runWithTerminal`; on completion the wake/follow-up turn fires. Add a `functional-coverage` row.
- typecheck / lint / `pnpm harness:scan` green; no executor→TUI dependency.

## User Execution Test Scenarios

- Prereq: built CLI, interactive terminal; a background command that will block on a TTY prompt.
- Steps: start it as a background task flagged interactive; when it needs input, the session offers
  the foreground handoff; provide input; the task completes and the agent is woken to react.
- Expected: input reaches the child on the real terminal, the TUI restores cleanly, and the
  completion triggers the follow-up turn.
- Evidence: _to be filled after implementation._
