---
title: 'PROC-012: verify a merged branch by its pull request merge commit, not by branch ancestry'
issue: https://github.com/woojubb/robota/issues/2135
status: done
created: 2026-08-23
completed: 2026-08-23
priority: high
urgency: now
area: .agents/rules/git-branch.md, .claude/hooks/branch-guard.sh
depends_on: []
---

# PROC-012: verify a merged branch by its pull request merge commit, not by branch ancestry

## Problem

`.agents/rules/git-branch.md` § "Delete Merged Branches (mandatory)" mandates that a merged branch
must not be left standing, and then requires this before deleting it:

> `git merge-base --is-ancestor origin/<branch> origin/main` (or `origin/develop` for non-release
> merges) must succeed. If it does not, the branch carries commits the target does not have — **do
> not delete it; surface it**.

This repository squash-merges. A squash merge writes a NEW commit on the target; the branch's own
commits become ancestors of nothing on that target. So the verification step fails for every
squash-merged branch, and an agent following the rule honestly reaches "do not delete it; surface
it" every time — for branches that are genuinely, fully merged.

The rule's two halves are each correct and jointly unsatisfiable. They became incompatible when the
merge method changed, and the ancestry check encodes a contingent fact — _we merge with merge
commits_ — as if it were a property of merged branches.

## Evidence

Measured 2026-08-23 in `/home/ubunutu/dev/robota` against `origin`, one row per non-default remote
branch. `anc(dev)`/`anc(main)` are the rule's current check; `mc(dev)`/`mc(main)` are the proposed
merge-commit check.

