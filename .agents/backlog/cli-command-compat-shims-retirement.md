# CLI Command Compatibility Shims Retirement

## Status

Backlog.

## Priority

P1 - removes a misleading CLI command ownership surface before the beta API shape hardens.

## Problem

`packages/agent-cli/src/commands/` still contains compatibility shims that re-export SDK-owned
command infrastructure:

- `packages/agent-cli/src/commands/command-registry.ts`
- `packages/agent-cli/src/commands/builtin-source.ts`
- `packages/agent-cli/src/commands/skill-source.ts`
- `packages/agent-cli/src/commands/types.ts`

The CLI does not own `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource`, or command
contracts. Keeping these public-looking files makes it easy for new code to import command
infrastructure from the wrong package and weakens the built-in command layer boundary.

`packages/agent-cli/src/commands/skill-executor.ts` is different: it contains real skill execution
logic for legacy CLI skill paths. It needs an owner decision instead of being treated as a simple
re-export shim.

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

- [ ] No production code imports command infrastructure through `packages/agent-cli/src/commands/*`
      or `@robota-sdk/agent-cli`.
- [ ] `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource`, and command contract types
      are imported from `@robota-sdk/agent-sdk` or the owning package.
- [ ] `skill-executor.ts` is either moved to an owning SDK command/skill API or explicitly kept as a
      CLI-private host adapter with no public-looking compatibility barrel.
- [ ] Re-export-only tests are deleted or replaced with owner-package tests.
- [ ] `packages/agent-cli/docs/ARCHITECTURE-MAP.md` reflects the final command ownership state.
- [ ] A mechanical harness guard exists when the forbidden import pattern can be detected reliably.

## Verification Plan

- `rg -n "from ['\\\"](\\./commands|\\.\\./commands|@robota-sdk/agent-cli)" packages -g '!**/dist/**'`
- `pnpm harness:scan:commands`
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli build`
