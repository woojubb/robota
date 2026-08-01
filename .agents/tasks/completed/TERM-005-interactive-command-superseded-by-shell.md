---
title: 'TERM-005: framework-level interactive (TTY-requiring) command execution'
status: superseded
created: 2026-06-27
completed: 2026-06-28
priority: medium
urgency: later
area: packages/agent-framework
depends_on: [TERM-001, TERM-002]
---

> **Superseded by TERM-003.** The user-in-the-loop interactive TTY-requiring command path is
> delivered by `/shell <command>`: it runs any command through the terminal handoff with inherited
> stdio, so TTY-only flows (`gh auth login`, `npm login`, `sudo`, interactive installers) complete
> exactly as this item intended. The remaining hypothetical — the AGENT autonomously seizing the
> terminal for a full-screen program — was intentionally excluded (safety + the agent-tools zero-dep
> boundary; see the layer-placement note below). An agent-initiated, user-approved handoff belongs to
> TERM-006 (request-via-wake), not here. No separate code is warranted.

# Interactive (TTY-requiring) command execution

Let a command that needs a real terminal (password prompts, `gh auth login`, `npm login`,
interactive installers, `ssh`) run with the terminal handed over, instead of hanging on fully-piped
stdio. Reuses the terminal-handoff capability (TERM-001).

## Layer placement (architecture-review correction)

The earlier draft put this on the `agent-tools` `BashTool`. **That is a layering violation:**
`agent-tools` has **zero workspace dependencies** (it is a pure leaf) and therefore cannot consume
the framework's `ICommandHostContext` / handoff capability. So:

- **`agent-tools` `BashTool` stays pure capture** (`stdio: ['pipe','pipe','pipe']`) — unchanged. No
  handoff dependency is pushed down into it.
- **Interactive execution is a framework-level concern.** Implement it where `ICommandHostContext`
  (and thus `runWithTerminal`) is reachable — a framework command/tool module (e.g. an interactive
  variant exposed through the command layer, or folded into `/shell`'s `!<cmd>` path — TERM-003).
- This also avoids the dubious "autonomous agent drives a full-screen program" path: interactive
  handoff is **user-in-the-loop**, surfaced as a command, not an unattended agent tool.

Shell selection uses the `resolveShell()` seam (TERM-003); macOS/Linux first, Windows via TERM-007.
The handoff itself (TERM-001 contract) is platform-neutral.

## Scope / safety

- **User-in-the-loop**, for commands that _block on a TTY prompt_ (auth/login, sudo, confirmations) —
  not for the agent to autonomously run editors.
- Trigger: an explicit interactive invocation (e.g. the `/shell !<cmd>` path or an explicit
  interactive command), not a silent agent default.
- Permission/approval: grabbing the terminal is a side-effecting action — it must pass the permission
  gate and require confirmation before the handoff.
- When `canHandoffTerminal` is false (headless), fail fast with a clear message rather than hanging.

## Why

Real workflows hit TTY-only prompts (`gh auth login`, registry login, sudo). Today they silently
hang. Routing them through the handoff at the framework layer makes them completable without leaving
the agent — while keeping `agent-tools` zero-dep and the agent from autonomously seizing the terminal.

## Test Plan

- Framework unit/functional tests: the interactive command path calls `runWithTerminal`; passes the
  permission gate; fails fast when `canHandoffTerminal` is false. `agent-tools` `BashTool` tests
  unchanged (still pure capture).
- Add/extend a `functional-coverage` row.
- typecheck / lint / `pnpm harness:scan` green; no new `agent-tools` workspace dependency.

## User Execution Test Scenarios

- Prereq: built CLI, interactive terminal; a command that prompts on a TTY (e.g. a script doing
  `read -s -p 'pw: ' x`).
- Steps: run the interactive command (e.g. via `/shell !<cmd>`); approve the handoff; enter input.
- Expected: the prompt shows on the real terminal, input is accepted, the command completes, and the
  TUI restores cleanly with the result returned to the session.
- Cleanup: exit the TUI.
- Evidence: _to be filled after implementation._
