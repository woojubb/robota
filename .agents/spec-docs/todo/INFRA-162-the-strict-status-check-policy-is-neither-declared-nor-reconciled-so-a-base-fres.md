---
status: approved
type: INFRA
tags: [process, harness]
lane: L1
---

# INFRA-162: the strict status-check policy is neither declared nor reconciled, so a base-freshness change is invisible

Paired with `.agents/tasks/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md`. Arising from [issue #2219](https://github.com/woojubb/robota/issues/2219).

## Problem

`node scripts/harness/scan-main-required-checks.mjs --live` — the job `.github/workflows/ruleset-drift.yml`
runs on `workflow_dispatch` — reports `Live ruleset reconciled.` and exits 0 whatever value the
branch-protection setting "require branches to be up to date before merging" holds, because the
reconciler reduces each live `required_status_checks` rule to its context names and discards the
sibling `strict_required_status_checks_policy` parameter. Measured on 2026-09-05 at `develop`
`73b53e35c`: the live value is `false` on `protect-develop` (ruleset 18715844) and `true` on
`protect-main` (ruleset 18715845), and `.github/required-status-checks.json` — the file
`ruleset-drift.yml` names as "the SOURCE of what `protect-main` must require" — carried the key for
neither branch:

```
$ gh api repos/woojubb/robota/rules/branches/develop --jq '.[] | select(.type=="required_status_checks") | {ruleset_id, strict: .parameters.strict_required_status_checks_policy}'
{"ruleset_id":18715844,"strict":false}
$ node -e "const j=require('./.github/required-status-checks.json'); console.log(Object.keys(j.branches.develop))"
[ 'ruleset', 'ruleset_id', 'mirrored_by', 'why', 'required_status_checks', 'deliberately_not_required' ]
```

Reproduction condition: flip the checkbox on either ruleset in the GitHub UI, in either direction,
then dispatch `ruleset-drift`. The run is green. The flip changes whether GitHub refuses a stale head
and re-runs the checks after an update — the exact question issue #2219 raised after PR #2212 was
`MERGEABLE` / `CLEAN` with twenty green checks about a tree that failed `pnpm typecheck` once put
together with the base it would land on — and nothing in the tree records what the policy is or
notices when it moves. That is the shape `.agents/rules/enforcement-architecture.md` § "Silence is
not success" names: the reconciler did not check, and reported as if it had.

The issue's headline remedy — switch the policy ON for `develop` — was considered and declined
five days after it was filed. Commit `fd0752f90` (2026-08-28) landed `.claude/hooks/merge-gate.sh`,
whose header at lines 392-408 asks the base-moved question as an interaction test (which files the
base moved over ∩ which files the pull request touches, plus `mergeable` read now) and says of itself:
"This is the non-strict policy the host already runs under ("require branches to be up to date" is
off), asked mechanically at the one moment it matters." The declined setting is therefore a policy
this repository runs under on purpose — and a policy run under on purpose must be declared and
watched, or its reversal is silent.

## Prior Art Research

Every product below exposes "must the branch be current before it merges" as a setting the operator
can read and check, and each documents the cost of the strict form and its own answer to that cost.
Quoted from product documentation, not source code. The decision brief that gathered these references
and the throughput measurement is `/tmp/robota-issues/round2/decisions/INFRA-158-strict.md`.

1. **GitHub rulesets — the setting itself.** "Require branches to be up to date before merging …
   The topic branch must be up to date with the base branch before merging." and, on cost: "This is
   the default behavior for required status checks. More builds may be required, as you'll need to
   bring the head branch up to date after other collaborators update the target branch."
   — <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>
2. **GitHub merge queue — GitHub's own answer to the strict cost, and its availability.** "The merge
   queue provides the same benefits as the Require branches to be up to date before merging branch
   protection, but does not require a pull request author to update their pull request branch and
   wait for status checks to finish before trying to merge." and "Pull request merge queues are
   available in any public repository owned by an organization, or in private repositories owned by
   organizations using GitHub Enterprise Cloud."
   — <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue>
   Measured against this repository on 2026-09-05:
   `gh api repos/woojubb/robota --jq '{owner: .owner.login, type: .owner.type, visibility}'` →
   `{"owner":"woojubb","type":"User","visibility":"public"}`. The repository is user-owned, so by the
   quoted sentence a merge queue is not available to it; no follow-up item to "evaluate a merge queue"
   is created, because the evaluation has been made by the documentation.
