---
status: draft
type: INFRA
tags: [typescript]
---

# INFRA-051: Keep `main`'s ancestry inside `develop` so promotions never re-conflict

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

**Reproduction condition:** `git merge-base --is-ancestor origin/main origin/develop` exits non-zero while
`main` carries non-merge commits whose content `develop` only has as a squash copy.

## Architecture Review

### Measured facts (these constrain the choice — none of them is assumed)

| Fact                                                                                                                                                         | Evidence                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Things **have** landed directly on `main`, not only via `develop`                                                                                            | 12 Dependabot PRs (#1316–#1328) are non-merge commits reachable from `origin/main` and absent from `origin/develop`'s ancestry. They are precisely the content `bc0ee64ff` had to squash-copy.                         |
| Dependabot is off **today**, but by policy, not by mechanism                                                                                                 | `.github/dependabot.yml` deleted; `.github/DEPENDABOT-DISABLED.md` records #1412. Re-enabling it re-opens the same hole.                                                                                               |
| `hotfix/*` may still target `main` directly                                                                                                                  | `main-pr-source-guard` in `.github/workflows/ci.yml` admits `develop`, `release/*`, `hotfix/*`.                                                                                                                        |
| Release automation does **not** push commits to `main`                                                                                                       | `release-tag-on-version-bump.yml` triggers `on: push: branches: [main]` and pushes only a `v<version>` **tag**.                                                                                                        |
| `main` is a real release boundary                                                                                                                            | Cloudflare Pages deploys on `main`; `protect-main` carries its own required-check set; `release-grade-verify` runs only for `base_ref == 'main'`.                                                                      |
| CI runs **only** `on: pull_request`                                                                                                                          | `.github/workflows/ci.yml`. No workflow runs on push to `develop`, so a `develop` tip SHA carries **no** check runs.                                                                                                   |
| `protect-main` = `required_status_checks` (build, quality, scans, security audit, commitlint) + `non_fast_forward`; bypass only for RepositoryRole 5 (admin) | `gh api repos/woojubb/robota/rulesets/18715845`                                                                                                                                                                        |
| GitHub offers **no** per-branch merge-method rule                                                                                                            | Repo-level `allow_squash_merge` / `allow_merge_commit` / `allow_rebase_merge` are all `true` and are repository-wide. Rulesets expose `required_status_checks` and `non_fast_forward` only.                            |
| For a `base_ref == 'main'` PR the required contexts `build`, `quality`, `scans` are **no-op echoes**                                                         | `.github/workflows/ci.yml` — each begins with a "Skip duplicate … for main PR" step and every subsequent step is `if: github.base_ref != 'main'`. `commitlint` is skipped wholesale (`if: github.base_ref != 'main'`). |
| `release/*` and `hotfix/*` are already exempt from the "no merge commits in range" push block                                                                | `.claude/hooks/pre-push-check.sh` §0                                                                                                                                                                                   |
| `main`'s tree is **already** identical to the develop commit #1427 promoted                                                                                  | `git rev-parse origin/main^{tree} 21fe31d4d^{tree}` — both `cb874373…`. So `main` holds no content `develop` lacks; only the _graph_ is broken.                                                                        |

### Alternatives Considered

1. **Merge-commit the sync merges, expressed as an ancestry invariant and gated pre-merge on the
   promotion PR (chosen).** Keep squash for feature PRs. Require every PR into `main` to already contain
   `origin/main` in its ancestry, and require `origin/main` to carry no non-merge commit that
   `origin/develop`'s ancestry lacks. Both are computable from refs alone, on the PR, before it merges.
   - _Pro:_ it is a real pre-merge block, riding an already-required status context, needing no ruleset
     or repo-settings change and no new bypass actor.
   - _Pro:_ it makes the recurring **back-merge disappear** rather than making it safer — see Decision.
   - _Con (accepted, stated in Decision):_ it cannot force the _merge method used to land the promotion
     PR itself_. A squashed promotion is caught at the **next** promotion, as a hard block, not prevented.

2. **Fast-forward promotion (`git push origin develop:main`).** _Rejected — not reachable from the current
   configuration, and its premise is false today._
   - Its premise is "nothing ever lands directly on `main`." The history refutes that: #1316–#1328 landed
     on `main` directly, and `main-pr-source-guard` still admits `hotfix/*` → `main`. Under FF promotion a
     single such landing makes `main` un-fast-forwardable and requires exactly the hand-derived merge this
     item exists to remove.
   - Mechanically it needs a push to `main` that satisfies `protect-main`. CI runs only on
     `pull_request`, so the `develop` tip SHA has **no** check runs and `required_status_checks` blocks
     the push. Making it work needs _either_ an owner-provisioned bypass actor / deploy key (production
     pushed with checks bypassed) _or_ duplicating the full required matrix `on: push: [develop]` (double
     CI cost on every merge). Neither is inside this item's blast radius.
   - GitHub's PR merge API has no fast-forward method, so it cannot be done through the PR that carries
     the checks. It is the better _end state_; filed as INFRA-052 rather than faked here.

3. **Single trunk.** _Rejected — blast radius far exceeds the defect._ `main` is a deploy trigger
   (Cloudflare Pages), a tag trigger (`release-tag-on-version-bump.yml`), and a distinct protection
   surface with a release-grade verification job that exists only for `base_ref == 'main'`. Collapsing the
   split to avoid a per-cycle merge conflict trades a contained process defect for an uncontained release
   one.

4. **Disable squash merging repository-wide.** _Rejected —_ it is the only _repo setting_ that could force
   merge commits, but it is repository-wide: it would also strip squash from every feature PR, which this
   repo deliberately uses (`.agents/rules/git-branch.md`, PR-batching = one multi-commit PR squashed to one
   `develop` commit). Fixing a two-merges-per-cycle problem by changing the method of every merge is the
   wrong lever.

5. **A rule in `git-branch.md` saying "use a merge commit here."** _Rejected —_ prose without a mechanism.
   The merge method is a per-merge human choice and the default is squash; this is exactly the failure mode
   the harness has recorded repeatedly.

### Decision

**Adopt an ancestry invariant on `main`, enforce it as a pre-merge gate on every PR into `main`, and
replace the hand-derived back-merge with a deterministic, conflict-free promotion-branch construction.**

**The invariant (`PROMOTION-ANCESTRY`), two assertions:**

- **A1 — the promotion carries `main`'s ancestry.**
  `git merge-base --is-ancestor origin/main <PR head>` must succeed.
- **A2 — `main` holds no content `develop`'s ancestry lacks.**
  `git rev-list origin/develop..origin/main --no-merges` must be empty.

Why these two and not "merge commit, please":

- A1 is _exactly_ the property a squashed back-merge destroys. It is the measured red.
- When A1 holds, the promotion merge introduces **zero content** onto `main` — the merge commit's tree
  equals the promoted head's tree — so `main` can never again carry content `develop` lacks, so the next
  merge base is `develop`'s own tip and the next promotion has nothing to conflict on.
- A2 catches the residue A1 cannot see: a _previous_ promotion that was squashed leaves `main`'s tip as a
  non-merge commit outside `develop`'s ancestry. Non-merge is the right filter — a promotion merge commit
  carries no content of its own, an unreviewed direct landing does.

**The construction that removes the manual work.** The promotion branch is built by
`scripts/harness/promote.mjs`, not by hand:

```
git fetch origin
git checkout -B release/promote-develop-to-main origin/develop
git merge --no-ff origin/main      # records main's ancestry INTO the promotion
```

In the steady state this merge is **clean by construction and never asks a human anything**:
`merge-base(develop, main)` is the develop commit the last promotion promoted, and `main`'s tree equals
that commit's tree, so `main`'s side of the three-way merge has an **empty** delta. There is nothing to
resolve. That is the root-cause fix the recurring cost was paying for — the separate `main -> develop`
back-merge PR is **deleted from the process**, not made safer.

**One-time bootstrap.** `main` currently fails A2 (the 12 Dependabot commits). It is repaired once, by the
first promotion built with the command above: that `git merge --no-ff origin/main` records their ancestry
into the promotion branch, and merging that PR puts it on `main` — after which A2 is satisfied
permanently, because every later commit on `main` is either a promotion merge (excluded) or already in
`develop`. `main`'s **tree** is already correct (`cb874373…` on both sides), so the bootstrap merge changes
no content.

**Where the gate lives.** `scripts/harness/scan-promotion-ancestry.mjs`, registered in
`run-all-scans.mjs` and invoked from the **`scans`** job of `.github/workflows/ci.yml`.

- `scans` is a **required** status context on both `protect-main` and `protect-develop`, so the gate blocks
  the merge **without** any ruleset edit or new required-check registration.
- On a `base_ref == 'main'` PR today `scans` is a single `echo` — every other step is
  `if: github.base_ref != 'main'`. This gate is added to that branch of the job, so a promotion PR's
  `scans` context stops being vacuous and starts asserting the one thing only it can see.
- The scan is inert outside a promotion context (no `GITHUB_BASE_REF=main`, no explicit flag), so
  `pnpm harness:scan` on a feature branch is unaffected.

### Gate vs detector — stated plainly

- **Against a lost-ancestry back-merge (the measured defect): a GATE.** A1 is evaluated on the promotion
  PR _before_ it merges, on a required context. A promotion whose base lost `main`'s ancestry cannot land.
- **Against the promotion PR's own merge method: a blocking detector, one cycle later.** GitHub exposes no
  per-branch merge-method control, and a status check cannot observe a method chosen after the check ran.
  If someone squashes the promotion, A2 fails on the **next** promotion PR and hard-blocks it with a
  precise diagnostic and repair command, instead of surfacing as an unexplained six-file conflict. This is
  the honest ceiling of what is enforceable without a bypass actor; it is recorded, not papered over.

### Test Strategy

- `scripts/harness/__tests__/scan-promotion-ancestry.test.mjs` — builds real throwaway git repositories
  and asserts the scan is **RED** on the squashed-back-merge topology (the `bc0ee64ff` shape), **RED** on a
  squashed promotion (A2), and **GREEN** on the merge-commit topology.
- Red-first proof against the real repository: the scan run against the reconstructed pre-#1427 refs must
  fail, and against the post-fix promotion topology must pass.

## Scope

**In:** `scripts/harness/scan-promotion-ancestry.mjs`, `scripts/harness/promote.mjs`, their tests,
`run-all-scans.mjs` registration, the `scans` job in `.github/workflows/ci.yml`,
`.agents/rules/git-branch.md`.

**Out:** repository ruleset changes, merge-method repo settings, fast-forward promotion (INFRA-052),
re-enabling Dependabot.

## Residual manual work (explicitly filed, not hidden)

1. **The promotion PR's merge method** stays a human click (`gh pr merge <n> --merge`, never `--squash`).
   Enforced only by the next cycle's A2 block. → INFRA-052 covers the FF end-state that removes the choice.
2. **A `hotfix/*` branch cut from `main`** would land content on `main` outside `develop` and break A2. The
   gate blocks the _next promotion_ rather than the hotfix. The correct process (hotfix → `develop` →
   promote) is documented; making it mechanical is INFRA-052 scope.
