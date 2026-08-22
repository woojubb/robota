---
title: 'INFRA-128: report the promotion lag of every pull_request_target gate'
issue: https://github.com/woojubb/robota/issues/2039
status: in-progress
created: 2026-08-22
priority: medium
urgency: soon
area: scripts/harness, .github/workflows
depends_on: [INFRA-097]
---

# INFRA-128: report the promotion lag of every `pull_request_target` gate

## Objective

A `pull_request_target` workflow loads its YAML from the repository's DEFAULT branch, not from the
PR and not from the PR's base. So a fix to such a gate is **inert on the branch that carries it**,
and stays inert until that branch is promoted to `main`. Nothing in the harness said so, and the
cost was paid twice in one session on issue #1719's gate: two defects were found, fixed, reviewed
and merged to `develop`, and neither changed what actually ran.

Report that gap, per workflow, on every scan run.

## Plan

- [x] Compare each `pull_request_target` workflow between `HEAD` and the promotion ref.
- [x] Distinguish `absent` (never promoted) from `lagging` (promoted, then diverged).
- [x] Refuse rather than report "no delta" when a ref cannot be read.
- [x] Register the scan in `scripts/harness/run-all-scans.mjs`.
- [x] Split `scan-workflow-provenance`'s finding by trigger, since the two triggers fail in
      opposite directions.

## Why whole-file comparison, not a curated field list

Comparing only the fields that "matter" needs a list of what matters, and that list rots silently:
the day a `pull_request_target` gate grows a field nobody listed, the check reports a match over a
real difference. Whole-file comparison over-reports instead — a reworded comment is not a behaviour
change, so comments and blank lines are stripped, and what remains can still differ for reasons that
do not affect execution. That direction is the safe one: the failure mode is one advisory line on a
diff already touching CI, where someone is already looking.

## The state at authoring, stated so it cannot be mistaken for a measurement of nothing

`git diff origin/main origin/develop -- .github/workflows/workflow-provenance-gate.yml` is **empty**
as this lands: the promotion that carried both of issue #1719's gate fixes went through first. The check
therefore ships with **no live subject** — it reports `1 pull_request_target workflow(s); 1 match
origin/main, 0 do not`. Recorded here because a green line from a check with nothing to find and a
green line from a check that found nothing are indistinguishable at a glance, and only the first one
means the check is unproven against a real delta.

The `lagging`, `absent` and unreadable-ref cases are therefore proven against throwaway git
repositories with real refs, not against this tree.

## The false start, kept because it is the point

The first cut of those three cases used a stub helper that returned a fixed `promoted` verdict for
every fixture. Two of the three passed. They proved nothing: the assertion could not observe what
the code under test computed, and one case failed only because the stub disagreed with the fixture
it served — which is the ONLY reason the stub was noticed at all.

That is the same defect one layer up from this check's subject. A check that cannot fail installed
in the slot where a check belongs reads exactly like a check that passes. Replaced with temporary
repositories, which is I/O in a test and worth it: `git show <ref>:<path>` is the behaviour under
test, so anything that stands in for git is asserting the stand-in.

The refusal case then found a real defect in the implementation. `readAtRef` returned `null` for two
different facts — "this ref has no such file" and "there is no such ref" — and `findPromotionLagAt`
read both as `absent`. An unfetched `origin/main` would have reported every workflow as never
promoted: a loud wrong answer, and one built out of exactly the collapse this check exists to name.
