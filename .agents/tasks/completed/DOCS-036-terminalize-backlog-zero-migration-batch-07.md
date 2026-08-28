---
title: 'DOCS-036: terminalize backlog-zero migration batch 07'
issue: https://github.com/woojubb/robota/issues/2456
status: done
completed: 2026-08-29
created: 2026-08-29
priority: high
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-036: terminalize backlog-zero migration batch 07

## Objective

Apply the approved three-unit `BACKLOG-ZERO-MIGRATION` manifest: close delivered HARNESS-103,
return SEC-009 and HARNESS-108 residual work to their exact GitHub owners, and rekey only the exact
citations and no-growth baseline entry required by the Task moves without changing source, APIs,
policy, product docs, workflows, topology, or baseline cardinality.

Source initiative: issue #2404. This Task and its PR are owned by child issue #2456; SEC-009 remains
owned by issue #2047 and HARNESS-108 remains owned by issue #2457.

## Spec

`.agents/spec-docs/done/DOCS-036-terminalize-backlog-zero-migration-batch-07.md`

## Plan

- [x] TC-01 — preserve the committed three-unit/eleven-path manifest, seven governed current blob
      OIDs, exact dispositions, and value/cardinality-preserving baseline boundary.
- [x] TC-02 — preserve exact readback of control issue #2456, residual issues #2047/#2457, and both
      canonical handoff URLs; return only SEC-009 and HARNESS-108 to those exact comments.
- [x] TC-03 — mark HARNESS-103 done, mark SEC-009/HARNESS-108 skipped, preserve SEC-009 and
      HARNESS-108 Task bodies byte-for-byte, change HARNESS-103 only by the exact one-line approved
      `evidence-superseded` annotation, and keep both planning documents rejected.
- [x] TC-04 — rekey exactly five Task-path citations across the three approved carrier documents and
      move the one HARNESS-108 baseline key with value `2` and cardinality unchanged.
- [x] TC-05 — keep the exact final changed-path set to eleven approved lifecycle/ledger paths, change
      no excluded path, and pass focused lifecycle/reference checks plus the full harness CI mirror.

## Test Plan

Compare all governed blobs and the normalized Task bodies permitting only the exact HARNESS-103
annotation; read back all remote owners/comments; run task archival, folder/status,
standing-delegation, scenario-section, reference-kind, Task citation, baseline, and loop-ledger scans;
then run `pnpm harness:scan` and `pnpm harness:verify-like-ci` against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this work changes internal lifecycle evidence, references, and remote queue
ownership only. It introduces no runnable user-facing behavior.
