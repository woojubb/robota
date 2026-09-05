---
name: delegated-refactor-green-gate
description: Delegate one mechanical change with focused worker verification, one integrated final gate, and one independent batch review. Route-only; does not edit or form verdicts. Use for decision-free shared-tree work.
loop: over=finding-set; escape=no-progress; bound=2 rounds
---

# Delegated Refactor Green Gate

Orchestrator for **one** delegated mechanical change (mass rename, type extraction, import rewrite) on
the orchestrator's own working tree. This skill owns only the ordering and the routing — the work is the
worker's, the verdict on the diff is the reviewer's, and every constraint it invokes belongs to the rules
below and is **not restated here**.

Where the procedure needs a concrete command, script, or threshold, it **points at the rule that owns
it**. The only names used literally are the agents this pipeline dispatches, because they _are_ the
mechanism.

## Rule Anchor

- `AGENTS.md` > "Rules and Skills Boundary" — skills are procedure; rules win on conflict.
- [verification.md](../../rules/verification.md) — "Delegated Verification Claims" (a delegated green
  claim is a hypothesis until independently reproduced); the build/test/harness gates.
- [git-branch.md](../../rules/git-branch.md) — "Clean Working Tree Before Every Commit and Push"
  (it names the project's CI-equivalent verification entry point); who may commit, and when.
- [enforcement-architecture.md](../../rules/enforcement-architecture.md) — worker / guardian /
  orchestrator; this skill is the orchestrator and does neither of the other two jobs.

## When to Use / When NOT to Use

- **Use** for a single change that is large but **decision-free** — predictable, repetitive edits across
  many files, specifiable precisely enough that a worker needs no product judgement.
- **Do NOT use** when the change requires design decisions mid-flight; settle those first.
- **Do NOT use** for **several independent items at once** — that is
  [worktree-parallel-orchestration](../worktree-parallel-orchestration/SKILL.md), whose isolated
  implementers commit and open their own PRs. This pipeline is the shared-tree, hand-back-unstaged case.

## The Pipeline

### 1. Specify the end state, and the file set it may touch

Write the target transformation and its boundaries before dispatching: what changes, everywhere it
applies, and what must NOT be touched. An underspecified dispatch is what turns a mechanical change into
a judgement call the worker is not allowed to make. The path list is not decoration — step 3b evaluates
the actual diff against it, so it has to be written down to be checkable.

**Route:** specification complete → step 2. Any part that still needs a decision → settle it first; do
not dispatch around it.

### 2. Dispatch `mechanical-refactor-worker`

Hand it the specification and focused verification scope. It shares this tree and returns it
unstaged with `scoped-pass` or a named blocker. The integration owner, not each worker, owns the full
gate under [execution-cadence.md](../../rules/execution-cadence.md).

**Route:** `scoped-pass` → step 3. `blocked` → read the blocker: a defect in the specification returns to
step 1 (bounded to 2 re-specifications); an environment or toolchain failure is diagnosed and the step
repeats; anything else terminates.

### 3. Gate the returned tree — two mechanically decidable checks

Both are conditions you evaluate from observable state, not verdicts: you read exit codes and path
lists. Forming a judgement about the diff is step 4's job, and not yours.

**3a. Verify the integrated batch.** Inspect the worker's scoped evidence without calling it branch
green. At the parent work unit's final boundary, the integration owner runs the full CI-equivalent
entry point and frozen-lockfile install when applicable. If this is a sub-step, return the scoped
result to that owner instead of running another full gate here. Read the final gate's reported
uncovered contexts; they remain unverified, not implicitly passed.

**3b. Check the changed file set against step 1's list.** Compare the paths the diff touches with the
paths the specification allowed. A file outside the list is out-of-scope work, decidable without reading
a line of the diff.

**Route:** both clean → step 4. 3a failed → back to step 2 with the failing command and its
output (bounded to 2 rounds). 3b out of scope → back to step 2 with the offending paths (bounded to 2
rounds). Either bound exhausted → terminate and report.

### 4. Dispatch `pr-review-reviewer` on the working-tree diff

Reuse the parent work unit's final independent review when composed into that pipeline; do not
dispatch a second reviewer for the same batch. Hand it **the uncommitted diff plus step 1's specification**, so it can judge the change against what
was actually asked for rather than inferring the intent from the diff. Defects the transformation
introduced, and edits that are in-scope by path but not by intent, are its findings to make — not yours
to eyeball. Do not ask it for **missed** sites: a site that was never edited is not in the changed set,
and exhaustiveness is the worker's contract, checked from its reported target-set enumeration.

**Route:** `ACTIONABLE FINDINGS: 0` → step 5. `> 0` → back to step 2 with the findings (bounded to 2
rounds); if the same findings recur unchanged, or the bound is exhausted, terminate and report.

### 5. Commit

Return the verified diff to the parent's batch commit, or commit once when this is the whole work
unit, per [git-branch.md](../../rules/git-branch.md). This pipeline does not push, open, or merge.

**Terminate** at any step per the Stop Conditions in
[backlog-execution.md](../../rules/backlog-execution.md) — report state, blocker, and the tree's staging
state, and do not proceed.

## What This Skill Does NOT Do

| Not this skill's job                          | Owner                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Make the edits / reach green                  | `mechanical-refactor-worker`                                                   |
| Judge the diff's quality (defects, severity)  | `pr-review-reviewer` → `ACTIONABLE FINDINGS`                                   |
| Guarantee the change reached every site       | `mechanical-refactor-worker` (its target-set enumeration)                      |
| Define the CI-equivalent verification entry   | [git-branch.md](../../rules/git-branch.md)                                     |
| Mandate that a delegated green be re-verified | [verification.md](../../rules/verification.md)                                 |
| Run several delegated items concurrently      | [worktree-parallel-orchestration](../worktree-parallel-orchestration/SKILL.md) |

If you find yourself editing, or forming a judgement about the diff, stop — dispatch the owning agent.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop delegated-refactor-green-gate
node scripts/harness/loop-run.mjs round --loop delegated-refactor-green-gate --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop delegated-refactor-green-gate --run <id> --terminal <reason>
```
