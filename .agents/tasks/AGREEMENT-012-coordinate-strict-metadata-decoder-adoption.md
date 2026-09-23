---
title: 'AGREEMENT-012: coordinate strict metadata decoder adoption'
issue: https://github.com/woojubb/robota/issues/2066
status: done
created: 2026-09-03
priority: high
urgency: soon
area: skill, plugin, and agent-definition metadata trust
depends_on: [RULE-023]
children: [SECURITY-003, SECURITY-004]
---

# AGREEMENT-012: coordinate strict metadata decoder adoption

## Objective

Coordinate skill, plugin, and agent-definition metadata trust as one exact Issue-to-Task migration graph rooted in [issue #2066](https://github.com/woojubb/robota/issues/2066). Preserve external security decisions and historical Issue evidence while removing only redundant executable queue entries.

## Children

- [x] SECURITY-003 — done — `.agents/tasks/SECURITY-003-migrate-skill-and-plugin-discovery-to-the-strict-decoder.md`
- [x] SECURITY-004 — done — `.agents/tasks/SECURITY-004-migrate-agent-definition-loading-to-the-strict-decoder.md`

## Historical migration plan

The administrative plan below records the original queue migration. PR #2827 retired that procedure; its unchecked steps are historical and are not prerequisites for the retained product outcome.

- [ ] TC-01 — Land every declared child Task atomically with exact source Issue identity.
- [ ] TC-02 — Preserve native dependency order and every external prerequisite.
- [ ] TC-03 — Freeze exact row-level marker, label, body, and terminal-state mutations before apply.
- [ ] TC-04 — Apply the homogeneous rows in one batch and preserve the complete parent map, body prefixes, assignees, history, and relationships.
- [ ] TC-05 — Reconcile the whole group once after writes and keep product Tasks open until implementation.

## Test Plan

- Validate the complete parent/child projection and exact source Issue URL for every Task.
- Compare frozen and post-write marker, label, state, body-prefix, hierarchy, dependency, and assignee fields once for the whole group.
- Run affected repository scans after the complete group evidence update.
- Execute the administrative migration as one bounded batch and reconcile it once after all authorized writes.

## User Execution Test Scenarios

Not applicable — this AGREEMENT changes planning and GitHub ownership only. Each child Task owns the runnable implementation scenario.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No runtime, public API, CLI, TUI, or end-user interaction changes in this coordination record.

## Retained security outcome

PR #2832 delivered both discovery leaves and removed the permissive public parser. The strict decoder rejects malformed authority flags, context, positive-integer limits, wrong types, and unknown fields across native, `.agents`, Claude-compatible, and bundle-plugin metadata. Its repository-corpus regression verifies checked-in definitions remain loadable.

The remaining model field now selects the forked child request model, with the selected agent's model retained when the skill omits an override. Specifying a model without `context: fork` is rejected at discovery and at the programmatic command boundary. A real scripted session discovers both agent and skill files, assembles the agent runtime, and verifies model override, child failure, default reuse, and unchanged parent state. Existing scoped effort behavior from BEHAVIOR-009 remains covered. The implementation's owning PR and issue #2664 delivery record own final remote landing evidence; this record remains at its fixed path.
