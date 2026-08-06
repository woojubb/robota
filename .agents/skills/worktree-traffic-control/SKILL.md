---
name: worktree-traffic-control
description: The two gates around any worktree-isolated work — an entry gate before the first command and an exit gate before the work leaves. Routing only; it decides WHEN each gate is asked and what a verdict means, and delegates the parallel-work procedure to worktree-parallel-orchestration and every git constraint to the rules that own them. Use whenever work is done in a git worktree, whether one item or several.
---

# Worktree Traffic Control

Two gates and the rule for when to ask them. Nothing else.

This skill does **not** describe how to partition work, isolate agents, or merge their PRs — that is
[worktree-parallel-orchestration](../worktree-parallel-orchestration/SKILL.md), and restating any of
it here would fork the vocabulary. This skill is the thing that wraps whatever work happens inside a
worktree, including a single item worked alone.

## Rule Anchor

- `AGENTS.md` > "Rules and Skills Boundary" — skills are procedure; rules win on conflict.
- [operational.md](../../rules/operational.md) § "A Wait Is Not Idle Time" — why worktrees get used.
- [git-branch.md](../../rules/git-branch.md) — every git constraint the gates reference.

## Why gates rather than advice

Worktree accidents in this class are silent when they happen and expensive later: a command that
looks local writes to another repository; a checkout that cannot succeed is followed by statements
that still run; a suite reads build output left behind by a different branch. Advice does not prevent
any of these, because the moment they occur nothing looks wrong.

So the prevention is layered, and this skill is only the outermost layer:

| Layer                                        | Prevents                                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `.claude/hooks/worktree-cwd-guard.sh`        | Refuses the dangerous command outright. Unavoidable — it does not depend on anyone remembering. |
| `scripts/harness/worktree-gate.mjs`          | Answers the fixed questions mechanically, in both phases.                                       |
| `worktree-entry-gate` / `worktree-exit-gate` | Judge what a finding MEANS for the work at hand.                                                |
| This skill                                   | Says when each gate is asked.                                                                   |

Read that table top-down when something goes wrong: if an accident reached the work, the first
question is why the hook did not refuse it, not why the gate was not asked. A gap fixed at the top is
fixed for everyone; a gap fixed at the bottom is fixed for whoever reads the skill.

## The procedure

### 1. Entry gate, before the first command in the worktree

Ask [worktree-entry-gate](../../../.claude/agents/worktree-entry-gate.md) with the worktree path and
the branch. It returns `GATE VERDICT: PASS | FAIL | NON-COMPLIANCE`.

- **PASS** — start the work.
- **FAIL** — clear the named hazard yourself, then ask again. Do not ask the gate to clear it; a gate
  that repairs what it judges is judging its own work.
- **NON-COMPLIANCE** — the gate could not run. Treat it as a FAIL, never as a pass; the whole point
  is that a check which did not run must not read like one that passed.

"Before the first command" is literal. The accidents happen on the first few commands, when the
worktree is newest and least verified.

### 2. Work

Per the procedure that owns it. Nothing in this skill applies until the work is ready to leave.

### 3. Exit gate, before the work leaves

Ask [worktree-exit-gate](../../../.claude/agents/worktree-exit-gate.md) with the worktree path, the
branch, and what the work claims to have done. Ask it BEFORE the push, not after — the point is to
catch a handoff that cannot be trusted while it is still cheap to fix.

- **PASS** — push, open the PR, continue.
- **FAIL** — fix what it named, re-verify, ask again.
- **NON-COMPLIANCE** — as above.

### 4. When the gate finds something the checks do not cover

A finding the mechanical check could not have produced is the interesting case: it means the layer
table above has a gap. Record it, and mechanize it — a hazard caught once by judgement will be missed
next time by judgement. The gate agents mark what they judged rather than measured precisely so this
is visible.

## What this skill does NOT do

- It does not partition work, spawn agents, or merge PRs.
- It does not restate any git rule, command, or branch convention.
- It does not replace the hook. If the only thing standing between the work and an accident is that
  someone read this file, the accident has not been prevented.
