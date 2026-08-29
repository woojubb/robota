---
title: 'DOCS-040: Terminalize backlog-zero migration batch 11'
issue: https://github.com/woojubb/robota/issues/2404
status: done
completed: 2026-08-29
created: 2026-08-29
priority: high
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-040: Terminalize backlog-zero migration batch 11

## Objective

Move TRANS-003, TRANS-004, and HARNESS-087 to their canonical OPEN GitHub issue owners and archive duplicate local records without changing implementation code or APIs.

## Spec

`.agents/spec-docs/done/DOCS-040-terminalize-backlog-zero-migration-batch-11.md`

## Plan

- [x] TC-01 — preserve the exact three-unit/six-path manifest, blobs, issue comments, and excluded scope.
- [x] TC-02 — mark all three Tasks skipped with exact handoff URLs and move them atomically to `completed/`.
- [x] TC-03 — pass lifecycle, citation, delegation, reference-kind, and no-growth scans.
- [x] TC-04 — run `pnpm harness:scan`, `pnpm test`, and `pnpm harness:verify-like-ci` successfully.

## Test Plan

Compare fixed-population/current blobs and normalized bodies; read the OPEN issue states and exact handoff comment URLs; run archival, folder/status, task-path-citation, standing-delegation, reference-kind, and loop-ledger scans; then run the full harness scan, tests, and CI mirror.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this is internal backlog lifecycle documentation with no user-facing behavior.
