---
title: 'HARNESS-20260912: complete the Astra instruction-routing follow-up'
status: todo
created: 2026-09-12
priority: high
urgency: now
area: repository harness guidance and lifecycle records
depends_on: []
---

# HARNESS-20260912: complete the Astra instruction-routing follow-up

## Objective

Finish the integration-tree follow-up to the merged Astra guidance work by routing stale skill
anchors directly to their owner documents and reconciling the completed records left by that batch.

## Plan

- [ ] Replace misleading pre-router `AGENTS.md` anchors with direct owner-document routes.
- [ ] Reduce `branch-guard` to an operation-specific router without duplicating branch policy.
- [ ] Teach `harness-governance` to verify real owner-document anchors and scoped disclosure.
- [ ] Archive the completed HARNESS-2710 and HARNESS-2711 records.
- [ ] Run formatting, skill-registration, consistency, lifecycle, and affected harness checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This documentation-only harness routing and lifecycle-record batch changes no runnable
product behavior or end-user interface.

## Completion Criteria

- [ ] Skills link to the documents that actually own the named rules.
- [ ] The branch-policy skill selects only the sections needed for the current operation.
- [ ] Existing harness checks accept the integrated documentation batch.
- [ ] The completed predecessor Tasks are archived and the follow-up Task records its result.
