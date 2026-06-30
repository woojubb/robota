---
title: 'TERM-007: Windows support for the terminal-handoff feature group (shell selection + terminal capabilities)'
status: in-progress
created: 2026-06-28
priority: low
urgency: backlog
area: packages/agent-tools, packages/agent-cli, packages/agent-transport-tui
depends_on: [TERM-001, TERM-002, TERM-003, TERM-005]
---

# Windows support follow-up

**Status (2026-06-30):** the code-side work is complete — item 1 (shell selection) shipped as
[TERM-008](../spec-docs/active/TERM-008-cross-platform-shell-execution.md), item 4 (no Unix job-control)
is audited clean, and item 2's handoff is platform-neutral/Windows-capable by construction with nothing
left to change without Windows runtime introspection. The **only** residual is an **empirical
verification pass on real Windows Terminal** (item 2) — which cannot be run in the macOS/Linux
dev/CI environment and needs a Windows machine or a Windows CI runner. Item 3 (PTY) is a deferred
non-goal. The item stays open solely to track that Windows verification pass.

The terminal-handoff feature group ships macOS/Linux-first. The framework handoff (TERM-001) and the
TUI suspend/resume (TERM-002) are platform-neutral by construction, so Windows work is confined to
the **shell-selecting consumer modules** and a few **terminal-capability** edge cases — not the
framework.

## What

1. **Shell selection (`resolveShell()` win32)** — ✅ **DONE in [TERM-008](../spec-docs/active/TERM-008-cross-platform-shell-execution.md)** (carved out and implemented): the cross-platform SSOT `resolvePlatformShell()` (agent-core) now backs the `Shell`/`Bash` tool, the hook `command` executor, and the interactive `resolveShell()` seam — POSIX `sh`/`bash` and Windows PowerShell (cmd via `ROBOTA_SHELL`), with per-OS quoting/`-c` equivalents and OS-aware command-syntax hints. The hard `sh`-only failure on Windows is removed.
2. **Terminal capabilities (TERM-002 on Windows)** — ⏳ **code-ready; needs a Windows hardware pass.**
   Audit (2026-06-30) confirms the handoff is **platform-neutral by construction**: `TerminalHandoffController`
   uses only Node TTY APIs (`stdin.setRawMode`/`pause`, `isTTY`) + Ink rendering and `spawn(stdio:'inherit')`
   — all ConPTY-capable on Win10 1809+. `canHandoffTerminal` already degrades to `false` on a non-TTY, and
   alternate-screen/kitty/bracketed-paste emission + "only undo what was enabled" are owned by Ink, not us.
   No reliable code change remains without Windows runtime introspection (legacy `conhost` detection is
   unreliable via env and is an explicit non-goal). **Remaining: empirical verification on real Windows
   Terminal — cannot be executed in the macOS/Linux dev/CI environment; requires a Windows machine or
   Windows CI runner.**
3. **PTY evaluation (optional)** — ⏸️ **deferred non-goal.** `stdio: 'inherit'` (+ ConPTY) is sufficient;
   `node-pty` is already a dependency for the TEST-007 PTY e2e harness but is **not** needed for the
   runtime handoff. Adopt only on a concrete, demonstrated need (none today).
4. **No Unix job-control assumptions** — ✅ **DONE (audited 2026-06-30).** Repo-wide grep finds **zero**
   `SIGTSTP`/`SIGCONT`/`SIGWINCH` handlers; the handoff suspends/resumes purely via Ink unmount + raw-mode
   release, with no Unix job-control reliance. Nothing to change.

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
- Evidence: ⛔ **pending a Windows pass.** The macOS/Linux unit + functional coverage for the shell
  resolver (TERM-008 `platform-shell.test.ts` covers the win32 PowerShell/cmd branches via mocked
  `process.platform`) is green, but the on-Windows-Terminal handoff/IME behaviour can only be captured
  on real Windows hardware — not available in this environment. This scenario stays unfilled until a
  Windows machine or Windows CI runner runs it.
