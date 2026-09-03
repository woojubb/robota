---
title: 'INFRA-155: authorize the final RULE-023 bulk migration'
status: in-progress
created: 2026-09-03
priority: high
urgency: now
area: issue migration governance
depends_on: [INFRA-152]
---

# INFRA-155: authorize the final RULE-023 bulk migration

## Objective

Bind the approved 48 ABSORB and 20 RETAIN decisions to their exact live Task owners in the durable RULE-023 manifest, and freeze the single pre-existing reference-kind debt in AGREEMENT-008 before GitHub mutation.

no-issue: This record closes the administrative migration already authorized by RULE-023. Creating another GitHub Issue would recreate the duplicate queue entry being removed.

## Plan

- [ ] TC-01 — Record exactly 48 newly authorized ABSORB rows and their unique live Task paths.
- [ ] TC-02 — Record exactly 20 RETAIN rows with substantive independent-lifecycle reasons and the owner receipt.
- [ ] TC-03 — Preserve #2093 and #2514 as the only non-ABSORB/non-RETAIN reconciliation rows.
- [ ] TC-04 — Freeze exactly one known reference-kind occurrence in the AGREEMENT-008 active evidence log without rewriting append-only evidence.
- [ ] TC-05 — Make planning-order, reference-kind, manifest accounting, and diff checks pass together.

## Test Plan

- Assert exact issue sets, unique Task URLs, counts, approval evidence, and expected population arithmetic from the final manifest.
- Run the staged planning-order and reference-kind scans after both files are present.
- Run one affected repository verification after the complete authorization batch.

- Apply the manifest authorization and reference baseline together, then verify the combined final state once.

## User Execution Test Scenarios

Not applicable. This work changes repository governance evidence only and exposes no runnable product surface.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Manifest and baseline invariants are fully machine-checkable; no product interaction exists.
