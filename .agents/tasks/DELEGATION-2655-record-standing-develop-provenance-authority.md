---
title: 'DELEGATION-2655: Record standing develop provenance authority'
issue: https://github.com/woojubb/robota/issues/2655
status: in-progress
created: 2026-09-13
priority: medium
urgency: now
area: merge guidance
depends_on: []
---

# DELEGATION-2655: Record standing develop provenance authority

## Objective

Record the owner's explicit standing delegation for the develop workflow-provenance exception.
Do not request repeated owner operation when the delegation and verified evidence apply.
Retain all other CI/review requirements and exclude main, release and protection changes.

Owner approval (verbatim): "병합완료. 다음부터는 너가 직접해. 나에게 그만시켜"

## Plan

- [x] Amend the existing Git rule and verifier routing without changing executable gates.
- [x] Mirror the exact instruction into existing repository permissions and recurrence records.
- [ ] Verify the bounded documentation changes and their delivery.

## Test Plan

Inspect ordinary versus explicitly delegated authority, current head/base and review evidence,
the one intentional provenance exception, truthful agent approver attribution, and refusal of
other failed checks or main/release/protection changes. Run formatting and applicable document
checks. No product behavior changes or product test reruns are required.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Permission routing and documentation only; no runnable product behavior changes.

## Progress

The instruction follows the owner's actual PR #2718 merge at
`fa7984f59358682ab472b1adf96297767715ef4e`. That completed merge remains attributed to the owner;
future delegated decisions must identify the actual agent and this instruction, not fabricate
fresh direct owner approval. The existing recurrence ledger L7 remains OPEN, not mechanized.

Hume's bounded documentation review returned ACTIONABLE FINDINGS: 0 after the canonical N/A
author verdict was corrected. The review verified refusal of other failed or unproven checks,
ordinary delegation without the explicit exception, and out-of-scope main/release/protection changes.
Formatting and the canonical scenario validator passed. Delivery remains pending.
