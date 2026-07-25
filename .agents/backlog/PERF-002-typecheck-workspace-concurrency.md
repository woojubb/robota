---
title: 'PERF-002: raise pnpm workspace concurrency for typecheck (no-risk, compiler-independent)'
status: todo
created: 2026-07-25
priority: medium
urgency: soon
area: package.json
depends_on: []
---

# PERF-002: `pnpm typecheck` only runs 2–4 packages at a time

## ⛔ Execution constraint — SERIAL ONLY, after other work is drained

**Owner directive (2026-07-25): the TypeScript items must NOT run in parallel with any other work.**

A compiler/tsconfig change moves the ground every other task stands on: `pnpm typecheck` is the shared
gate every agent and every CI job runs. If a TS change lands while other branches are in flight, a
failure in those branches is ambiguous — nobody can tell whether it is their own defect or fallout from
the version/config change. Bisecting that after the fact is far more expensive than waiting.

**Preconditions before starting any PERF-002/003/004 work:**

1. No other backlog item is in flight (no open PRs, no running implementation agents).
2. `develop` is green on a full `pnpm harness:verify-like-ci`.
3. The work runs as a **single serial track** — one item at a time, each merged and verified before the
   next starts. Do not fan these three out to parallel agents even among themselves: PERF-003 and
   PERF-004 both touch the typecheck path.

Re-verify precondition 1 immediately before starting; other work may have been queued in the meantime.

## Problem

Source investigation: [`TYPESCRIPT-7-TYPECHECK-PERFORMANCE.md`](../../TYPESCRIPT-7-TYPECHECK-PERFORMANCE.md)
(2026-07-25, measured; no repo change was made).

The root script is `pnpm run -r --if-present typecheck` and each of the **66** workspace projects runs
its own `tsc --noEmit`. pnpm's `--workspace-concurrency` defaults to **4**, so on a 20-core machine only
2–4 `tsc` processes run at once (confirmed by repeated `pgrep -fc tsc`). Overall CPU stays low while each
`tsc` pins 2–3 cores at max turbo — the package hits 43°C → 87°C in seconds, and per-package process
startup repeats 66 times (~0.19 s each on the current compiler ≈ 12 s of pure startup).

Low utilization, high heat, long wall-clock — and the fix is one flag.

## What

```diff
-"typecheck": "pnpm run -r --if-present typecheck"
+"typecheck": "pnpm run -r --workspace-concurrency=12 --if-present typecheck"
```

Constraint from the investigation: **do NOT use `--parallel`** — it ignores topological order and breaks
dependency sequencing. `--workspace-concurrency` preserves order and only raises how many run at once.
Pick the number deliberately (12 was the investigation's suggestion for a 20-core host); consider whether
CI runners (fewer cores) want the same value or an env-driven one.

## Test Plan

Measure wall-clock before/after on the same machine (3 runs, report the minimum) and record both numbers
in the Outcome — the investigation's §7 explicitly asks for this. Verify `pgrep -fc tsc` actually rises.
Confirm ordering is unaffected: a package that depends on another must still typecheck after it (a
deliberate type error in a dependency must still surface downstream, not race past it).
`pnpm harness:verify-like-ci` green.

## Note

Expect _higher_ instantaneous power and fan speed — the win is much shorter duration, so total heat and
noise duration drop. That trade is intended, not a regression.
