---
title: 'META-2655: Permit bounded completion records without executable planning authority'
issue: https://github.com/woojubb/robota/issues/2655
status: in-progress
created: 2026-09-13
priority: medium
urgency: soon
area: completion-record validation
depends_on: []
---

# META-2655: Permit bounded completion records without executable planning authority

Spec: `.agents/spec-docs/todo/META-2655-permit-bounded-completion-records-without-executable-planning-authority.md`

## Objective

Permit required completion bookkeeping without granting executable planning authority. The current
checker refuses a reviewed documentation-only Task's own archive, a ledger-only record of failed
post-merge verification, and a delivered Task/spec archive accompanied by required parent projections
and execution-run closures. These are observed record-boundary mismatches, not missing product tests.

Supporting Issue #2655; the existing MERGE-2655 amendment records the first refusal. ARTIFACT-2655
already passed GATE-COMPLETE and landed via PR #2715. Its complete closeout is preserved in scoped
stash `f066e47468945c6ff06db347e0ae90eed4f5b322`; no implementation, hook bypass or lost history is
needed to repair the record path. The ordinary executable checkpoint and exact merge proof remain.

Owner authorization (verbatim):

> 작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.

## Plan

- [x] Reproduce the three metadata refusals with ordinary-file/in-memory fixtures; no local Git fixtures.
- [x] Extend the existing record classifier and shared staged/history routes with bounded metadata handling.
- [ ] Verify refusal cases, actual staged/history closeout and owner-document consistency; preserve existing executable gates.

## Test Plan

Focused Vitest pure record-classification fixtures establish RED then GREEN without Git fixtures.
Reject executable paths, missing authorization, absent or mismatched archive halves, changed plans
or sealed history, unsupported lifecycle transitions, unrelated parents/runs and missing merge
evidence. Use the current repository's real staged/history checks for wiring verification; remote
CI retains the existing Git-fixture integration suite. No product rebuild is relevant to this fix.

## Progress

TC-01's first executable regression reproduced the actual boundary failure: the existing shared
staged/history documentation reader returned false for an unchanged approved Task archive.
The bounded archive predicate now passes that case in both readers. It checks original approval,
complete Plan, no paired spec, valid terminal lifecycle/date, regular Git objects, exact paired
paths, and unchanged content outside status/date. Only in-memory Git-object adapters were used;
no Git repository, worktree, clone or product fixture was created.

The focused file now passes 14 tests across both object readers, including missing approval,
empty instruction, unchecked Plan, changed content/scenario, invalid date, duplicate status,
retained source, existing destination, paired specs, unreadable lane ownership and extra source
paths. The post-format rerun passed; this is TC-01-focused evidence, not whole-Task completion.
At that checkpoint TC-02 ledger history and TC-03 parent/run closeout handling were not yet
implemented. The existing product build/CI evidence is unchanged and has not been rerun.
ESLint reported all three script/test paths ignored by repository configuration; its exit 0 is
not counted as a lint pass. The actual Vitest run imported and executed the changed MJS modules.

2026-09-13 completion-boundary implementation: TC-02 now retains only closed append-only history,
without consuming a planning checkpoint or claiming merge authority. TC-03 reuses the existing
delivery predicate for required parent path/status projections and bound existing OPEN run closures;
the outer caller retains terminal gate and exact merge-ancestor validation. Committed mode reads
file types from the examined commit, staged mode from the index.

The focused memory-only file passed 56 tests. New RED cases exposed false convergence with one
unresolved finding and a malformed JSON closure throwing through the classifier; both now reject
the input. Negative coverage also includes unrelated parent/child changes, parent Plan/frontmatter/
Evidence Log rewrites, lifecycle and file-type violations, partial/duplicate pairs, source additions,
run identity/ref/open-time/extension/round-history changes and sealed-record rewrites. Historical
abandoned/halted closures stay historical, not successful. CI Git-fixture caller tests are being
updated separately and have not run locally. Actual staged/history closeout and affected scans
remain required before whole-Task completion.

Integrated local review found two MUSTs: archive source comparisons were incomplete, and staged
delivery counted prior history-only captures as deliveries. Pascal independently classified both
LOCAL; Hume confirmed the repair batch at ACTIONABLE FINDINGS: 0. The focused suite now passes
66 tests. Additional RED cases cover substituted issue/Objective/Problem/scenario, Task Plan,
completion criteria and sealed evidence. The predecessor-count test's initial RED was missing API,
not a full caller reproduction; CI-only Git integration cases exercise the actual staged/history
sequence, including invalid merge witnesses and refusal of subsequent unplanned source.

