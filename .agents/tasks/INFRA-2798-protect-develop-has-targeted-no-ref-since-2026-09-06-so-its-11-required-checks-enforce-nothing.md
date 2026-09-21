---
title: 'INFRA-2798: protect-develop has targeted no ref since 2026-09-06, so its 11 required checks enforce nothing and the reconciler that reports it has not run since 2026-08-11'
issue: https://github.com/woojubb/robota/issues/2798
status: todo
created: 2026-09-21
priority: high
urgency: soon
area: GitHub control plane (ruleset 18715844), .github/required-status-checks.json, scripts/harness/required-status-checks-live.mjs, .agents/rules/git-branch.md
depends_on: []
---

# INFRA-2798: protect-develop has targeted no ref since 2026-09-06, so its 11 required checks enforce nothing and the reconciler that reports it has not run since 2026-08-11

## Objective

Decide the control-plane state of `develop` and record the decision, so the repository stops
adapting its rules to a configuration nobody chose.

Ruleset `protect-develop` (id 18715844) is `active` and lists exactly the 11 contexts
`.github/required-status-checks.json` declares under `branches.develop`, but its
`conditions.ref_name.include` has been `[]` since 2026-09-06 00:05:41 KST (history version
48767623, actor woojubb; the previous version 47297672 of 2026-08-22 15:20 had
`["refs/heads/develop"]`, and with `updated_at` removed the scope is the ONLY diff between the two
version states — contexts, `strict_required_status_checks_policy: false`, `non_fast_forward` and
the bypass actor are identical). A ruleset that targets no ref enforces nothing:
`gh api repos/woojubb/robota/rules/branches/develop` returns `[]`. This is not GitHub reading an
empty `include` as "all refs": 18715844's rules appear on NO branch — `rules/branches/main` returns
only `required_status_checks`, `non_fast_forward` and `pull_request`, all sourced from 18715845,
and a branch covered by neither ruleset returns `[]`. `protect-main` (18715845) is unaffected.

The change was an owner action opening a **temporary** direct-integration window: the
`chore/allow-develop-direct-merge` branch's first commit lands 00:10:19 KST, ~4.6 minutes later,
and its PR #2591 (opened 01:26 KST) says "explicit maintainer authorization for temporary direct
integration updates". PR #2613 then landed the rule text permitting maintainer-requested direct
commits to `develop`. None of those records mentions the ruleset: the contemporaneous evidence in
`b1af6709a` is `branches/develop/protection` → 404, which is the CLASSIC-protection endpoint and
returns 404 in a rulesets repository whatever the scope is. So the un-scoping itself is recorded
nowhere, and neither is any decision to keep it.

**What makes this a root item is not documentation drift.** `develop`'s own documents have already
been amended, twice, to tolerate the gap rather than to name it:

- `git-branch.md` (pre-merge section) now says the declaration "is not proof that a live ruleset
  applies" and routes an empty required-check discovery to inspecting each context's owning
  workflow, and the `$schema-note` in `required-status-checks.json` ends "A declaration alone does
  not prove the live ruleset applies to its branch."
- On 2026-09-13, MERGE-2655 met this exact state (its record quotes "live develop rules returned
  `[]`"), triaged it LOCAL / 0 FOUNDATIONAL of 1, instructed "Do not change protection", and PR #2719
  amended `git-branch.md` so the merge verifier ACCEPTS a required-check projection that is
  "confirmed empty by readable live protection state" (`git-branch.md:396-397`).

Each amendment is defensible alone. Together they mean the repository has spent two weeks making
its rules fit an unrecorded control-plane state instead of deciding that state. That is the defect
this item owns.

**Blast radius, stated precisely.** `bypass_actors` on both versions is
`{actor_type: RepositoryRole, actor_id: 5, bypass_mode: always}`, and the same payload reports
`current_user_can_bypass: "always"` for the owner's own token — so the owner could already push and
merge past the SCOPED ruleset, and the un-scoping bought the owner's stated need nothing. That half
needs no role-id reading. The other half does: `actor_id: 5` is GitHub's base repository role for
admin, which is an inference from GitHub's role numbering rather than anything the payload names.
On it rests the claim that the repository's second collaborator, `easylogic` (push, not admin per
`gh api repos/woojubb/robota/collaborators`), was bound by the scoped ruleset and is not bound
now.
If 5 were a lower role, that second claim inverts; the owner-side claim stands either way.
`.claude/hooks/merge-gate.sh` still refuses a non-`CLEAN`
`mergeStateStatus`, but it is a local hook with a documented inline override, it does not run on
another collaborator's machine, and its own comment records that it never sees a web-UI Merge
button. At least 100 pull requests have merged into `develop` since 2026-09-06 with no server-side
required check.

