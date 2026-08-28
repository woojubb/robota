---
title: 'DOCS-034: terminalize backlog-zero migration batch 05'
issue: https://github.com/woojubb/robota/issues/2451
status: in-progress
created: 2026-08-29
priority: high
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-034: terminalize backlog-zero migration batch 05

## Objective

Apply the approved three-unit `BACKLOG-ZERO-MIGRATION` manifest: return HARNESS-120, HARNESS-128,
and INFRA-133 to their exact GitHub owners and terminalize the local Tasks without changing source,
APIs, policy, package/product docs, workflows, topology, baselines, or carriers.

Source initiative: issue #2404. This Task and its PR are owned by child issue #2451; the parent remains
open for later batches and the preventive durable-queue mechanism.

## Spec

`.agents/spec-docs/active/DOCS-034-terminalize-backlog-zero-migration-batch-05.md`

## Plan

- [ ] TC-01 — preserve the committed three-unit/seven-path manifest, three source Task blob OIDs,
      exact ownership/dispositions, and zero-baseline/carrier boundary.
- [ ] TC-02 — preserve exact readback of issues #2326, #2394, #2149, control issue #2451, and all
      three canonical handoff URLs; put each URL on its skipped Task.
- [ ] TC-03 — terminalize all three Tasks as skipped without deleting or rewriting historical
      evidence and without claiming implementation delivery.
- [ ] TC-04 — keep the exact final changed-path set to the three Task moves, paired DOCS-034
      Task/spec, and two loop ledgers; change no excluded path.
- [ ] TC-05 — pass focused lifecycle/folder/delegation/scenario/reference/ledger checks and the full
      harness scan/CI mirror on atomic final placement.

## Test Plan

Compare all three source blobs/bodies and the exact final path set; read back the four issues and three
handoff comments; run task archival, folder/status, standing-delegation, scenario-section,
reference-kind, Task citation, and loop-ledger scans; then run `pnpm harness:scan` and
`pnpm harness:verify-like-ci` against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this work changes internal lifecycle evidence and remote queue ownership only. It
introduces no runnable user-facing behavior.
