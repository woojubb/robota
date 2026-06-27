---
title: 'TERM-004: compose prompts/messages in $EDITOR via terminal handoff'
status: todo
created: 2026-06-27
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
- Evidence: _to be filled after implementation._
