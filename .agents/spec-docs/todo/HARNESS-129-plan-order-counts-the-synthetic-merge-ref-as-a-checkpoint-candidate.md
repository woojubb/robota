---
status: approved
type: RULE
tags: [harness, testing]
---

# HARNESS-129: plan-order counts the synthetic merge ref as a checkpoint candidate

## Problem

`scripts/harness/scan-user-execution-plan-order.mjs` judges the commits between the topic merge
base and `HEAD`:

```js
const listed = runGit(root, ['rev-list', '--reverse', '--topo-order', `${base}..HEAD`]); // :1118
…
const parentResult = runGit(root, ['rev-parse', `${commit}^`]); // :1126
return { commit, parent, paths: changedPaths(root, parent, commit) };
```

On a `pull_request` event CI checks out `refs/pull/N/merge`, GitHub's synthetic merge of the PR head
into the base. That commit is inside `base..HEAD`, its `^` is the base tip, and its diff against
that parent is the whole branch — including the planning checkpoint's `todo → active` Task/spec
transition — so `isCheckpointTransition` accepts it as a second candidate and the scan refuses for
ambiguity. The branch passes the same scan locally.

Measured 2026-08-28 on `origin/develop` `58c7ca4b9` with PR #2409's branch (spec `in-progress`):

```
CI  scans   scan-user-execution-plan-order.test.mjs > repository contract > passes on this branch
            AssertionError: expected [ { commit: null, …(1) } ] to deeply equal []
local       branch HEAD, base origin/develop                  examined 8   PASS
lab         git merge --no-ff <branch> onto origin/develop:
            ✗ multiple planning checkpoint candidates exist (1c41f82d6, 72d0c93c4)   examined 9
            (1c41f82d6 = the branch's checkpoint, 72d0c93c4 = the merge)
lab         same tree, rev-list --no-merges                   findings []  examined 8
```

Issue #2373's correction recorded the same pair on PR #2372 (`cc5f40213`, `c6163520b` =
`refs/pull/2372/merge`). Its first six worktree runs did not reproduce it because the scan's
`WORKSPACE_ROOT` is the script's own checkout (`:22`), so `cd <worktree> && node /main/…` analysed
the main checkout (issue #2413); its later comments did reproduce it with `commit-tree`. The
mechanism in every case is the first-parent diff.

**The promotion path has the same shape and is worse.** A synthetic `develop → main` merge under
the release-grade job's env (`HARNESS_BASE_REF=origin/develop`, `GITHUB_BASE_REF=main`,
`ci.yml:593-641`): `origin/develop..origin/main` is 60 commits, all merges, and `main` is not an
ancestor of `develop`, so `develop-tip..<promotion merge>` is the synthetic merge plus 60 promotion
merges, each attributed a whole promotion's diff — measured `examined 61`, 31 findings; with
`--no-merges`, `examined 0`, none. No promotion has run since the gate landed (`675cd814e`,
2026-08-26); the next one goes red regardless of any spec's status, so "archive the spec before
opening the PR" mitigates nothing there.

**Reproduction condition.** Any branch carrying a planning checkpoint, evaluated at a merge commit
whose first parent is the base, while the checkpoint transition is still visible in the merge's diff
against the base — every PR opened while its spec is `in-progress`, and every promotion PR. PRs
PR #2396 and PR #2402 escaped only because their archival commit had moved the spec to `done` before the
PR opened.

## Prior Art Research

Waived: the defect and its remedy are internal to this repository's own scan. The one external fact
that applies — `git rev-list --no-merges` excludes commits with more than one parent, and a merge
commit's `^` is its first parent — is Git's documented behaviour, used here as the mechanism rather
than as a citation that changes the decision.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. One enumeration flag in a repository verification
scan plus fixtures; no product surface changes. The scan is already wired into the pre-commit hook,
`harness:scan` and CI, so no capability sits behind an unexposed seam. The verification surface is
the fixtures and the mutation.

## Depth verdict

