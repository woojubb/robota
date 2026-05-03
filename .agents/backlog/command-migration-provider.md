# Command Migration: `/provider`

## What

Extract `/provider` from the transitional SDK-exported command module into a built-in command package that consumes SDK provider common APIs.

## Current Owner

- Transitional implementation: `packages/agent-sdk/src/commands/provider-command-*.ts`
- Composition: `packages/agent-cli/src/cli.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-provider`.

## Migration Notes

- SDK should keep provider settings/profile helpers, environment reference helpers, setup-flow primitives, and command interaction/effect contracts as common APIs.
- The command package should own `/provider` metadata, subcommands, setup state machine, settings patch orchestration, and endpoint probe orchestration.
- CLI supplies provider definitions and settings adapters at composition root only.

## Acceptance Criteria

- `/provider` implementation lives outside `agent-sdk` command implementation files.
- `agent-sdk` does not depend on `agent-command-provider`.
- CLI/TUI still renders only generic command interactions and effects.
- Current provider command tests move to the command package.

## Test Plan

- Port provider command module tests to the new command package.
- Run `pnpm harness:scan:commands` to prove provider command state does not return to CLI/TUI hooks.
- Add integration tests for list/current/use/add/test.
