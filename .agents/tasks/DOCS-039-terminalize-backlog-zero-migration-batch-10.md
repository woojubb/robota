---
title: 'DOCS-039: terminalize backlog-zero migration batch 10'
issue: https://github.com/woojubb/robota/issues/2404
status: in-progress
created: 2026-08-29
priority: critical
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-039: terminalize backlog-zero migration batch 10

## Objective

Move the three legacy ARCH Tasks to their exact existing OPEN GitHub owners and remove the
duplicate durable queue without changing package source, APIs, policy, architecture, workflows, or
product documentation. The batch is a documentation-only application of the registered
`BACKLOG-ZERO-MIGRATION` class.

## Spec

`.agents/spec-docs/active/DOCS-039-terminalize-backlog-zero-migration-batch-10.md`

## Plan

- [x] TC-01 — preserve the exact three-unit/12-path manifest, current blobs, owner issues, handoff
      comments, four package documentation carrier links, and excluded-scope boundary.
- [x] TC-02 — mark ARCH-047, ARCH-048, and ARCH-049 skipped with exact `returned_to_issue` links,
      preserving each body and moving each Task atomically to `completed/`.
- [ ] TC-03 — pass lifecycle, citation, manifest, delegation, carrier, and no-growth path scans
      with no package source or policy files changed.
- [ ] TC-04 — run focused scans and the full harness verification mirror successfully.

## Test Plan

Compare fixed-population/current Task blobs and normalized bodies; read back exact OPEN issue states,
assignees, and handoff comment URLs; run task archival, folder/status, task-path-citation,
standing-delegation, reference-kind, and loop-ledger scans; then run `pnpm harness:scan` and
`pnpm harness:verify-like-ci` against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this batch changes internal Task lifecycle records and GitHub queue ownership only;
it introduces no runnable user-facing behavior.
