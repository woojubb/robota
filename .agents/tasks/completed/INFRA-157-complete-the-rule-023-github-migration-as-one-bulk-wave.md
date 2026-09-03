---
title: 'INFRA-157: complete the RULE-023 GitHub migration as one bulk wave'
status: done
created: 2026-09-03
completed: 2026-09-03
priority: high
urgency: now
area: issue migration governance
depends_on: [INFRA-155, INFRA-156]
---

# INFRA-157: complete the RULE-023 GitHub migration as one bulk wave

## Objective

Execute the fully approved RULE-023 GitHub disposition set from one complete `/tmp` snapshot and close it with one post-write audit.

no-issue: This is the terminal execution record for the existing approved migration; creating another GitHub Issue would recreate the queue overhead being removed.

Checkpoint: implementation starts only after this Task and its paired spec are atomically activated.

## Plan

- [x] TC-01 — Promote the eleven P2 sources and make their Task urgency `soon`.
- [x] TC-02 — Finalize and close all 48 ABSORB rows while preserving bodies and relations.
- [x] TC-03 — Record and preserve all twenty RETAIN external lifecycles.
- [x] TC-04 — Update four parent maps, reopen three parents, and complete issue #2093 reconciliation.
- [x] TC-05 — Re-snapshot once, reconcile the manifest and `/tmp` plan, and run the large final verification.

## Test Plan

- Compare exact before/after JSON snapshots for all authorized IDs and parent relationships.
- Assert marker authors, bodies, labels, states/reasons, assignees, and map row counts locally.
- Run the issue-triage audit and one full affected repository verification on the final tree.

## Execution Evidence

- `/tmp/robota-issue-bulk-verification-final.json`: 511/511 PASS and 273→227 OPEN Issues.
- `.agents/evidence/RULE-023-child-issue-migration-manifest.json`: final 56 ABSORB / 20 RETAIN / 2 ALREADY_RESOLVED / 0 OWNER_REVIEW accounting and exact receipt metadata.
- `/tmp/robota-issue-child-consolidation-plan.md`: complete before/after paths, query population, mutation order, recovery, and final reconciliation.
- Final substantive-tree verification at `21a859d6d`: `pnpm build` passed; the affected contract tier passed 97 files / 2,304 tests; planning-order history examined three commits and passed; all non-Work-Run harness scans passed. The required Work-Run validation is finalized by the receipt-only commit that immediately follows this completion commit and is checked before the direct develop push.

## User Execution Test Scenarios

Not applicable. This wave changes GitHub administration and governance evidence only.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** All acceptance outcomes are machine-readable and have no product user surface.