`finding-depth-triager` (2026-08-28), four verdicts on the issue: **LOCAL** — the scan attributes
content by a single-parent diff, undefined for a merge; excluding merges is exact in both measured
shapes (PR `9 → 8`, promotion `61 → 0`) and also removes two false refusals on the branch tip.
**FOUNDATIONAL, sibling not root** — which commit a `pull_request`-event history scan evaluates has
no owner (INFRA-049 and INFRA-051 each patched the merge-ref trap differently; the `scans` job
exports no head; `check-regression-red-proof.mjs` escapes only because `diff-tree` hides merge
diffs): issue #2412, filed; this item is correct on its own and lands first. **INVALID** — the
issue's title clause (the verdict depends on the base; `675cd814e` faults its own gate): no harness
invocation hands the scan such a base — issue #2411, filed on the reviewer's request and closed the
same day with the measurement and what would reverse it. **UNDETERMINED** — a scan run against
another checkout silently reads its own and names no root: issue #2413, filed.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs` — `historyAnalysis`: `--no-merges` in the
  `rev-list` enumeration, with the mechanism, the fail direction and `Contained — HARNESS-130.` in
  the comment
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — PR-shape and
  promotion-shape merge cases, the invariance, three controls
- No production package, no rule or catalogue text

### Alternatives Considered

**A1 — Exclude merge commits from the enumeration (`--no-merges`) (chosen).** The scan attributes a
commit's content by diffing it against its parent; that attribution is defined for a single-parent
commit and undefined for a merge — `commit^` picks one side and the "diff" becomes the other side's
whole history, which is never the topic's own work. Under the scan's own contract (a linear topic
branch against its integration base), a merge is not a topic commit; enumerating one is the defect,
whoever checked it out.

- Pro: the fix is at the attribution model, not at one invoker, and it is exact in both measured
  shapes — PR: `examined 9 → 8`, matching the branch tip; promotion: `61 → 0`. Two false refusals
  on the branch tip go with it: a back-merge of the advanced base before the checkpoint (the base's
  content attributed to the merge), and a base whose own history holds an unrelated checkpoint.
  `findStagedFindings` iterates the same commit list and inherits the exclusion.
