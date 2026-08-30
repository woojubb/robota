---
title: 'ARCH-114: route query and AgentRuntime factories through SessionRecipe'
issue: https://github.com/woojubb/robota/issues/2102
status: todo
created: 2026-08-30
priority: high
urgency: soon
area: packages/agent-framework
depends_on: [ARCH-113]
---

# ARCH-114: route query and AgentRuntime factories through SessionRecipe

## Objective

Route the framework `query` and `AgentRuntime` construction paths through the ARCH-113 session recipe
kernel so neither path constructs `InteractiveSession` directly and invalid required options fail during
type checking or normalization rather than after session start. This Task preserves issue #2102's work.

## Plan

- [ ] Project `query` inputs exhaustively into `SessionRecipe`.
- [ ] Project `AgentRuntime` inputs exhaustively into `SessionRecipe`.
- [ ] Add parity and invalid-input tests without changing the interactive/channel factory.
- [ ] Run affected package verification and repository scans.

## Test Plan

- Add projection parity tests for both public factory paths.
- Add type-level or normalization negatives for omitted provider/cwd requirements.
- Prove the constructor guard observes no direct construction in either migrated path.
- Run the affected build/test scope and `pnpm harness:scan`.

## User Execution Test Scenarios

Prerequisites: complete ARCH-113 and build the framework examples. Invoke one real `query` request and
one programmatic `AgentRuntime` session with equivalent provider/cwd inputs. Expected: both start and
complete through the same normalized recipe invariants; invalid configuration is rejected before start.
Cleanup: stop sessions and remove temporary working directories. Evidence: pending implementation.
