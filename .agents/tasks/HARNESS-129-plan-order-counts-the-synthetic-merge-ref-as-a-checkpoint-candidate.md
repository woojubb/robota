---
title: "HARNESS-129: plan-order counts the pull request's synthetic merge commit as a planning-checkpoint candidate, so a PR whose spec is in-progress cannot pass its own required check"
issue: https://github.com/woojubb/robota/issues/2373
status: todo
created: 2026-08-28
priority: high
urgency: now
area: scripts/harness
depends_on: []
---

# HARNESS-129: plan-order counts the synthetic merge ref as a checkpoint candidate

## Problem

`scripts/harness/scan-user-execution-plan-order.mjs` enumerates the topic commits it judges with
`git rev-list --reverse --topo-order <base>..HEAD`. On a `pull_request` event CI checks out
`refs/pull/N/merge` — GitHub's synthetic merge of the PR head into the base — so that list ends
with a merge commit whose first parent is the base tip. The scan resolves every commit's parent as
`commit^` and diffs against it, so the merge commit's "diff" is the entire branch: it contains the
planning checkpoint's Task/spec transition and is recognised as a second checkpoint candidate. The
scan refuses for ambiguity, and the required `scans` check goes red for a branch that passes the
same scan locally.

## Evidence

Measured 2026-08-28 on `origin/develop` `58c7ca4b9`, PR #2409 (branch head `cc1e30962`, spec
`in-progress` because RULE-016 is delivered as two sequenced PRs):

```
CI  scans job  → scan-user-execution-plan-order.test.mjs > repository contract > passes on this branch
                 AssertionError: expected [ { commit: null, …(1) } ] to deeply equal []
local, branch HEAD, base origin/develop            ::examined:: 8 topic commit(s)   PASS
lab worktree: git merge --no-ff <branch> onto origin/develop, then the scan:
                 ✗ multiple planning checkpoint candidates exist (1c41f82d6, 72d0c93c4)   examined 9
                 (1c41f82d6 = the branch's checkpoint; 72d0c93c4 = the synthetic merge)
same tree, rev-list with --no-merges                 findings []   examined 8
```

Issue #2373's first comment recorded the same shape on PR #2372 (`cc5f40213` the checkpoint,
`c6163520b` = `refs/pull/2372/merge`); its first six worktree runs did not reproduce it because the
main checkout's scan copy analyses its own `WORKSPACE_ROOT` (issue #2413), and its later comments did
reproduce it with `commit-tree`. The promotion path has the same shape: a synthetic `develop → main`
merge under the release-grade job's env → examined 61, 31 findings (60 promotion merges, each
attributed a whole promotion's diff); `--no-merges` → examined 0.

Earlier PRs (PR #2396, PR #2402) did not hit it because their archival commit moved the spec to
`done` before the PR opened, so the merge commit's diff no longer matched the `todo → active`
checkpoint shape. Any PR opened while its spec is `in-progress` — the two-PR delivery RULE-016 needs
— hits it deterministically, and every promotion PR will.

## Reproduction condition

Any branch carrying a planning checkpoint, evaluated at a merge commit whose first parent is the
base (CI's `refs/pull/N/merge`; a local `--no-ff` merge), while the checkpoint's `todo → active`
transition is still visible in the merge's diff against the base; any promotion merge under the
release-grade job.

## Depth

`finding-depth-triager` (2026-08-28): **LOCAL** — the scan attributes content by a single-parent
diff, undefined for a merge; excluding merges (`--no-merges`) is exact in both measured shapes (PR
9 → 8; promotion 61 → 0) and also fixes two false refusals on the branch tip. **FOUNDATIONAL**,
sibling not root — which commit a `pull_request`-event history scan evaluates has no owner (issue #2412); this item is correct on its own and lands first. **INVALID** — the issue's title clause
(base dependence, `675cd814e` faulting its own gate): no harness invocation hands the scan such a
base (issue #2411, filed and closed with the measurement). **UNDETERMINED** — a scan run against
another checkout reads its own and names no root (issue #2413). The residual the flag leaves — a
merge's OWN content is judged by nothing, and the staged path refuses honest back-merges — is
**HARNESS-130** (issue #2410); the flag's line carries `Contained — HARNESS-130.`

## Test Plan

- PR-shape fixture: a valid branch merged `--no-ff` onto the base, evaluated at the merge — red
  before the fix (`multiple planning checkpoint candidates`), green after, with the invariance
  (findings and examined count at the merge equal those at the tip).
- Promotion-shape fixture: a `main` of `--no-ff` promotion merges with develop merged in, base =
  develop tip — red before, examined 0 and no findings after.
- Controls: the branch at its tip passes; two real checkpoints still refused; a back-merge of an
  advanced base carrying an implementation path before the checkpoint accepted (a false refusal
  today).
- The live reproduction re-run FROM a worktree (not the main checkout's copy): the scan at a
  `--no-ff` merge of PR #2409 → no findings, HEAD and both parents recorded.
- Applied-check mutation: removing `--no-merges` makes the two merge cases and the back-merge
  control red, nothing else.
- `pnpm harness:scan` exit 0.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. One enumeration flag in a repository verification
scan and its fixture; no product surface changes. The verification surface is the fixture and the
mutation.

## Bound spec document

`.agents/spec-docs/todo/HARNESS-129-plan-order-counts-the-synthetic-merge-ref-as-a-checkpoint-candidate.md`
