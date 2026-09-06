---
status: verifying
type: INFRA
tags: [harness, hooks]
lane: L2
---

# INFRA-201: merge-gate review check must not deadlock when the automated reviewer is retired

## Problem

`.claude/hooks/merge-gate.sh` refuses `gh pr merge` unless a comment or review from the identity
`REVIEWER_RE='^github-actions(\\[bot\\])?$'` (`merge-gate.sh:248`) carries an `ACTIONABLE FINDINGS: <n>`
marker for the exact current head. That identity belongs to `.github/workflows/claude-code-review.yml`,
which as of 2026-09-06 carries `if: false` and the comment `# CLAUDE-CODE-REVIEW: RETIRED (INFRA-2631).
2026-09-06 — the owner directed that this action be treated as permanently non-functional and disabled.`
— confirmed live: the job appears on every PR's check list as `Claude review  skipping  0`, never runs,
and posts nothing under that login, ever.

Every criterion downstream of the identity lookup — the verdict search, the inline-thread-resolution
scope ("threads the REVIEWER opened"), the `REVIEWED BASE`/`REVIEWED HEAD`/`ACTIONABLE FINDINGS` marker
parse — depends on a comment from that identity existing. None can be satisfied once it is retired, so
every future `gh pr merge` refuses unconditionally regardless of CI status or PR content, with no path
forward except `MERGE_GATE_ACK=1` on every single merge — which is the exact erosion the hook's own
header warns about ("teach everyone to pass MERGE_GATE_ACK=1, which is the bypass it exists to
prevent"). Reproduced directly: PR #2649 (2026-09-06, REFACTOR-027) got an independent internal-agent
review (`pr-review-reviewer`) posted to the PR with `ACTIONABLE FINDINGS: 0`, CI fully green, and
`merge-gate.sh` still refused — the comment's author login was `woojubb` (the authenticated CLI
account), which does not match `REVIEWER_RE`. The PR was only merged because the user clicked GitHub's
web-UI Merge button directly, which the local `PreToolUse` hook never intercepts — a one-PR workaround,
not a fix; every subsequent `gh pr merge` hits the identical refusal.

Full account and reproduction: `/tmp/robota-issues/MERGE-GATE-REVIEWER-BOT-RETIRED-ISSUE.md`.

## Prior Art Research

Waived: this is a repository-local CI/merge-policy hook change with no external product or protocol
behavior to research.

## Architecture Review

### Affected Scope

- `.claude/hooks/merge-gate.sh`

### Alternatives Considered

1. Broaden `REVIEWER_RE` to also accept a human login (e.g. `woojubb`).
   - Pro: smallest textual diff.
   - Con: defeats the gate's own stated purpose — its header explicitly names the case it exists to
     stop: "anyone — including the person merging — could post a remark after the review and satisfy
     both the recency check and the findings check with text that is not a review at all." Accepting
     the merger's own login turns the gate into self-certification, the exact bypass its `MERGE_GATE_ACK`
     override already provides deliberately and visibly — this would provide it silently.
2. Recognize `pr-review-reviewer`'s comments via a distinct content marker instead of a login.
   - Pro: preserves an independent-review requirement in spirit.
   - Con: `pr-review-reviewer` posts through the same authenticated CLI account as every other actor
     (`woojubb`), so a marker string is trivially copy-pasteable by anyone merging — it narrows the
     bypass surface without closing it, and requires the reviewer agent's own output contract to
     change in lockstep, which is a second, undelivered piece of work this fix does not include.
