---
title: 'SECURITY-003: migrate skill and plugin discovery to the strict decoder'
issue: https://github.com/woojubb/robota/issues/2094
status: done
created: 2026-09-03
priority: high
urgency: soon
area: skill and plugin metadata trust
depends_on: [SECURITY-002, BEHAVIOR-009]
---

# SECURITY-003: migrate skill and plugin discovery to the strict decoder

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2094](https://github.com/woojubb/robota/issues/2094) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Closing it as `NOT_PLANNED` means only that GitHub no longer schedules it independently; this Task records the product outcome separately from that administrative closure.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the source Issue; do not add compatibility shims unless a current runtime consumer proves necessity.

## Plan

- [x] Revalidate the source Issue against the current tree and name the exact owner boundary.
- [x] Implement the target behavior without parallel ownership or a forwarding facade.
- [x] Add negative and positive regression evidence for the source acceptance conditions.
- [x] Update affected specifications and run package, type, build, and boundary verification.

## Implementation result

SkillCommandSource and BundlePluginLoader use the private shared decoder, and PluginCommandSource preserves typed invocation controls. The permissive public parser and plugin parser are removed. Skill model/effort execution semantics remain the separate #1987-owned concern; this leaf does not claim the full #2066 tracker is complete.

## Test Plan

The containing implementation change passes the framework package suite: 1,791 passed, 77 existing skipped, no failures. Focused negative cases were observed failing before their fixes. Package typecheck, lint (zero errors), formatting, and the functional-coverage check pass. PR CI owns the clean affected build under the current verification policy; local tests import source and require no local build.

## User Execution Test Scenarios

Malformed disabling flags are rejected across native, .agents, Claude skill/command, user, and plugin paths. Plugin inspection reports source diagnostics without disclosing received values and continues to valid neighboring plugins. A real InteractiveSession with the scripted provider omits disabled skills from its initial request and refuses model activation; malformed metadata prevents any provider request.

**Author verdict:** `SCENARIO VERIFIED: automatable | 1`

The containing PR still requires independent final review, selected remote checks, and verified landing before this branch's completion state is authoritative on develop. The PR owns those delivery records; no legacy gate workflow is restored.
