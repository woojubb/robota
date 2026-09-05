---
title: 'INFRA-162: the strict status-check policy is neither declared nor reconciled, so a base-freshness change is invisible'
issue: https://github.com/woojubb/robota/issues/2219
status: todo
created: 2026-09-05
priority: medium
urgency: soon
area: .github/required-status-checks.json, scripts/harness/scan-main-required-checks.mjs, scripts/harness/required-status-checks-declaration.mjs
depends_on: []
---

# INFRA-162: the strict status-check policy is neither declared nor reconciled

Registered as issue #2219.

Paired with
`.agents/spec-docs/todo/INFRA-162-the-strict-status-check-policy-is-neither-declared-nor-reconciled-so-a-base-fres.md`,
which owns the decision, the prior art and the completion criteria.

**Why this record is `INFRA-162` and not `INFRA-158`.** The first draft of this unit (held outside
the tree on 2026-09-04) was written under `INFRA-158`. That ID is already claimed by another item —
the abandoned browser-entry direction that
`.agents/spec-docs/active/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md`
and `.agents/tasks/INFRA-161-contain-the-browser-bundle-break-in-the-cli-web-package.md` cite by
that number — and `.agents/tasks/README.md` § "Work-item IDs" holds that one ID names one item.
`pnpm harness:task:allocate INFRA … --issue 2219` on 2026-09-05 read 1688 claimed IDs (1080 from
records, 1682 from citations, 383 from issue titles and bodies) and allocated `INFRA-162`.

## Lane

`Lane: L1`.

Derived from the diff: the change touches `.github/required-status-checks.json` (no L2 row in
`.agents/rules/spec-workflow.md` § "Lane floors" matches it — `.github/workflows/**` does not, and
the `package.json` row is anchored at the repository root), `scripts/harness/scan-main-required-checks.mjs`
and the new `scripts/harness/required-status-checks-declaration.mjs`, whose non-comment changes match
`scripts/**#non-comment` at floor L1. No workflow file changes, because
`.github/workflows/ruleset-drift.yml` already runs `node scripts/harness/scan-main-required-checks.mjs --live`;
keeping the assertion inside that existing entry point is what holds the floor at L1 rather than L2.
Re-measured for the recovery on 2026-09-05:
`node scripts/harness/scan-lane-declaration.mjs --diff-file /tmp/robota-issues/round2/impl2/INFRA-162/plan-preserved.patch --changed <the five preserved paths>`
reports floor L1 (`.github/required-status-checks.json` L0; the four `scripts/**` paths L1).

## Objective

Make the branch-protection **strict status-check policy** a declared fact that the live reconciler
checks, so that turning "require branches to be up to date before merging" on or off is a visible
change rather than a silent one. The value declared is the value the ruleset holds today — `develop`
`false`, `main` `true` — and the live ruleset is not changed by this unit.

## What was confirmed, and what was refuted

First verified on 2026-09-04 against `develop` at `a81cc85b7`; re-measured on 2026-09-05 against
`develop` at `73b53e35c` with the endpoint the scan actually reads:

```
$ gh api repos/woojubb/robota/rules/branches/develop --jq '.[] | select(.type=="required_status_checks") | {ruleset_id, strict: .parameters.strict_required_status_checks_policy}'
{"ruleset_id":18715844,"strict":false}
$ gh api repos/woojubb/robota/rules/branches/main --jq '.[] | select(.type=="required_status_checks") | {ruleset_id, strict: .parameters.strict_required_status_checks_policy}'
{"ruleset_id":18715845,"strict":true}
```

**Confirmed — the live setting, and that nothing declared it.** Before this unit the declaration
file did not mention the key:

```
$ node -e "const j=require('./.github/required-status-checks.json'); console.log(Object.keys(j.branches.develop))"
[ 'ruleset', 'ruleset_id', 'mirrored_by', 'why', 'required_status_checks', 'deliberately_not_required' ]
```

The reconciler discarded it. `scripts/harness/scan-main-required-checks.mjs` (at `a81cc85b7`,
lines 397-401) reduced the live rule to its contexts and nothing else:

