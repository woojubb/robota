---
name: automated-review-convergence
description: Procedure for iterating on a PR's automated review feedback until it converges — fetch the findings (not the check status), judge each one, fix or refute it, push, then re-read the review the push re-triggered, and repeat until a fresh round yields nothing actionable. Use whenever a PR carries automated review output, before the merge is armed.
loop: over=finding-set; escape=no-progress
---

# Automated Review Convergence

Responding to automated review feedback is a **loop**, not a step: a fix is pushed, the review automation
re-runs on the new head, and that run can produce findings the previous one could not. This skill owns only
the loop and its termination condition. What counts as a resolved finding, when a PR may merge, and how the
branch is verified are **owned by the rules below and must not be restated here**.

Where the procedure needs a concrete command, host, tool, or branch name, it **points at the rule that owns
it** instead of naming it. The only things named literally are the review surfaces themselves — the comment,
annotation, and analysis-alert streams a PR carries — because those _are_ the material the loop consumes.

## Rule Anchor

- `AGENTS.md` > "Rules and Skills Boundary" — skills are procedure; rules win on conflict.
- [git-branch.md](../../rules/git-branch.md) — "Pre-Merge Code-Review Gate" (the fixed / refuted / deferred
  resolution taxonomy and the record-it-on-the-PR requirement — this skill reuses that vocabulary and does
  not invent its own); "Clean Working Tree Before Every Commit and Push" (names the CI-equivalent
  verification entry point); "Merge Landing Verification".
- [verification.md](../../rules/verification.md) — the gates a fix must re-clear before it is pushed.
- [tdd-and-planning.md](../../rules/tdd-and-planning.md) — red-before-green, when a finding warrants a
  regression test.

## When to Use / When NOT to Use

- **Use** whenever an open PR has **automated review feedback** — bot review comments, inline annotations, or
  static-analysis alerts — and especially before the merge is armed.
- **Do NOT use** as a substitute for the code-review gate the rules own. That gate decides whether the PR may
  merge at all; this loop only drives the automated feedback to a stable state so the gate has something
  honest to judge.
- **Do NOT use** for a red required check. A failing gating check is a build/test failure — diagnose it under
  the verification rules, not as a review finding.

## The Loop

**Its escape is no-progress, and it is the only one.** Compare each round's finding-identity set to
the previous round's; if the same findings recur unchanged, STOP and escalate to the user. There is no
round cap — a stuck loop and a productive one look identical to a counter and different to the finding
set. [no-progress escape](../../rules/enforcement-architecture.md) owns the form; this skill is one of its subjects.

### 1. Fetch the findings — the check status is not the review

Review-producing automation is typically **advisory**: it reports `pass` whether or not it commented, because
its job is to comment, not to gate. A green check is therefore **not** evidence of no findings. Read the
actual output — the PR's review comments and review threads, the inline annotations on the diff, and any
analysis alerts attached to the head commit — and enumerate them into a ledger before judging any of them.

### 2. Judge each finding individually

Never batch-accept and never batch-dismiss. For each finding, decide from the code — not from the wording of
the rule — whether the defect is real: establish what actually reaches that construct and what the call site
guarantees. Then record it as **fixed**, **refuted**, or **deferred** (the rules' taxonomy, resolved on the PR
as those rules require). A refutation needs a specific written reason naming **why the rule's premise fails at
this call site**; "looks fine" or "false positive" alone is not a reason and resolves nothing.

**A finding may outrank a harness rule — and then the rule changes by AMENDMENT, not by this loop.** When the
reviewer argues from a universal engineering principle and a rule in this repo says otherwise, "our rule says
X" is not a refutation; neither is agreeing with the reviewer and quietly departing from the rule. The rule
binds until amended, and the minimum evidence of an amendment attempt is a filed backlog item — so the honest
resolutions here are **fixed** (comply and file the amendment) or **deferred** (file it, say so on the PR),
never a fourth thing. See [agent-conduct.md](../../rules/agent-conduct.md) § "A local rule is an encoding"
and [rules/index.md](../../rules/index.md) § "Amendable by amendment", which own the precedence, the
narrow exceptions and the bar. This loop's job is to surface the case, not to settle it by
citation in either direction.

