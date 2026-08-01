---
title: 'CLI-063: Print mode silently ignores -c/--continue and -r/--resume'
status: done
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
- Evidence: executed 2026-06-12 against the fixed local build (`bin/robota.cjs`, branch
  `feat/cli-063-print-mode-resume`, PR #697) with a real Anthropic provider
  (claude-sonnet-4-6, key via `$ENV:ANTHROPIC_API_KEY`) in an isolated HOME + temp cwd:
  - turn 1 `robota -p "Remember this number: 42. Acknowledge briefly."` → "Saved! The
    number **42** has been stored in memory.", exit 0
  - turn 2 `robota -p "What number did I ask you to remember? Answer with just the
number." -c` → output exactly `42`, exit 0
  - `.robota/sessions/` contains exactly **1** session file after both turns (before the
    fix: a new file per run, model had no memory — see
    `.design/validation/agent-cli-product-verification-2026-06.md` L3)
  - Automated regression: `print-mode-integration.test.ts` TC-02/03/06,
    `headless-channel-options.test.ts` resume/fork wiring, `cli-args.test.ts` TC-04/05
    (agent-cli 117 tests, agent-transport 460 tests green)