3. **Gerrit submit types — the same trade-off, stated as two options.** Fast Forward Only: "Whenever
   one change is submitted all other open changes for the same branch, that are not successors of the
   submitted change, become non-submittable." and "The advantage of using this action is that the
   target branch is always updated to the exact commit that has been reviewed and approved. In
   particular, if CI verification is configured, this means that the CI verified the exact commit to
   which the target branch is being fast-forwarded on submit." Rebase If Necessary: "If a
   fast-forward is not possible, Gerrit automatically rebases the current patch set of the change on
   top of the current head of the target branch." — the tested commit and the merged commit differ,
   which is the non-strict trade this repository makes.
   — <https://gerrit-review.googlesource.com/Documentation/config-project-config.html>
4. **Renovate `rebaseWhen` — the strict policy presupposes an automatic rebaser.** "auto: Renovate
   will autodetect the best setting. It will use behind-base-branch if configured to automerge or
   repository has been set to require PRs to be up to date." and "If you have enforced that PRs must
   be up-to-date before merging (e.g. using branch protection on GitHub), then automerge won't be
   possible as soon as a PR gets out-of-date but remains non-conflicted". The bot absorbs the strict
   cost by rebasing on every base move; this repository has no such bot, and every rebase here needs
   a fresh reviewer verdict naming the new head (`.agents/rules/git-branch.md` § merge gate).
   — <https://docs.renovatebot.com/configuration-options/#rebasewhen>

What the research feeds: alternative A below is the only one every product above has in common —
the policy is a visible, checkable setting — and it is the precondition for any later flip to B being
a visible change. B's cost is the one GitHub and Gerrit both name and Renovate absorbs with a bot this
repository lacks. GitHub's own remedy for that cost (the merge queue) is documented as unavailable to
a user-owned repository, which is why it is not an alternative here.

## Architecture Review

### Affected Scope

- `.github/required-status-checks.json` — the declaration; gains two keys per branch
- `scripts/harness/required-status-checks-declaration.mjs` — new; the declaration reader and the strict-policy comparison
- `scripts/harness/scan-main-required-checks.mjs` — `reconcileLiveBranch` calls the comparison; the declaration reader moves out
- `scripts/harness/__tests__/scan-main-required-checks.test.mjs` — the offline cases
- `scripts/harness/file-size-baseline.json` — one entry ratcheted down (544 → 535)

Untouched, by decision: the live rulesets, `.github/workflows/ruleset-drift.yml`,
`.claude/hooks/merge-gate.sh`, `.agents/rules/git-branch.md`, and the merge path.

### Alternatives Considered

1. **A — declare the value each ruleset holds today (`develop` `false`, `main` `true`) with a stated
   reason, and reconcile it against the live ruleset, refusing rather than defaulting when either side
   cannot be read. The live ruleset is not changed.**
   - Pro: strengthens the gate without weakening it — no pull request is newly blocked, because the
     assertion runs only under `--live`, which `ruleset-drift.yml` keeps out of the merge path; the
     only new findings are "declared ≠ live" and "could not read", both fail-closed. Every later flip
     of the policy, in either direction, becomes a named finding instead of a green run.
   - Con: the two residuals of the interaction test survive unchanged — a new file importing a moved
     symbol still merges green, and a merge outside a Claude Code session is ungated. This is today's
     state, not an exposure A creates.
