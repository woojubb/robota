---
status: done
type: RULE
tags: [harness]
---

# PROC-012: verify a merged branch by its pull request merge commit

Paired with
`.agents/tasks/PROC-012-verify-a-merged-branch-by-its-pull-request-merge-commit-not-by-branch-ancestry.md`.
Converted from [issue #2135](https://github.com/woojubb/robota/issues/2135).

## Problem

`git-branch.md` § "Delete Merged Branches" mandates that a merged branch not be left standing, then
requires `git merge-base --is-ancestor origin/<branch> origin/main` before deleting it. This
repository squash-merges, so a merged branch's own commits are ancestors of nothing on the target and
that check fails for every one of them. The rule's two halves are each correct and jointly
unsatisfiable.

The same wrong question appears a second time in `.claude/hooks/branch-guard.sh`, which blocks branch
creation while a local branch looks unmerged. That path already knew about squash merges — it matched
candidates against `gh pr list --state merged --limit 500` — but the list is saturated at 500 in this
repository, so merged pull requests older than the window fall out and their branches are reported
unmerged. The hook printed a NOTE saying the list came back full and blocked anyway.

Both sites ask whether the BRANCH's commits are reachable on the target. The property they need is
whether the branch's PULL REQUEST landed there.

## Prior Art Research

Waived: the correct check is stated in full in the source issue, and it is a two-command composition
over `gh` and `git` with no external product analog to survey. The waiver is recorded rather than the
section left empty, per [research.md](../../rules/research.md).

The one external fact the design rests on is verified rather than assumed: GitHub's pull-request
object exposes `mergeCommit.oid` for a squash merge, and it is the commit written on the base branch.
Confirmed against this repository's own merged pull requests — see the Evidence Log.

## Architecture Review

**Alternatives considered.**

1. **Ancestry of the merged head (`headRefOid`) against the target.** Rejected: that is the same
   question in different clothing. A squash discards the head commit, so it is on the target under no
   merge method that squashes.
2. **"A merged pull request exists for this branch" alone.** Rejected on measurement, not taste. Four
   branches on `origin` carry a merged pull request whose base was a feature branch that has since
   been deleted, so their work is on neither `develop` nor `main`. This alternative clears all four
   for deletion and the work is unrecoverable afterwards. This is the rebuttal that decided the
   design.
3. **Ancestry of the pull request's merge commit against the named target.** Chosen. It answers the
   question the original check was reaching for, under both merge methods, and it keeps the guard's
   real value: no merged pull request, or a merge commit absent from the target, still refuses.

**Reachability.** Both consumers of the check — the rule's prose procedure and the hook's creation
guard — can run it: `gh` and `git` are already required by both, and the hook already routes `gh`
through its bounded helper.

**Capability preservation.** The replaced check protected two things, and both survive. Unmerged work
still blocks (no merged pull request → refused). Branch-name reuse still blocks: the decision requires
the local branch to still point at the exact commit the pull request merged, so stacking new work on a
merged name is not cleared. Both are covered by fixtures rather than asserted.

**Blast radius.** The hook trades one global query for one query per branch that is actually ahead of
the integration ref. That count is small by construction — the rule this very change unblocks is the
one that deletes the others — and the per-branch form removes the saturation window entirely.

## Completion Criteria

- **TC-01** The rule's verification step tests the pull request's merge commit against a named target,
  and states that both halves are required.
- **TC-02** The rule text carries no case narrative: the measurement lives in the paired Task, reached
  by a resolving link (`rule-case-narrative` green).
- **TC-03** The hook clears a squash-merged branch whose merge commit is on the integration ref.
- **TC-04** The hook refuses a branch whose pull request merged somewhere other than the integration
  ref.
- **TC-05** The hook refuses a merged branch name carrying new commits, and refuses when no merged
  pull request exists.
- **TC-06** A failed or stalled query still refuses, names the by-hand verification, and stays bounded.
- **TC-07** `pnpm harness:scan` green; the branch-guard suites green.

## Test Plan

`scripts/harness/__tests__/branch-guard-unmerged.test.mjs` — one fixture per TC-03…TC-06, with `gh`
stubbed per-branch so the assertions are about the DECISION rather than about a transcript. The
scratch repository advances `develop` by a commit to stand in for the squash, so merge-commit
ancestry is a real git question in the fixture and not a mocked boolean.

## Evidence Log

| Claim                                                            | Verified at                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The rule's current check fails for every squash-merged branch    | 14 of 14 non-default `origin` branches FAIL `--is-ancestor`, including all 8 fully merged into `develop` — table in the paired Task                                                                                                                                                                                                |
| A merged PR's `mergeCommit.oid` is the commit on the base branch | `gh pr list --state merged --head <branch> --json mergeCommit` over PRs #2133, #2141–#2147, #2150; each oid is an ancestor of `origin/develop`                                                                                                                                                                                     |
| "Merged PR exists" alone is insufficient                         | PRs #1723–#1726 merged into `feat/arch-dag-runtime-completion`, which no longer exists on `origin`; their merge commits are ancestors of neither `origin/develop` nor `origin/main`                                                                                                                                                |
| The hook's 500-item window is saturated, not theoretical         | The hook's own `MERGED_TRUNCATED` NOTE fired in this clone, and the four branches it named were merged as PRs #2143, #2147, #2133, #2144                                                                                                                                                                                           |
| The defect blocks live work, not just cleanup                    | Branch creation refused in two of four active clones within ten minutes; one `BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1` override resulted                                                                                                                                                                                                |
| `-d` is not a fallback guard                                     | `git branch -d` applies the same ancestry test; all four stale local branches here required `-D`                                                                                                                                                                                                                                   |
| GATE-APPROVAL                                                    | The repository owner, in the current conversation, was shown the measured block and asked whether to pull issue #2135 forward; they selected "지금 큐 앞으로 당김" (pull it forward now). This is a direct instruction naming this issue, not a standing delegation, so the delegated-class question does not arise for this item. |
| The rule change is a policy-file edit                            | Disclosed to the owner in the same exchange: `backlog-execution.md` reserves repository-wide policy files, and the owner's instruction to prioritize this issue is what authorizes it. Scope is limited to the one section and the one hook path.                                                                                  |

## Non-goals

Deleting the branches this unblocks. A bulk remote deletion is irreversible and outward-facing; the
rule already permits a branch to stay with a recorded reason, so the sweep asks its holder. The four
`feat/arch-dag-runtime-completion` branches need a disposition decision this change surfaces rather
than makes.

## User Execution Test Scenarios

**Not applicable.** This change delivers rule text and a repository hook, not runnable user-facing
product behavior — no CLI command, TUI action, browser flow, or public SDK surface changes. Per
`.agents/tasks/README.md`, a documentation/rule-only change must record the not-applicable with its
reason rather than invent a product scenario, and the developer-workflow observable it does change
(a branch creation that no longer needs an override) belongs in the Test Plan, where it is recorded
with its evidence.
