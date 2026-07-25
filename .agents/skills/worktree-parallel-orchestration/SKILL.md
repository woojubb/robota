---
name: worktree-parallel-orchestration
description: Procedure for running multiple independent backlog items in parallel via worktree-isolated subagents with zero merge conflicts — partition file ownership before spawning, isolate each implementer in its own worktree, sequence overlapping work behind occupants, one coherent self-verified PR per agent, and serial orchestrator merge. Use when executing 2 or more independent items concurrently.
---

# Worktree-Parallel Orchestration

Procedure for the orchestrator that fans out several **independent** backlog items to
**worktree-isolated** subagents at once, then merges their PRs serially with no conflicts. This skill is
routing/procedure only — every git, spec, TDD, and verification constraint it invokes is **owned by the
rules below and must not be restated here**.

## Rule Anchor

- `AGENTS.md` > "Rules and Skills Boundary" — skills are procedure; rules win on conflict.
- `.agents/rules/git-branch.md` — Git Worktree (isolation + guardrails); One-Branch-At-A-Time Rule
  (Exception 2 authorizes concurrent worktree branches on a **disjoint file set**);
  `--delete-branch` ban; Merge Landing Verification; Delete Merged Branches; PR Batching (DX-001).
- `.agents/rules/spec-workflow.md` + `.agents/rules/backlog-execution.md` — spec gate pipeline for code work.
- `.agents/rules/tdd-and-planning.md` — red-before-green (HARNESS-041).
- `.agents/rules/verification.md` — build / test / typecheck / scan gates.

## When to Use / When NOT to Use

- **Use** when there are **≥ 2 independent items** whose file territories can be made disjoint, and the
  speedup of running them concurrently is worth the partition overhead.
- **Do NOT use** for a **single item** (just do it on one branch) or for **tightly-coupled changes** that
  cannot be split into non-overlapping file sets — run those sequentially on one branch instead.

## The Procedure

### 1. Partition file ownership BEFORE spawning (primary conflict-avoidance)

Before any agent is spawned, assign every candidate item an explicit **OWNED path list** and a
**FORBIDDEN path list**. The partition invariant: **no two concurrent agents may write the same file.**
Shared/central files (index registries, baselines, cross-cutting rule docs) are the usual collision
points — give each such file to at most one agent, or defer edits to it (see step 8). This is the
mechanism the git-branch.md One-Branch-At-A-Time Exception 2 depends on; without a clean partition, do
not run in parallel.

### 2. Isolate each implementer in its own worktree

Spawn each parallel implementer with the `Agent` tool's `isolation: "worktree"`. Each carries its own
concurrent feature branch cut from a freshly-fetched `origin/develop` (branch-guard override:
`BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1`). Hand each agent its OWNED + FORBIDDEN lists verbatim.

### 3. Sequence overlapping work behind occupants

If a candidate item's territory overlaps the OWNED paths of a **currently-running** agent, **HOLD** it —
do not spawn it. Release it only after the occupying agent's PR merges (its files are then free). Never
run two agents that touch the same file concurrently.

### 4. One coherent PR per agent (the agent's contract)

Each implementer produces exactly one PR and does **not** self-merge:

- Red-before-green (HARNESS-041): prove the new/changed test fails pre-fix.
- **Foreground** self-verification on a BUILT tree (`pnpm build` first): `pnpm harness:verify-like-ci`
  — the CI-equivalent entry (harness self-test, prettier check, full scan suite incl. the
  dist-dependent scans, typecheck) — plus `pnpm test`; all green, evidence reported. A bare
  `run-all-scans` is NOT the CI gate: it reports baseline notices and an unbuilt `dist` as a pass, and
  a fresh worktree has no husky/prettier toolchain (HARNESS-045).
- Correct commit footers; `gh pr create --base develop`.
- Stop-and-report on a blocker rather than merging or leaving a broken commit.

### 5. Orchestrator merges serially

Merge PRs one at a time via armed auto-merge: `gh pr merge --auto --squash` (never `--delete-branch`).
On a stale base or CI flake, **rebase the branch onto fresh `origin/develop` and re-arm**. Diagnose real
failures; treat known fresh-worktree env artifacts (e.g. a missing `dist`) as non-blocking. Confirm each
merge actually landed (Merge Landing Verification) before releasing any item held in step 3.

### 6. Spec-gated (code) work clears its gate BEFORE implementation

For code items requiring a spec, run draft → GATE-WRITE → independent GATE-APPROVAL (proposal-reviewer +
architecture-auditor) first; fold REVISE items, then approve — all per `spec-workflow.md` /
`backlog-execution.md`. Only APPROVED items enter the parallel implementation wave.

### 7. Resume, don't respawn

A subagent killed by a session limit is **resumed from its transcript** (`SendMessage` to the same
agent), never re-spawned from scratch — a fresh spawn loses its partition context and its in-progress
worktree state.

### 8. Baseline reconciliation once

When several concurrent PRs each tighten the same ratchet baseline (spec-surface, file-size,
prompt-prose), do **not** regenerate the baseline per-PR (each regen races the others). Let the earlier
PRs land, then regenerate the baseline **once on the last-merging PR**.

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

| Not this skill's job                    | Owner                                          |
| --------------------------------------- | ---------------------------------------------- |
| Define git/branch/merge/worktree policy | `.agents/rules/git-branch.md`                  |
| Define the spec gate pipeline           | `spec-workflow.md` / `backlog-execution.md`    |
| Define red-before-green / verification  | `tdd-and-planning.md` / `verification.md`      |
| Do the implementation or judge the PR   | the spawned implementer / the code-review gate |

If you find yourself restating a rule here, stop — link the rule instead.
