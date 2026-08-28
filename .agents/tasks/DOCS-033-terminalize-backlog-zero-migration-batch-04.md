---
title: 'DOCS-033: terminalize backlog-zero migration batch 04'
issue: https://github.com/woojubb/robota/issues/2447
status: in-progress
created: 2026-08-29
priority: high
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-033: terminalize backlog-zero migration batch 04

## Objective

Apply the approved four-unit `BACKLOG-ZERO-MIGRATION` manifest: return CLI-082, CMD-007, CMD-008,
and CMD-009 to their exact GitHub owners and terminalize the local Tasks without changing CLI-083,
CLI2-011, carriers, baselines, package source/docs, APIs, policy, workflows, topology, or product/user
documentation.

Source initiative: issue #2404. This Task and its PR are owned by child issue #2447; the parent remains
open for later batches and the preventive durable-queue mechanism.

## Spec

`.agents/spec-docs/active/DOCS-033-terminalize-backlog-zero-migration-batch-04.md`

## Plan

- [ ] TC-01 — preserve the committed four-unit/eight-path manifest, four source Task blob OIDs,
      ownership, dispositions, and zero-baseline-change boundary.
- [ ] TC-02 — preserve exact readback of issues #1988, #2058, #2449, #2448, control issue #2447, and
      all four canonical handoff comment URLs; put each URL on its skipped Task.
- [ ] TC-03 — terminalize all four Tasks as skipped without deleting or rewriting historical
      evidence; leave excluded CLI-083 and terminal CLI2-011 byte-unchanged.
- [ ] TC-04 — keep the exact final changed-path set to the four Task moves, paired DOCS-033 Task/spec,
      and two loop ledgers; change no baseline, carrier, or package path.
- [ ] TC-05 — pass the pre-completion lifecycle/folder/delegation/scenario/reference/ledger checks;
      reserve `pnpm harness:scan` and `pnpm harness:verify-like-ci` for the atomic final Task/spec
      placement, where immutable original-path citations are historical rather than live.

## Test Plan

Compare all four source blobs and the exact final path set; read back the five issues and four handoff
comments; run task archival, folder/status, standing-delegation, scenario-section, reference-kind,
and loop-ledger scans before completion; compare excluded CLI-083/CLI2-011 blobs. In the atomic final
Task/spec placement, run Task-path citation, `pnpm harness:scan`, and `pnpm harness:verify-like-ci`
against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this work changes internal lifecycle evidence and remote queue ownership only. It
introduces no runnable user-facing behavior.
