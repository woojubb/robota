---
title: 'DELEGATE-2655: Honor owner-delegated develop merge decisions'
issue: https://github.com/woojubb/robota/issues/2655
status: todo
created: 2026-09-13
priority: medium
urgency: now
area: merge authorization guidance
depends_on: []
documentation_batch_approval: DIRECT
documentation_batch_instruction: '병합 승인해. 앞으로 병합은 너가 확인해서 타당할 경우 셀프승인하고 병합해'
---

# DELEGATE-2655: Honor owner-delegated develop merge decisions

## Objective

Honor the owner's standing develop-merge delegation without repeating permission requests or
weakening CI, independent review, exact-head evidence, protected-branch or release boundaries.
This is a documentation-only supporting amendment for the existing Issue, not a new product issue.
The allocator dry run resolved DELEGATE-2655 against Issue #2655 without a collision.

## Plan

- [x] Define delegated merge decisions in the existing Git rule and route both review skills to it.
- [x] Independently verify the small documentation batch and its preserved refusal boundaries.

## Test Plan

Run formatting and diff checks over the changed Markdown. Review three formerly unconditional
maintainer-approval statements as one batch. Confirm that an unrevoked develop delegation admits
an honest agent decision, while missing delegation, changed evidence, main/release scope, a red
required check or absent independent review does not. Inspect the existing push/rebase parser
without changing it; it must not be described as validating merge actions. These are document
and semantic checks, not runnable product tests or claims of new mechanical enforcement.

## User Execution Test Scenarios

Not applicable: repository governance text only; no runnable product behavior is delivered.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

## Progress

Carson's read-only depth classification returned LOCAL, 0 FOUNDATIONAL of 1. The sweep found
three current statements in the Git rule and two review skills. The existing parser only
accepts push/rebase plus a maintainer login, so the amendment distinguishes the operator-owned
merge decision instead of changing the parser or disguising agent approval as a human review.
The exact standing owner instruction is preserved in the existing execution-permissions memory.
The recurring process-fragmentation lesson remains open for the existing consolidated cycle.

The focused review found one LOCAL MUST: a clean merge had no truthful value among the old
push-only grounds. The repair scopes that fixed format to push/rebase and gives merge its own
operator-owned evidence record; no failing check or manufactured finding is required to merge.
Formatting, diff checks, review-findings and task-plan-items checks passed before this correction;
the changed documentation was rechecked rather than re-running product tests. The final
Prettier check, review-findings scan and diff check passed. Carson's single repair confirmation
returned `ACTIONABLE FINDINGS: 0`, with the original authorization boundaries preserved.
These changes were locally authored and reviewed before this delivery checkpoint; this record
does not claim that local drafting happened after it. Publication of the complete documentation,
memory and existing-loop closure batch is now explicitly requested by the owner. The initial
queued delivery record supplies the existing L0/no-spec publication boundary; it is not authority
for executable changes or a new review of unchanged text.

PR #2716 itself was separately approved directly by the owner and merged at
2026-09-13T00:46:44Z as 8badd7c570035e87625a34f03a514729121c97bf. Nash independently returned
MERGE VERIFIED: PASS. This subsequent amendment was not part of that merged PR.

## Delivery

Deliver all pending changes together in one PR, as explicitly requested by the owner:

> 커밋과 푸시 안한거 다 커밋과 푸시해서 origin/develop에 머지해야지

Do not reopen or push the already-merged PR. Keep Issue #2655 open for BOUNDARY-2655.
No main promotion or package publication.

## Result

The approved L0 documentation amendment is complete: one rule owns the delegated merge decision,
two skills route to it, the existing memory preserves the owner's exact instruction, and L7
records one correction without claiming a new enforcement mechanism. Both Plan items and the
non-applicable scenario outcome are verified; Carson's final focused review reports zero findings.
The delivery batch also preserves PR #2716's actual completed review and merge-loop records.
This record closes local documentation work, not Issue #2655 or unperformed remote delivery.