3. Skip review verification only when NO comment or review anywhere on the PR is from the identity
   `REVIEWER_RE` names — i.e., only in the exact "the automated reviewer never spoke" case — while
   leaving every other check (CI green, the withdrawal/`re-plan` disposition check, base-freshness)
   fully intact, and leaving the full strict verification logic in place and auto-re-engaging the
   moment that identity posts again (automation restored, or a replacement adopts the same login).
   - Pro: matches the user's explicit instruction ("리뷰는 이제 당분간 없다. 리뷰 없이 머지가능하게
     바꿔" — no review for now; make merging possible without one) precisely, changes nothing about
     merges when a reviewer IS present, and requires no second undelivered piece (no reviewer-side
     contract change, no new registered identity). Reversible in one line once a replacement reviewer
     is chosen: point `REVIEWER_RE` at it, or remove the early-exit.
   - Con: removes independent review as a merge precondition entirely while no reviewer is configured
     — accepted, per direct user instruction, because CI-green and the withdrawal check still hold, and
     the alternative is every `gh pr merge` refusing forever with `MERGE_GATE_ACK=1` as the routine
     workaround, which is strictly worse for the property this gate protects (a bypass everyone learns
     to reach for, per the hook's own header).

### Decision

Alternative 3, per direct user instruction. It is the only option that does not either quietly reopen
the self-certification hole this gate was built to close (Alternative 1) or ship half of a two-part
fix (Alternative 2), and it self-repairs the moment a real reviewer identity resumes commenting.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: a single local PreToolUse hook script, not a command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and no
      layer or product-family reclassification.

## Fallback & Degradation Declaration

None. If a future session needs the strict check back before a replacement reviewer exists, revert
this change or add `MERGE_GATE_ACK=1` per merge, both already-supported paths.

## Solution

In `merge-gate.sh`, immediately after the CI-green check (`--- 1. CI ---`) and before the review
section starts asking `gh` for the PR's base/head OIDs:

1. Move the existing `REVIEWER_RE='^github-actions(\\[bot\\])?$'` definition up to this point (it was
   previously defined later, inside the section this reorders around).
2. Read every comment/review author login on the PR (`gh pr view --json comments,reviews`, the same
   read the "reviewer spoke but delivered no verdict" branch already performs) and test each against
   `REVIEWER_RE`.
3. If NONE match — the reviewer has never spoken on this PR, which is now the permanent case since
   INFRA-2631 retired the workflow that used to post under that identity — print a visible, named
   notice (naming the retirement, the date, INFRA-2631, and the report this Task cites) to stderr and
   `exit 0`, skipping the rest of the review section (OID/base-freshness/thread/marker checks)
   entirely.
4. If at least one comment/review DOES match — a future replacement automation, or the retired one
   somehow reactivated — fall through unchanged into the existing strict verification logic exactly as
   it runs today, with no behavior change for that case.

## Affected Files

- `.claude/hooks/merge-gate.sh`

## Completion Criteria

- [ ] TC-01: With no `github-actions[bot]`-authored comment/review anywhere on a PR and CI green, `gh pr merge <N> --merge` (simulated via the hook's stdin contract) exits 0 with a printed notice naming the retirement — verified against a fixture PR/transcript, not a live GitHub call
- [ ] TC-02: With a `github-actions[bot]`-authored comment present, the existing strict verification path is reached and behaves exactly as before (unchanged pass/fail outcomes) — verified against the hook's existing fixture-based test coverage
- [ ] TC-03: `bash -n .claude/hooks/merge-gate.sh` (syntax check) and the hook's existing test suite both exit 0

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                             | Notes                                                                      |
| ----- | --------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TC-01 | Unit      | The hook's existing bats/shell test harness, new case: no reviewer comment, CI clean        | Confirms the early-exit path fires and prints the retirement notice        |
| TC-02 | Unit      | The hook's existing bats/shell test harness, existing cases with a reviewer comment present | Regression — every existing pass/fail case must keep its outcome unchanged |
| TC-03 | Static    | `bash -n` + the full existing test file for this hook                                       | Syntax and full regression                                                 |

## User Execution Test Scenarios

Not applicable.

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes a local git-hook script that gates the `gh pr merge` CLI command; it has no
end-user runtime surface, CLI behavior of a shipped product, SDK contract, or product-facing
interaction to execute — it is repository contributor tooling, not the product.

## Tasks

- [ ] `.agents/tasks/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md` — not yet implemented (planning checkpoint only)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → review-ready

**Judged by:** `backlog-gate-guard`, dispatched for the 7 `semantic` criteria after
`scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this path> --lane L2` reported 27 criteria
judged (20 `mechanical` PASS, 0 FAIL, 7 `PENDING-GUARDIAN`) with no entry written. The 20 mechanical
results below are this guardian's own direct re-read of the document, recorded for a complete entry;
the 7 semantic results are this guardian's independent judgement, each cross-checked against the
working tree (`.claude/hooks/merge-gate.sh`, `.github/workflows/claude-code-review.yml`, git history,
and `/tmp/robota-issues/MERGE-GATE-REVIEWER-BOT-RETIRED-ISSUE.md`) rather than taken on the document's
own word.

**Frontmatter:**

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — line 1 is `---`.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — line 2 is `status: draft`.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS — `type: INFRA` (line 3), INFRA is in the 11-prefix list.
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): PASS — `tags: [harness, hooks]` (line 4).

**Problem section:**

- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — names the exact file/line (`merge-gate.sh:248`), the exact regex variable, the exact retirement marker comment, and the exact refusing command (`gh pr merge`). Independently verified: `.github/workflows/claude-code-review.yml` line 57 carries `if: false` with the literal marker `# CLAUDE-CODE-REVIEW: RETIRED (INFRA-2631). 2026-09-06 — the owner directed...`; `.claude/hooks/merge-gate.sh:248` is exactly `REVIEWER_RE='^github-actions(\\[bot\\])?$'`. One transcription defect found: the Problem section quotes this regex as `'^github-actions(\[bot\])?$'` (single backslash) — the live source has a doubled backslash (confirmed by the file's own comment at line 284, "REVIEWER_RE doubles its backslashes because it is written for embedding in a jq string"). This is an inaccurate literal quote of the source line, but it does not weaken the symptom itself: the identity, the behavior, and the downstream mechanics it names (`REVIEWED BASE`/`REVIEWED HEAD` markers at lines 388-398, "threads the REVIEWER opened" at line 330, the `MERGE_GATE_ACK=1`/"teach everyone to pass" language at line 247) are all verified present verbatim in the hook. Criterion is met on the substance; the backslash mismatch is noted as a documentation defect, not grounds to fail concreteness.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — states the general condition (occurs on every future `gh pr merge` once the identity stops posting, "regardless of CI status or PR content") and a specific instance (PR #2649, 2026-09-06, CI green, an `ACTIONABLE FINDINGS: 0` comment present under login `woojubb` rather than `github-actions[bot]`). Independently verified: `git log` shows commit `35f1d907e` "Merge pull request #2649 from woojubb/fix/refactor-027-phantom-ports-v4" (2026-09-07 00:34 +0900, i.e. 2026-09-06 in most reference timezones), and the retirement commit `c018c1bdf` "ci(infra-2631): retire the non-functional Claude Code Review GitHub Action" is dated 2026-09-06 — both dates check out. `/tmp/robota-issues/MERGE-GATE-REVIEWER-BOT-RETIRED-ISSUE.md` (not part of the repo, read for corroboration only) independently describes the identical PR #2649 reproduction with the same details (CI green, `pr-review-reviewer` posted `ACTIONABLE FINDINGS: 0` under login `woojubb`, gate still refused, merged only via the web UI). The spec's account and the source report's account agree.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: PASS — multi-paragraph Problem section, no TBD/TODO strings, no single vague sentence.

**Prior Art Research:**

- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: PASS — section present at line 35.
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source, OR explicitly states no comparable reference was found: PASS — satisfied via the waiver route (next criterion); no fabricated external source is cited in its place.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: PASS — "Waived: this is a repository-local CI/merge-policy hook change with no external product or protocol behavior to research." — a stated, non-bare reason.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — with no external research to feed (legitimately waived — this is an internal hook script, not an external product/protocol), the criterion is read as "the recommendation is evidence-based, not asserted," and it is: Alternative 1's Con quotes the hook's own header near-verbatim ("anyone — including the person merging — could post a remark after the review and satisfy both the recency check and the findings check with text that is not a review at all") — independently confirmed present at `merge-gate.sh:241-242`. Alternative 2's Con is grounded in the actual authentication fact that `pr-review-reviewer` posts through the same `woojubb` CLI login as everyone else — consistent with the PR #2649 reproduction. Alternative 3 grounds its Pro in the user's own verbatim instruction. None of the three alternatives assert a preference without pointing at a specific, checkable fact.

**Architecture Review Checklist:**

- GATE-WRITE — All 4 checklist items are `[x]`: PASS — the 4 base items (영향 패키지/레이어, Sibling scan, 대안 최소 2개, 결정 근거) are all `[x]`.
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: PASS — `[x]` with "N/A: a single local PreToolUse hook script, not a command family."
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: PASS — 3 alternatives, each with a Pro and a Con.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — the Decision text explicitly weighs Alternative 3 against the other two ("does not either quietly reopen the self-certification hole this gate was built to close (Alternative 1) or ship half of a two-part fix (Alternative 2)"), and Alternative 3's own Con names the specific trade-off accepted ("removes independent review as a merge precondition entirely while no reviewer is configured — accepted... because CI-green and the withdrawal check still hold, and the alternative is every `gh pr merge` refusing forever... which is strictly worse"). This is a stated trade-off, not a bare preference.
- GATE-WRITE — New-surface placement (conditional): PASS — the checklist already carries "New-surface placement: **N/A** — no new package, app, presentation or interface surface, and no layer or product-family reclassification." Verified correct: the Affected Scope and Affected Files sections name only `.claude/hooks/merge-gate.sh`, an existing local hook script; nothing in the Solution introduces a package, app, or interface surface, or reclassifies a layer/product-family boundary. The N/A determination is accurate, not a rubber-stamp.

**Completion Criteria:**

- GATE-WRITE — Every item has a `TC-N` prefix: PASS — TC-01, TC-02, TC-03.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — the Solution names two behavior branches (early-exit when the reviewer identity never spoke; unchanged strict path when it does) plus a regression/syntax requirement, and each has a dedicated criterion: TC-01 covers the early-exit branch, TC-02 covers the unchanged-strict-path branch, TC-03 covers syntax + full regression. No distinct behavior branch in the Solution is left without a corresponding TC-N.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — TC-01: precondition ("no `github-actions[bot]`-authored comment/review... and CI green") + command (`gh pr merge <N> --merge`) + exact observable result (exit 0, printed notice naming the retirement) + verification method (fixture, not a live call). TC-02: precondition + observable result ("existing strict verification path is reached," "unchanged pass/fail outcomes") + verification method (existing fixture-based coverage). TC-03: literal commands (`bash -n .claude/hooks/merge-gate.sh`, the existing test suite) + exact expected exit codes. None rely on unfalsifiable language; each names what would be observed and how it would be checked. Cross-checked that the referenced test infrastructure is real, not aspirational: `scripts/harness/__tests__/merge-gate-decision.test.mjs` and `scripts/harness/__tests__/merge-gate-disposition.test.mjs` both exist in the working tree.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": PASS — none of these four banned phrases appear in TC-01/02/03.

**Test Plan section:**

- GATE-WRITE — `## Test Plan` section present: PASS — section present at line 128.
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): PASS — 3 TC-N (TC-01, TC-02, TC-03) and 3 Test Plan rows, one per TC-ID.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): PASS — all 3 rows have a Test Type (Unit/Unit/Static) and a Tool/Approach column, neither blank nor "TBD".
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: PASS — no row's Tool is "manual" (Unit/Unit/Static), so the criterion is vacuously satisfied; all 3 rows carry a Notes entry regardless.

