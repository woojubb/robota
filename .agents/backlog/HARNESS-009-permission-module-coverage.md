---
title: 'HARNESS-009: Minimum test coverage for permission/security modules'
status: todo
created: 2026-06-11
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# HARNESS-009: Minimum test coverage for permission/security modules

## Problem

`permission-gate.ts` — the module deciding whether tools are denied — had zero tests for deny
precedence until CLI-053 added four. The property "deny beats bypassPermissions" underpinning
`--denied-tools` was unverified.

## Proposed Change

Rule (code-quality or process): modules under `packages/agent-core/src/permissions/` (and any
future auth/security module) require unit tests for every decision branch; PR review checklist
item. Optionally a coverage threshold scoped to those directories in vitest config.

## Test Plan

- Audit current permissions modules for untested branches; add missing tests.
- Coverage threshold wired and green in CI for the scoped paths.

## User Execution Test Scenarios

Not applicable — test/rule change.
