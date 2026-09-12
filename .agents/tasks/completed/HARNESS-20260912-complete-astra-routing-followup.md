---
title: 'HARNESS-20260912: complete the Astra instruction-routing follow-up'
status: done
created: 2026-09-12
completed: 2026-09-12
priority: high
urgency: now
area: repository harness guidance and lifecycle records
depends_on: []
---

# HARNESS-20260912: complete the Astra instruction-routing follow-up

no-issue: post-merge follow-up to the already closed issues #2710 and #2711; no new product defect

## Objective

Finish the integration-tree follow-up to the merged Astra guidance work by routing stale skill
anchors directly to their owner documents and reconciling the completed records left by that batch.

## Plan

- [x] Replace misleading pre-router `AGENTS.md` anchors with direct owner-document routes.
- [x] Reduce `branch-guard` to an operation-specific router without duplicating branch policy.
- [x] Teach `harness-governance` to verify real owner-document anchors and scoped disclosure.
- [x] Archive the completed HARNESS-2710 and HARNESS-2711 records.
- [x] Run formatting, skill-registration, consistency, lifecycle, and affected harness checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This documentation-only harness routing and lifecycle-record batch changes no runnable
product behavior or end-user interface.

## Completion Criteria

- [x] Skills link to the documents that actually own the named rules.
- [x] The branch-policy skill selects only the sections needed for the current operation.
- [x] Existing harness checks accept the integrated documentation batch.
- [x] The completed predecessor Tasks are archived and the follow-up Task records its result.

## Result

- Thirteen skills now route stale `AGENTS.md` section labels to the rule documents that own them.
- `branch-guard` is a 19-line operation router instead of a second copy of branch policy.
- `harness-governance` checks owner-document identity and section-scoped progressive disclosure.
- HARNESS-2710 and HARNESS-2711 now have terminal metadata and live under `tasks/completed/`.
- Formatting, skill registration, consistency, lifecycle, diff, and affected-PR-context scans pass;
  the default-context progress-report check still reports only the repository's pre-existing local
  transcript findings from 2026-09-07.
