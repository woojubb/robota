---
title: 'ARCH-048: Canonical project root binding contract'
status: todo
created: 2026-08-22
priority: high
urgency: now
area: packages/agent-framework public composition and packages/agent-cli startup
depends_on: []
---

Registered as GitHub issue https://github.com/woojubb/robota/issues/2152.

## Problem

High-level framework and CLI composition boundaries accept `cwd` and `projectAccess` as independent
project-root carriers. A trusted authority minted for workspace A can consequently be supplied while a
runtime, query, or CLI composition is configured for workspace B. Repeating mismatch checks at those
call sites would retain the duplicated ownership that caused the drift.

This was discovered during the ARCH-042 local review. It is not solved there because the cause is the
absence of a single project-root binding contract across public composition boundaries.

## Directions Considered

- Make trusted project access the canonical source of the effective project root.
- Bind `cwd` and project access in one validated value before high-level composition.
- Separate execution working directory from project identity where both concepts are genuinely needed.

The design choice remains open and must enter the spec gate before implementation.

## Completion Criteria

- One contract owns the relationship between execution working directory and trusted project identity.
- Runtime, query, CLI, and future high-level composition APIs cannot pair authority for one workspace
  with project-scoped behavior for another.
- Restricted access and no-project callers retain explicit, documented behavior.
- A mechanical guard or shared boundary prevents new independent root-carrier pairs from appearing.

## Test Plan

- Add public-boundary tests for matching, mismatching, restricted, and identity-drift cases.
- Verify runtime, query, and CLI composition through their supported public entry points.
- Run affected package tests/builds and the repository conformance and architecture scans.

## User Execution Test Scenarios

### Public SDK rejects cross-workspace composition

- Prerequisites: a built local SDK and two temporary workspaces.
- Steps: mint trusted project access for workspace A, then construct each documented high-level public
  composition surface while requesting workspace B as its working directory.
- Expected result: every surface applies the one documented binding rule; no project-A authority is
  silently used inside a project-B composition.
- Cleanup: revoke the test authority and remove both temporary workspaces.
- Evidence: pending implementation.