```js
const live = new Set(
  rules
    .filter((rule) => rule.type === 'required_status_checks')
    .flatMap((rule) => rule.parameters?.required_status_checks ?? [])
    .map((check) => check.context),
);
```

The two findings it could emit (lines 405-419) were both about a context being present on one side
and absent on the other. So a flip of the strict flag in the GitHub UI — in either direction —
produced no finding, and `ruleset-drift.yml` reported success. That is the same shape
`.agents/rules/enforcement-architecture.md` § "Silence is not success" names: the reconciler did not
check, and reported as if it had.

**Refuted — the issue's headline claim, as of five days after it was filed.** Issue #2219 says
"nothing on the PR asks whether it still builds against the base it will land on", and asks for the
strict policy as "the cheapest complete answer". A different remedy landed on 2026-08-28 in commit
`fd0752f90` ("feat(harness): gate.mjs, lane scan, spec scaffold, affected scans, interaction merge
gate"), five days after the issue was created on 2026-08-23. `.claude/hooks/merge-gate.sh` now asks
the base-moved question mechanically, and its own header (lines 392-408) records the choice:

> Disjoint AND MERGEABLE is accepted. Any overlap is refused naming every file, because that is the
> case the review has not seen. Anything unreadable is refused: unknown is not zero, the same rule
> the thread block above applies. This is the non-strict policy the host already runs under
> ("require branches to be up to date" is off), asked mechanically at the one moment it matters.

So the strict-policy remedy was considered and deliberately declined in favour of an interaction
test. This Task does not reopen that choice; it makes the declined setting a _declared_ one.

**Residual, and stated narrowly.** Two limits of the interaction test are properties of the code as
written, not of any incident:

1. It is a **file-path set intersection**. `merge-gate.sh` line 500 computes
   `comm -12` over the base's moved-file list and the pull request's own file list. A pull request
   that adds a new file importing a symbol the base moved, and touches no file the base moved, has
   an empty intersection and is accepted. The proxy is paths; the failure is types.
2. It is **reachable only from a Claude Code session**. `.claude/settings.json` registers
   `merge-gate.sh` as a `PreToolUse` hook on the `Bash` matcher, and no workflow invokes it
   (`git grep merge-gate -- .github scripts package.json` returns prose and test fixtures only). A
   merge from the GitHub UI, from auto-merge, or from a plain terminal is subject to none of it.

Both residuals are recorded in the paired spec § "Out of Scope" as a decision deferred by the owner
(B versus C, to be made explicitly later), not as work this Task's Plan performs.

## Plan

All completion markers are reset for prospective verification; the historical `[x]` ticks of the
pre-gate implementation are preserved in the original archive
(`/tmp/robota-issues/round2/impl2/INFRA-162/plan-preserved-untracked/.agents/tasks/…`) and are not
new completion. The settled owner decision this Plan reflects is option A: declare
`develop` `false` and `main` `true`, reconcile against the live ruleset fail-closed, do not switch
`develop` on, and file no merge-queue follow-up. TC-01 through TC-06 mirror the paired spec's
Completion Criteria one-to-one; TC-07 carries the two decision clauses ("develop is not switched on",
"no merge-queue follow-up") that the preserved Plan predated.

- [ ] TC-01 — Declare the value each ruleset holds today.
      `node -e "const j=require('./.github/required-status-checks.json');for(const b of ['develop','main'])console.log(b,j.branches[b].strict_required_status_checks_policy,typeof j.branches[b].strict_policy_why)"`
      prints `develop false string` and `main true string`; the vitest describe
      `the tracked declaration records the strict policy each ruleset holds (INFRA-162 TC-01)` passes,
      and its run against the pre-change declaration file (no key) is recorded RED first.
- [ ] TC-02 — Reconcile the flag beside the contexts.
      `pnpm exec vitest run scripts/harness/__tests__/scan-main-required-checks.test.mjs` exits 0;
      the two `is RED on disagreement in each direction (…)` cases each produce exactly one finding
      under `(strict policy: develop)` naming both values, and both go red when the comparison in
      `strictPolicyFindings` is replaced by a constant (falsification recorded).
- [ ] TC-03 — Refuse rather than default when the flag cannot be read on either side.
      The four `refuses rather than defaulting when …` cases (no strict key in parameters; no
      `required_status_checks` rule at all; `parameters` `null`; a non-boolean value) and
      `refuses a declaration that omits the key, rather than assuming a value` each produce exactly
      one finding naming what could not be read, and all five go red when the refusal is replaced by
      a `?? false` default (falsification recorded).
- [ ] TC-04 — Keep the hermetic half green.
      `node scripts/harness/scan-main-required-checks.mjs` exits 0 and prints
      `::examined:: 5 required contexts`; the TC-04 test file run against the pre-change scan (no
      declaration module) is recorded RED first.
- [ ] TC-05 — Reconcile live, with the ruleset unchanged.
      `node scripts/harness/scan-main-required-checks.mjs --live` exits 0 and prints
      `Live ruleset reconciled.` against the rulesets as measured; with
      `branches.develop.strict_required_status_checks_policy` flipped to `true` in the working tree
      it exits 1 with a finding under `(strict policy: develop)` naming both values; and
      `gh api repos/woojubb/robota/rules/branches/develop --jq '.[] | select(.type=="required_status_checks") | {ruleset_id, strict: .parameters.strict_required_status_checks_policy}'`
      still prints `{"ruleset_id":18715844,"strict":false}` after the change (the live ruleset was
      not touched).
- [ ] TC-06 — Stay under the `file-size` budget by moving, not by raising.
      `node scripts/harness/scan-file-size.mjs` exits 0 with the baseline entry for
      `scripts/harness/scan-main-required-checks.mjs` at 535, lower than the 544 it replaced, and
      `scripts/harness/required-status-checks-declaration.mjs` exists owning `DECLARATION_FILE`,
      `readDeclaration`, `readDeclarationBranch`, `STRICT_POLICY_KEY` and `strictPolicyFindings`.
- [ ] TC-07 — Change nothing the decision keeps fixed.
      `git diff --name-only origin/develop -- .github/workflows .claude/hooks .agents/rules` prints
      nothing (`ruleset-drift.yml`, the merge gate and `git-branch.md` are untouched, so no pull
      request is newly blocked), and `git ls-files .agents/tasks .agents/spec-docs | grep -i 'merge-queue\|merge_group'`
      prints nothing (no merge-queue follow-up record was filed).

## Test Plan

- TC-02/TC-03 are exercised by the vitest cases against a stubbed live payload
  (`strictPolicyFindings({ branchName, rules, branch })` is pure); `--live` is not needed to prove
  the comparison, and the offline half stays hermetic as the scan's header requires.
- Falsification, required before the cases are trusted: replace the comparison with a constant
  and confirm the disagreement cases go red; restore a `?? false` default in place of the TC-03
  refusal and confirm the unreadable cases go red. Confirm each against the fixture payloads, not
  merely that the suite passes on the current tree. Record the red output before the green.
- Red-first: the test file run against the pre-change scan (no declaration module, no key in the
  declaration file) fails; the same run passes with the change. Both outputs are recorded.
- `node scripts/harness/scan-main-required-checks.mjs` (offline, the form `pnpm harness:scan` runs)
  exits 0 on the branch.
- `node scripts/harness/scan-main-required-checks.mjs --live` reports no drift when TC-01 records
  the values measured above, and exits 1 naming `(strict policy: develop)` when the declared
  `develop` value is flipped to `true` against the unchanged ruleset. The live read of the
  `develop` ruleset after the change still shows `strict: false`.
- `node scripts/harness/scan-file-size.mjs` exits 0 with the ratcheted baseline.
- `git diff --name-only origin/develop -- .github/workflows .claude/hooks .agents/rules` is empty,
  and no `merge-queue`/`merge_group` record exists under `.agents/tasks` or `.agents/spec-docs`.

## Baseline and introduction order

**No baseline freeze is required, and no pull request is newly blocked.** The new assertion runs in
`reconcileLiveBranch`, which is reached only under `--live`, which
`.github/workflows/ruleset-drift.yml` invokes on `workflow_dispatch` and which is deliberately out
of the merge path — its header states this: "It gates nothing: a GitHub API outage costs a red
manual run, never a blocked promotion."

Order matters in one place: **TC-01 must record the value the ruleset holds today (`develop`
`false`, `main` `true`), not a value anyone may later prefer.** Declaring `true` for `develop`
before the ruleset is changed would make the first `--live` run red about a setting nobody has
agreed to change, which is the reverse of what this Task is for.

## Completion criteria

- `.github/required-status-checks.json` declares `strict_required_status_checks_policy` for both
  `develop` (`false`) and `main` (`true`), each with a stated `strict_policy_why`.
- `node scripts/harness/scan-main-required-checks.mjs --live` reports a finding when the declared
  value and the live value disagree, in both directions, proved by the fixture cases.
- The same entry point reports a finding, not a pass, when the flag is absent from the live payload
  or from the declaration — never a silent default.
- `node scripts/harness/scan-main-required-checks.mjs` exits 0 offline.
- The live `protect-develop` ruleset still holds `strict: false`; no workflow, hook or rule file
  changes; no merge-queue follow-up record exists.

## Decision

The question this unit could not answer for itself — whether `develop` should be switched to the
strict policy — was put to the owner as a USER-DECISION (Option A: keep `false`, declared; Option
B: switch `develop` to `true`; Option C: add a required check that recomputes the merge result and
typechecks it). The owner's 2026-09-05 selection is Option A. Its settled record, quoted verbatim
from `/tmp/robota-issues/round2/DECISIONS.md`:

> 2026-09-05 INFRA-158 별건 (#2219) 결정: A — strict 정책 선언(develop=false, main=true) + 라이브 룰셋
> 대조(fail-closed), develop 은 켜지 않음. 머지 큐 후속은 만들지 않음(사용자 소유 저장소 불가); 잔여
> 위험은 후일 B vs C.

(`INFRA-158` there is the superseded label for this same item, #2219 — see "Why this record is
`INFRA-162`" above; it is not the other item that holds `INFRA-158` today.) The decision brief with
the prior art and the throughput measurement behind it is
`/tmp/robota-issues/round2/decisions/INFRA-158-strict.md`. The paired spec § "Decision" records the
trade-off. The original record's note that "the GATE-APPROVAL entry is written only in the
conversation where the owner gives it" was correct for the session that wrote it (a relay); the
authorization now in force is the one recorded in § "Prospective Recovery" below, given in the
current conversation.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Subject-bound verdict authored for this Task on 2026-09-05 under owner option A (declare
`develop` `false` and `main` `true`, reconcile fail-closed against the live ruleset, do not switch
`develop` on, file no merge-queue follow-up). The unit delivers no runnable user-facing behaviour: the
preserved patch (`/tmp/robota-issues/round2/impl2/INFRA-162/plan-manifest.json`) modifies
`.github/required-status-checks.json`, `scripts/harness/scan-main-required-checks.mjs`,
`scripts/harness/__tests__/scan-main-required-checks.test.mjs`, `scripts/harness/file-size-baseline.json`
and adds `scripts/harness/required-status-checks-declaration.mjs`; it contains zero paths under
`packages/` or `apps/`. The installed `robota` CLI (`robota 3.0.0-beta.72`, resolved on this host) is
therefore byte-identical in behaviour before and after the change, no TUI action, browser flow or
public SDK export gains or loses a behaviour, and a user of the published packages has no product
surface on which anything observably differs. The unit's whole effect is on the project's own
governance machinery: a maintainer-dispatched `ruleset-drift` workflow run that can now go red where
it was silently green when the branch-protection strict policy moves. The live ruleset is not changed,
`develop` is not switched on, and no merge-queue follow-up is filed, so nothing a pull request author
experiences differs either.

Surface search, so the verdict is auditable rather than asserted. The repository's scenario surface
contract (`scripts/harness/user-execution-scenario-surface.mjs`) recognises exactly four product
surfaces — `robota-cli`, `robota-tui`, `robota-browser-ui`, `public-sdk-example` — and the one
observable this unit adds is reached only through `node scripts/harness/scan-main-required-checks.mjs
--live`, which is none of them. That entry point was attempted on this worktree in its offline form
(`node scripts/harness/scan-main-required-checks.mjs` → exit 0, `::examined:: 5 required contexts`),
so the invocation shape is real; it is a repository governance scan, which this rule's own contract
excludes as scenario evidence. The capability is reachable (`.github/workflows/ruleset-drift.yml`
invokes that entry point under `--live`), so this is a governance-only unit, not an unexposed
capability awaiting surface wiring. Its exercise belongs to TC-02, TC-03 and TC-05 in the Plan above,
as engineering verification, not as a user-execution scenario.

## Prospective Recovery — current conversation authorization

**Historical NON-COMPLIANCE, preserved and not erased.** The implementation of this unit was written
on 2026-09-04/05 in the worktree `/Users/jungyoun/Documents/dev/woojubb/robota/.claude/worktrees/wf_0fbb6b3c-209-7`
(branch `worktree-wf_0fbb6b3c-209-7`, based on `73b53e35c3f18f5cec15c29f491e2eaeeeaa0c18`) before
any GATE-APPROVAL or GATE-IMPLEMENT (for lane L1: the PLAN gate) had run on its Task/spec pair. That
ordering violated `.agents/specs/gate-catalogue.md` (implementation before GATE-APPROVAL is the
NON-COMPLIANCE trigger) and remains a historical NON-COMPLIANCE. Nothing here claims the original
sequence complied, and no old completion tick or green observation from that tree is new evidence.
The original tree is frozen and untouched; its tracked diff, every untracked file, and a SHA256/mode
manifest are preserved at `/tmp/robota-issues/round2/impl2/INFRA-162/` (`plan-preserved.patch`,
`plan-preserved-untracked/`, `plan-manifest.json`, re-hashed clean on 2026-09-05).

**Authorization, verbatim and sourced.** The current conversation carries this instruction:

> 인계 문서에 출처가 기록된 기존 9건의 설계 결정과, 과거 위반/원본을 보존하면서 실제 계획 → 재적용 →
> 검증으로 복구하는 승인을 이 대화에도 승계합니다. 새로운 설계나 검증 우회까지 승인하는 것은 아닙니다.
> (…) 기존 승인 항목은 rank와 의존순으로 진행하세요.

Source: this conversation, 2026-09-05 — the user typed
"/tmp/robota-issues/round2/CLAUDE-RESUME-PROMPT.txt 이 파일을 읽고 시작하세요." and that user-authored
file carries the instruction quoted above; the nine inherited design decisions and their original
sources are recorded in `/tmp/robota-issues/round2/DECISIONS.md`, whose INFRA-162 (#2219) line is
quoted in § "Decision" above. This is Route DIRECT provenance for the PLAN gate's GATE-APPROVAL
criteria; the `gate.mjs approve` entry itself is written by the owner of the gate step, not by this
planning recovery.

**What the recovery permits.** A bounded prospective recovery in the normal order: this real
planning checkpoint (the Task/spec pair on a clean branch `fix/infra-162-recovery` cut from
`origin/develop` at `73b53e35c3f18f5cec15c29f491e2eaeeeaa0c18`, work-run
`32cfb911-108f-4b23-a11b-6c3d92e4086b` bound to INFRA-162 / L1 / `recovery`), then the PLAN gate on
this pair, then reapplication of the preserved patch, then verification with RED recorded before
GREEN for every regression and falsification case named in the Plan. The settled option A decision
is inherited, not reopened.

**What it does not permit.** No new design; no verification bypass; no disabling or editing of any
hook or scan to pass; no raising of the `file-size` baseline; no change to the live ruleset, to
`.github/workflows/ruleset-drift.yml`, to `.claude/hooks/merge-gate.sh`, or to
`.agents/rules/git-branch.md`; no merge-queue follow-up; no retrospective PASS for the historical
ordering; no status `done`, no move to `completed/`, and no `work-run ready` from this recovery
stage — those belong to the parent after the gates pass.
