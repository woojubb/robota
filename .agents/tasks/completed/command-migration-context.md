---
status: completed
completed_at: 2026-05-03
branch: feat/command-migration-context
---

# Command Migration: `/context`

## What

Migrate `/context` into a command-module owner that consumes SDK context-window common APIs.

## Current Owner

- Execution: `packages/agent-sdk/src/commands/system-command.ts`
- Auto compact threshold helper: `packages/agent-sdk/src/commands/system-command-metadata.ts`

## Target Owner

Recommended: `@robota-sdk/agent-command-context`, potentially grouped with compact auto-control work.

## Migration Notes

- Preserve token usage output and auto compact threshold display.
- Future auto compact controls should be exposed as command descriptors/subcommands rather than CLI-specific settings UI.
- Context percentage must come from structured SDK state, not prose parsing.

## Acceptance Criteria

- [x] `/context` is provided by an injected `ICommandModule`.
- [x] Context and auto compact data are exposed through SDK common APIs.
- [x] Tests cover enabled and disabled auto compact display.

## Test Plan

- [x] Add command module tests for context formatting.
- [x] Add integration tests for auto compact threshold values and disabled state.

## Result

- Added `@robota-sdk/agent-command-context` as the owner package for `/context`.
- Removed `/context` from SDK-default embedded system commands.
- Composed `createContextCommandModule()` by default in the CLI composition root.
- Kept token usage and auto-compact display based on structured SDK command host APIs.

## Verification

- `pnpm install`
- `pnpm --filter @robota-sdk/agent-sdk build`
- `pnpm --filter @robota-sdk/agent-command-context test`
- `pnpm --filter @robota-sdk/agent-command-context typecheck`
- `pnpm --filter @robota-sdk/agent-command-context build`
- `pnpm --filter @robota-sdk/agent-sdk test -- src/commands/__tests__/system-command.test.ts src/command-api/__tests__/command-api.test.ts`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-command-context lint`
- `pnpm --filter @robota-sdk/agent-cli test -- src/commands/__tests__/builtin-source.test.ts src/ui/__tests__/slash-routing-effects.test.ts`
- `pnpm --filter @robota-sdk/agent-cli build`
- `pnpm docs:validate-structure`
- `pnpm harness:scan:commands`
- `git diff --check`
