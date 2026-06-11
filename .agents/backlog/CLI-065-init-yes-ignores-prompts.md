---
title: 'CLI-065: init --yes does not skip prompts; non-TTY fallthrough prints wrong guidance'
status: todo
created: 2026-06-11
priority: high
urgency: soon
area: packages/agent-cli
depends_on: []
---

# CLI-065: `init --yes` ignores its own flag

## Problem

SPEC (docs/SPEC.md:1021) promises prompts are skipped when "`--yes` flag or `CI=true`
environment is detected", and `IInitOptions.yes` JSDoc says "Skip all Y/n prompts and use
defaults". In practice (2026-06-11 verification, npm-installed beta.73, non-TTY stdin):

- In a directory with `.claude/`: `robota init --yes` still calls the migration prompt and
  fails with `Cannot prompt for input: stdin is not a TTY`.
- When `AGENTS.md`/`.robota/settings.json` already exist: the overwrite prompt fires the same
  way (exit 1).
- The non-TTY fallthrough message is unrelated to the question asked: it prints "Set your API
  key via environment variable instead: ANTHROPIC_API_KEY=<key> robota".

Root cause: `askYesNo` call sites at `src/init/init-command.ts:95` (overwrite) and `:107`
(migration) never consult `options.yes`; it is only checked for provider setup (line 152).

## Expected Behavior

`init --yes` (and `CI=true`) answers every confirmation with its documented default and
completes non-interactively with exit 0. Any non-TTY prompt error names the question that
could not be asked.

## Test Plan

- Unit tests for `runInitCommand` with `yes: true` covering the overwrite and migration
  branches (no prompt function invoked; defaults applied).
- Non-TTY behavior test: prompt required without `--yes` → clear error naming the prompt.
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: temp dir containing `.claude/` and pre-existing `AGENTS.md`.
- Steps: `robota init --yes < /dev/null`; `echo $?`.
- Expected observable result: exit 0, files created/kept per documented defaults, no TTY
  error.
- Evidence: (fill after implementation)
