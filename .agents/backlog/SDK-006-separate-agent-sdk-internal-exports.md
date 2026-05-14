---
title: 'SDK-006: Separate agent-sdk/src/index.ts internal exports to subpath'
status: backlog
created: 2026-05-15
priority: low
urgency: later
area: packages/agent-sdk
---

## Problem

`agent-sdk/src/index.ts` exports several symbols that are internal assembly utilities (session
factory helpers, private command executors) not documented in the SDK SPEC Public API Surface
table. Once consumers depend on them they become frozen public API that is expensive to change.

**Evidence**: Symbols exported from `agent-sdk/src/index.ts` but absent from
`agent-sdk/docs/SPEC.md` Public API Surface section.

**Source**: ARCH-SD-011 (Senior Developer review 2026-05-15)

## Scope

1. Audit `agent-sdk/src/index.ts` exports against the Public API Surface table in
   `agent-sdk/docs/SPEC.md`
2. Identify symbols present in `index.ts` but absent from the SPEC table
3. For each undocumented export, decide:
   - (a) It is a legitimate public API → add it to SPEC.md Public API Surface
   - (b) It is internal → move to `agent-sdk/src/internal/` and remove from `index.ts`
4. If internal symbols are consumed by other packages (e.g., `agent-cli`), migrate those
   imports to the correct source (SPEC-documented export or package-internal path)
5. Update `agent-sdk/docs/SPEC.md` Public API Surface table to reflect the final state

## Test Plan

- `pnpm --filter @robota-sdk/agent-sdk build` passes
- `pnpm typecheck` clean across all packages
- `pnpm test` passes
- All exports in `agent-sdk/src/index.ts` are present in `agent-sdk/docs/SPEC.md`
- No undocumented symbols remain in the public barrel

## User Execution Test Scenarios

This is a type-safety and API surface cleanup with no observable runtime behavior change.
No user execution test scenario required. Verified by confirming SPEC alignment and clean build.

Evidence: (to be filled after implementation — confirm SPEC alignment)
