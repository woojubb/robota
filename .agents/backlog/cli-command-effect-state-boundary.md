# CLI Command Effect State Boundary

## Status

Backlog.

## Priority

P1 - removes implicit UI state mutation from the SDK session object.

## Problem

The CLI TUI currently passes command interactions and deferred command effects between hooks by
casting `InteractiveSession` to an `ISideEffects` intersection and attaching ad hoc fields such as
`_pendingCommandInteraction` and `_pendingCommandEffects`.

Known current files:

- `packages/agent-cli/src/ui/hooks/useSlashRouting.ts`
- `packages/agent-cli/src/ui/hooks/useSideEffects.ts`
- `packages/agent-cli/src/ui/hooks/side-effects-types.ts`
- `packages/agent-cli/src/ui/__tests__/slash-routing-effects.test.ts`

This keeps the SDK type clean only at compile time. Runtime state still lands on the SDK session
object, which makes ownership ambiguous and makes future command/UI behavior harder to reason about.

## Recommended Direction

Introduce an explicit command result/effect state boundary owned by the CLI or SDK.

Preferred near-term design:

- Create a small CLI-owned command effect queue/controller used by `useSlashRouting()` and
  `useSideEffects()`.
- Store `ICommandInteraction` and deferred `TCommandEffect[]` in that controller or React state.
- Stop mutating `InteractiveSession` with `_pending*` fields.
- Keep command packages returning only SDK `ICommandResult` values.

Longer-term option:

- If multiple hosts need the same behavior, move the result channel into an SDK-owned command host
  helper while keeping UI-specific rendering in the CLI.

## Acceptance Criteria

- [ ] `InteractiveSession` is no longer cast to `InteractiveSession & ISideEffects` for command
      effect transport.
- [ ] No `_pendingCommandInteraction` or `_pendingCommandEffects` fields are written to the SDK
      session instance.
- [ ] Command interactions and effects remain generic and typed.
- [ ] Existing slash routing and command effect tests are updated to assert the explicit boundary.
- [ ] `packages/agent-cli/docs/ARCHITECTURE-MAP.md` reflects the final state.

## Verification Plan

- `rg -n "_pendingCommandInteraction|_pendingCommandEffects|InteractiveSession & ISideEffects" packages/agent-cli/src`
- `pnpm --filter @robota-sdk/agent-cli test -- slash-routing`
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