### 3. A finding on a line you touched may be pre-existing

Diff-scoped analysis attributes any finding on a changed line to the change. Before judging, check the
finding's origin — was the flagged construct introduced by this branch, or only re-touched by it? But
**pre-existing is not a synonym for false positive**: if it is a genuine defect, fix it and say so in the
ledger. Origin changes the framing, not the verdict.

### 4. Prefer deleting the flagged construct over arguing with the analysis

Where the flagged pattern can be replaced by one the rule cannot apply to — an explicit linear scan instead of
a backtracking pattern match, a total function instead of a partial one — that is a stronger resolution than a
suppression or a refutation, because **the rule cannot flag what is no longer there**. Reach for a suppression
only when the construct genuinely must stay.

### 5. Push, then read the review again — expect round two to be non-empty

Re-clear the project's verification gates, push, and **wait for the automation to re-run on the new head**.
Then return to step 1 against that fresh run. Your own fix routinely produces new findings, in two ways worth
anticipating:

- **The fix moves the code into a different rule's probe set.** Simplifying a construct to escape one rule can
  make it match a rule that never applied before.
- **The fix makes a pre-existing defect newly visible.** Restructuring changes which lines are in the diff,
  and diff-scoped analysis then surfaces something that was always there.

Do not assume one pass converges. A second empty round is the thing to be demonstrated, not assumed.

### 6. Sequence the loop BEFORE the merge is armed

An auto-merge armed while findings are still open fires on the gating checks and carries the unaddressed
findings into the integration branch — and a fix still in flight then **misses the merge window and has to
land afterwards as a separate change**. Converge first, arm second. This is an ordering hazard, not a style
preference.

### 7. Terminate honestly

Converged means **both** of:

1. a review round produced **after the latest push** yielded no new actionable findings, and
2. every finding in the ledger is fixed, refuted, or deferred — each with its recorded reason.

Report it per finding, not in aggregate. Silence from automation you never waited for is not convergence, and
"the checks are green" is not convergence either (step 1).

## Worked Example — the ledger

| Round | Finding                       | Verdict | Reason recorded on the PR                                       |
| ----- | ----------------------------- | ------- | --------------------------------------------------------------- |
| 1     | super-linear backtracking     | fixed   | construct replaced by a linear scan (step 4), not suppressed    |
| 1     | unvalidated input at `f()`    | refuted | both call sites pass a value already validated upstream         |
| 2     | new rule hit on the rewrite   | fixed   | the round-1 fix entered a different rule's probe set (step 5)   |
| 2     | defect on a line merely moved | fixed   | pre-existing (step 3) but genuine — fixed, and labelled as such |
| 3     | —                             | —       | fresh round after the round-2 push: no new findings → converged |

Three rounds, and the loop was allowed to stop only at round 3 — because round 3 is the first run that
observed the round-2 push and returned nothing.

**Latest-verdict action gate.** Before each edit, push, rebase, or merge, read the latest
`ACTIONABLE FINDINGS: N` verdict and publish the head- and verdict-bound
`POST_FINDINGS_ACTION_REQUEST` comment from `git-branch.md`, with maintainer approval. A zero or
non-zero count, a local review record, or an internal judgement never substitutes for that current
decision record; a new verdict or head requires a new comment.

## What This Skill Does NOT Do

| Not this skill's job                       | Owner                                                                |
| ------------------------------------------ | -------------------------------------------------------------------- |
| Define what "resolved" means / gate merges | `.agents/rules/git-branch.md`                                        |
| Define build / test / scan verification    | `.agents/rules/verification.md`                                      |
| Judge the PR's overall quality             | the code-review gate the rules own                                   |
| Drive the reviewer→fixer agent pipeline    | [pr-finding-resolution-loop](../pr-finding-resolution-loop/SKILL.md) |
| Merge, or decide when to arm the merge     | the merge procedure the git rules own                                |

If you find yourself restating a rule here, stop — link the rule instead.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop automated-review-convergence
node scripts/harness/loop-run.mjs round --loop automated-review-convergence --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop automated-review-convergence --run <id> --terminal <reason>
```
