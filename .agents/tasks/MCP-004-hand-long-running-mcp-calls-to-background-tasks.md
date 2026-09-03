---
title: 'MCP-004: hand long-running MCP calls to background tasks'
issue: https://github.com/woojubb/robota/issues/2524
status: todo
created: 2026-09-03
priority: medium
urgency: later
area: MCP background execution
depends_on: [MCP-002, MCP-003]
---

# MCP-004: hand long-running MCP calls to background tasks

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2524](https://github.com/woojubb/robota/issues/2524) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Closing it as `NOT_PLANNED` means only that GitHub no longer schedules it independently; this Task remains `todo` until the product outcome is delivered.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the source Issue; do not add compatibility shims unless a current runtime consumer proves necessity.

## Plan

- [ ] Revalidate the source Issue against the current tree and name the exact owner boundary.
- [ ] Implement the target behavior without parallel ownership or a forwarding facade.
- [ ] Add negative and positive regression evidence for the source acceptance conditions.
- [ ] Update affected specifications and run package, type, build, and boundary verification.

## Test Plan

Exercise the source Issue's primary success path and at least one failure or refusal path, then run affected package tests, typecheck, build, and repository boundary scans. Record exact commands and outputs in the implementation lifecycle.

## User Execution Test Scenarios

Execute the source Issue's user- or operator-observable workflow from a clean fixture. Expected: the named outcome is visible through its canonical owner and no legacy or parallel path is required. Evidence is pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