**Detection.** The reconciler is not blind: `node scripts/harness/scan-main-required-checks.mjs
--live` returns 12 findings today (11 contexts "enforcing nothing" + `(strict policy: develop)`
unreadable). What is missing is a trigger. `ruleset-drift.yml` is `workflow_dispatch`-only and last
ran 2026-08-11 — zero runs across the change. `scripts/harness/promote.mjs` calls `reconcileLive`
on every promote, but explicitly "does not block the promotion", and it sits on the develop→main
path rather than on a `develop` merge. `run-all-scans.mjs` registers only the hermetic half.

## Plan

- [ ] TC-01: Owner decision, recorded here: (a) restore
      `conditions.ref_name.include: ["refs/heads/develop"]` on ruleset 18715844, or (b) declare the
      un-scoping permanent. No agent changes the ruleset — a control-plane change is the owner's
      (`git-branch.md` § "Landing a control-plane change" excludes protection changes from the
      delegated route).
- [ ] TC-02: If (a): `gh api repos/woojubb/robota/rules/branches/develop` reports the 11 contexts,
      `node scripts/harness/scan-main-required-checks.mjs --live` exits 0, and the new ruleset
      history version id is recorded here. If (b): `required-status-checks.json`'s
      `branches.develop` states that these 11 are a LOCAL floor with no live enforcement, and
      `git-branch.md`'s pre-merge section says so in the same words.
- [ ] TC-03 (mechanical): `reconcileLiveBranch` in
      `scripts/harness/required-status-checks-live.mjs` reads the declared `ruleset_id`'s
      `conditions.ref_name.include` and emits a finding, distinct from its per-context ones, when
      that list does not contain `refs/heads/<branch>`. Today the scan infers the state from 11
      missing contexts; it never reads the scope that caused them, so it cannot say why.
- [ ] TC-04 (prose): `git-branch.md`'s empty-projection paragraph (`:396-404`) and
      `.claude/agents/merge-verifier.md` say that a confirmed-empty projection is REPORTED as an
      anomaly against the declared branch, not merely verified around. The rule already requires
      reporting the fact and re-verifying each declared context — this adds that the emptiness is
      itself the anomaly, so a future un-scoping surfaces on the next merge rather than passing as
      a known-handled shape. Under (a) this is what restores detection without a cron: the
      projection is non-empty, so going empty is visible on the next verdict.
- [ ] TC-05: The two stale comments that claim a schedule owns the live half —
      `scripts/harness/required-status-checks-live.mjs:48` ("the scheduled reconciler owns this
      half … a red cron") and `scripts/harness/scan-main-required-checks.mjs:58-59` ("the scheduled
      `.github/workflows/ruleset-drift.yml` runs that half") — say what is true: the workflow is
      dispatch-only under the 2026-08-04 no-cron directive, and last ran 2026-08-11.

## Test Plan

TC-02(a): the live command output and `gh api repos/woojubb/robota/rules/branches/develop`, both
captured here. TC-02(b): the `conflict-markers` and affected-document scans over the amended files.
TC-03: a harness test driving `reconcileLiveBranch` with an injected payload in the falsifiability
pattern INFRA-162 used for this same function (`scan-main-required-checks.test.mjs:744-782`), so
removing the new read fails the test rather than leaving a check that cannot go red. Note the seam
the implementation must add: today's third parameter injects the BRANCH-RULES projection, which
carries no `conditions` at all — and under an empty scope that projection is empty, so the case
"contexts match while the scope is empty" cannot be expressed through it. TC-03 therefore needs a
second injectable read, of `repos/<slug>/rulesets/<ruleset_id>`, and the test asserts the scope
finding when that object's `ref_name.include` omits the branch and no finding when it contains
it. TC-04 is prose in a rule and an agent
definition, with no executable surface: it is covered by the affected-document scans and by TC-03
being the mechanical half that can actually fail. TC-05: comment-only, same scans.
`pnpm harness:test` and `pnpm harness:scan` green.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This item changes a GitHub ruleset, a repository declaration file, harness comments and
rule text. No Robota CLI, TUI, browser or SDK surface is touched, so there is no product behaviour a
user could observe; the verification is the live control-plane read and the harness test in the
Test Plan.

## Notes

Found by `merge-verifier` while verifying PR #2792's landing on 2026-09-21. Independently verified
by `finding-verifier` (outcome CONFIRMED) against the live API: the rebuttals that another ruleset
or classic protection still covers `develop` (repository and `includes_parents` listings return
only 18715844 and 18715845; the owner is a User, so no organization level exists), and that an
empty `include` might mean all refs (18715844's rules appear on no branch: `rules/branches/main`
returns only 18715845's three rules, and a branch covered by neither ruleset returns `[]`), both
fail.

That verification also corrected this record's first draft, which quoted
`required-status-checks.json` and `git-branch.md` as still asserting enforcement. Those sentences
exist on the session's starting branch, 60 commits ahead of `develop`, not on `develop` — where
both documents already carry the caveats quoted in the Objective. The correction makes the finding
sharper, not weaker: the documents were amended around the gap rather than contradicting it.

The full evidence and timeline are on [issue #2798](https://github.com/woojubb/robota/issues/2798).
This record does not decide (a) versus (b); that is the owner's call, and this record is not
actionable until the owner makes it.
