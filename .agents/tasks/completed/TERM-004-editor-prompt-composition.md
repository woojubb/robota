---
title: 'TERM-004: compose prompts/messages in $EDITOR via terminal handoff'
status: done
created: 2026-06-27
completed: 2026-06-28
priority: medium
urgency: later
area: packages/agent-framework, packages/agent-cli
depends_on: [TERM-001, TERM-002]
---

# $EDITOR-backed prompt composition

Let the user write a long prompt or message in their `$EDITOR` (like `git commit`), then submit it —
using the framework terminal-handoff capability.

## What

Add a command (e.g. `/editor`, or a key affordance in the prompt input) that:

- Opens `$EDITOR` (fallback chain `$VISUAL` → `$EDITOR` → a sensible default) on a temp file,
  optionally pre-filled with the current prompt buffer, via the terminal-handoff capability.
- On editor exit (success), reads the file back and loads it into the prompt buffer (or submits it,
  per the chosen UX); on non-zero exit / empty file, cancels without changing the buffer.
- Cleans up the temp file. If `canHandoffTerminal` is false, the command is unavailable.

## Why

Multi-line / structured prompts are painful in a single-line TUI input. A real editor handoff is the
standard solution and reuses TERM-001.

## Test Plan

- Unit test the editor resolution + temp-file round-trip (fake handoff + fake editor that writes a
  known file).
- Framework functional test driving the command end to end with a scripted handoff.
- typecheck / lint / `pnpm harness:scan` green.

## User Execution Test Scenarios

- Prereq: built CLI; `EDITOR` set (e.g. `vi`).
- Steps: launch the TUI; trigger `/editor`; type a multi-line message; save and quit; submit.
- Expected: the editor opens with the real terminal, the saved text becomes the prompt/message, the
  TUI restores cleanly; canceling (quit without save / empty) leaves the buffer unchanged.
- Cleanup: temp file removed; exit the TUI.
- Evidence (2026-06-28): automated real-TTY proof via the TEST-007 PTY harness —
  `src/__tests__/command-handoff-pty-e2e.test.ts` ("/editor opens $EDITOR on the real terminal and
  round-trips the composed text") drives the real `executeEditorCommand` through the real
  `TerminalHandoffController` under a pseudo-terminal with a scripted `$EDITOR` that reads a line from
the inherited TTY: the typed text (`composed-in-editor`) round-trips back as the command result and
the App resumes cleanly. Framework functional test (fake handoff/editor) + this PTY E2E +
`pnpm harness:scan` green.

### Closure (2026-06-28)

Done-gate satisfied. Re-ran the scenario at closure: `command-handoff-pty-e2e.test.ts` `/editor`
(real TTY, scripted `$EDITOR` round-trip) ✓. Marking done.