| remote branch                               | anc(dev) | anc(main) | merged PR → base                              | mc(dev) | mc(main) |
| ------------------------------------------- | -------- | --------- | --------------------------------------------- | ------- | -------- |
| `chore/complete-infra-129-records`          | FAIL     | FAIL      | PR #2143 → develop                            | PASS    | FAIL     |
| `docs/cli-082-output-styles-research`       | FAIL     | FAIL      | PR #2142 → develop                            | PASS    | FAIL     |
| `docs/register-security-foundations`        | FAIL     | FAIL      | PR #2141 → develop                            | PASS    | FAIL     |
| `feat/architecture-audit-refresh`           | FAIL     | FAIL      | PR #2150 → develop                            | PASS    | FAIL     |
| `fix/dependency-review-license-exemptions`  | FAIL     | FAIL      | PR #2147 → develop                            | PASS    | FAIL     |
| `fix/infra-126-burn-down`                   | FAIL     | FAIL      | PR #2146 → develop                            | PASS    | FAIL     |
| `fix/work-item-id-allocator`                | FAIL     | FAIL      | PR #2133 → develop                            | PASS    | FAIL     |
| `task/dependency-review-license-exemptions` | FAIL     | FAIL      | PR #2144 → develop                            | PASS    | FAIL     |
| `feat/arch-012-session-capabilities`        | FAIL     | FAIL      | PR #1724 → `feat/arch-dag-runtime-completion` | FAIL    | FAIL     |
| `feat/arch-019-honest-session-double`       | FAIL     | FAIL      | PR #1723 → `feat/arch-dag-runtime-completion` | FAIL    | FAIL     |
| `fix/infra-099-completion-archive`          | FAIL     | FAIL      | PR #1726 → `feat/arch-dag-runtime-completion` | FAIL    | FAIL     |
| `fix/infra-099-stage-verification-receipts` | FAIL     | FAIL      | PR #1725 → `feat/arch-dag-runtime-completion` | FAIL    | FAIL     |
| `fix/glob-import-spellings`                 | FAIL     | FAIL      | none                                          | —       | —        |
| `spec/arch-042-project-authority`           | FAIL     | FAIL      | none (PR #2160 OPEN)                          | —       | —        |

Three groups, and the proposed check separates them where the current one cannot:

1. **Eight genuinely merged into `develop`.** The current check refuses deletion for all eight; the
   merge-commit check clears all eight. Ancestry-of-branch passes for **0 of 14** branches — a 100%
   false-negative rate over the set it is supposed to clear.
2. **Four merged into a FEATURE branch** (`feat/arch-dag-runtime-completion`, PRs #1723–#1726) that
   no longer exists on `origin`. Their work is on neither `develop` nor `main`. This is the genuine
   "surface it, do not delete" case, and the merge-commit check still refuses them — the guard keeps
   its real value. `gh pr list --state merged --head <branch>` alone would have cleared these four,
   so the base of the merged PR is not sufficient on its own; the merge commit must be tested for
   ancestry on the actual target.
3. **Two with no merged pull request**, one of which has an OPEN PR. Both correctly retained under
   either check.

`main` trails `develop` by 50 commits, so a merge commit on `develop` is on `main` for none of these
rows. The target the check names is therefore load-bearing, not incidental.

### The same wrong question in the branch-creation guard

`.claude/hooks/branch-guard.sh` blocks new branch creation when a local branch has commits not on the
integration branch. It already knows about squash merges and matches candidates against a merged-PR
list — but it fetches that list as `gh pr list --state merged --limit 500` over ALL merged PRs and
matches by `headRefName + headRefOid`. The list is saturated: it returns a full 500, so merged PRs
older than the window fall out and their branches are reported as unmerged. The hook prints a NOTE
saying the list came back full and blocks anyway.

Measured 2026-08-23: this blocked branch creation in two of four active clones within ten minutes.
In this clone all four reported branches (`chore/complete-infra-129-records`,
`fix/dependency-review-license-exemptions`, `fix/work-item-id-allocator`,
`task/dependency-review-license-exemptions`) were fully merged via PRs #2143, #2147, #2133, #2144. In
another clone it produced a `BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1` override on a branch whose work had
already landed as PR #2146.

This is the same cause, not a second one: both sites ask whether the BRANCH's commits are reachable
on the target, when the property they need is whether the branch's PULL REQUEST landed there. The
per-branch query the rule change adopts (`--head <branch>`) also removes the 500-item window,
because it never enumerates the global list.

## Non-goals

- Deleting the remote branches this unblocks. The rule already allows a branch to stay with a
  recorded reason, so the sweep asks its holder rather than assumes; a bulk remote deletion is an
  irreversible outward-facing action and is not authorized by this Task.
- Branch attribution. Issue #2135 notes that 28 of the branches it measured carry no
  `Claude-Session` trailer and cannot be attributed. That is a separate observation.
- The four `feat/arch-dag-runtime-completion` branches. They need a disposition decision from their
  holder, which this Task surfaces rather than makes.

## Plan

- [x] Rewrite `git-branch.md` § "Delete Merged Branches" verification to test the merge commit of the
      branch's merged pull request for ancestry on the stated target, under both merge methods.
- [x] State the retained refusal explicitly: no merged PR, or a merge commit absent from the target,
      still means surface it and do not delete.
- [x] Replace the branch-guard creation check's global 500-item merged-PR list with the per-branch
      merge-commit query, so the window cannot saturate.
- [x] Add a regression fixture covering all three groups above.

## Test Plan

- Hook fixture: a merged-and-squashed branch is cleared; a branch merged into a third branch that is
  not the target is refused; a branch with no merged PR is refused; a branch whose name matches a
  merged PR but whose HEAD has moved on is refused (the name-reuse case the delete guard already
  documents).
- `pnpm harness:scan` green, including `hook-override-declarations` and `conflict-markers`.
- Re-run the measurement table above and confirm the three groups separate as predicted.
- Confirm branch creation succeeds in a clone holding a squash-merged local branch WITHOUT an
  override, which is the observable that made this Task urgent.

## User Execution Test Scenarios

Not applicable — rule text and a repository hook, delivering no runnable user-facing product
behavior. The observable is a developer-workflow check and is covered in the Test Plan, per
`.agents/tasks/README.md` (documentation/rule-only changes must not invent a product scenario).

## Verification Evidence

Recorded after implementation, per `.agents/tasks/README.md`.

- `npx vitest run scripts/harness/__tests__/branch-guard-*.test.mjs` → **113 passed, 5 files**,
  including the six new/rewritten decision fixtures in `branch-guard-unmerged.test.mjs`.
- The rewritten suite fails against the pre-change hook: the per-branch stub answers a query the old
  code never makes, so a stale implementation reads an unanswered world rather than silently agreeing.
- `pnpm harness:scan` green, including `rule-case-narrative` (the amendment carries no case narrative —
  the measurement lives here and is reached from the rule by a resolving link) and
  `reference-kind-qualified` (every `#NNNN` above says which kind it is).
- The block that motivated this Task is gone in practice: after deleting the four verified-merged
  stale local branches, `git checkout -b fix/proc-012-…` succeeded with **no override**. The four had
  landed as PRs #2143, #2147, #2133 and #2144, and `git branch -d` refused all four — `-D` plus the
  merge-commit verification is what cleared them.

## Follow-ups filed rather than absorbed

- The 14 remote branches are left standing. Eight are safely deletable under the new check; four
  (PRs #1723–#1726, merged into the since-deleted `feat/arch-dag-runtime-completion`) need a
  disposition decision from their holder; two have no merged pull request, one of them with an open
  pull request. The sweep asks rather than assumes, per the rule's own judgement conditions.
