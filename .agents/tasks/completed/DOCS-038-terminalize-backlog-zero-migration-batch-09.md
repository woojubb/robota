---
title: 'DOCS-038: terminalize backlog-zero migration batch 09'
issue: https://github.com/woojubb/robota/issues/2464
status: done
created: 2026-08-29
completed: 2026-08-29
priority: critical
urgency: now
area: internal backlog lifecycle documentation
depends_on: []
---

# DOCS-038: terminalize backlog-zero migration batch 09

## Objective

Apply the corrected three-unit `BACKLOG-ZERO-MIGRATION` manifest and its mandatory INFRA-138
containment record: return unfinished
SEC-016, SECURITY-001, and STRUCT-011 records to their exact open GitHub owners without changing
package/app source, APIs/contracts, policy/gate owners, package/product docs, workflows, hooks, skills,
topology, or product behavior.

Source initiative: issue #2404. This Task and its PR are owned by child issue #2464. Residual work
remains owned by issues #2225, #2465, and #2198 respectively. Issue #2467 owns the separate reusable
gate-reader defect exposed by the final local review.

## Spec

`.agents/spec-docs/done/DOCS-038-terminalize-backlog-zero-migration-batch-09.md`

## Plan

- [x] TC-01 — preserve the exact three-unit/eleven-batch-path manifest, the one INFRA-138 root Task,
      the twelve-path overall boundary, governed input/postimage blobs, skipped/rejected dispositions,
      and excluded implementation/policy scope.
- [x] TC-02 — preserve exact readback of control/owner issues and all three canonical handoffs; put
      only those exact comment URLs on the skipped Tasks and rejected plans.
- [x] TC-03 — preserve all three Task bodies; apply exactly three SEC-016 lifecycle-evidence
      corrections (`e3668da7...` → `e73e2396...`) and preserve STRUCT-011's single citation rekey and
      body postimage `ca8278c6...`.
- [x] TC-04 — rekey only the SEC-016 standing-delegation baseline path from active to rejected,
      preserving cardinality 218 and every other entry/order; change no excluded path.
- [x] TC-05 — keep the exact batch subset at eleven lifecycle/ledger/baseline paths and the overall
      changed-path set at twelve with INFRA-138; pass focused lifecycle/current-premise/containment
      checks plus the full harness CI mirror.

## Test Plan

Compare governed input/postimage blobs, normalized Task bodies, and exact lifecycle-evidence
corrections; read back exact issues/comments; compare baseline preimage/postimage/cardinality/key counts; run task
archival, folder/status, standing-delegation, scenario-section, reference-kind, Task citation,
baseline, and loop-ledger scans; run focused current-premise checks; then run `pnpm harness:scan` and
`pnpm harness:verify-like-ci` against the final tree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable: this work changes internal lifecycle evidence, current-path citations, one frozen
lifecycle baseline key, and remote queue ownership only. It introduces no runnable user-facing
behavior.