- Con — the residual, stated: a merge's OWN content (a conflict resolution or a `--no-commit` edit
  introducing a path present in neither parent) before the checkpoint is judged by nothing on the
  history path; the staged path has the same single-parent misattribution and refuses honest clean
  back-merges. The obvious closing move, a combined diff (`git diff-tree --cc`), is measured to
  false-positive on a clean merge touching two hunks of one file. That is **HARNESS-130**
  (issue #2410), filed; the flag's line carries `Contained — HARNESS-130.` naming it.

**A2 — Diff a merge commit against its second parent (the PR head) instead of the first.**

- Pro: keeps merges in the enumeration.
- Con: the diff of a synthetic merge against the PR head is the base's movement, which is not the
  PR's to answer for; a back-merge is the same shape in the opposite direction. It picks the other
  side and is wrong for the other direction.

**A3 — Evaluate the PR head rather than the merge ref in CI (`HEAD^2` when HEAD is a merge, or
checkout `github.event.pull_request.head.sha`).**

- Pro: the scan sees exactly the branch it judges locally.
- Con: it fixes one invoker and leaves the attribution model wrong — the back-merge refusals above
  occur on the branch tip with no merge ref in sight, and the promotion shape's 60 offending merges
  are not HEAD, so a `HEAD^2` heuristic does not reach them. (The `scans` job's checkout is
  GitHub's default for `pull_request`, not a stated choice; nothing rests on it being deliberate.)

**A4 — Answer the issue's title clause here: the verdict depends on the base it is given, and a
base predating the gate faults `675cd814e`, the gate's own landing commit.**

- Pro: closes the whole issue.
- Con: measured INVALID as a defect. No harness invocation hands this scan such a base — the
  `scans` job is skipped when `base_ref == 'main'`, release-grade pins `HARNESS_BASE_REF=origin/develop`,
  `pre-push` and `verify-like-ci` default to `origin/develop` and the latter does not forward
  `--base-ref` to the scans — and a conformant topic branch cannot have `675cd814e` inside
  `merge-base..HEAD`. The verdict SHOULD depend on the range; what must not vary is the spelling of
  HEAD, which is A1. Issue #2411 records the measurement and what would reverse it.

**A5 — The repository's established answer to a synthetic HEAD: `PR_HEAD_SHA` plus refusal
(`scan-promotion-ancestry.mjs:243-256`, `ci.yml:145-153`) — the direction issue #2373's author
proposed, calling `--no-merges` "weaker".**

- Pro: the pattern exists and is proven for the promotion-ancestry scan.
- Con: it fits a scan whose SUBJECT is the head commit's identity, where a synthetic HEAD changes
  the question and nothing downstream can repair it. This scan's subject is per-commit content in a
  range; merges are a shape it must handle regardless of who checked out what, and A5 does nothing
  for the branch-tip refusals or the promotion shape. The "population that is not the branch's"
  objection is measured false: with `--no-merges`, `examined` is the branch's own non-merge count,
  and nothing else in `historyAnalysis` reads HEAD's tree. A5 would also need `PR_HEAD_SHA`
  threaded into the `scans` job AND into the suite's repository-contract case, or that case fails
  closed on every PR. That the head has no owner at all is issue #2412, the FOUNDATIONAL sibling;
  A1 is correct on its own and lands first.

### Decision

**A1.** The scan cannot attribute a merge's content with a single-parent diff; enumerating merges is
the defect, and it shows on the branch tip and on the promotion path as well as at CI's merge ref.
A2 picks the other side and is wrong for the opposite direction; A3 and A5 fix one invoker; A4's
premise does not hold. The residual A1 leaves is HARNESS-130 (issue #2410), filed and named at the
site; the missing head owner is issue #2412, filed as a sibling.

**The property this change makes true**, stated so the tests can assert it: for a fixed base,
`findings(merge of tip onto base) == findings(tip)` and the examined counts are equal —
HEAD-spelling independence. Both A1 and A5 satisfy it for the PR shape; only A1 satisfies the
promotion shape without a workflow change.

**Landing path.** The circularity issue #2373 spent four comments on is broken by the fix itself: CI
runs the scan from the checked-out tree, so this fix's own PR passes its own `scans` job with no
GATE-VERIFY-first mitigation. **Closure of issue #2373 on landing:** its title is the base clause
(issue #2411, closed as measured invalid); its CI failure is this item; the head-owner sibling is
issue #2412 and the scan-root observation issue #2413 — the closing comment names the delivering
commit and all three, per git-branch.md § "Work that reaches develop is resolved".

**Containment conditions.** The `Contained — HARNESS-130.` opening at the flag's line is a
containment, not a plain residual note, so it lands under finding-depth.md's conditions: the
`.agents/tasks/HARNESS-130-…md` record (status `todo`, issue #2410) is committed in the SAME
implementation commit as the flag — after the planning checkpoint, since a second planning unit in
the checkpoint commit is refused as an ambiguous checkpoint (`multiple Task/spec pairs changed`) (precedent: HARNESS-128's record in HARNESS-127's
fix commit `7b4892c5f`); that commit's body names HARNESS-130; and the local review record is
taken as `pnpm harness:review:record --findings <n> --foundational HARNESS-130`, which resolves the
ID against `.agents/tasks/`.

### Architecture Review Checklist

- [x] Affected package/layer list complete — one scan and its test file
- [x] Sibling scan complete — `N/A for new-surface placement`: no package, app, presentation or
      interface surface. Sibling history readers examined: `scan-new-rule-declares-enforcement.mjs`
      reads one diff against the base (`base...HEAD`), so a merge is not a unit for it;
      `check-regression-red-proof.mjs` IS a per-commit consumer (`log base..HEAD`, then `diff-tree -r`
      per sha) that escapes only because `diff-tree` suppresses merge diffs by default (0 paths; 10
      with `-m`) — recorded in issue #2412, not changed here.
- [x] At least 2 alternatives reviewed — A1–A5
- [x] Decision rationale documented — the attribution model, not the invoker; the residual, the
      head owner and the base clause are filed items named by ID

## Fallback & Degradation Declaration

None. Merges are excluded from the enumeration with the fail direction stated at the site (a
merge's own pre-checkpoint content is not judged — HARNESS-130); nothing falls back.

## Solution

1. In `historyAnalysis`, `rev-list --reverse --topo-order --no-merges <base>..HEAD`, with a comment
   stating the mechanism (a merge's `^` is its first parent, so its diff is the other side's whole
   history; CI's `refs/pull/N/merge` and every promotion merge are that shape — issue #2373), the
   fail direction (merges are excluded; a merge's own pre-checkpoint content is not judged on this
   path), and `Contained — HARNESS-130.` naming the item that owns that residual.
2. PR-shape case: a valid branch with the existing helpers (checkpoint, an implementation commit),
   then `git switch develop && git merge --no-ff feature` so HEAD is the merge with the base as first
   parent; `findHistoryFindings(root, base)` is empty and `readExaminedPlanOrderCount` equals the
   branch's commit count (2), and both equal their values at the tip (the invariance). Red on the
   unfixed scan with `multiple planning checkpoint candidates`.
3. Promotion-shape case: a fixture `main` holding `--no-ff` merges of earlier develop states, then
   develop merged into main `--no-ff`, HEAD at that merge, base = develop tip; today examined 1 + N
   with findings, after: examined 0 and no findings.
4. Controls in the same describe: the branch at its own tip passes; a branch with two genuine
   checkpoint commits is still refused as multiple candidates (the flag did not silence the ambiguity
   check); a back-merge of an advanced base carrying an implementation path before the checkpoint is
   accepted (a false refusal on the branch tip today — the case that proves the decision is about
   attribution, not about CI's checkout).
5. TC-04's live reproduction runs the scan INSIDE the worktree (`cd <wt> && node
./scripts/harness/scan-user-execution-plan-order.mjs`, or `findHistoryFindings(<wt>)`), recording
   `git -C <wt> rev-parse HEAD HEAD^1 HEAD^2` beside the output — the issue's six invalid runs came
   from invoking the main checkout's copy (issue #2413).

## Affected Files

| File                                                                                       | Change                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `scripts/harness/scan-user-execution-plan-order.mjs`                                       | `--no-merges` in the rev-list enumeration, labelled                                        |
| `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`                        | PR and promotion merge cases, invariance, three controls                                   |
| `.agents/tasks/HARNESS-130-plan-order-has-no-definition-of-a-merge-commits-own-content.md` | New Task record (issue #2410) the containment note resolves to; lands in the flag's commit |

## Completion Criteria

- [ ] **TC-01** PR shape: a fixture branch merged `--no-ff` onto its base, evaluated at the merge
      with base = the pre-merge base SHA (not the `develop` ref, which the merge advances — passing
      the ref yields examined 0 vacuously), yields no finding and an examined count equal to the
      branch's commit count; findings and count at the merge equal those at the tip. Red before
      the fix (`check-regression-red-proof`).
- [ ] **TC-02** Promotion shape: a fixture `main` of `--no-ff` promotion merges with develop merged
      in, evaluated at that merge with base = develop tip, yields no finding and examined 0. Red
      before the fix.
- [ ] **TC-03** Controls: the branch at its own tip passes; a branch with two real checkpoint commits
      is still refused with `multiple planning checkpoint candidates`; a back-merge of an advanced
      base carrying an implementation path, before the checkpoint, is accepted (red before the fix
      as `implementation … changed before the planning checkpoint`).
- [ ] **TC-04** Live: in a throwaway worktree, `git merge --no-ff` of PR #2409's branch onto
      `origin/develop`, the fixed scan run FROM that worktree → no findings, examined = the branch's
      commit count; `HEAD`, `HEAD^1`, `HEAD^2` recorded beside the output.
- [ ] **TC-05** Applied-check mutation: removing `--no-merges` fails TC-01, TC-02 and the back-merge
      control, and no other case; restored byte-identical.
- [ ] **TC-06** `pnpm vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
      passes with every pre-existing case plus the added ones (count stated by describe in the
      GATE-VERIFY entry); `pnpm harness:scan` exits 0.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                   | Notes                                       |
| ----- | ----------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| TC-01 | Integration | vitest, fixture repository with a `--no-ff` merge as HEAD, plus the invariance    | red-proof recorded before the flag is added |
| TC-02 | Integration | vitest, fixture `main` of promotion merges, develop merged in, base = develop tip |                                             |
| TC-03 | Integration | vitest, branch-tip, two-checkpoint and back-merge controls                        |                                             |
| TC-04 | Integration | the fixed scan run inside a worktree merge of the real PR #2409 branch            | HEAD and both parents recorded              |
| TC-05 | Mutation    | remove the flag, run the file, restore, record counts                             | `git diff --stat` empty after restore       |
| TC-06 | Integration | `pnpm vitest run <file>` and `pnpm harness:scan`, exit codes recorded             |                                             |

## Tasks

- [ ] `.agents/tasks/HARNESS-129-plan-order-counts-the-synthetic-merge-ref-as-a-checkpoint-candidate.md` — 생성됨 (GATE-IMPLEMENT에서 바인딩)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → review-ready

- Ordering: entry gate, no prior gate required; `status: draft` and file under `.agents/spec-docs/draft/` match the expected input state. Tree: `HEAD` = `origin/develop` `58c7ca4b9`, only the untracked spec/task pair present, `scan-user-execution-plan-order.mjs:1118` still lacks `--no-merges` — nothing implemented.
- Frontmatter: file begins with `---`; `status: draft`; `type: RULE` (in the 11-prefix list); `tags: [harness, testing]`.
- Problem — concrete symptom: quoted code verified at `scan-user-execution-plan-order.mjs:1118` (`rev-list --reverse --topo-order ${base}..HEAD`) and `:1126` (`rev-parse ${commit}^`); `isCheckpointTransition` exists at `:813`. CI claim verified in PR #2409 `scans` job log (run 33128936002): `FAIL … > passes on this branch …`, `AssertionError: expected [ { commit: null, …(1) } ] to deeply equal []`, candidates `(1c41f82d6, 6bfc5d0d3)`. Lab reproduced by the guard: throwaway worktree at `origin/develop` `58c7ca4b9`, `git merge --no-ff origin/feat/rule-016-pr-body-background-first-no-session-link` → merge `df64f1bfe` (parents `58c7ca4b9`, `cc1e30962`); scan at the merge → `✗ multiple planning checkpoint candidates exist (1c41f82d6, df64f1bfe)`, `::examined:: 9`; at branch tip `cc1e30962` → `::examined:: 8`, no finding; with `--no-merges` added to the enumeration at the merge → `::examined:: 8`, no finding. Issue #2373 comment confirms the PR #2372 pair `cc5f40213` / `c6163520b` = `refs/pull/2372/merge` and the first-parent mechanism.
- Problem — reproduction condition: stated explicitly (any checkpoint-carrying branch evaluated at a merge whose first parent is the base while the `todo → active` transition is in the merge's diff; every PR opened with the spec `in-progress`); PRs #2396/#2402 (merged, spec archived pre-PR) cited as the negative case.
- Problem — no TBD/TODO: grep finds only `todo → active`, a task-status name, not a placeholder.
- Prior Art Research: `## Prior Art Research` present with an explicit `Waived: <reason>` line (internal scan defect); the one cited external fact (`rev-list --no-merges` excludes multi-parent commits; `^` is the first parent) is Git's documented behaviour and is the mechanism A1 and the Decision rest on — confirmed by the lab `--no-merges` run above.
- Architecture Review Checklist: all 4 items `[x]`. Sibling scan `[x]` with `N/A for new-surface placement` plus sibling-read evidence; verified `scan-new-rule-declares-enforcement.mjs:190` diffs `${baseRef}...HEAD` and `check-regression-red-proof.mjs` reads `base..HEAD` diffs/log and per-sha `diff-tree` — neither resolves `commit^` per commit, so the claim holds (the doc's `base...HEAD` spelling is exact only for the first; immaterial).
- Alternatives Considered: A1–A4, each with Pro and Con. Decision names the trade-off (merge carries no planning content; A2 answers the wrong question, A3 fixes one invoker, A4 is a separate item).
- New-surface placement: N/A — affected files are one existing scan and its test; no package, app, or interface surface introduced.
- Completion Criteria: TC-01…TC-05 all prefixed; coverage per sub-item (flag: TC-01/TC-03; controls: TC-02; mutation: TC-04; suite + `harness:scan`: TC-05); every criterion in command or observable form; none of the banned phrases present. `findHistoryFindings` (`:1310`) and `readExaminedPlanOrderCount` (`:1323`) referenced by the Solution exist and are imported by the test file.
- Test Plan: present; 5 rows for 5 TC-Ns (count matches); every row has non-empty Test Type and Tool/Approach, no TBD; no `manual` rows, so the Notes requirement is N/A.
- Structure: `## Tasks` present with a placeholder line naming the path to bind at GATE-IMPLEMENT; `## Evidence Log` present and empty before this entry; no `## Status` or `## Classification` in the body.

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → review-ready (second GATE-WRITE run on the revised text after the `proposal-reviewer` REVISE; the first PASS above stands, no transition)

- Ordering: entry gate, no prior gate required. Input state is the state the first PASS left it in — `status: review-ready` under `.agents/spec-docs/backlog/`, the pair `spec-workflow.md:168` maps; no rule in `backlog-pipeline` or `spec-workflow.md` reverts a revised document to `draft`, so the frontmatter criterion is read against the recorded state. Tree: branch `fix/2373-plan-order-ignores-the-synthetic-merge-ref`, `HEAD` = `origin/develop` `58c7ca4b9`, only the untracked spec/task pair present, `scan-user-execution-plan-order.mjs:1118` contains no `--no-merges` (grep count 0) — nothing implemented.
- Frontmatter: file begins with `---`; `status: review-ready` (see Ordering — the recorded post-PASS state, not `draft`); `type: RULE` (in the 11-prefix list); `tags: [harness, testing]`.
- Problem — concrete symptom, re-verified: quoted code at `:1118` (`rev-list --reverse --topo-order ${base}..HEAD`) and `:1126` (`rev-parse ${commit}^`); `WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..')` at `:22`; `isCheckpointTransition` at `:813`. CI claim re-read from run 33128936002 `scans` log: `FAIL … > passes on this branch …`, `AssertionError: expected [ { commit: null, …(1) } ] to deeply equal []`, `multiple planning checkpoint candidates exist (1c41f82d6, 6bfc5d0d3)`. PR-shape lab re-run by the guard in a throwaway worktree at `58c7ca4b9`: `git merge --no-ff origin/feat/rule-016-pr-body-background-first-no-session-link` (PR #2409's head, 8 commits over develop) → merge `c29f70eb7` (`HEAD^1`=`58c7ca4b9`, `HEAD^2`=`cc1e30962`); scan run FROM the worktree with `HARNESS_BASE_REF=origin/develop`: `✗ multiple planning checkpoint candidates exist (1c41f82d6, c29f70eb7)`, `::examined:: 9`, exit 1; with `--no-merges` patched into the worktree's copy: `::examined:: 8`, exit 0; at the branch tip `cc1e30962`: `::examined:: 8`, exit 0 — matches the doc's `9 → 8 = tip`.
- Problem — promotion-path claim, re-verified: `git rev-list --count origin/develop..origin/main` = 60, `--no-merges` = 0; `merge-base --is-ancestor origin/main origin/develop` = no; `675cd814e` dated 2026-08-26 and no merge into `origin/main` since. Release-grade job (`ci.yml` "release-grade verification", `if: base_ref == 'main'` at `:595`, `HARNESS_BASE_REF: origin/develop`). Lab: throwaway worktree detached at `origin/main` `12a4ecd1b`, `git merge --no-ff origin/develop` → `ad2907c26` (`HEAD^1`=`12a4ecd1b`, `HEAD^2`=`58c7ca4b9`), `origin/develop..HEAD` = 61 commits, 0 non-merge; scan FROM the worktree with `HARNESS_BASE_REF=origin/develop GITHUB_BASE_REF=main`: 31 `✗ … implementation exists with no planning checkpoint` findings, `::examined:: 61`, exit 1; with `--no-merges`: 0 findings, `::examined:: 0 topic commit(s) ::expected-empty::`, exit 0 — matches the doc's `61 / 31 → 0 / none`. Worktrees removed afterwards; main tree unchanged.
- Problem — reproduction history: issue #2373 OPEN; PR #2372 MERGED 2026-08-26 (the `cc5f40213`/`c6163520b` pair is the issue's own record, not re-run); issue #2413 (scan reads its own checkout) OPEN, filed 2026-08-28. PRs #2396/#2402 MERGED 2026-08-27, cited as the negative case.
- Problem — reproduction condition: stated explicitly (any checkpoint-carrying branch at a merge whose first parent is the base while the transition is in the merge's diff; every PR opened with the spec `in-progress`; every promotion PR).
- Problem — no TBD/TODO: grep finds only `todo → active` (a task-status name) and the prior entry's own "no TBD/TODO" line; no vague single-sentence description.
- Prior Art Research: section present with an explicit `Waived: <reason>` line; the one cited external fact (`--no-merges` excludes multi-parent commits; `^` is the first parent) is Git's documented behaviour and is the mechanism A1 rests on — confirmed by both lab `--no-merges` runs.
- Architecture Review Checklist: all 4 items `[x]`. Sibling scan `[x]` with `N/A for new-surface placement` plus sibling-read evidence; verified `scan-new-rule-declares-enforcement.mjs:190` diffs `${baseRef}...HEAD` (one diff, not per commit) and `check-regression-red-proof.mjs:554/562` reads `log base..HEAD` then per-sha `diff-tree --no-commit-id --name-only -r` — on merge `6802df180` that yields 0 paths and 3 with `-m`, so the "escapes only because diff-tree suppresses merge diffs" mechanism holds (the doc's "10 with -m" is its own sample merge, not contradicted).
- Alternatives Considered: A1–A5, each with Pro and Con. A4's invoker claims verified: `scans`-side jobs gated `base_ref != 'main'` (`ci.yml:285/383/476/529`), release-grade pins `HARNESS_BASE_REF=origin/develop`, `verify-like-ci.mjs:117` `DEFAULT_BASE_REF = 'origin/develop'`. A5's pattern verified at `scan-promotion-ancestry.mjs:243-256` (`PR_HEAD_SHA` else refuse on `pull_request`) and `ci.yml:145-153`. Filed items exist: issue #2410 OPEN (HARNESS-130 residual), issue #2411 CLOSED same day (base clause, INVALID), issue #2412 OPEN (head owner). A1's `diff-tree --cc` false-positive claim is issue #2410's content, not re-run here.
- Decision: names the trade-off — attribution model over invoker (A3/A5 fix one invoker, A2 picks the other side, A4's premise measured invalid), the residual filed as HARNESS-130, the property the tests assert (HEAD-spelling independence: `findings(merge) == findings(tip)`, equal examined counts) — matched by the lab (8 == 8).
- New-surface placement: N/A — affected files are one existing scan and its test; no package, app, or interface surface introduced.
- Completion Criteria: TC-01…TC-06 all prefixed; coverage per sub-item (PR shape + invariance: TC-01; promotion shape: TC-02; three controls: TC-03; live worktree reproduction: TC-04; mutation: TC-05; suite + `harness:scan`: TC-06); every criterion in command or observable form (named outputs, counts, exit codes); grep for the banned phrases finds only the prior entry's "nothing implemented" line, none in a criterion. `findHistoryFindings` (`:1310`) and `readExaminedPlanOrderCount` (`:1323`) exist and are imported by the test file.
- Test Plan: present; 6 rows for 6 TC-Ns (count matches); every row has non-empty Test Type and Tool/Approach, no TBD; no row has Tool "manual", so the Notes requirement is N/A.
- Structure: `## Tasks` present with the placeholder line naming the path to bind at GATE-IMPLEMENT; `## Evidence Log` present — not empty, N/A because this is the second GATE-WRITE run (the catalogue scopes the empty requirement to the first run) and the one prior entry is this gate's own PASS; no `## Status` or `## Classification` in the body (`## Depth verdict` and `## User Execution Test Scenarios` are neither).

### [GATE-APPROVAL] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 (권장)"
**Given:** 2026-08-28, this conversation

- Ordering: prior gate GATE-WRITE shows `✅ PASS` twice (both dated 2026-08-28, lines 284 and 301; the first made `draft → review-ready`, the second attested the revised text after `proposal-reviewer` round 2 and recorded no transition). `status: review-ready` under `.agents/spec-docs/backlog/` is the input state this gate takes (spec-workflow.md folder table line 168; `node scripts/harness/scan-doc-folder-status-agreement.mjs` → `violations=0 result=PASS`). Context, not a criterion: three editorial changes landed after the second GATE-WRITE run (§ Decision "Containment conditions." paragraph; a third § Affected Files row for the HARNESS-130 Task record; TC-01 base = the pre-merge base SHA) — all three are on disk in the text judged here, and no rule requires a GATE-WRITE re-run for them.
- Route DIRECT / explicit approval in the current conversation: the dispatching orchestrator reports that on 2026-08-28, in this conversation, the owner was asked a structured question headed "GATE-APPROVAL" beginning "HARNESS-129 (issue #2373) GATE-APPROVAL — Route DIRECT. spec: `.agents/spec-docs/backlog/HARNESS-129-plan-order-counts-the-synthetic-merge-ref-as-a-checkpoint-candidate.md`. 결정 A1: plan-order 스캔의 커밋 열거에 `--no-merges` 추가 (…) 잔여(머지 자체 내용 미판정)는 HARNESS-130/#2410로 봉쇄. GATE-WRITE PASS(2회), proposal-reviewer 3라운드 ENDORSE, 깊이 판정 LOCAL. 이 spec을 승인하시겠습니까?" with options "승인 (권장)" / "보류 — 질문 있음" / "거절", and selected "승인 (권장)". "승인" is on the catalogue's explicit list. Provenance stated plainly: this guard did not observe the selection itself; it is the quote the `backlog-pipeline` dispatch carries into the subagent for this gate, from this document's own conversation — not from another session, agent run, or document (the same provenance the RULE-016 entry of 2026-08-28 records).
- Route DIRECT / directed at this spec document: the question names HARNESS-129, issue #2373 (`gh issue view 2373` → OPEN, created 2026-08-25, title "user-execution-plan-order reports its own landing commit as a violation, …" — the paired Task's `issue:`), and this file's exact path; its summary matches § Decision on disk point for point — A1 `--no-merges` in the rev-list enumeration, the residual (a merge's own content unjudged) contained by HARNESS-130 / issue #2410 (`gh` → OPEN, created 2026-08-28), the `finding-depth-triager` LOCAL verdict in § Depth verdict. The other filed items § Decision names check out: issue #2411 CLOSED 2026-08-28, issues #2412 and #2413 OPEN. No other spec document is named in the question. Route CLASS unavailable and not claimed: backlog-execution.md § Delegated Approval Classes holds only the `_(none registered)_` placeholder row (`parseRegistry` → size 0).
- No Architecture Review or frontmatter type/tags modified after approval: the spec is untracked (no git history); its mtime is 2026-08-28T00:51:39Z, the paired Task's 00:40:57Z, and this gate runs at 00:56Z — the spec's last write is the three post-round-3 editorial changes above, which the approval question's summary already reflects ("HARNESS-130/#2410로 봉쇄" is the Containment conditions paragraph). Frontmatter reads `type: RULE`, `tags: [harness, testing]` — identical to what both GATE-WRITE entries recorded. The § Decision text the owner was shown is the § Decision text on disk.
- Independent architecture validation (conditional): N/A — the condition is not met. § Affected Scope and § Affected Files name one existing scan (`scripts/harness/scan-user-execution-plan-order.mjs`), its existing test file, and one new Task record under `.agents/tasks/` (HARNESS-130, a planning record — not a package, app, presentation or interface surface; it does not exist yet, consistent with "lands in the flag's commit"); no layer or product-family boundary is reclassified, and the checklist's sibling-scan item reads `N/A for new-surface placement`. Recorded for the record: the dispatch reports `proposal-reviewer` round 3 returned `REVIEW VERDICT: ENDORSE`; that verdict is not recorded in this Evidence Log and this conditional criterion is the only one that would require it, so nothing rests on it here.
- Evidence form: route, verbatim instruction, and date carried in the backlog-execution.md § Delegated Approval Classes DIRECT shape; parsed by `classifyApproval` from `scan-standing-delegation-evidence.mjs` on this entry → `{"route":"DIRECT"}`; `node scripts/harness/scan-standing-delegation-evidence.mjs` exit 0 with this document counted among the DIRECT passes (numbers in the gate's return message).
- NON-COMPLIANCE trigger (implementation before this gate): none. Branch `fix/2373-plan-order-ignores-the-synthetic-merge-ref`, `HEAD` `58c7ca4b9` = `origin/develop` (`git log origin/develop..HEAD` empty); `git status --porcelain` → exactly the two untracked planning files; `grep -c -- --no-merges scripts/harness/scan-user-execution-plan-order.mjs` → 0; no `.agents/tasks/HARNESS-130-*` file; `git diff --stat HEAD -- scripts/` empty.
