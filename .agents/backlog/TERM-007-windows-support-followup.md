---
title: 'TERM-007: Windows support for the terminal-handoff feature group (shell selection + terminal capabilities)'
status: todo
created: 2026-06-28
priority: low
urgency: backlog
area: packages/agent-tools, packages/agent-cli, packages/agent-transport-tui
depends_on: [TERM-001, TERM-002, TERM-003, TERM-005]
---

# Windows support follow-up

The terminal-handoff feature group ships macOS/Linux-first. The framework handoff (TERM-001) and the
TUI suspend/resume (TERM-002) are platform-neutral by construction, so Windows work is confined to
the **shell-selecting consumer modules** and a few **terminal-capability** edge cases — not the
framework.

## What

1. **Shell selection (`resolveShell()` win32)** — implement the Windows branch of the
   `resolveShell()` seam introduced in TERM-003/005: `%ComSpec%` (cmd.exe) or PowerShell instead of
   `sh`. This also fixes the pre-existing gap where `BashTool` and the background runners hardcode
   `sh` (broken on Windows today). Decide command quoting/`-c` equivalents per shell.
2. **Terminal capabilities (TERM-002 on Windows)** — verify the manual suspend/resume on modern
   Windows Terminal / ConPTY (Win10 1809+): VT processing enabled, cursor / alternate-screen restore
   correct, and the "only undo what was enabled" rule keeps kitty-keyboard/bracketed-paste no-ops
   where unsupported. Legacy `conhost` is an explicit non-goal; degrade via `canHandoffTerminal`.
3. **PTY evaluation (optional)** — if full-screen interactivity or mid-run detach/reattach
   (TERM-006) proves insufficient with `stdio: 'inherit'` on Windows, evaluate `node-pty` (ConPTY)
   with its native-build/packaging cost. Only adopt on a concrete, demonstrated need.
4. **No Unix job-control assumptions** — confirm nothing in the handoff relies on SIGTSTP/SIGCONT.

## Why

`agent-cli` is POSIX-developed today; the hardcoded `sh` makes shell commands non-functional on
Windows. Once the macOS/Linux feature group lands behind clean seams, Windows becomes a contained,
mostly module-local addition rather than a cross-cutting rewrite.

## Test Plan

- Windows CI (or a manual Windows pass): `resolveShell()` picks the right shell; `/shell`, an
  interactive `BashTool` command, and `$EDITOR` complete on Windows Terminal; the TUI restores
  cleanly.
- Cross-platform unit tests for `resolveShell()` (mock `process.platform`).
- typecheck / lint / `pnpm harness:scan` green on all platforms.

## User Execution Test Scenarios

- Prereq: Windows 10/11 + Windows Terminal, built CLI.
- Steps: run `/shell` (expect cmd/pwsh), run an interactive command, edit via `$EDITOR`.
- Expected: each hands the real console to the child, input works, and the TUI restores without stale
  frames or mode artifacts.
- Evidence: _to be filled after implementation._
