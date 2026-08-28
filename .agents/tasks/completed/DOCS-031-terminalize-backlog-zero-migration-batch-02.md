---
title: 'DOCS-031: terminalize backlog-zero migration batch 02'
issue: https://github.com/woojubb/robota/issues/2436
status: done
completed: 2026-08-29
created: 2026-08-29
priority: high
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-031: terminalize backlog-zero migration batch 02

## Objective

Apply the approved three-unit `BACKLOG-ZERO-MIGRATION` manifest: return ARCH-110 and CLI-032 to
their exact GitHub owners, independently terminalize delivered ARCH-111, correct the one CLI-083
carrier link, and preserve the historical CLI-032 done spec and all baselines byte-for-byte.

Source initiative: issue #2404. This Task and its PR are owned by child issue #2436; the parent remains
open for later batches and the preventive durable-queue mechanism.

## Spec

`.agents/spec-docs/done/DOCS-031-terminalize-backlog-zero-migration-batch-02.md`

## Plan

- [x] TC-01 — preserve the committed 3-unit/9-path manifest, six source/carrier blob OIDs, ownership,
      dispositions, and zero-baseline-change boundary.
- [x] TC-02 — preserve exact readback of CLI-032 issue #2437, control issue #2436, and both canonical
      handoff comment URLs; put each URL on its skipped Task.
- [x] TC-03 — terminalize ARCH-110 and CLI-032 as skipped, ARCH-111 Task as done, and ARCH-111 draft
      spec as rejected without deleting or rewriting historical evidence.
- [x] TC-04 — distinguish the archived ARCH-110 record from open issue #2295 in CLI-083 while leaving the
      CLI-032 done spec and all baseline files byte-unchanged.
- [x] TC-05 — pass the pre-completion lifecycle/folder/delegation/scenario/reference/ledger checks;
      retain `pnpm harness:scan` and `pnpm harness:verify-like-ci` for the atomic final Task/spec
      placement, where the immutable original-path manifest is historical rather than a live citation.

## Test Plan

Compare all governed blobs and the exact final path set; read back the two issues and two handoff
comments; run task archival, folder/status, standing-delegation, scenario-section, reference-kind,
and loop-ledger scans before completion; compare the historical CLI-032 spec and baseline blobs. In
the atomic final Task/spec placement, run Task-path citation, `pnpm harness:scan`, and
`pnpm harness:verify-like-ci` against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this unit changes internal lifecycle evidence, one relative documentation carrier,
and remote queue ownership only. It introduces no runnable user-facing behavior.
