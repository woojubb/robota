---
title: 'ARCH-029: command-host consumers claim a 46-member optional facade instead of their declared capabilities'
status: todo
created: 2026-08-14
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-command, packages/agent-command-workflows, packages/agent-cli, packages/agent-transport-tui
depends_on: [ARCH-012]
issue: https://github.com/woojubb/robota/issues/1722
---

# ARCH-029: decompose the command host into explicit capability contracts

## Problem

`ICommandHostContext` currently has 46 members, 32 of them optional, spanning preset mutation,
history, interaction, adapters, context references, skills, checkpoints, memory, background work,
goals, plans, agent jobs, and terminal handoff. A command needing one role must accept the entire
facade and tests construct partial objects through casts. Production also projects
`InteractiveSession` through `this as unknown as ICommandHostContext`.

The issue reproduces by type-checking a command with a minimal honest host: the command signature
requires unrelated methods, while optional methods cannot distinguish an absent capability from a
provided capability whose result is empty.

## Why this is foundational

The recurring cause is the framework-owned host contract, not any individual command. Fixing one
cast or making another method optional leaves every sibling command under the same pressure. This
item was split from ARCH-012 after an independent depth audit found two distinct owners and migration
graphs.

## Direction

- Define framework-owned named command-host roles and a typed capability map/query.
- Make each command consume only its required roles and handle absence explicitly.
- Provide one production adapter from `InteractiveSession` and reusable exact-role test hosts.
- Remove the production self-cast and every direct `ICommandHostContext` partial cast; add a zero
  mechanical floor.
- Preserve provided-empty results as distinct from capability absence.

## Test Plan

- Type-level RED: a minimal workspace-only or preset-only host is assignable to the corresponding
  command role without a cast; current code must fail before the new surface exists.
- Runtime tests distinguish absent capability from provided `null`/`undefined`/empty-array results.
- Existing command suites migrate to exact capability fixtures and remain green.
- The contract-cast scanner covers `ICommandHostContext` at an exact zero baseline and mutation
  fixtures prove either canonical cast is rejected.
- A public command-path scenario exercises a capability-present and capability-absent path through
  the real framework adapter.

## User Execution Test Scenarios

Applies. Exact agent-executable commands, prerequisites, output, cleanup, and empty evidence fields
will be authored at this item's scenario-planning gate before implementation.

## Plan

- [ ] Author and independently approve the DATA spec for the framework-owned capability map.
- [ ] Record DONE-GATE-STAGE-1 for the durable public command-path scenario.
- [ ] Add red-first type/runtime tests and the command-host capability contracts.
- [ ] Migrate production adapter, all shipped commands, and test fixtures; lower casts to zero.
- [ ] Synchronize framework/command SPECs and changesets.
- [ ] Run targeted and broad verification, execute the scenario, pass completion gates, and archive atomically.

## Blockers

- ARCH-012 session capabilities must land first so the framework adapter is not designed twice.

## Result

Pending.
