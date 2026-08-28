---
title: 'DOCS-037: terminalize backlog-zero migration batch 08'
issue: https://github.com/woojubb/robota/issues/2459
status: in-progress
created: 2026-08-29
priority: high
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-037: terminalize backlog-zero migration batch 08

## Objective

Apply the approved three-unit `BACKLOG-ZERO-MIGRATION` manifest: return the unfinished HARNESS-057,
PLG-020, and TOOL-004 records to their exact open GitHub owners without changing package source,
APIs, policy, package/product docs, workflows, topology, baselines, or carriers.

Source initiative: issue #2404. This Task and its PR are owned by child issue #2459; residual work
remains owned by issues #2462, #2460, and #2461 respectively. Umbrella issue #2234 is related-only.

## Spec

`.agents/spec-docs/active/DOCS-037-terminalize-backlog-zero-migration-batch-08.md`

## Plan

- [ ] TC-01 — preserve the corrected three-unit/seven-path manifest, three governed blob OIDs,
      exact high/now skipped dispositions, and zero-baseline/carrier boundary.
- [ ] TC-02 — preserve exact readback of control issue #2459, residual issues #2462/#2460/#2461,
      and all three canonical handoff URLs; put only those exact URLs on the skipped Tasks.
- [ ] TC-03 — mark all three Tasks skipped and preserve all three historical Task bodies byte-for-byte.
- [ ] TC-04 — change no package/app source, API/contract, package/product doc, policy/gate,
      skill/workflow/hook, topology, baseline, or carrier path.
- [ ] TC-05 — keep the exact final changed-path set to seven approved lifecycle/ledger paths and pass
      focused lifecycle/current-premise checks plus the full harness CI mirror.

## Test Plan

Compare the three governed blobs and normalized Task bodies; read back the control/residual issues and
exact comments; run task archival, folder/status, standing-delegation, scenario-section,
reference-kind, Task citation, and loop-ledger scans; run focused current-premise tests; then run
`pnpm harness:scan` and `pnpm harness:verify-like-ci` against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this work changes internal lifecycle evidence and remote queue ownership only. It
introduces no runnable user-facing behavior.