Actual ARTIFACT closeout has been restored and its bounded record-scope predicate passes against
the current HEAD and filesystem. This is not by itself terminal-gate or merge-witness proof.
Task verification observations are separate from its unchanged Test Plan; the spec Test Plan may
record actual test references as GATE-COMPLETE requires. Existing ARTIFACT terminal/CI evidence
and the historical unsuccessful loop records remain intact. MERGE archival preserves the later
diagnostic prose instead of replacing it with an older saved version.

The first affected scan selected 72 checks: one blocking lane-declaration failure and one advisory
reference-kind finding. The lane conflict was among this branch's unpublished L0 documentation
trailers and L1 implementation plan. Reworded those trailers to L1 without changing any tree content:
`b97e7f9c8` → `bb0556124`, `d5335fdb9` → `892b09e7b`, `80b05d9d5` → `4daea42f2`,
`bf50b4524` → `1a99186ce`; `git diff --exit-code` between old/new heads returned 0.
Old evidence entries retain the actual historical identities under which they were recorded.
Scoped backup `387b36beb3f1628041215f069e76e0935eea6d9b` preserves the complete uncommitted
repair/closeout batch; it was restored after rewording. No remote history was rewritten.

The real combined staged check then refused the two historical post-merge attempts as a delivery
witness batch. Preserve those sealed records separately before appending the canonical delivery
witness; do not rewrite their human-readable refs. The integrated closeout is now in scoped stash
`2c7074defa24a7d033a5ebc0dd79b1b8b4c1dfee` so the reviewed checker implementation can land in a
coherent local milestone first. This Task stays in-progress until the actual record sequence and
final affected checks are verified. The corrected committed lane scan passed with zero violations.

Local record integration now completed: implementation `f4776d116`, historical attempts `a98f2e256`,
and exact ARTIFACT/MERGE archival `9fc15a99c`. The first canonical capture accidentally omitted
`--ref` at close; immutable history `8f0102850` retains that mistake. The corrected record
`r20260912233724` explicitly binds PR #2715 and merge `4f3c0755dd70d3830127ffecdbdc8cb7a9704abc`.
Actual staged validation accepted all 12 closeout paths; committed-history validation then accepted
all eight topic commits. The last advisory reference was corrected and its owning scan passed.
The final DONE gate owns the remaining aggregate verification run. CI-only Git regressions have
not been executed locally and remote CI remains required before merge. No new GitHub issue began.

Final GATE-DONE attempt did not pass. Its focused tests again passed 66/66, but the full current
branch scan found two record-process refusals. First, `scan-lane-declaration` treats the existing
AGREEMENT-2655 parent's unchanged `lane: L2` as a new branch declaration merely because its required
completion projection changed; that conflicts with META-2655's L1 plan and trailers. The earlier
pre-commit scan did not include the then-uncommitted projection in that scanner's HEAD-based diff.
This is not an under-declared executable path: all changed executable paths have floor L1, and the
parent metadata paths have floor L0. Preserve the parent's original L2 planning classification and
the exact completion/merge checks; do not relabel the parent or invent an L2 META checkpoint.

Second, `check-task-archival` rejects all-checked Task Plans before the spec's terminal gate passes,
while GATE-DONE requires those checkboxes checked. Its documented `archival-exempt` annotation is
available for a deliberately still-active record; none has been added. The real lane failure means
the final verification Plan item and TC-04 are not complete, so they are unchecked again. The
GATE-DONE FAIL and all per-TC observations remain preserved. Two legacy catalogue-wording matches
also remain guardian residue (Every Plan item / No Plan item), as in the earlier ARTIFACT gate;
they are not permission to change the catalogue or fabricate a mechanical verdict.

Correction to the lane diagnosis: `gatherInputs` already excludes `isLifecycleProjectionOnly`
changes. The extra parent TC-01/TC-03 checkbox/evidence edits exceeded that existing route; the
required child row itself was not the cause. Keep only the parent's required Tasks projection in
this batch. Its original criteria remain intact for the initiative's own verification, while actual
delivery remains recorded in the completed child, parent Task Progress and GitHub Issue. No new
lane-classifier implementation, lower parent lane or extra approval is needed.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This repairs internal repository record validation only. It adds no CLI, TUI, browser or
public SDK behavior, so there is no new product interaction for a user to execute.
