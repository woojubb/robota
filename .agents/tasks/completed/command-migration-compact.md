---
status: completed
completed_at: 2026-05-03
branch: feat/command-migration-compact
---

# Command Migration: `/compact`

## What

Migrate `/compact` from SDK embedded system-command logic into a command-module owner with explicit blocking lifecycle metadata.

## Current Owner

- Execution/lifecycle: `packages/agent-sdk/src/commands/system-command.ts`
- Session compaction implementation: `@robota-sdk/agent-sessions`

## Target Owner

Recommended: `@robota-sdk/agent-command-compact`, consuming SDK compaction/context common APIs.

## Migration Notes

- Preserve optional instruction argument behavior.
- Preserve blocking foreground behavior so TUI shows the same running/thinking process as prompt execution.
- Coordinate with existing compact auto-control backlog; manual compact and auto compact controls should share descriptor/common API concepts without duplicating policy.

## Acceptance Criteria

- [x] `/compact` is provided by an injected `ICommandModule`.
- [x] Lifecycle metadata declares `blocking`.
- [x] The command consumes SDK compaction APIs, not session internals.
- [x] Manual `/compact` visibly blocks/queues input consistently.

## Test Plan

- [x] Add command module tests for compaction message and before/after context values.
- [x] Add interactive-session lifecycle tests for blocking command state.
- [x] Add TUI routing tests proving generic command lifecycle drives the status indicator.

## Result

- Added `@robota-sdk/agent-command-compact` as the owner package for `/compact`.
- Added SDK `command-api/context` helpers so command packages compact through the command host facade rather than session internals.
- Removed `/compact` from SDK-default embedded system commands.
- Composed `createCompactCommandModule()` by default in the CLI composition root.

## Verification

- `pnpm --filter @robota-sdk/agent-sdk build`
- `pnpm --filter @robota-sdk/agent-command-compact test`
- `pnpm --filter @robota-sdk/agent-command-compact typecheck`
- `pnpm --filter @robota-sdk/agent-command-compact build`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-sdk test -- src/commands/__tests__/system-command.test.ts src/command-api/__tests__/command-api.test.ts src/interactive/__tests__/interactive-session.test.ts`
- `pnpm --filter @robota-sdk/agent-command-compact lint`
- `pnpm --filter @robota-sdk/agent-cli test -- src/ui/__tests__/streaming-indicator.test.tsx src/ui/__tests__/slash-routing-effects.test.ts src/commands/__tests__/builtin-source.test.ts`
- `pnpm --filter @robota-sdk/agent-cli build`
- `pnpm docs:validate-structure`
- `pnpm harness:scan:test-plans`
- `pnpm --filter @robota-sdk/agent-cli lint`
- `pnpm --filter @robota-sdk/agent-sdk lint`
- `pnpm harness:scan:commands`
