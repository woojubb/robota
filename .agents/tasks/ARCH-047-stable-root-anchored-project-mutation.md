---
title: 'ARCH-047: Stable root-anchored project mutation'
status: todo
created: 2026-08-22
priority: critical
urgency: now
area: packages/agent-framework workspace-trust mutation boundary
depends_on: []
---

Registered as GitHub issue https://github.com/woojubb/robota/issues/2151.

## Problem

Project mutation currently validates directory ancestry and targets by pathname, then later opens or
unlinks those pathnames. A rename or link swap between validation and mutation can therefore redirect
an authority-bearing write or delete outside the approved workspace. The read boundary already has a
descriptor-rooted traversal, but no mutation primitive owns equivalent stable-root semantics.

This was discovered during the ARCH-042 local review. It is not solved there because the cause is the
missing shared mutation primitive, not one caller's validation sequence.

## Directions Considered

- Root each mutation in stable directory handles and perform final operations relative to the verified
  parent handle.
- Define explicit fail-closed behavior for platforms that cannot provide the required handle semantics.
- Extend one existing project file boundary only if it can own both read and mutation invariants without
  weakening either contract.

The design choice remains open and must enter the spec gate before implementation.

## Completion Criteria

- One owner defines stable-root semantics for project create, replace, append, and delete operations.
- Ancestry and final-target swaps cannot redirect a mutation outside the approved workspace.
- Cross-platform behavior is explicit and fails closed where the invariant cannot be implemented.
- Every project mutation consumer uses the owned primitive rather than reproducing pathname checks.

## Test Plan

- Add deterministic race/swap tests for parent-directory and final-target replacement.
- Cover create, overwrite, append, and delete operations.
- Run the affected framework unit and integration suites, package build, and repository verification.
- Run the containment-label and work-item scans while ARCH-042 still references this Task.

## User Execution Test Scenarios

### Public SDK project mutation remains workspace-confined

- Prerequisites: a built local SDK and two temporary workspaces on the supported host platform.
- Steps: mint project authority for workspace A through the public trust flow, arrange the documented
  swap fixture between validation and mutation, and invoke each public project mutation operation.
- Expected result: no file in workspace B or outside workspace A is created, changed, or deleted; the
  SDK either mutates the stable workspace-A target or returns the documented refusal.
- Cleanup: remove both temporary workspaces and restore any platform-specific fixture state.
- Evidence: pending implementation.
