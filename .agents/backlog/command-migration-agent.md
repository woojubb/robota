# Command Migration: `/agent`

## What

Finish migration hardening for `/agent`, which already lives in `@robota-sdk/agent-command-agent`, and ensure it is the model for future built-in command packages.

## Current Owner

- Implementation: `packages/agent-command-agent/src/agent-command-module.ts`
- Runtime APIs: `@robota-sdk/agent-sdk` and `@robota-sdk/agent-runtime`

## Target Owner

Keep `@robota-sdk/agent-command-agent`.

## Migration Notes

- `/agent` is already a command module and should remain outside SDK/CLI implementation internals.
- Use this package as the reference structure for other built-in command migrations.
- Ensure SDK does not special-case `/agent` beyond generic command module session requirements.

## Acceptance Criteria

- `/agent` remains fully supplied by `@robota-sdk/agent-command-agent`.
- SDK imports no `agent-command-agent` implementation.
- CLI composition root is the only default product wiring point.
- Command-layering scan covers the invariant.

## Test Plan

- Run `pnpm --filter @robota-sdk/agent-command-agent test`.
- Run `pnpm harness:scan:commands`.
- Add any missing contract tests for session requirements and model-invocable descriptor metadata.
