# CLI Session Store Boundary Cleanup

## Status

Completed.

## Priority

P1 - fixes a documented package boundary violation in the CLI beta architecture.

## Problem

`packages/agent-cli/docs/SPEC.md` states that `agent-cli` must not import from
`@robota-sdk/agent-sessions`, but current CLI source constructs and passes `SessionStore` directly.
This leaks session persistence ownership into the product UI layer and keeps the CLI coupled to a
concrete sessions package class.

Known current files:

- `packages/agent-cli/package.json`
- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/src/ui/render.tsx`
- `packages/agent-cli/src/ui/App.tsx`
- `packages/agent-cli/src/ui/hooks/useInteractiveSession.ts`
- `packages/agent-cli/src/ui/SessionPicker.tsx`

## Recommended Direction

Move session persistence construction and host-facing resume/picker data behind an SDK-owned API or
port. The CLI should depend on SDK-owned types and factories rather than importing
`@robota-sdk/agent-sessions`.

Recommended shape:

- `agent-sdk` owns a public session persistence facade or factory for project-local persistence.
- CLI passes `cwd`, resume/fork/name options, or an SDK-owned persistence adapter into
  `InteractiveSession`.
- `SessionPicker` consumes an SDK-owned resumable session summary interface, not
  `ISessionRecord` or `SessionStore`.
- `agent-cli/package.json` no longer depends on `@robota-sdk/agent-sessions`.

## Acceptance Criteria

- [x] No production file under `packages/agent-cli/src` imports from `@robota-sdk/agent-sessions`.
- [x] `packages/agent-cli/package.json` no longer declares `@robota-sdk/agent-sessions`.
- [x] Resume, fork, continue, and session picker behavior still work through SDK-owned APIs.
- [x] `packages/agent-cli/docs/SPEC.md` and `packages/agent-cli/docs/ARCHITECTURE-MAP.md` reflect the final boundary.
- [x] Add or extend a mechanical harness/import check for this forbidden edge if feasible.

## Verification Plan

- `rg -n "@robota-sdk/agent-sessions" packages/agent-cli/src packages/agent-cli/package.json`
- `pnpm --filter @robota-sdk/agent-cli test`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
