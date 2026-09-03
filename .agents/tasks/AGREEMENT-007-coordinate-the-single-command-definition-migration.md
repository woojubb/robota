---
title: 'AGREEMENT-007: coordinate the single command definition migration'
issue: https://github.com/woojubb/robota/issues/2061
status: todo
created: 2026-09-03
priority: high
urgency: soon
area: command contracts, projections, modules, and registries
depends_on: []
children: [CMD-010, CMD-011, CMD-012, CMD-013]
---

# AGREEMENT-007: coordinate the single command definition migration

## Objective

Replace issue #2061's GitHub-only execution tree with one relationship owner and four independently
verifiable command Tasks. Preserve canonical issue #2079, every external prerequisite, and the direct
prerelease replacement constraint without implementing product code in this conversion.

## Children

- [ ] CMD-010 — todo — `.agents/tasks/CMD-010-define-the-discriminated-command-definition-and-serializable-descriptor.md`
- [ ] CMD-011 — todo — `.agents/tasks/CMD-011-derive-command-projections-from-one-definition.md`
- [ ] CMD-012 — todo — `.agents/tasks/CMD-012-migrate-skill-and-plugin-commands-to-discriminated-definitions.md`
- [ ] CMD-013 — todo — `.agents/tasks/CMD-013-remove-parallel-command-contracts-and-registries.md`

## Plan

- [ ] TC-01 — Freeze exactly `{#2061,#2088,#2092,#2100,#2129}` as a held migration batch with exact Task
      paths and no GitHub mutation authority.
- [ ] TC-02 — Land this AGREEMENT, its paired spec, and CMD-010 through CMD-013 on `develop` in native order
      `CMD-010 → CMD-011 → CMD-012 → CMD-013`.
- [ ] TC-03 — Preserve open issue #2094 and open issues #2121–#2125 as external prerequisites, while closed
      issue #2080 and completed ARCH-100 remain historical delivery evidence only.
- [ ] TC-04 — After a fresh post-merge read and independent apply review, migrate only the five approved
      Issue rows with marker/read-back, P-label removal, reverse-order closure, and full population audit.
- [ ] TC-05 — Complete this AGREEMENT only after all four children are `done` and issue #2079's current map
      resolves to their exact completed Task paths through full-commit-SHA links.

## Shared Constraints

- One command definition owns identity, presentation, safety, permission, invocation policy, and the
  executable handler required by executable variants.
- Serializable descriptors contain no functions or live runtime objects and are derived from definitions.
- The prerelease contracts are replaced directly; no compatibility alias, forwarding facade, or parallel
  registry remains as an end state.
- CMD-012 cannot claim issue #2094's decoder/discovery work delivered. CMD-013 cannot start final removal
  while issues #2121–#2125 remain unresolved or unmapped.

## Test Plan

- Run Task/spec projection, lifecycle, work-item collision, and plan-order scans on the atomic prelude.
- Re-read all five target Issues and the seven live external prerequisites before any later apply gate.
- Run each child Task's package/type/functional tests only in that child's own implementation lifecycle.
- Run affected repository scans and required CI before every evidence PR merges.

## User Execution Test Scenarios

Not applicable to this migration-only AGREEMENT. Each child Task owns the runnable command scenario for
the behavior it later changes.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This record changes Task/spec governance and future GitHub Issue administration only. It adds
no runnable command behavior, public API, CLI output, TUI flow, or end-user interface.
