---
title: 'DOCS-032: terminalize backlog-zero migration batch 03'
issue: https://github.com/woojubb/robota/issues/2441
status: in-progress
created: 2026-08-29
priority: high
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-032: terminalize backlog-zero migration batch 03

## Objective

Apply the approved five-unit `BACKLOG-ZERO-MIGRATION` manifest: return CLI-062, CLI-078, CLI-079,
CLI-080, and CLI-081 to their exact GitHub owners and terminalize the local Tasks without changing
CLI-034, carriers, baselines, package source/docs, APIs, policy, workflows, topology, or product/user
documentation.

Source initiative: issue #2404. This Task and its PR are owned by child issue #2441; the parent remains
open for later batches and the preventive durable-queue mechanism.

## Spec

`.agents/spec-docs/active/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`

## Plan

- [ ] TC-01 — preserve the committed five-unit/nine-path manifest, five source Task blob OIDs,
      ownership, dispositions, and zero-baseline-change boundary.
- [ ] TC-02 — preserve exact readback of issues #2442, #2443, #2444, #2445, and #2056, control issue
      #2441, and all five canonical handoff comment URLs; put each URL on its skipped Task.
- [ ] TC-03 — terminalize all five Tasks as skipped without deleting or rewriting historical
      evidence; leave excluded CLI-034 and both factual carriers byte-unchanged.
- [ ] TC-04 — keep the exact final changed-path set to the five Task moves, paired DOCS-032 Task/spec,
      and two loop ledgers; change no baseline, carrier, or package path.
- [ ] TC-05 — pass the pre-completion lifecycle/folder/delegation/scenario/reference/ledger checks;
      reserve `pnpm harness:scan` and `pnpm harness:verify-like-ci` for the atomic final Task/spec
      placement, where immutable original-path citations are historical rather than live.

## Test Plan

Compare all five source blobs and the exact final path set; read back the six issues and five handoff
comments; run task archival, folder/status, standing-delegation, scenario-section, reference-kind,
and loop-ledger scans before completion; compare excluded CLI-034/carrier/baseline blobs. In the atomic
final Task/spec placement, run Task-path citation, `pnpm harness:scan`, and
`pnpm harness:verify-like-ci` against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this work changes internal lifecycle evidence and remote queue ownership only. It
introduces no runnable user-facing behavior.
