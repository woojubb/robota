---
title: "HARNESS-130: plan-order has no definition of a merge commit's own content, so an evil merge before the checkpoint is judged by nothing and the staged path refuses honest back-merges"
issue: https://github.com/woojubb/robota/issues/2410
status: skipped
created: 2026-08-28
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
completed: 2026-08-29
handoff: https://github.com/woojubb/robota/issues/2410
---

# HARNESS-130: plan-order has no definition of a merge commit's own content

## Terminal disposition

Skipped as a duplicate of canonical open issue #2410, which owns this plan-order merge-content scope.

## Problem

`scripts/harness/scan-user-execution-plan-order.mjs` attributes a commit's content by diffing it
against `commit^` (`historyAnalysis`, `changedPaths`), and its `--staged` path reads the index
against `HEAD`. Neither defines what a MERGE commit's own content is. A merge whose first parent
is the base diffs as the whole other side (HARNESS-129 excludes merges from the enumeration for that
reason); a merge that introduces content present in neither parent — a conflict resolution, a
`--no-commit` edit — is then judged by nothing on the history path, and on the staged path an honest
clean back-merge before the checkpoint is refused as implementation.

## Evidence

Measured on `develop` `58c7ca4b9` (2026-08-28) by `proposal-reviewer` while reviewing HARNESS-129,
with the test file's own fixture helpers against a scratch copy of the scan:

- Evil merge (adds `scripts/harness/evil.mjs`, in neither parent, before the checkpoint): unpatched
  scan refuses it only by accident (alongside a false positive on `README.md`); with `--no-merges`
  → `findings=0`.
- Staged path: an honest clean back-merge of the base before the checkpoint → "staged
  implementation has no planning checkpoint ancestor" (a clean `git merge` fires
  `pre-merge-commit`, which `.husky/` does not install; a conflicted merge finished by `git commit`
  hits pre-commit and is refused), so it refuses honest merges and is bypassed with `--no-verify`.
- The obvious closing move, a combined diff (`git diff-tree --cc --name-only -r`), false-positives:
  it lists `README.md` for a clean merge where both sides touched different hunks of one file.
- `scan-promotion-ancestry.mjs:30` records the same limitation for its own subject ("`--no-merges`
  cannot observe content a merge commit introduced") and closes it with a separate tree-equality
  assertion; this scan has no analog.

**Contained under this item:** HARNESS-129 (issue #2373) excludes merges from the enumeration and
carries `Contained — HARNESS-130.` at that line, naming the residual: a merge's own pre-checkpoint
content is not judged.

## Reproduction condition

Any merge commit on a topic branch that introduces a path present in neither parent before the
planning checkpoint; any clean back-merge attempted through the pre-commit path before the
checkpoint.

## Why it is its own item

"What is a merge's own content, and on which path is it judged" is a design decision — the first
candidate answer is measured to false-positive — with its own fixtures on both paths, not a flag in
a `blocks-landing` fix.

## Test Plan

- A fixture evil merge (path in neither parent, before the checkpoint) is refused on the history
  path; a clean merge that touches two hunks of one file is NOT refused (the combined-diff false
  positive as a control).
- The staged path accepts an honest clean back-merge before the checkpoint and refuses a staged
  merge resolution that adds an implementation path.
- Applied-check mutation on whichever attribution is chosen.

## User Execution Test Scenarios

Not applicable — repository verification machinery only; no product surface. To be re-judged by
`user-execution-scenario-author` when the item is picked up.
