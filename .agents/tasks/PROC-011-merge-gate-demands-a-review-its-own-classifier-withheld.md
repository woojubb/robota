---
title: 'PROC-011: the merge gate demands a reviewer verdict on every pull request, but the review automation deliberately skips a documentation-only one — so the two mechanisms disagree about the same PR and the only route through is the override the rules say a gate must never train people to reach for'
status: todo
created: 2026-08-16
priority: medium
urgency: soon
area: .claude/hooks, .github/workflows
depends_on: []
---

# PROC-011: the merge gate blocks on a review its own classifier withheld

Measured on PR #1756 (2026-08-16), which it blocked.

## Problem

`.claude/hooks/merge-gate.sh` refuses a merge unless the PR carries a comment or review from
`^github-actions(\[bot\])?$` containing an `ACTIONABLE FINDINGS: <n>` marker. On a documentation-only
PR no such artifact exists — **by design**: the `classify review applicability` job passes and
`Claude review` resolves to `skipping`, because the diff carries no code.

That matches the rule the gate is enforcing.
[git-branch.md](../rules/git-branch.md) § Pre-Merge Code-Review Gate scopes itself explicitly:

> **Scope:** required for any PR that changes code (`.ts`/`.tsx`/`.js`/`.mjs`/`.cjs`). A
> documentation/spec/backlog-only PR (markdown/JSON config only, no code diff) is exempt — running
> `/code-review` on it yields no code findings.

So the rule exempts the PR, the CI classifier exempts the PR, and the hook refuses it anyway. Its
diagnostic compounds the confusion by proposing the wrong cause:

```
[merge-gate] Blocked: no comment on #1756 is from the reviewer this gate looks for.
[merge-gate]   looked for: ^github-actions(\[bot\])?$   comments are from: woojubb
[merge-gate] If the reviewer's login changed, fix REVIEWER_RE — do not route around it.
```

The login had not changed. The reviewer never ran.

## Why it matters

The only route through is `MERGE_GATE_ACK=1`, which prints that the gate did not verify. Every
documentation-only PR therefore ends in the override, and the person who learns that lesson carries it
to a PR where the gate _is_ load-bearing. [git-branch.md](../rules/git-branch.md) names the shape:

> a gate that trains people to route around it has already failed

and, in the same section:

> If a check is wrong, unrunnable, or fires on correct work, **the check is what changes**.

**This is the second instance this session**, which is what makes it a pattern rather than an
inconvenience. [PROC-010](PROC-010-re-plan-disposition-blocks-the-filing-that-carries-it.md) is the
first: recording a re-plan disposition labels the PR that _files_ the root item, after which the same
hook refuses it and instructs the author to close the PR — which would discard the root item. Both
end in `MERGE_GATE_ACK=1`, and both are the gate blocking on a state its own machinery produced.

## Direction

The hook needs the same applicability answer CI already computes, rather than assuming a verdict
always exists. Options, not chosen here because this is a judgement about the enforcement design:

- Have the hook read the `classify review applicability` result (or recompute the same
  code-vs-docs classification from the PR's file list) and require the marker only when the review was
  applicable.
- Or have the review workflow post an explicit `ACTIONABLE FINDINGS: 0` with a "not applicable —
  docs-only" body instead of skipping, so the artifact always exists and the hook stays simple. This
  is the smaller change and it keeps one code path in the hook, at the cost of a comment on every
  docs PR.

Whichever is taken, the diagnostic must stop asserting a cause it has not established: "no verdict
found" and "the reviewer's login changed" are different claims, and printing the second for the first
is what sent this investigation down the wrong path.

**Consider together with PROC-010.** Both are the merge gate refusing a PR because of something the
harness itself did; a fix that teaches the hook _why_ an artifact is absent would likely address both.

## Test Plan

- A case pinning that a documentation-only PR does not require a reviewer verdict to merge.
- A case pinning that a code-carrying PR still does — the property that must not regress.
- A case pinning that "verdict absent" and "reviewer login mismatch" produce different diagnostics.
- `depth-verdict-reachable.test.mjs` already enumerates the consumers of the review vocabulary;
  whatever applicability signal is introduced belongs in that enumeration so it cannot be wired for
  one consumer only.

## User Execution Test Scenarios

Not applicable — harness and CI machinery with no runnable user-facing behaviour. Verification evidence
belongs in the engineering test plan above.
