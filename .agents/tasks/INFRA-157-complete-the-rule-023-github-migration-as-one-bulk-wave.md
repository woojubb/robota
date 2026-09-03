---
title: 'INFRA-157: complete the RULE-023 GitHub migration as one bulk wave'
status: todo
created: 2026-09-03
priority: high
urgency: now
area: issue migration governance
depends_on: [INFRA-155, INFRA-156]
---

# INFRA-157: complete the RULE-023 GitHub migration as one bulk wave

## Objective

Execute the fully approved RULE-023 GitHub disposition set from one complete `/tmp` snapshot and close it with one post-write audit.

no-issue: This is the terminal execution record for the existing approved migration; creating another GitHub Issue would recreate the queue overhead being removed.

## Plan

- [ ] TC-01 — Promote the eleven P2 sources and make their Task urgency `soon`.
- [ ] TC-02 — Finalize and close all 48 ABSORB rows while preserving bodies and relations.
- [ ] TC-03 — Record and preserve all twenty RETAIN external lifecycles.
- [ ] TC-04 — Update four parent maps, reopen three parents, and complete issue #2093 reconciliation.
- [ ] TC-05 — Re-snapshot once, reconcile the manifest and `/tmp` plan, and run the large final verification.

## Test Plan

- Compare exact before/after JSON snapshots for all authorized IDs and parent relationships.
- Assert marker authors, bodies, labels, states/reasons, assignees, and map row counts locally.
- Run the issue-triage audit and one full affected repository verification on the final tree.

## User Execution Test Scenarios

Not applicable. This wave changes GitHub administration and governance evidence only.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** All acceptance outcomes are machine-readable and have no product user surface.
