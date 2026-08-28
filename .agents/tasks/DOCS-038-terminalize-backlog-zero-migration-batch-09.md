---
title: 'DOCS-038: terminalize backlog-zero migration batch 09'
issue: https://github.com/woojubb/robota/issues/2464
status: todo
created: 2026-08-29
priority: critical
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-038: terminalize backlog-zero migration batch 09

## Objective

Apply the corrected, freshly approved three-unit `BACKLOG-ZERO-MIGRATION` manifest: return unfinished
SEC-016, SECURITY-001, and STRUCT-011 records to their exact open GitHub owners without changing
package/app source, APIs/contracts, policy/gate owners, package/product docs, workflows, hooks, skills,
topology, or product behavior.

Source initiative: issue #2404. This Task and its PR are owned by child issue #2464. Residual work
remains owned by issues #2225, #2465, and #2198 respectively.

## Spec

`.agents/spec-docs/done/DOCS-038-terminalize-backlog-zero-migration-batch-09.md`

## Plan

- [x] TC-01 — preserve the exact three-unit/ten-path manifest, governed input/postimage blobs,
      skipped/rejected dispositions, and excluded-scope boundary.
- [x] TC-02 — preserve exact readback of control/owner issues and all three canonical handoffs; put
      only those exact comment URLs on the skipped Tasks and rejected plans.
- [x] TC-03 — preserve all three Task bodies; rekey exactly three SEC-016 and one STRUCT-011 Task
      citations inside the rejected plans and reproduce plan postimages `4d092597...`/`ca8278c6...`.
- [x] TC-04 — rekey only the SEC-016 standing-delegation baseline path from active to rejected,
      preserving cardinality 218 and every other entry/order; change no excluded path.
- [x] TC-05 — keep the exact final changed-path set to ten approved lifecycle/ledger/baseline paths
      and pass focused lifecycle/current-premise checks plus the full harness CI mirror.

## Test Plan

Compare governed input/postimage blobs, normalized Task bodies, and exact citation replacements; read
back exact issues/comments; compare baseline preimage/postimage/cardinality/key counts; run task
archival, folder/status, standing-delegation, scenario-section, reference-kind, Task citation,
baseline, and loop-ledger scans; run focused current-premise checks; then run `pnpm harness:scan` and
`pnpm harness:verify-like-ci` against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this work changes internal lifecycle evidence, four exact lifecycle citations, one
frozen lifecycle baseline key, and remote queue ownership only. It introduces no runnable user-facing
behavior.
