---
title: 'CMD-013: remove parallel command contracts and registries'
issue: https://github.com/woojubb/robota/issues/2129
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: command contracts, module registration, execution, and reintroduction guards
depends_on: [CMD-012]
---

# CMD-013: remove parallel command contracts and registries

## Objective

After every command slice has migrated, delete the dual `ICommand`/`ISystemCommand` contracts, paired
source/system registries and factories, and manual projections. Preserve issue #2129 as the final guarded
cleanup Task under AGREEMENT-007.

Source child: [issue #2129](https://github.com/woojubb/robota/issues/2129).

## Plan

- [ ] Re-read issues #2121–#2125 and their canonical Task mappings; stop while any required command slice
      remains unresolved or still consumes the old surfaces.
- [ ] Remove obsolete exports, paired registries/factories, and legacy projection functions.
- [ ] Migrate remaining consumers to one command-definition registration path.
- [ ] Add a guard that prevents production reintroduction of the removed contracts and parallel registries.

## Constraints

- Open issues #2121–#2125 remain external prerequisites; this Task does not absorb their feature slices.
- No compatibility shim or forwarding facade may preserve the prerelease dual surface.
- A command must be registered exactly once and all views must derive from that registration.

## Test Plan

- Add negative guard fixtures for every removed contract/registry spelling and path.
- Run model/remote/palette/executor parity tests across the complete migrated command population.
- Run full affected package tests, typecheck, build, public-surface checks, and repository scans.

## User Execution Test Scenarios

Prerequisites: build the CLI after every command slice is migrated. Enumerate the command palette, run a
representative builtin/skill/plugin command, and inspect model and remote descriptors. Expected: each
command appears and executes once from the same definition, while repository search and the guard find no
dual contract or registry. Cleanup: remove temporary fixtures. Evidence: pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