**Structure:**

- GATE-WRITE — Tasks section present with placeholder: PASS — `## Tasks` present, naming the paired Task path with "not yet implemented (planning checkpoint only)".
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS (as read prior to this append) — `## Evidence Log` was present at line 155 with no entries beneath it before this entry was appended.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: PASS — no such headings appear anywhere in the document body.

**Judged at:** HEAD `be9d6b0a91c7` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/draft/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md` blob `ade7333d5ba1` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-07

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "AskUserQuestion, header "GATE-APPROVAL": "INFRA-201 스펙 문서를 작성했습니다: merge-gate.sh에 CI 통과 확인 직후, 해당 PR에 github-actions[bot] 명의의 코멘트이나 리뷰가 하나도 없으면(= 은퇴로 인해 영구히 없을 경우) 리뷰 검증 전체를 건너뛰고 바로 머지를 허용하는 early-exit을 추가합니다. 만약 나중에 그 또는 다른 식별자가 다시 코멘트를 달기 시작하면, 기존의 엄격한 검증(CI 정확한 HEAD/BASE 일치, 대응되지 않은 쓰레드 확인, ACTIONABLE FINDINGS 개수 확인 등)이 자동으로 다시 작동합니다. 이 설계로 진행해도 될까요?" — user selected: "이 설계를 직접 승인 (권장)" (option description: "지금 이 대화에서 INFRA-201 스펙 문서(github-actions[bot]이 하나도 코멘트하지 않았을 때만 리뷰 검증을 건너뛰는 early-exit)를 직접 승인합니다.")"
**Given:** 2026-09-07, this conversation
**Review fingerprint:** 9d883e2a2a6d (review e2a96575, type/tags f186cc84)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-07, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (9d883e2a2a6d) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the recorded `**Instruction (verbatim):**` is an AskUserQuestion (header "GATE-APPROVAL") that names "INFRA-201 스펙 문서" explicitly and restates its exact mechanism — early-exit fires only when NO comment/review anywhere matches the reviewer identity, and the existing strict checks auto-resume the moment that identity (or a replacement using the same login) posts again — then asks the user to confirm exactly that; the user's selected option's own description repeats "INFRA-201 스펙 문서" and "github-actions[bot]이 하나도 코멘트하지 않았을 때만" verbatim. Independently re-read `## Problem` (lines 10-33), `### Decision` (lines 77-81), and `## Solution` (lines 99-116) against the question text for drift: "CI 통과 확인 직후" matches Solution's "immediately after the CI-green check"; "코멘트이나 리뷰가 하나도 없으면" matches "test each against `REVIEWER_RE`... If NONE match"; "바로 머지를 허용하는 early-exit" matches "`exit 0`, skipping the rest of the review section... entirely"; "그 또는 다른 식별자가 다시 코멘트를 달기 시작하면... 자동으로 다시 작동" matches "a future replacement automation, or the retired one somehow reactivated... fall through unchanged into the existing strict verification logic" and Decision's "self-repairs the moment a real reviewer identity resumes commenting"; the three named strict checks (HEAD/BASE 일치, 쓰레드 확인, ACTIONABLE FINDINGS 개수) match the Problem section's own list (`REVIEWED BASE`/`REVIEWED HEAD`, "threads the REVIEWER opened", `ACTIONABLE FINDINGS` marker parse) verbatim. No drift found — the question is an accurate, mechanism-specific summary, not a paraphrase that drops or loosens a condition. This resolves the 2026-09-07 prior-round gap on its own merits (a general, pre-existing standing instruction given before this document existed, never confirming its specific Decision): this exchange is document-named, mechanism-specific, and posed and answered inside this document's own approval flow, which is what the prior round lacked.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — this criterion binds Route CLASS only. The recorded `**Approval route:**` above is `DIRECT`, consistent with `gate.mjs judge`'s own per-criterion output marking the three other Route CLASS mechanical lines "route DIRECT, so the Route CLASS condition does not apply" — no class boundary is invoked, so there is nothing for this criterion to bound.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — condition not triggered, verified independently rather than taken on the checklist's own word. `## Affected Scope` and `## Affected Files` name only `.claude/hooks/merge-gate.sh`; `git log --follow --diff-filter=A -- .claude/hooks/merge-gate.sh` shows it was added in `a93aeb872` (2026-07-28) and most recently modified in `b080d2087` (2026-09-06), both well before this document — a pre-existing hook script, not a new package/app/presentation/interface surface, and no layer or product-family reclassification. `git status --porcelain` shows no path under `.claude/` changed; the Solution only proposes adding an early-exit branch inside this existing file. No independent `proposal-reviewer` verdict is required.

