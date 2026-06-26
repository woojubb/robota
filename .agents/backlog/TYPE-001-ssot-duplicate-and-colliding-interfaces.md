---
title: 'TYPE-001: Resolve duplicate IDiffLine + same-name colliding interfaces (Type SSOT)'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-transport-tui, packages/agent-core, packages/agent-playground
depends_on: []
---

# Resolve duplicate + colliding interfaces (Type SSOT)

The repo rule: one canonical type per data shape, extended via `extends`, never re-declared.
Two distinct problems found 2026-06-27.

## What

1. **True duplicate — `IDiffLine` (fix first).** Identical field-for-field interface declared
   in two packages with **no import link** (verified: `edit-diff.ts` does not import the
   contract):
   - `packages/agent-interface-transport/src/session-contracts.ts:66-70`
   - `packages/agent-transport-tui/src/utils/edit-diff.ts:10-14`
     Same `{ type: 'add'|'remove'|'context'|'hunk'; text: string; lineNumber: number }`. This is
     a clear SSOT violation: make `agent-interface-transport` the owner and have the TUI import
     it (respecting dependency direction — confirm the TUI may depend on the contract package;
     if not, hoist the type to the correct shared owner).

2. **Same-name, different-shape collisions (audit + disambiguate).** Several interfaces share
   a name but describe different data, which is confusing and invites accidental cross-import:
   - `IExecutionResult` — `agent-interface-transport/.../session-contracts.ts:103` vs
     `agent-core/src/services/execution-types.ts` (only `response` overlaps).
   - `IPermissionRequest` — `agent-interface-transport/.../interaction-contracts.ts` vs
     `agent-transport-tui/src/types.ts` (latter adds a `resolve` callback).
   - `IProviderConfig` — three shapes: `agent-playground/.../use-provider-config.ts`,
     `agent-core/src/abstracts/abstract-ai-provider.ts`,
     `agent-core/src/interfaces/provider-definition.ts` (note `baseUrl` vs `baseURL` casing).
   - `IUsageSnapshot` — `agent-interface-transport/.../session-contracts.ts:84` vs
     `agent-playground/.../usage-monitor/types.ts` (zero field overlap).
     For each: decide whether they should be ONE type (extend/import) or are genuinely distinct
     (then rename to remove the collision, e.g. `IProviderRuntimeConfig` vs `IProviderDefinitionConfig`).

## Why

`IDiffLine` is a straight SSOT-rule breach (duplicate data shape). The name collisions are a
latent maintenance/refactor hazard — a developer importing "the wrong `IProviderConfig`" gets
a silently incompatible shape. Resolving both upholds the Type-SSOT rule.

## Done When

- `IDiffLine` is declared once and imported by the other consumer (or hoisted to the correct
  shared owner); the duplicate is deleted.
- Each colliding name is either unified via `extends`/import or renamed to be unambiguous;
  SPEC/usages updated.
- `pnpm typecheck` + `pnpm harness:scan` pass.

## Test Plan

- Grep each interface name across packages → either a single declaration or clearly-distinct
  renamed types; no unlinked identical-shape duplicates remain.
- `pnpm typecheck` green after the consolidation/renames.

## User Execution Test Scenarios

Not applicable — type-system SSOT refactor; no runtime behavior change. Evidence = single
canonical `IDiffLine` + disambiguated names + green typecheck.
