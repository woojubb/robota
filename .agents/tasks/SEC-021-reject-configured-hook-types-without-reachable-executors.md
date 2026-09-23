---
title: 'SEC-021: reject configured hook types without reachable executors'
issue: https://github.com/woojubb/robota/issues/2099
status: done
created: 2026-09-03
priority: high
urgency: soon
area: hook configuration enforcement
depends_on: [SEC-015]
---

# SEC-021: reject configured hook types without reachable executors

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2099](https://github.com/woojubb/robota/issues/2099) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Closing it as `NOT_PLANNED` means only that GitHub no longer schedules it independently; this Task remains `todo` until the product outcome is delivered.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the source Issue; do not add compatibility shims unless a current runtime consumer proves necessity.

## Plan

- [x] Revalidate the source Issue against the current tree and name the exact owner boundary.
- [x] Implement the target behavior without parallel ownership or a forwarding facade.
- [x] Add negative and positive regression evidence for the source acceptance conditions.
- [x] Update the framework contract and verify the affected merge, reachability, and real CLI paths, package typechecks, and generated framework output consumed by the CLI test.

## Test Plan

Exercise the source Issue's primary success path and at least one failure or refusal path, then run affected package tests, typecheck, build, and repository boundary scans. Record exact commands and outputs in the implementation lifecycle.

## User Execution Test Scenarios

Execute the source Issue's user- or operator-observable workflow from a clean fixture. Expected: the named outcome is visible through its canonical owner and no legacy or parallel path is required. The scripted CLI fixture exercises both configured `prompt` and `agent` hooks: startup exits 1, stderr names `.robota/settings.json` and the unsupported type, and the provider receives no request. The same suite retains successful ordinary startup controls.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

## Implementation evidence

The existing reachability guard from issue #2245 remains the single refusal owner. The loader now carries settings-source facts through the same hook merge traversal and the internal asynchronous initialization handoff. Only surviving definitions retain a source; higher-priority `disabledHooks` filters remove both a later hook and its provenance. Programmatic configurations retain strict type/reason diagnostics without invented file paths. Public resolved-config and session-option contracts remain unchanged.

The settings-loader regression verifies absolute user paths, relative project paths, disabled-hook omission, and unchanged public config shape. Real `startCli` tests passed after rebuilding the framework output they consume; the scripted CLI suite passed 12 cases with two existing exclusions. Framework and CLI typechecks pass. Remote landing is recorded by the owning PR and issue #2664 completion record; this leaf does not complete the separate TRANS-016 child in AGREEMENT-013.
