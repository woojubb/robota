---
name: worktree-parallel-orchestration
description: Procedure for running multiple independent backlog items in parallel via worktree-isolated subagents with zero merge conflicts — partition file ownership before spawning, isolate each implementer in its own worktree, sequence overlapping work behind occupants, one coherent self-verified PR per agent, and serial orchestrator merge. Use when executing 2 or more independent items concurrently.
invocable: true
---

# Worktree-Parallel Orchestration

Procedure for the orchestrator that fans out several **independent** backlog items to
**worktree-isolated** subagents at once, then merges their PRs serially with no conflicts. This skill is
routing/procedure only — every git, spec, TDD, and verification constraint it invokes is **owned by the
rules below and must not be restated here**.

Where the procedure needs a concrete command, script, branch name, or threshold, it **points at the rule
that owns it** instead of naming it. The only names used literally are the agent-tooling primitives the
procedure is built on (the `Agent` tool's worktree isolation and `SendMessage`), because they _are_ the
mechanism.

## Rule Anchor

- `AGENTS.md` > "Rules and Skills Boundary" — skills are procedure; rules win on conflict.
- [git-branch.md](../../rules/git-branch.md) — "Git Worktree" (isolation + guardrails);
  "One-Branch-At-A-Time Rule" (Exception 2 authorizes concurrent worktree branches on a **disjoint file
  set**, and names the branch-guard override that permits them); "Clean Working Tree Before Every Commit
  and Push" (names the CI-equivalent verification entry point); the merge-time branch-deletion ban;
  "Merge Landing Verification"; "Delete Merged Branches"; "PR Batching".
- [spec-workflow.md](../../rules/spec-workflow.md) + [backlog-execution.md](../../rules/backlog-execution.md)
  — the spec gate pipeline for code work.
- [tdd-and-planning.md](../../rules/tdd-and-planning.md) — "Prove the regression test RED" (red-before-green).
- [verification.md](../../rules/verification.md) — build / test / typecheck / scan gates.

## When to Use / When NOT to Use

- **Use** when there are **≥ 2 independent items** whose file territories can be made disjoint, and the
  speedup of running them concurrently is worth the partition overhead.
- **Do NOT use** for a **single item** (just do it on one branch) or for **tightly-coupled changes** that
  cannot be split into non-overlapping file sets — run those sequentially on one branch instead.
- **Do NOT use — and drain everything else first — for a "shared-ground" change:** anything that alters
  the toolchain or configuration every other task is verified against (the type-checker or its
  configuration, the test runner, the lint/format configuration, the build pipeline, a workspace-wide
  dependency bump). File ownership cannot make these disjoint: they are disjoint in _files_ but shared in
  _effect_. Landing one while other branches are in flight makes every downstream failure ambiguous — an
  agent cannot tell its own defect from fallout, and bisecting afterwards costs far more than waiting.
  Run such an item **serially, on an empty queue**: no other open PRs, no running implementation agents,
  and the integration branch green on the project's CI-equivalent verification entry point. Re-check that
  the queue is still empty immediately before starting.

## The Procedure

### 1. Partition file ownership BEFORE spawning (primary conflict-avoidance)

Before any agent is spawned, assign every candidate item an explicit **OWNED path list** and a
**FORBIDDEN path list**. The partition invariant: **no two concurrent agents may write the same file.**
Shared/central files (index registries, generated baselines, cross-cutting rule docs) are the usual
collision points — give each such file to at most one agent, or defer edits to it (see step 8). This is
the mechanism the git rules' One-Branch-At-A-Time exception depends on; without a clean partition, do not
run in parallel.

### 2. Isolate each implementer in its own worktree

Spawn each parallel implementer with the `Agent` tool's `isolation: "worktree"`. Each carries its own
concurrent feature branch cut from a **freshly-fetched integration branch**, created with the branch-guard
override the git rules define for exactly this case. Hand each agent its OWNED + FORBIDDEN lists verbatim.

**Where the isolation stops.** A worktree owns its working tree and its index. It shares everything
else in the clone, and an agent told to work "in isolation" will not assume that unless it is said:

| Shared                          | Consequence measured 2026-08-01                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `refs/stash`                    | one agent's bare `git stash push` + `pop` took **another agent's uncommitted work** into its own tree                                                                   |
| `refs/stash`, via `lint-staged` | a concurrent stash destroyed the pre-commit backup: `lint-staged automatic backup is missing!` — the exposure is **every commit**, not only agents who type `git stash` |
| `refs/` and the object store    | `branch-guard` enumerates branches across all worktrees, so every branch creation during a wave needs the open-branches override                                        |

Two things follow, and both are now mechanical rather than advisory (INFRA-082): the pre-commit hook
runs `lint-staged` under a clone-wide lock, and a bare stash command is refused while a sibling
worktree exists. For a before/after comparison use `git archive` or a copy — no shared ref is
involved, and it is what the agent that hit this switched to.

**The work is wrapped by two gates, and this is where they are invoked.** They exist because the
list above is what a worktree agent learns by damaging something — a gate that runs before and after
turns each of those into a refusal instead of an incident. Both are in
[`worktree-traffic-control`](../worktree-traffic-control/SKILL.md); neither depends on anyone
remembering the table.

| when                                 | what                                                                                                   | refuses on                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| BEFORE handing an agent its worktree | `node scripts/harness/worktree-gate.mjs --phase before --branch <name>` (agent: `worktree-entry-gate`) | an inherited `GIT_DIR` family variable, a branch a sibling worktree already holds, a worktree with no dependencies installed |
| AFTER the agent reports done         | `node scripts/harness/worktree-gate.mjs --phase after --branch <name>` (agent: `worktree-exit-gate`)   | the same ambient check, a HEAD that is not the branch the work was for, build output older than the source beside it         |

`--branch` is REQUIRED. Without it the branch-held and HEAD-matches checks examine nothing and the
gate would print a pass it did not compute, which is the silent green the gate exists to remove.

### 3. Sequence overlapping work behind occupants

If a candidate item's territory overlaps the OWNED paths of a **currently-running** agent, **HOLD** it —
do not spawn it. Release it only after the occupying agent's PR merges (its files are then free). Never
run two agents that touch the same file concurrently.

### 4. One coherent PR per agent (the agent's contract)

Each implementer produces exactly one PR and does **not** self-merge:

- **Prove it fails first.** A new or changed regression test does not count as verification until it has
  been demonstrated to FAIL against the pre-change state, then pass. Never skip this because the test is
  green now.
- **Self-verify in the FOREGROUND using the project's CI-equivalent verification entry point** — the
  single entry that reproduces what CI's required checks assert, including the build and the affected
  packages' tests. All green, evidence reported. **A partial check is not the gate:** a narrower
  scan-only or hook-only run can report a pass where CI fails, because it treats baseline notices and
  missing build outputs as clean, and a freshly-created worktree may not carry the installed
  hook/formatter toolchain the project's checks assume. Never substitute a narrower command for the
  CI-equivalent one, never restrict it to a subset of its stages, and never background the
  verification and report before it finishes. It takes minutes on a code branch — that is the gate,
  not an overrun.
- Correct commit footers; open **exactly one** PR against the integration branch.
- Stop-and-report on a blocker rather than merging or leaving a broken commit.

### 5. Orchestrator merges serially

The orchestrator — never the implementer — merges, and **one PR at a time**, via the armed auto-merge form
the git rules permit (the merge-time branch-deletion flag is banned there; do not reintroduce it). On a
stale base or a CI flake, **rebase the branch onto the freshly-fetched integration branch and re-arm**.
Diagnose real failures; a known fresh-worktree environment artifact (e.g. build outputs absent because
that worktree was never built) is not a code failure.

**After each merge, run [post-merge-cycle](../post-merge-cycle/SKILL.md)** — it confirms the merge actually
landed, and only then deletes the branch and prunes its worktree. Release an item held in step 3 only once
that cycle reports the landing confirmed; the occupant's files are not free until then. Run it **per merge,
as you go** — that is the orchestrator's call, not something to wait for a human to request, and deferring
it is how a hundred stale branches and tens of gigabytes of worktrees accumulate.

**Read the review output BEFORE arming the merge.** Review-producing automation is typically _advisory_:
its findings arrive as PR comments, while the checks that actually gate a merge are a different set. So an
auto-merge armed early fires on the gating checks and carries the review's findings straight into the
integration branch — the feedback was produced, and simply never read. A review job reporting `pass` is
not evidence of no findings; it usually passes whether or not it commented. Therefore: fetch the PR's
review comments and analysis findings, address or consciously dismiss them, and only then arm the merge.
Passing checks answer "did it break anything"; the review answers "should it land as written". The full
fix → push → re-review loop this hands off to is
[automated-review-convergence](../automated-review-convergence/SKILL.md).

### 6. Spec-gated (code) work clears its gate BEFORE implementation

For code items requiring a spec, run draft → GATE-WRITE → **independent** GATE-APPROVAL first — independent
meaning a `proposal-reviewer` that did not author the spec. When architecture evidence is additionally
required, dispatch the complete `architecture-audit-fanout` or an explicitly scoped dimension; dimensional
auditors emit coverage signals, not GATE-APPROVAL verdicts.
Fold every REVISE finding, then approve — all per the spec-workflow / backlog-execution rules. Only
APPROVED items enter the parallel implementation wave.

### 7. Resume, don't respawn

A subagent killed by a session limit is **resumed from its transcript** (`SendMessage` to the same
agent), never re-spawned from scratch — a fresh spawn loses its partition context and its in-progress
worktree state.

### 8. Baseline reconciliation once

When several concurrent PRs each tighten **the same ratchet baseline** — any generated allowlist or
threshold file the project derives from the whole tree — do **not** regenerate that baseline per-PR: each
regeneration races the others and freezes a tree the sibling PRs are about to change. Let the earlier PRs
land, then regenerate the baseline **once, on the last-merging PR**.

## Worked Example — the partition step

Three independent items, partitioned so no file is written twice:

| Item | Agent | OWNED (may write)                             | FORBIDDEN (must not touch)                       |
| ---- | ----- | --------------------------------------------- | ------------------------------------------------ |
| A    | a1    | `packages/foo/**`                             | `packages/bar/**`, `packages/baz/**`, shared idx |
| B    | a2    | `packages/bar/**`                             | `packages/foo/**`, `packages/baz/**`, shared idx |
| C    | a3    | `packages/baz/**` + the shared registry/index | `packages/foo/**`, `packages/bar/**`             |

The shared registry is owned by exactly one agent (a3). A fourth item touching `packages/bar/**` is
**held** (step 3) until B's PR merges, since it overlaps a2's OWNED set.

## What This Skill Does NOT Do

| Not this skill's job                      | Owner                                            |
| ----------------------------------------- | ------------------------------------------------ |
| Define git/branch/merge/worktree policy   | `.agents/rules/git-branch.md`                    |
| Name the CI-equivalent verification entry | `.agents/rules/git-branch.md`                    |
| Define the spec gate pipeline             | `spec-workflow.md` / `backlog-execution.md`      |
| Define red-before-green / verification    | `tdd-and-planning.md` / `verification.md`        |
| Verify a merge landed / delete a branch   | [post-merge-cycle](../post-merge-cycle/SKILL.md) |
| Do the implementation or judge the PR     | the spawned implementer / the code-review gate   |

If you find yourself restating a rule here, stop — link the rule instead.
