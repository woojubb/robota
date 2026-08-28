---
title: 'DOCS-035: terminalize backlog-zero migration batch 06'
issue: https://github.com/woojubb/robota/issues/2454
status: done
completed: 2026-08-29
created: 2026-08-29
priority: high
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-035: terminalize backlog-zero migration batch 06

## Objective

Apply the approved three-unit `BACKLOG-ZERO-MIGRATION` manifest: close the already delivered
DOCS-028 and HARNESS-122 records truthfully, reject their bypassed or stale planning documents, and
return CONFIG-002's undelivered writer/API half to its exact GitHub owner without changing source,
APIs, policy, package/product docs, workflows, topology, baselines, or carriers.

Source initiative: issue #2404. This Task and its PR are owned by child issue #2454; residual
CONFIG-002 implementation remains owned by issue #2453.

## Spec

`.agents/spec-docs/done/DOCS-035-terminalize-backlog-zero-migration-batch-06.md`

## Plan

- [x] TC-01 — preserve the committed three-unit/nine-path manifest, five governed source blob OIDs,
      exact mixed dispositions, and zero-baseline/carrier boundary.
- [x] TC-02 — preserve exact readback of control issue #2454, residual issue #2453, and the
      CONFIG-002 canonical handoff URL; put only that exact URL on the skipped CONFIG-002 Task.
- [x] TC-03 — mark DOCS-028 and HARNESS-122 done, mark CONFIG-002 skipped, and preserve all three
      historical Task bodies byte-for-byte.
- [x] TC-04 — reject the DOCS-028 and HARNESS-122 planning documents with dated truthful evidence,
      rekey DOCS-028's Task path, and manufacture no historical gate verdict.
- [x] TC-05 — keep the exact final changed-path set to nine approved lifecycle/ledger paths, change
      no excluded path, and pass focused lifecycle checks plus the full harness CI mirror.

## Test Plan

Compare all five governed source blobs and all three Task bodies; read back both issues and the exact
handoff comment; run task archival, folder/status, standing-delegation, scenario-section,
reference-kind, Task citation, and loop-ledger scans; then run `pnpm harness:scan` and
`pnpm harness:verify-like-ci` against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this work changes internal lifecycle evidence and remote queue ownership only. It
introduces no runnable user-facing behavior.
