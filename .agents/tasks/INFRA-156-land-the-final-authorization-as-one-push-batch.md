---
title: 'INFRA-156: land the final authorization as one push batch'
status: in-progress
created: 2026-09-03
priority: high
urgency: now
area: issue migration governance
depends_on: [INFRA-155]
---

# INFRA-156: land the final authorization as one push batch

## Objective

Deliver the already approved RULE-023 manifest authorization and reference baseline through the history window required by the current pre-push scanner.

no-issue: This is a repository-local delivery correction for the approved migration; creating a GitHub Issue would recreate queue overhead.

## Plan

- [ ] TC-01 — Preserve the exact INFRA-155 48/20 authorization and one reference baseline entry.
- [ ] TC-02 — Commit prelude, checkpoint, and implementation in one local topic range before any push.
- [ ] TC-03 — Make default history planning-order, reference-kind, manifest accounting, and pre-push checks pass.

## Test Plan

- Compare the implementation files byte-for-byte with the independently reviewed INFRA-155 implementation.
- Run default history and staged planning-order scans from current origin/develop.
- Push the three-commit topic range once, then read back remote develop.

- Deliver prelude, checkpoint, and implementation in one push batch.

## User Execution Test Scenarios

Not applicable. This changes governance delivery history only.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** All outcomes are repository-history and manifest invariants with no product surface.
