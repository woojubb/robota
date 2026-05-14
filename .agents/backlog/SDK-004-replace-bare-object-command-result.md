---
title: 'SDK-004: Replace bare object type in TCommandResultDataValue'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-sdk
---

## Problem

`agent-sdk/src/command-api/command-result.ts` line 5 defines `TCommandResultDataValue` with
`object` as one of its union members. Bare `object` is effectively `Record<string, unknown>`
minus type safety — it prevents the caller from accessing any properties without casting.

**Evidence**: `agent-sdk/src/command-api/command-result.ts` line 5:
`type TCommandResultDataValue = string | number | boolean | object | ...`

**Source**: ARCH-SD-004 (Senior Developer review 2026-05-15)

## Scope

1. In `agent-sdk/src/command-api/command-result.ts` line 5, replace `object` with
   `Record<string, unknown>`
2. If any call sites relied on the bare `object` type for structural subtypes, update them
   to use `Record<string, unknown>` or a named discriminated union where a specific shape
   is needed
3. Run `pnpm typecheck` to catch any downstream type errors from the change

## Test Plan

- `pnpm --filter @robota-sdk/agent-sdk build` passes
- `pnpm typecheck` clean across all packages
- `pnpm test` passes
- No remaining bare `object` in `TCommandResultDataValue` union

## User Execution Test Scenarios

This is a type-safety fix with no observable runtime behavior change. No user execution test
scenario required. Verified by `pnpm typecheck` passing cleanly.

Evidence: (to be filled after implementation — confirm typecheck clean)
