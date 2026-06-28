---
title: 'TERM-003: drop-to-shell command (hand the terminal to an interactive subshell)'
status: done
created: 2026-06-27
completed: 2026-06-28
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
- Evidence (2026-06-28): automated real-TTY proof via the TEST-007 PTY harness —
  `src/__tests__/command-handoff-pty-e2e.test.ts` ("/shell runs a one-shot command on the real
  terminal and returns its exit code") drives the real `executeShellCommand` through the real
  `TerminalHandoffController` under a pseudo-terminal: the subshell receives the driver's keystrokes
  (`SHELL_GOT:[shell-input]`), exits 0, and the App resumes (no hang — see the TERM-002 controller
  fix). Framework functional test (fake handoff) + this PTY E2E + `pnpm harness:scan` green.
- **Real-binary user-execution evidence:** `src/__tests__/pty/terminal-handoff.ptytest.ts` (TC-09,
  `test:pty` project) boots the **built** robota CLI in a PTY, types `/shell echo HANDOFF_REAL_OK`
  like a user, and asserts the child's output appears on the real terminal **and** the TUI prompt
  frame redraws (clean resume, no hang) — the whole path: CLI → command pipeline → injected
  `TerminalHandoffController` → handoff. (A user-typed command is not permission-gated; that gate is
  for model/agent-invoked actions.)

### Closure (2026-06-28)

Done-gate satisfied. Re-ran the scenarios at closure: `command-handoff-pty-e2e.test.ts` `/shell`
(real TTY) ✓ and `terminal-handoff.ptytest.ts` TC-09 (built binary `/shell` on the real terminal) ✓.
Marking done.
