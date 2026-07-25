---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-051: Keep `main`'s ancestry inside every promotion so promotions never re-conflict

## Problem

`main` and `develop` cannot be kept in sync, because both merges that are supposed to sync them are
squashed:

- a **back-merge** (`main -> develop`) squashed into one commit copies main's content across but records
  **no ancestry link**;
- so the next **promotion** (`develop -> main`) still computes against the old merge base and re-conflicts
  on exactly the manifests the back-merge just reconciled.

Measured 2026-07-26: #1415 back-merged main into develop and merged green as squash commit `bc0ee64ff`
(single parent). Immediately after, `develop -> main` (#1413) still reported `CONFLICTING` on five
`package.json` files plus `pnpm-lock.yaml`. #1427 cleared it by hand with real merge commits.

The manual re-resolution is where the risk sits: resolving wholesale toward `main` would have reverted
develop's dependency patch bumps; resolving wholesale toward `develop` would have un-archived four backlog
items and dropped ~80 changesets. A resolution that must be hand-derived every cycle will eventually be
got wrong.

**Reproduction condition:** `git merge-base --is-ancestor origin/main <promotion head>` exits non-zero.

## Architecture Review

### Measured facts (re-derived, and corrected by the proposal review)

| Fact                                                                                                                  | Evidence                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Things **have** landed directly on `main`, not only via `develop`                                                     | `git rev-list origin/develop..origin/main --no-merges` = **10**: nine Dependabot bumps (#1316–#1328) **and one human feature branch** — `fbf9f5156`, #1216, `head: feat/harness-028-no-fallback-gate`, `base: main`. That is the very incident `main-pr-source-guard` was written for, and it happened anyway.         |
| Dependabot is off **by policy, not by mechanism**                                                                     | `.github/dependabot.yml` deleted; `.github/DEPENDABOT-DISABLED.md` records #1412. Re-enabling it re-opens the hole.                                                                                                                                                                                                    |
| `hotfix/*` may still target `main` directly                                                                           | `main-pr-source-guard` admits `develop`, `release/*`, `hotfix/*`.                                                                                                                                                                                                                                                      |
| Release automation does **not** push commits to `main`                                                                | `release-tag-on-version-bump.yml` pushes only `refs/tags/$TAG`.                                                                                                                                                                                                                                                        |
| `main` is a real release boundary                                                                                     | `release-grade-verify` runs only for `base_ref == 'main'`; `protect-main` carries its own rule set; `release-tag-on-version-bump.yml` triggers on push to `main`.                                                                                                                                                      |
| `ci.yml` runs only `on: pull_request`; **CodeQL also runs on push to `main`/`develop`** but is not a required context | `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`. Net effect stands: a `develop`-tip SHA carries **no required** check runs.                                                                                                                                                                                 |
| `protect-main` bypass is **already active** for the operating account                                                 | `gh api …/rulesets/18715845` → `bypass_actors: [RepositoryRole 5, always]`, `current_user_can_bypass: "always"`. A direct push to `main` is _not_ mechanically impossible.                                                                                                                                             |
| For a `base_ref == 'main'` PR **all five** required contexts were vacuous                                             | `build`, `quality`, `scans`, `security audit` each open with a "Skip duplicate … for main PR" echo and gate every later step on `base_ref != 'main'`; `commitlint` is skipped wholesale. Measured on #1427: 5s/5s/6s/3s/skipping. The only substantive job, `release-grade verification` (7m31s), is **not** required. |
| GitHub **does** expose a per-branch merge-method control                                                              | `pull_request` ruleset rule, `allowed_merge_methods`. Verified by applying it — see Decision. The first draft claimed it did not exist; the proposal review refuted that, and the refutation is what turns this from a detector into a gate.                                                                           |
| `release/*` / `hotfix/*` are already exempt from the "no merge commits in range" push block                           | `.claude/hooks/pre-push-check.sh` §0                                                                                                                                                                                                                                                                                   |
| `main`'s tree is **already** identical to the develop commit #1427 promoted                                           | `git rev-parse origin/main^{tree} 21fe31d4d^{tree}` — both `cb874373…`. `main` holds no content `develop` lacks; only the _graph_ is broken.                                                                                                                                                                           |

### Alternatives Considered

1. **Merge-commit the sync merges, expressed as an ancestry invariant, enforced pre-merge by BOTH a ruleset
   merge-method restriction and a required CI check (chosen).** See Decision.
   - _Pro:_ two independent mechanical layers, both pre-merge; feature PRs keep squash untouched.
   - _Pro:_ it **removes the back-merge from the process** rather than making it safer.
   - _Con (accepted, filed):_ an admin can still bypass `protect-main`; and a `hotfix/*` landing on `main`
     still requires one deliberate back-merge before the next promotion.

2. **Fast-forward promotion (`git push origin develop:main`).** _Rejected on policy, not on capability._
   The first draft rejected it as mechanically impossible; the review showed that is false — `protect-main`
   already grants the operating account `bypass_mode: always`, so the push would succeed today. It is
   rejected because:
   - `.agents/rules/git-branch.md` prohibits direct pushes to `main`, and promotion is a release-level
     action the **user** performs; a bypassing push makes the agent the one who ships to production.
   - It forfeits the only place `release-grade verification` and CodeQL run against the promotion.
   - Its premise — "nothing ever lands directly on `main`" — is refuted by the history above (nine
     Dependabot PRs **and** #1216). One such landing makes `main` un-fast-forwardable and demands exactly
     the hand-derived merge this item exists to remove.
   - It is nevertheless the stronger end state. Filed as **INFRA-053** with the concrete shape the review
     supplied: a `workflow_dispatch` job that asserts the ancestry, runs `harness:verify:release` **on the
     exact SHA being promoted**, then fast-forwards — one CI run, not two. It requires this item's
     invariant first, so the sequencing is right.

3. **Single trunk.** _Rejected — blast radius far exceeds the defect._ `main` is a tag trigger, a deploy
   boundary, and a distinct protection surface with a release-grade verification job that exists only for
   `base_ref == 'main'`. Collapsing the split to avoid a per-cycle merge conflict trades a contained
   process defect for an uncontained release one.

4. **Disable squash merging repository-wide** (`allow_squash_merge: false`). _Rejected —_ repository-wide,
   so it also strips squash from every feature PR, which this repo deliberately uses. The correct lever is
   the **per-branch** `allowed_merge_methods` on `protect-main` only (Decision), which the first draft
   wrongly believed did not exist.

5. **A rule in `git-branch.md` saying "use a merge commit here."** _Rejected —_ prose without a mechanism.
   The merge method is a per-merge human choice and the default is squash; this is exactly the failure this
   harness has recorded repeatedly.

### Decision

**Adopt an ancestry invariant on every promotion, enforce it with two independent pre-merge mechanisms, and
replace the hand-derived back-merge with a deterministic, conflict-free promotion-branch construction.**

**The invariant, three assertions, all evaluated on `github.event.pull_request.head.sha`:**

- **A1 — the promotion carries `main`'s ancestry.** `git merge-base --is-ancestor origin/main <head>`.
  Exactly the property a squashed back-merge destroys; the measured red. When it holds, the promotion merge
  introduces **zero content** onto `main`, so the next merge base is `develop`'s own tip.
- **A2 — the promotion adds no non-merge commit `develop` has never seen**, past a frozen adoption
  baseline. `git rev-list <head> ^origin/develop ^<BASELINE> --no-merges` must be empty. Catches a
  _previous_ promotion that was squashed: its squash commit is a non-merge commit on `main`, off `develop`.
- **A3 — the promotion promotes `develop`'s tree, unchanged.**
  `git diff --name-only $(git merge-base origin/develop <head>) <head>` must be empty. This is the review's
  addition and it closes a real hole: `--no-merges` **cannot by construction** see content introduced by a
  merge commit, so an evil merge (a conflict-resolving promotion), a `hotfix/*` landing, or a direct push
  would pass A1+A2 while leaving the branches diverged. A3 also converts "the merge of `main` is clean by
  construction" from an assumption into an assertion.

**The frozen baseline is load-bearing, and the first draft was wrong without it.** A2 phrased against
`origin/main` with no baseline is **unsatisfiable**: the review proved it by simulation and against the live
repo — #1427 _did_ use real merge commits, and `git rev-list origin/develop..origin/main --no-merges` is
**still 10**, because this design deliberately removes the `main -> develop` back-merge, so nothing ever
propagates those ten commits into `develop`'s ancestry. Installing that version would have red-blocked
every promotion forever. The baseline is `origin/main` at adoption (`a1a6bb830`), a one-time amnesty for ten
commits that cannot be recovered without rewriting `main` (forbidden by `non_fast_forward`), whose
**content** is already on `develop` and whose **tree** is already identical. It is anti-rot: the gate fails
hard if the baseline commit is unreachable, so a truncated or moved baseline cannot silently widen the
amnesty.

**PR-head resolution is load-bearing too.** On a `pull_request` event `HEAD` is GitHub's synthetic
`refs/pull/N/merge`, whose **first parent is the base branch** — `merge-base --is-ancestor origin/main HEAD`
is **vacuously true** there, and A1/A3 would pass on the very state they exist to reject. The scan refuses
to evaluate `HEAD` under `GITHUB_EVENT_NAME=pull_request` rather than passing. `ci.yml`'s commitlint job
documents the same trap for the same reason.

**The construction that removes the manual work** — `scripts/harness/promote.mjs`, not a human:

```bash
git checkout -B release/promote-develop-to-main origin/develop
git merge --no-ff origin/main      # records main's ancestry INTO the promotion
```

Clean by construction in the steady state: `merge-base(develop, main)` is the develop commit the last
promotion promoted and `main`'s tree equals that commit's tree, so `main`'s side of the three-way merge is
**empty**. Verified against the live repository — `git merge-tree --write-tree origin/develop origin/main`
exits 0 and yields a tree byte-identical to `origin/develop^{tree}`. There is nothing to resolve. **The
separate `main -> develop` back-merge PR is deleted from the process, not made safer.**

`promote.mjs` runs that merge as a pure object operation _first_, so a drifted `main` is reported before any
branch is created, with the correct remedy (back-merge on its own PR, merged as a merge commit) rather than
an invitation to resolve inside the promotion.

### Enforcement — gate or detector, stated plainly

Both layers are **GATES**: they block before the merge, not after.

| Layer            | Mechanism                                                                                         | Blocks                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Merge **method** | `protect-main` ruleset, `pull_request` rule, `allowed_merge_methods: ["merge"]` — **applied**     | GitHub refuses to squash- or rebase-merge any PR into `main`. `protect-develop` untouched, so feature PRs still squash. |
| Merge **input**  | `promotion ancestry` job in `ci.yml`, registered as a **required status check** on `protect-main` | A promotion head that fails A1, A2, or A3.                                                                              |

The first draft conceded that the promotion's own merge method could only be a "blocking detector one cycle
later", because GitHub was believed to have no per-branch merge-method control. The proposal review refuted
that; applying `allowed_merge_methods` was verified against the live ruleset. **There is no detector-only
residue in the merge-method dimension.**

Remaining bypass, recorded honestly: `protect-main.bypass_actors` still lists `RepositoryRole 5` with
`bypass_mode: always`, so a repository admin can override both layers. Narrowing that list is a separate
owner decision (**INFRA-054**).

### Test Strategy

Both suites build **real** throwaway git repositories — the property under test is a property of the commit
graph, so a mocked git would only test the mock. 20 tests total.

`scan-promotion-ancestry.test.mjs` (13): the squashed back-merge red (A1), the prescribed construction
green, a 3-cycle steady-state green, the squashed-previous-promotion red (A2), the evil-merge red with A2's
blindness demonstrated in the same assertion (A3), **the amnesty cutting in exactly one direction**
(pre-baseline debt absolved, post-baseline debt still reported), **fail-closed on a git error backing
A2/A3**, baseline-unreachable and missing-ref hard failures, and the `refs/pull/N/merge` refusal.

`promote.test.mjs` (7): dirty-tree refusal, nothing-to-promote, `--dry-run` creating no branch, the ready
branch (asserting `main` is an ancestor and the tree equals develop's), a conflicting `main`, a
**non-conflicting** `main` that still drags content across (the case a conflict check alone waves through),
and a git error not being misreported as a conflict.

**Mutation-verified.** The code-review pass mutation-tested the first suite and found the amnesty exclusion
was _not_ red-proof — deleting `^${baseline}` left all 11 tests green. The fixture above was added and the
same mutation now fails it. A1, A2 and A3 were each independently confirmed red-proof by the same method.

### Code-review round (a second gate after the proposal gate)

`pr-review-reviewer` on #1438 returned 5 actionable findings; all were fixed in the same PR.

1. **MUST — the gate broke `release-grade verification` on every promotion PR.** Registering the scan in
   `run-all-scans` makes it fire inside `pnpm harness:verify:release`, where the runner sets
   `GITHUB_BASE_REF=main` and `GITHUB_EVENT_NAME=pull_request` but **not** the PR head sha — so the
   `refs/pull/N/merge` refusal (correctly) fired and the 7.5-minute job went red even on a correctly built
   promotion. Fixed by supplying `PR_HEAD_SHA` to that job. Deliberately **not** fixed by making the gate
   skip when it cannot resolve a head: that is INFRA-050's silently-skipped-but-green shape.
2. **A2 and A3 failed open.** `runGit` maps any git failure to `{ code: 1, stdout: '' }`, and empty stdout
   is exactly what "assertion satisfied" looks like — a broken git (e.g. `--no-commit-header` on git < 2.33)
   would have printed "passed — A1/A2/A3 hold" having asserted nothing. Both now fail closed, with a test.
3. **The amnesty was untested in the widening direction.** Beyond the new fixture, `ADOPTION_BASELINE_DEBT`
   now pins how many commits the amnesty may cover, so advancing the baseline to bury fresh debt is red.
4. **`promote.mjs` left a half-built branch** on a post-`checkout -B` failure. It now aborts the merge,
   restores the previous branch, deletes the branch it created, and says so.
5. **`promote.mjs` was untestable by construction** — `git` was hard-bound to the workspace root. `main()`
   now takes `cwd`/`out`/`fetch` seams and returns an exit code, and has the 7 tests above.

Also fixed: `merge-tree` exit 1 (conflict) is no longer conflated with any other non-zero (git error) —
the remedies differ; the CI job pins Node 22.x like its siblings; and the job comment no longer claims to be
the only substantive check on a main PR.

## Scope

**In:** `scripts/harness/scan-promotion-ancestry.mjs`, `scripts/harness/promote.mjs`, the test suite,
`run-all-scans.mjs` registration, `scan-ci-base-history.mjs`'s `BASE_HISTORY_INVOCATIONS` entry (so
INFRA-050's floor covers the new indirect base-history read), the `promotion ancestry` job in
`.github/workflows/ci.yml`, the `protect-main` ruleset, `.agents/rules/git-branch.md`, and the stale
`-s ours` comment in `.claude/hooks/pre-push-check.sh`.

**Out:** fast-forward promotion (INFRA-053), narrowing `protect-main`'s bypass actors and making
`release-grade verification` a required context (INFRA-054), re-enabling Dependabot.

## Residual manual work (filed, not hidden)

1. **A `hotfix/*` that lands content on `main`** still requires one deliberate `main -> develop` back-merge,
   merged as a merge commit, before the next promotion. A3 blocks the promotion until that happens, with the
   remedy in the failure message — but `protect-develop` cannot restrict the _method_ of that back-merge
   without also stripping squash from every feature PR. Routing hotfixes through `develop` first is the
   documented process; making it mechanical is INFRA-053 scope.
2. **A repository admin can bypass `protect-main`** and therefore both gates. → INFRA-054.
