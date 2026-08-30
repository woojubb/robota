---
title: 'ARCH-115: route interactive runtime through SessionRecipe and remove the public test escape hatch'
issue: https://github.com/woojubb/robota/issues/2115
status: todo
created: 2026-08-30
priority: high
urgency: soon
area: packages/agent-framework
depends_on: [ARCH-113, ARCH-114]
---

# ARCH-115: route interactive runtime through SessionRecipe and remove the public test escape hatch

## Objective

Migrate `createInteractiveRuntime` and its channel-facing construction path to the shared recipe kernel,
remove `_testSession` from the production contract, and provide an explicit testing-only seam. This Task
preserves issue #2115's work and completes the issue #2063 migration sequence.

## Plan

- [ ] Replace production option weakening with exhaustive discriminated production modes.
- [ ] Route the interactive factory through `SessionRecipe` without direct construction.
- [ ] Move injected test sessions/factories to the framework testing surface.
- [ ] Verify headless, TUI, programmatic, serverless, and product consumers preserve invariants.

## Test Plan

- Add type-level negatives proving production options cannot omit provider/cwd through a test-only field.
- Add interactive/channel projection tests and testing-surface injection tests.
- Prove the constructor guard permits only the recipe kernel.
- Run the affected build/test scope and `pnpm harness:scan`.

## User Execution Test Scenarios

Prerequisites: complete ARCH-113 and ARCH-114, build the framework, CLI, TUI, and headless examples.
Start representative interactive, TUI, headless, programmatic, and serverless sessions. Expected: all
start through the same normalized invariants and no production configuration exposes `_testSession`.
Cleanup: stop sessions and remove temporary settings/workspaces. Evidence: pending implementation.
