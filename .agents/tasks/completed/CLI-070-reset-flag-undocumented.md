---
title: 'CLI-070: --reset is absent from --help and deletes settings without confirmation'
status: done
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
- Evidence (2026-06-13, real binary `bin/robota.cjs`, isolated HOME via `env -i`,
  settings file present):

  ```
  $ robota --help | grep -A1 -- --reset
  --reset    Delete ~/.robota/settings.json (provider profiles and preferences).
             Asks for confirmation; use --yes to skip

  $ robota --reset < /dev/null; echo $?
  --reset deletes <home>/.robota/settings.json. Refusing without confirmation in
  non-interactive mode — pass --yes to proceed.
  1            # file still present

  $ robota --reset --yes; echo $?
  Deleted <home>/.robota/settings.json
  0            # file deleted
  ```

  CI tests: `packages/agent-cli/src/startup/__tests__/reset-config.test.ts`
  (TC-01~TC-05, 5/5 — help content, refusal matrix, --yes, injected y/N, clean state).
