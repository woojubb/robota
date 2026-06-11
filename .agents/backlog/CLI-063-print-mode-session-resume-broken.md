---
title: 'CLI-063: Print mode silently ignores -c/--continue and -r/--resume'
status: todo
created: 2026-06-11
priority: high
urgency: now
area: packages/agent-cli
depends_on: []
---

# CLI-063: Print mode session resume broken

## Problem

`robota -p "..." -c` and `robota -p "..." -r <id>` always create a brand-new session instead
of continuing/resuming. Verified with a real provider (2026-06-11 product verification, L3):
turn 1 stored "remember 42" in `session_...wuzooabxs.json`; turn 2 with `-c` created a new
session file and the model answered it had no record. Explicit `-r <valid-id>` behaves the
same (the id resolves — a bogus id correctly exits 1 — but the resolved session is then
dropped).

Root cause: `cli.ts` resolves `resumeSessionId` (src/cli.ts:154-168) but passes it only to
`renderApp` (TUI, src/cli.ts:204). `runPrintMode(...)` (src/cli.ts:171-181) never receives it
and `src/modes/print-mode.ts` contains no resume handling. Help text and SPEC advertise
`-c`/`-r` without any mode restriction. This is the CLI-053/054 incident class: flag parsed,
advertised, not wired on one path.

## Expected Behavior

Print mode with `-c` continues the most recent session for the cwd; with `-r <id|name>` it
resumes that session; prior messages are loaded into the conversation context so the model
can reference them. Headless/automation users get the same session semantics as TUI users.

## Test Plan

- Unit/integration: `print-mode-integration.test.ts` gains resume cases — seed a session
  store with a prior conversation, run print mode with `-c`/`-r`, assert the provider request
  contains the prior messages and no new session file is created.
- Contract: assert `runPrintMode` receives and honors the resolved `resumeSessionId`.
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: configured provider profile with valid API key env reference.
- Steps: `robota -p "Remember this number: 42"`; then `robota -p "What number did I ask you
to remember?" -c`.
- Expected observable result: second run answers 42; `.robota/sessions/` gains no third file
  beyond the continued session's update.
- Evidence: (fill after implementation)
