---
title: 'CLI-070: --reset is absent from --help and deletes settings without confirmation'
status: todo
created: 2026-06-11
priority: low
urgency: later
area: packages/agent-cli
depends_on: []
---

# CLI-070: `--reset` undocumented and unconfirmed

## Problem

Verified 2026-06-11 (L1): `robota --reset` exists (dispatched at `src/cli.ts:84` via
`runResetConfig`) and deletes `~/.robota/settings.json`, but:

- It does not appear anywhere in `robota --help` output — an undocumented destructive flag.
- It deletes the user's provider configuration immediately, with no confirmation prompt and
  no `--yes`/non-TTY story.

## Expected Behavior

`--reset` is listed in help with a one-line description of exactly what it deletes. It asks
for confirmation in a TTY (skippable with `--yes`); in non-TTY it requires `--yes`.

## Test Plan

- Help-content test asserting `--reset` appears (extend the help/flag-wiring guard family).
- Unit tests for the confirmation behavior matrix (TTY/non-TTY × with/without `--yes`).
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Steps: `robota --help | grep reset`; `robota --reset < /dev/null` with settings present.
- Expected observable result: help documents the flag; non-TTY without `--yes` refuses to
  delete.
- Evidence: (fill after implementation)
