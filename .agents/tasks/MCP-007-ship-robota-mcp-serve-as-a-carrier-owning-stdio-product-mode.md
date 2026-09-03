---
title: 'MCP-007: ship robota mcp serve as a carrier-owning stdio product mode'
issue: https://github.com/woojubb/robota/issues/2531
status: todo
created: 2026-09-03
priority: critical
urgency: now
area: MCP stdio server
depends_on: [TRANS-013, MCP-006]
---

# MCP-007: ship robota mcp serve as a carrier-owning stdio product mode

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2531](https://github.com/woojubb/robota/issues/2531) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

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