**Note on prior-round history:** This guardian was told a `[GATE-APPROVAL] — ❌ FAIL | 2026-09-07` entry from an earlier round (judged against a general, pre-existing standing instruction that predated this document) remains earlier in this Evidence Log as historical context. Independent verification — full-file read (235 lines), `grep -n "❌|🔴|FAIL|NON-COMPLIANCE"` — found no such entry and no second `[GATE-APPROVAL]` heading anywhere in this document; the document is entirely untracked (`git status --porcelain`) with no commit history to consult either. This is recorded here rather than silently accepted or silently dropped. It does not change any verdict above: the ordering check binds only GATE-WRITE (recorded PASS, verified independently) and the document's current status (`review-ready`, matching GATE-APPROVAL's expected input), both satisfied; GATE-APPROVAL's own catalogue-defined NON-COMPLIANCE trigger ("implementation work started before this gate ran") is not triggered (`.claude/hooks/merge-gate.sh` carries no INFRA-201 change, and `git status --porcelain` shows only the paired spec/task planning artifacts); and each of the three criteria above was judged on the content actually present, not on the missing entry's assumed contents.

**Judged by:** `gate.mjs` mechanical evaluator (the 5 mechanical/route bullets above) + `backlog-gate-guard`, dispatched for the 3 `semantic`/conditional criteria after `scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc <this path> --lane L2` reported 9 criteria judged (6 PASS, 0 FAIL, 3 PENDING-GUARDIAN) with no entry written. The 3 semantic results are this guardian's independent judgement, cross-checked against the document's own Problem/Solution/Decision text, `.claude/hooks/merge-gate.sh`, and `git log`/`git status`, rather than taken on the instruction's or the checklist's own word.
**Judged at:** HEAD `be9d6b0a91c7` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/backlog/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md` blob `73254f09fcd2` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-07

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-07; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (3)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 356 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md",
  "specPath": ".agents/spec-docs/todo/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md",
    ".agents/tasks/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `be9d6b0a91c7` · base `origin/develop@be9d6b0a91c7` · document `.agents/spec-docs/todo/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md` blob `c1e9465cc4e7` (untracked)

### [GATE-VERIFY] — ✅ PASS | 2026-09-07

**Status upgrade:** in-progress → verifying

**Ordering check:** GATE-VERIFY's prior gate is GATE-IMPLEMENT (`gate-catalogue.md` § Prior-gate map:
`GATE-VERIFY | GATE-IMPLEMENT | in-progress`). The last-recorded entry on this document is
`[GATE-IMPLEMENT] — ✅ PASS | 2026-09-07` (`**Status upgrade:** approved → in-progress`), and the
document's current frontmatter `status: in-progress` (line 2) matches GATE-VERIFY's expected input;
folder placement `.agents/spec-docs/active/` agrees with `spec-workflow.md`'s status↔folder mapping
(`in-progress` → `.agents/spec-docs/active/`, line 257). Ordering check PASSES.

**Flakiness investigation (independent).** The calling agent reported two prior GATE-VERIFY attempts on
this exact document FAILed on `pnpm exec vitest run scripts/harness/__tests__/merge-gate-decision.test.mjs
scripts/harness/__tests__/merge-gate-disposition.test.mjs` because of an intermittent
`[vitest-worker]: Timeout calling "onTaskUpdate"` IPC error under heavy concurrent system load, which
flips the process exit code while every assertion still passes. This guardian did not accept that account
at face value and reproduced independently: ran the identical command twice from a clean working tree
(`git status --porcelain` empty, HEAD `a0408b6c9c88`) — run 1: exit 0, `Test Files 2 passed (2)`,
`Tests 80 passed (80)`, Duration 57.60s; run 2: exit 0, `Test Files 2 passed (2)`, `Tests 80 passed (80)`,
Duration 57.14s. `grep -i "unhandled\|IPC\|onTaskUpdate"` over both captured logs returned no matches in
either. A third, in-band reproduction inside `gate.mjs judge --dry-run` (below) also exited 0. Three
consecutive clean runs, 240 assertions total, zero exit-code flips observed in this session — this
guardian did not personally witness the flip the caller described, so this entry does not itself confirm
the flip mechanism, but it does independently confirm the tests are currently green and reproducible on
demand, which is the substance the build/test criteria below require.

**Mechanical set reproduced independently**, not taken on the caller's reported summary alone —
`node scripts/harness/gate.mjs judge --gate GATE-VERIFY --doc
.agents/spec-docs/active/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md
--lane L2 --dry-run --verify-cmd "pnpm exec vitest run scripts/harness/__tests__/merge-gate-decision.test.mjs
scripts/harness/__tests__/merge-gate-disposition.test.mjs" --verify-cmd "node
scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip
work-run-measurement"` at HEAD `a0408b6c9c88` → `5 criteria judged — 3 PASS, 0 FAIL, 2 PENDING-GUARDIAN`,
matching the caller's reported counts exactly; both supplied commands exited 0 in this run too.

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: `[GATE-IMPLEMENT] —
✅ PASS | 2026-09-07`; status `in-progress`.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete
  (`[x]`) (`task-plan-items`): PASS (guardian). Read directly:
  `.agents/tasks/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md`
  carries no `## Plan` heading — `grep -n "^## "` on the Task returns exactly `## Problem`,
  `## Resolution`, `## Test Plan`, `## User Execution Test Scenarios` (lines 14/24/33/39), the same
  narrative shape as the three precedent Tasks this pattern was already established against
  (`HARNESS-102-a-dropped-finding-leaves-no-artifact.md`,
  `INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md`,
  `INFRA-191-continue-process-overhead-reduction-lane-declaration-and-contract-test-log-clarity.md`),
  not a checkbox-plan Task. Read `scan-task-plan-items.mjs` directly: `planSection()`
  (`/^## Plan[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m`) returns `null` when no `## Plan` heading exists,
  and the scan loop `continue`s past a `null` section without incrementing `examinedPlans` or recording
  any finding (`scan-task-plan-items.mjs:93-94`). Confirmed live, not just by reading the source:
  invoking `planSection()` directly against this Task's text returned `null`; `node
