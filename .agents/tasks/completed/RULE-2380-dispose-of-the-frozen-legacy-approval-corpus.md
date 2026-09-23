---
title: 'RULE-2380: Dispose of the frozen legacy approval corpus'
issue: https://github.com/woojubb/robota/issues/2380
status: done
created: 2026-09-20
completed: 2026-09-21
priority: high
urgency: now
area: standing approval migration and frozen spec evidence
depends_on: [RULE-2326]
---

# RULE-2380: Dispose of the frozen legacy approval corpus

## Current disposition — 2026-09-23

Historical delivery is preserved at replacement child merge `720eb5e841ba7a5361ac667b9658e034212bb58e` in R `720eb5e841ba7a5361ac667b9658e034212bb58e`. The done status and original evidence below describe that delivery; importing this record does not restore its historical implementation. PR #2827 (`2a4a84631d24243d8dfb8ef75e04d790e8d60d37`) deliberately retired the legacy gate, checkpoint, and recommendation machinery. This record is historical evidence of a completed child, not an active instruction to recreate its gate, checkpoint, endorsement, or frozen-corpus enforcement machinery.

Spec: `.agents/spec-docs/done/RULE-2380-dispose-of-the-frozen-legacy-approval-corpus.md`

## Objective

Give each currently frozen approval record one explicit, auditable disposition without rewriting sealed
history or inventing missing user authority. The current measured baseline is 218 frozen records with no
route, so silence or a shrinking count is not completion.

The canonical execution owner is issue #2664. Issue #2380 is the closed historical source whose
unfinished scope was explicitly transferred to issue #2664 on 2026-09-12.

## Owner Policy

Preserve every one of the 218 legacy approvals as a historical frozen exemption. Do not relabel any
record as DIRECT or CLASS and do not add approval evidence to a historical spec. Record one immutable
central disposition row per frozen record; every row has the sole terminal effect
`PRESERVE_FROZEN`. Evidence-shape categories describe only what the old record contains and grant no
current approval authority.

This policy follows the user's standing instruction in the current conversation: “승인합니다. 그리고
앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다.” The
recommendation is to preserve rather than retroactively repair because RULE-012 forbids retroactive
CLASS registration, relayed authority is not an instruction, and missing verbatim authority cannot be
reconstructed honestly.

## Plan

- [x] TC-01 — Freeze the current corpus and classify every record by historical direct shape, historical quoted-class shape, relayed authority only, or no quoted authority.
- [x] TC-02 — Obtain and encode the owner policy needed for classes that cannot be decided mechanically.
- [x] TC-03 — Apply only authorized metadata or terminal disposition while preserving every historical Evidence Log byte.
- [x] TC-04 — Prove population conservation, idempotent replay, and zero unclassified frozen records.
- [x] TC-05 — Verify exact RULE-2380 and AGREEMENT-2664 projection paths, statuses, and child inventory.

## Test Plan

Use `scan-standing-delegation-evidence.mjs` as the population owner, a frozen manifest/read-back comparison,
and idempotent replay fixtures. Verify original blobs and evidence logs are unchanged except for the exact
authorized append-only disposition records. Verify the child and both parent projections by exact path,
status, and remaining-owner assertions.

## User Execution Test Scenarios

Not applicable.

- **Canonical loop run:** `r20260920152818`

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is a repository approval-record migration with no Robota product CLI, TUI, browser,
public SDK, or installed-package behavior an end user can execute.

## Progress

- 2026-09-21: Approval committed; implementation checkpoint prepared.
- 2026-09-21: Canonical independent `proposal-reviewer` refresh returned `ENDORSE` with 0 unresolved
  findings after correcting the paired Task projection to `in-progress`.
- 2026-09-21: Independent review returned `ENDORSE` with 0 unresolved findings for the TC-05
  pre-terminal/post-PASS lifecycle-order correction.
- 2026-09-21: GATE-VERIFY and GATE-COMPLETE passed; archived through the initiative manual
  completion route with both parent projections reserved for the following subject-bound checkpoint.
