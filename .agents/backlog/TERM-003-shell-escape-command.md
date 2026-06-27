---
title: 'TERM-003: drop-to-shell command (hand the terminal to an interactive subshell)'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-cli
depends_on: [TERM-001, TERM-002]
---

# Drop-to-shell command

A user-facing command that hands the real terminal to an interactive subshell and returns to the
agent session on exit — the classic "shell escape". The first concrete consumer of TERM-001.

## What

Add a system command (e.g. `/shell`, optionally a `!` prefix for a one-shot `!<cmd>`) that runs the
user's shell (or a given command) via the framework terminal-handoff capability (TERM-001), with the
child inheriting the real TTY. On shell exit, the agent presentation is restored.

- `/shell` → interactive shell in the session's cwd; exit returns to the agent.
- `!<command>` (optional) → run a single command interactively, then return.
- Runs in the session working directory; inherits env.
- If `canHandoffTerminal` is false (headless), report that an interactive shell is unavailable.

## Platform scope + shell-selection seam

This command is a **shell-selecting consumer module** — this is where the POSIX assumption lives, not
in the framework. Per the agreed scope, target **macOS/Linux first** (resolve `$SHELL`, fall back to
`/bin/sh`). Put the shell choice behind a small **`resolveShell()` seam** so Windows (`cmd.exe` /
PowerShell / `%ComSpec%`) can be added later (TERM-007) without touching the call sites. Do not
hardcode `sh` at the spawn site.

## Why

Users frequently need a quick real shell (run an interactive tool, inspect state, complete a flow the
agent should not drive) without killing the session. Today there is no way to do this from the TUI.

## Test Plan

- Command-module unit test: `/shell` invokes the handoff capability with the right shell/cwd/env and
  returns to the session afterward (fake handoff).
- Framework functional test driving the command through a real session with a scripted handoff.
- typecheck / lint / `pnpm harness:scan` green.

## User Execution Test Scenarios

- Prereq: built CLI, interactive terminal.
- Steps: launch the TUI; run `/shell`; in the subshell run `pwd` and `echo hi`; `exit`.
- Expected: the subshell shows the session cwd and is fully interactive; on `exit` the TUI restores
  cleanly (no stale frame / raw-mode / cursor artifacts) and the session continues.
- Cleanup: exit the TUI.
- Evidence: _to be filled after implementation._
