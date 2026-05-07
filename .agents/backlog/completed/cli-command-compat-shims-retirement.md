# CLI Command Compatibility Shims Retirement

## Status

Completed.

## Priority

P1 - removes a misleading CLI command ownership surface before the beta API shape hardens.

## Problem

Before this work, `packages/agent-cli/src/commands/` contained compatibility shims that re-exported
SDK-owned command infrastructure:

- `packages/agent-cli/src/commands/command-registry.ts`
- `packages/agent-cli/src/commands/builtin-source.ts`
- `packages/agent-cli/src/commands/skill-source.ts`
- `packages/agent-cli/src/commands/types.ts`

The CLI does not own `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource`, or command
contracts. Keeping these public-looking files makes it easy for new code to import command
infrastructure from the wrong package and weakens the built-in command layer boundary.

`packages/agent-cli/src/commands/skill-executor.ts` was different: it contained real skill
execution logic for legacy CLI skill paths. The owner decision was to use the SDK-owned
`executeSkill()` implementation and move the behavior tests to `agent-sdk`.

## Recommended Direction

Remove the compatibility re-export shims and update imports to use the owning package directly.

Recommended sequence:

1. Search for imports from `packages/agent-cli/src/commands/*` and
   `@robota-sdk/agent-cli/dist/commands/*`.
2. Update CLI internals and tests to import SDK-owned command infrastructure from
   `@robota-sdk/agent-sdk`.
3. Decide `skill-executor.ts` ownership:
   - keep only terminal-host-specific glue in `agent-cli`; or
   - move reusable skill prompt execution into the SDK command/skill API.
4. Remove unused shim tests that only prove re-export behavior.
5. Add a harness check if there is a stable import pattern to forbid.

The beta is not required to preserve the CLI command shim surface.

## Acceptance Criteria

- [x] No production code imports command infrastructure through `packages/agent-cli/src/commands/*`
      or `@robota-sdk/agent-cli`.
- [x] `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource`, and command contract types
      are imported from `@robota-sdk/agent-sdk` or the owning package.
- [x] `skill-executor.ts` is either moved to an owning SDK command/skill API or explicitly kept as a
      CLI-private host adapter with no public-looking compatibility barrel.
- [x] Re-export-only tests are deleted or replaced with owner-package tests.
- [x] `packages/agent-cli/docs/ARCHITECTURE-MAP.md` reflects the final command ownership state.
- [x] A mechanical harness guard exists when the forbidden import pattern can be detected reliably.

## Result

Completed in `refactor/cli-command-shims-retirement`.

- Removed the `agent-cli/src/commands/` compatibility surface.
- Updated CLI UI code to import SDK-owned `CommandRegistry` and `ICommand` directly from
  `@robota-sdk/agent-sdk`.
- Moved command registry, built-in source, skill source, and skill execution behavior tests to
  `agent-sdk`.
- Added a command-layering harness guard that fails if new CLI command shim files are introduced.

## Verification Plan

- `rg -n "from ['\\\"](\\./commands|\\.\\./commands|@robota-sdk/agent-cli)" packages -g '!**/dist/**'`
- `pnpm harness:scan:commands`
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli build`
