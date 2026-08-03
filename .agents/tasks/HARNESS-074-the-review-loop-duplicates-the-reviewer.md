---
title: 'HARNESS-074: the review machinery performs a second review instead of resolving the first'
status: todo
created: 2026-08-03
priority: high
urgency: now
area: .agents/skills, .claude/hooks, scripts/harness
depends_on: []
---

# HARNESS-074: a loop that reviews what has already been reviewed

## Problem

Code review on an open pull request is delegated to the review automation the pull request runs. The
local loop's job is to RESOLVE what that review reports: fetch the findings, judge each, fix or refute
it, push, and read the round the push re-triggered.

The machinery does something else. It performs a second, local review of the same change, then treats
that review's output as the thing to converge on. The consequence is paid twice — once in continuous
integration minutes and once in local execution — and the second opinion is the weaker one, because it
does not carry the pull request's comment history and cannot see which findings an earlier round
already answered.

The procedure for the intended shape already exists and is not invoked:
[`automated-review-convergence`](../skills/automated-review-convergence/SKILL.md) — "fetch the
findings (not the check status), judge each one, fix or refute it, push, then re-read the review the
push re-triggered."

## Evidence

Each piece of the machinery, judged against the policy:

| Piece                                                               | What it does                                                            | Verdict              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------- |
| `pr-finding-resolution-loop` Round B step 1                         | Dispatched a reviewer agent on the OPEN pull request                    | Fails — corrected    |
| `.claude/hooks/pre-push-check.sh`                                   | Refuses a push without a recorded LOCAL review of the diff              | Fails                |
| `scripts/harness/record-local-review.mjs`, `.agents/local-reviews/` | Stores that local review, per working tree                              | Follows the above    |
| `pr-finding-resolution-loop` Round A                                | The skill form of the same pre-push local review                        | Fails                |
| `.claude/hooks/merge-gate.sh`                                       | Reads the disposition from the pull request LABEL, not the local record | Conforms — precedent |
| `.github/workflows/review-gate.yml`                                 | Reads code-scanning alerts and labels                                   | Conforms             |
| `automated-review-convergence`                                      | Fetch, judge, resolve, push, re-read                                    | Is the policy        |

Two observations sharpen the direction rather than merely condemning the machinery.

**The merge gate already moved.** It once read the per-working-tree record and was changed to read a
label on the pull request, because a record keyed to a local checkout is invisible to the clone that
merges — one worktree held the only record for its branch while the merging clone held a record for a
different one, and the gate answered one merge with another change's disposition. The same reasoning
applies to every decision the local record still carries.

**The pre-push gate's stated reason is a cost argument, not a review argument** — a round before the
push costs a minute where the same round after it costs an integration cycle. That reason is sound and
survives; what does not survive is discharging it by performing a REVIEW. Mechanical verification
before a push is verification; a subjective review before a push is the duplicated reviewer wearing a
hook.

## Why this is foundational (or not)

**FOUNDATIONAL.** It spans a hook, a recorded artifact, two skills, a merge gate and the tests that
assert their reachability, and every piece encodes the same wrong premise about who reviews. Correcting
one file leaves the premise intact everywhere else — which is what happened when Round B was corrected
on its own.

## Settled before the work starts

The loop is named `pr-finding-resolution-loop`. The old name said "review orchestration", which reads
as "orchestrate the reviewing" and is precisely how a reviewer came to be dispatched on an open pull
request. `loop` stays in the name deliberately: the failure was treating it as one round to perform
rather than a cycle that runs until nothing is left, and the name should carry that.

Its description now states what it is not — "it does not review" — because a description is what an
agent reads when choosing a skill, so a wrong one misleads before the body is ever opened.

Naming is therefore not open in this item. What remains is the machinery.

## Direction

Bring each piece to the policy, as one orchestrated unit rather than file by file:

1. **The pre-push gate keeps its cost rationale and loses its review demand.** It should require what
   a machine can decide — the verification entry point green, the tree clean — and stop requiring a
   recorded subjective review. What it must not do is let a push through with less mechanical checking
   than it has today.
2. **Round A follows the hook.** Whatever the hook requires is what the skill describes; two
   statements of one gate is the duplication this repository files separately.
3. **Round B resolves.** Corrected already: read the findings the pull request's automation produced,
   route the fetch procedure to the skill that owns it, and never dispatch a reviewer on an open pull
   request.
4. **Decide the fate of the local review record.** The merge gate no longer reads it; if nothing else
   does, it and its per-working-tree store go, and the tests asserting them go with them. Removing an
   artifact requires knowing every reader — enumerate them mechanically, do not assume.
5. **`pr-review-reviewer` keeps exactly the uses that survive.** A reviewer on a local diff before a
   push, and on a tree diff in the delegated-refactor gate, are not duplication if the pre-push gate
   still wants a subjective opinion. If step 1 removes that demand, the agent's registration, the
   orchestration map row and the reachability tests must move together.

Order matters: settle 1 before 2, and 4 only after 1 and 3, because the record's readers change with
them.

## Test Plan

- **Required red-first regression:** a check that the pull-request loop does not dispatch a reviewer
  agent — proven to FAIL against the state before this item, where Round B did exactly that.
- Every gate that exists today must still block what it blocks today. Enumerate them before the change
  and assert each afterwards; a cost saving that opens a hole is not a saving.
- Removing the local record requires proving no reader remains: enumerate readers mechanically, and
  the check reports how many it examined.
- `pnpm harness:scan` and `pnpm harness:test` green.

## User Execution Test Scenarios

**Does not apply.** Agent-process machinery; no user-facing surface.