scripts/harness/scan-task-plan-items.mjs` → exit 0, `::examined:: 259 Task Plan sections`,
  `task-plan-items scan passed.` — this Task is correctly absent from the 259 examined sections.
  `.agents/tasks/README.md` § "Plan Items" (lines 179-185) confirms `## Plan` is a named, optional
  section ("holds the work, never its disposition"), not a mandatory Task section. "Every item … is
  marked complete" is vacuously true over an empty/absent item set. Separately confirmed the mechanical
  PENDING-GUARDIAN cause: `gate-operations.mjs:1311`'s `tasks-complete` judgement pattern is
  `/All tasks in \`\.agents\/tasks\/<ID>\.md\` are marked complete/i`, which does not match the
catalogue's current wording (quoted without inline code spans to survive markdown reflow) — Every
item in the ## Plan section of .agents/tasks/ID.md is marked complete ([x]) — confirmed by reading
`gate-operations.mjs` directly today; this is the already-documented stale-regex defect (issue #2375
  follow-on), not a defect in this document.
- GATE-VERIFY — No Plan item is blocked or pending: PASS (guardian). Same absent-`## Plan` fact — there
  is no Plan item of any kind in this Task, so none can be blocked or pending — vacuously satisfied for
  the same reason as above. `gate-operations.mjs:1316`'s `no-blocked` judgement pattern is
  `/No tasks are blocked or pending/i`, which does not match the catalogue's current wording "No Plan
  item is blocked or pending" — confirmed by reading `gate-operations.mjs` directly today, the identical
  stale-regex cause, not a defect in this document.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`) (`mechanical`, `gate.mjs`): PASS —
  reproduced independently: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist
--skip build-contracts --skip work-run-measurement` → exit 0 (`context: pr`; `66 scans not re-run:
identical tree scanned at 2026-09-06T17:05:01.050Z` — a receipt-cache hit against a clean, unchanged
  tree at HEAD `a0408b6c9c88`, the harness's documented receipt-cache behavior, not a skipped check);
  matches the `gate.mjs` mechanical judgement's own PASS reproduced in the `--dry-run` above.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`) (`mechanical`, `gate.mjs`): PASS —
  reproduced independently twice (see Flakiness investigation above): `pnpm exec vitest run
scripts/harness/__tests__/merge-gate-decision.test.mjs
scripts/harness/__tests__/merge-gate-disposition.test.mjs` → exit 0 both times, `Test Files 2 passed
(2)`, `Tests 80 passed (80)` both times, no IPC/timeout text in either captured log; a third run inside
  `gate.mjs judge --dry-run` also exited 0.

**Delivery independently verified** (the content this gate authorises to move forward, not merely the
document's narrative of it): `git log --oneline -5 -- .claude/hooks/merge-gate.sh
scripts/harness/__tests__/merge-gate-decision.test.mjs
scripts/harness/__tests__/merge-gate-disposition.test.mjs` shows commit `a0408b6c9`
"fix(harness): merge-gate skips review when the automated reviewer never spoke (INFRA-201)" at HEAD,
touching both `.claude/hooks/merge-gate.sh` (+44/-1) and the decision test file (+64/-15).
`grep -n "INFRA-2631\|RETIRED\|retired 2026-09-06"` over `.claude/hooks/merge-gate.sh` confirms the
early-exit branch and its retirement-naming notice are present verbatim in the working tree, matching
the spec's `## Solution`. `git status --porcelain` is empty at HEAD — nothing uncommitted.

**Judged by:** `gate.mjs` mechanical evaluator (ordering + build + tests) reproduced independently by
this guardian via `--dry-run`, and this guardian directly for the 2 `PENDING-GUARDIAN` `## Plan`
criteria (tagged `mechanical` in the catalogue but left unbound by `gate.mjs` due to the stale-regex
defect documented above — judged here rather than left pending).
**Judged at:** HEAD `a0408b6c9c88` · base `origin/develop@be9d6b0a91c7` · document
`.agents/spec-docs/active/INFRA-201-merge-gate-review-check-must-not-deadlock-when-the-automated-reviewer-is-retired.md`
blob `1090b324c6db` (tracked)