2. **B — switch `protect-develop` to `strict_required_status_checks_policy: true` and declare `true`
   (the issue's original ask).**
   - Pro: GitHub itself refuses a stale head and re-runs the checks after the update, on every merge
     path; both residuals close.
   - Con: the cost this repository has already measured and declined in `fd0752f90`
     (`merge-gate.sh` lines 394-399: two fixtures rebased over a base that moved 15 files while the
     branch touched 2 — overlap 0, conflicts 0, `range-diff` identical — each costing a push, a CI
     cycle and a fresh review). Measured throughput: 30 `develop` merges in the seven days to
     2026-09-05, 11 on 2026-09-05 and 13 on 2026-08-29; on such a day every open pull request goes
     stale up to ten-plus times, and each rebase here needs a new reviewer verdict naming the head.
     Gerrit's Fast Forward Only documents the same shape; Renovate absorbs it with a bot this
     repository does not have; GitHub's own absorber, the merge queue, is unavailable to a user-owned
     repository (prior art 2).
3. **C — add a required check that recomputes the merge result against the current base and
   typechecks it.**
   - Pro: closes residual 1 at the type level rather than the path level, on every merge path.
   - Con: a new required context on `protect-develop` and its full CI time on every pull request;
     issue #2219 itself calls it "strictly more work for strictly less guarantee", and it still tests
     one pull request against the base at one instant, not against the other pull requests merging
     alongside it.
4. **D — leave the tree as it is.**
   - Pro: nothing to review.
   - Con: the reconciler keeps discarding the policy and every flip stays silent; no product in the
     prior art leaves this setting unreadable.

### Decision

**Alternative 1 (A).** The trade-off that drove it: A is the only alternative that adds a refusal
without adding a cost to the common case, and it is the precondition for B or C ever being a visible
change — a policy nobody declared cannot be seen to move. B buys the residuals' closure at a per-merge
price this repository measured and declined, with no absorber available; C buys less than B for more
CI time. The owner's settled selection of 2026-09-05, quoted verbatim from
`/tmp/robota-issues/round2/DECISIONS.md` (where `INFRA-158` is the superseded label of this same
item, #2219):

> 2026-09-05 INFRA-158 별건 (#2219) 결정: A — strict 정책 선언(develop=false, main=true) + 라이브 룰셋
> 대조(fail-closed), develop 은 켜지 않음. 머지 큐 후속은 만들지 않음(사용자 소유 저장소 불가); 잔여
> 위험은 후일 B vs C.

Consequences carried into this document: the declaration records `develop` `false` and `main`
`true` with a `strict_policy_why` each; the live reconciliation is fail-closed — an unreadable flag
on either side is a finding, never a default; the live ruleset is untouched and `develop` is not
switched on; no merge-queue follow-up is filed (prior art 2 records why); the residual risk is
recorded in § Out of Scope as a decision between B and C that the owner will make explicitly later,
not one this unit pre-empts. The earlier relayed wording of the same selection is preserved
byte-exact in the original spec under
`/tmp/robota-issues/round2/impl2/INFRA-162/plan-preserved-untracked/`; the authorization now in
force for this pair is recorded in § "Prospective Recovery — current conversation authorization".

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: one declaration file and the one scan that reads it; there is no sibling reconciler to align
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None. The strict-policy comparison never substitutes a default for a value it could not read: a live
payload with no `required_status_checks` rule, `parameters` `null` or without the key, a non-boolean
value, several rules that disagree, or a declaration branch that omits the key is each a finding
under `(strict policy: <branch>)` naming what could not be read, and `--live` exits 1 on any finding.
A GitHub API outage costs a red manual `ruleset-drift` run, never a silent green and never a blocked
promotion, because `--live` is outside the merge path by that workflow's own declaration.

## Solution

1. Declare `strict_required_status_checks_policy` and `strict_policy_why` under `branches.develop`
   (`false`) and `branches.main` (`true`) in `.github/required-status-checks.json`, recording the
   value measured on 2026-09-05, so that a declaration of a preferred-but-unagreed value cannot
   precede the ruleset change (Task § "Baseline and introduction order").
2. Add `scripts/harness/required-status-checks-declaration.mjs` owning `DECLARATION_FILE`,
   `readDeclaration`, `readDeclarationBranch`, `STRICT_POLICY_KEY` and
   `strictPolicyFindings({ branchName, rules, branch })` — pure over the live payload shape and the
   declaration's branch object, so the comparison has a failing input offline.
3. In `scan-main-required-checks.mjs` `reconcileLiveBranch`, call `strictPolicyFindings` beside the
   context comparison. Unreadable is a finding, never a default: no `required_status_checks` rule,
   `parameters` `null` or without the key, a non-boolean value, several rules disagreeing, or a
   declaration branch that omits the key each names what could not be read under
   `(strict policy: <branch>)`.
4. Keep the scan under its `file-size` budget by moving, not by raising: the baseline entry for the
   scan falls from 544 to 535.
5. Do not change the live ruleset, `.github/workflows/ruleset-drift.yml`, `.claude/hooks/merge-gate.sh`,
   `.agents/rules/git-branch.md`, or the merge path; file no merge-queue follow-up.

## Affected Files

- `.github/required-status-checks.json`
- `scripts/harness/required-status-checks-declaration.mjs`
- `scripts/harness/scan-main-required-checks.mjs`
- `scripts/harness/__tests__/scan-main-required-checks.test.mjs`
- `scripts/harness/file-size-baseline.json`
- `.agents/tasks/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md` (this pair)

## Out of Scope

- **Switching `protect-develop` to strict (B), or a merge-result typecheck check (C).** The residual
  risk both address — a pull request that is green about a base that has since moved, in the shapes
  the Task § "Residual" names (a new importer of a moved symbol; a merge outside a Claude Code
  session) — remains after this unit. Recorded by the owner's decision as **"B vs C: an explicit
  decision to be made later"**, not as a habit and not as work this unit performs. When that decision
  is made, the declaration, the ruleset and `.agents/rules/git-branch.md` § merge gate change in the
  same change, and this unit's reconciliation turns any half-done flip red by design.
- **A merge queue.** Not an alternative for this repository (prior art 2); no follow-up is filed.
- **`.agents/rules/git-branch.md` § merge gate prose.** Issue #2219's fourth acceptance test asks the
  rule to state what the gate does and does not prove; that sentence belongs to the B-versus-C
  decision that changes what the gate proves, and is deferred with it.

## Completion Criteria

- [ ] TC-01: Command — `node -e "const j=require('./.github/required-status-checks.json');for(const b of ['develop','main'])console.log(b,j.branches[b].strict_required_status_checks_policy,typeof j.branches[b].strict_policy_why)"` → prints `develop false string` and `main true string`; the vitest describe `the tracked declaration records the strict policy each ruleset holds (INFRA-162 TC-01)` passes, and its run against the pre-change declaration file (no key) is recorded RED first.
- [ ] TC-02: Command — `pnpm exec vitest run scripts/harness/__tests__/scan-main-required-checks.test.mjs` → exits 0; the two `is RED on disagreement in each direction (…)` cases each produce exactly one finding under `(strict policy: develop)` naming both values, and both go red when the comparison in `strictPolicyFindings` is replaced by a constant (falsification recorded).
- [ ] TC-03: Command — the same file's four `refuses rather than defaulting when …` cases (no strict key in parameters; no `required_status_checks` rule at all; `parameters` `null`; a non-boolean value) and `refuses a declaration that omits the key, rather than assuming a value` → each produces exactly one finding naming what could not be read, and all five go red when the refusal is replaced by a `?? false` default (falsification recorded).
- [ ] TC-04: Command — `node scripts/harness/scan-main-required-checks.mjs` → exits 0 and prints `::examined:: 5 required contexts`; the test file run against the pre-change scan (no declaration module) is recorded RED first.
- [ ] TC-05: Command — `node scripts/harness/scan-main-required-checks.mjs --live` → exits 0 and prints `Live ruleset reconciled.` against the rulesets as measured; with `branches.develop.strict_required_status_checks_policy` flipped to `true` in the working tree it exits 1 with a finding under `(strict policy: develop)` naming both values; and `gh api repos/woojubb/robota/rules/branches/develop --jq '.[] | select(.type=="required_status_checks") | {ruleset_id, strict: .parameters.strict_required_status_checks_policy}'` still prints `{"ruleset_id":18715844,"strict":false}` after the change (the live ruleset was not touched).
- [ ] TC-06: Command — `node scripts/harness/scan-file-size.mjs` → exits 0 with the baseline entry for `scripts/harness/scan-main-required-checks.mjs` at 535, lower than the 544 it replaced; `scripts/harness/required-status-checks-declaration.mjs` exists owning `DECLARATION_FILE`, `readDeclaration`, `readDeclarationBranch`, `STRICT_POLICY_KEY` and `strictPolicyFindings`.
- [ ] TC-07: Command — `git diff --name-only origin/develop -- .github/workflows .claude/hooks .agents/rules` → prints nothing (`ruleset-drift.yml`, the merge gate and `git-branch.md` are untouched, so no pull request is newly blocked); `git ls-files .agents/tasks .agents/spec-docs | grep -i 'merge-queue\|merge_group'` → prints nothing (no merge-queue follow-up record was filed).

## Test Plan

Derived from `type: INFRA` + `tags: [process, harness]` — offline unit cases over the exported
comparison, the scan's own offline run, one manual live run, and two git-level observables for the
clauses the decision keeps fixed.

| TC-ID | Test Type | Tool / Approach                                                                          | Notes                                                                                       |
| ----- | --------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| TC-01 | automated | `node -e` over the tracked declaration; vitest over `readDeclarationBranch`              | red-first: fails against the declaration file without the key; RED output recorded          |
| TC-02 | automated | vitest over `strictPolicyFindings` with a fixture live payload                           | falsified by replacing the comparison with a constant; RED output recorded                  |
| TC-03 | automated | vitest over `strictPolicyFindings` with each unreadable payload shape                    | falsified by restoring a `?? false` default; RED output recorded                            |
| TC-04 | automated | `node scripts/harness/scan-main-required-checks.mjs`                                     | the hermetic half `pnpm harness:scan` runs; red-first against the pre-change scan           |
| TC-05 | manual    | `node scripts/harness/scan-main-required-checks.mjs --live` and `gh api` with `GH_TOKEN` | reads the live ruleset over the GitHub API, which no fixture replaces; run once by hand     |
| TC-06 | automated | `node scripts/harness/scan-file-size.mjs`; `ls` of the declaration module                | the baseline moved down, never up                                                           |
| TC-07 | automated | `git diff --name-only origin/develop -- …` and `git ls-files … \| grep -i`               | both commands print nothing; proves the decision's "not switched on / no follow-up" clauses |

## User Execution Test Scenarios

Not applicable.

**Reason:** The change is a repository branch-protection declaration and the reconciler that reads it. It ships no Robota CLI command, no TUI action, no browser flow and no public SDK export, so no user of the published packages has a product surface on which the change could be observed. Its only observable is a maintainer-dispatched `ruleset-drift` run, which is governance machinery and not a product surface; that run is engineering verification under TC-05, not user-execution evidence.

The subject-bound author verdict for the PLAN checkpoint lives in the paired Task's
`## User Execution Test Scenarios` section (`SCENARIO DRAFTED: not-applicable | 0`), which a separate
author agent re-authors for this recovery; this spec section states the applicability decision only.

## Tasks

- [ ] `.agents/tasks/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md` — todo

## Prospective Recovery — current conversation authorization

**Historical NON-COMPLIANCE, preserved and not erased.** The implementation of this unit was written
in the frozen worktree `/Users/jungyoun/Documents/dev/woojubb/robota/.claude/worktrees/wf_0fbb6b3c-209-7`
(branch `worktree-wf_0fbb6b3c-209-7`, based on `73b53e35c3f18f5cec15c29f491e2eaeeeaa0c18`) before
any GATE-APPROVAL or PLAN gate had run on its Task/spec pair — the NON-COMPLIANCE trigger
`.agents/specs/gate-catalogue.md` names under GATE-APPROVAL. That ordering remains a historical
NON-COMPLIANCE; nothing here claims the original sequence complied, and no old completion tick or
green observation from that tree is new evidence. The original tree is untouched; its tracked diff,
every untracked file and a SHA256/mode manifest are preserved under
`/tmp/robota-issues/round2/impl2/INFRA-162/` (`plan-preserved.patch`, `plan-preserved-untracked/`,
`plan-manifest.json`; re-hashed clean on 2026-09-05).

**Authorization, verbatim and sourced.** The current conversation carries this instruction:

> 인계 문서에 출처가 기록된 기존 9건의 설계 결정과, 과거 위반/원본을 보존하면서 실제 계획 → 재적용 →
> 검증으로 복구하는 승인을 이 대화에도 승계합니다. 새로운 설계나 검증 우회까지 승인하는 것은 아닙니다.
> (…) 기존 승인 항목은 rank와 의존순으로 진행하세요.

Source: this conversation, 2026-09-05 — the user typed
"/tmp/robota-issues/round2/CLAUDE-RESUME-PROMPT.txt 이 파일을 읽고 시작하세요." and that user-authored
file carries the instruction quoted above; the nine inherited design decisions and their original
sources are recorded in `/tmp/robota-issues/round2/DECISIONS.md`, whose INFRA-162 (#2219) line is
quoted in § Decision. This is Route DIRECT provenance for the PLAN gate's GATE-APPROVAL criteria; the
`gate.mjs approve` entry is written by the owner of the gate step, not by this planning recovery, and
no gate entry is claimed below.

**What the recovery permits.** A bounded prospective recovery in the normal order: this real planning
checkpoint (the pair on the clean branch `fix/infra-162-recovery`, cut from `origin/develop` at
`73b53e35c3f18f5cec15c29f491e2eaeeeaa0c18`, work-run `32cfb911-108f-4b23-a11b-6c3d92e4086b` bound to
INFRA-162 / L1 / `recovery`), then the PLAN gate on this pair, then reapplication of the preserved
patch, then verification with RED recorded before GREEN for every regression and falsification case
TC-01 through TC-04 name. The settled option A decision is inherited, not reopened.

**What it does not permit.** No new design; no verification bypass; no disabling or editing of any
hook or scan to pass; no raising of the `file-size` baseline; no change to the live ruleset, to
`.github/workflows/ruleset-drift.yml`, to `.claude/hooks/merge-gate.sh` or to
`.agents/rules/git-branch.md`; no merge-queue follow-up; no retrospective PASS for the historical
ordering; no status `done` and no `work-run ready` from this recovery stage.

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "인계 문서에 출처가 기록된 기존 9건의 설계 결정과, 과거 위반/원본을 보존하면서 실제 계획 → 재적용 → 검증으로 복구하는 승인을 이 대화에도 승계합니다. 새로운 설계나 검증 우회까지 승인하는 것은 아닙니다. (…) 기존 승인 항목은 rank와 의존순으로 진행하세요."
**Given:** 2026-09-05, this conversation
**Review fingerprint:** 71bb8893a5a4 (review 71f14d6d, type/tags 7622c4ed)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (71bb8893a5a4) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `73b53e35c3f1` · base `origin/develop@73b53e35c3f1` · document `.agents/spec-docs/draft/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md` blob `051eaa7a3b38` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 2631 chars, 7 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 4 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 7 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 7 Test Plan rows = 7 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 7 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (71bb8893a5a4) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `73b53e35c3f1` · base `origin/develop@73b53e35c3f1` · document `.agents/spec-docs/draft/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md` blob `aed764da537e` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "인계 문서에 출처가 기록된 기존 9건의 설계 결정과, 과거 위반/원본을 보존하면서 실제 계획 → 재적용 → 검증으로 복구하는 승인을 이 대화에도 승계합니다. 새로운 설계나 검증 우회까지 승인하는 것은 아닙니다. (…) 기존 승인 항목은 rank와 의존순으로 진행하세요."
**Given:** 2026-09-05, this conversation
**Review fingerprint:** 71bb8893a5a4 (review 71f14d6d, type/tags 7622c4ed)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (71bb8893a5a4) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `73b53e35c3f1` · base `origin/develop@99386b241ed6` · document `.agents/spec-docs/todo/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md` blob `69bb013ef777` (modified)

### [GATE-PLAN] — ❌ FAIL | 2026-09-05

**Status remains:** approved
**Failed criteria:**

- GATE-WRITE — `status: draft` present in frontmatter: `status: approved`, required `status: draft`
  **Required action:** set `status: draft`

**Judged at:** HEAD `73b53e35c3f1` · base `origin/develop@99386b241ed6` · document `.agents/spec-docs/todo/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md` blob `5682a4a28535` (modified)
