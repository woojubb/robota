---
id: PERF-007
title: 'PERF-007: 80 independent vitest instances have no shared ceiling — the caps are conventions, not invariants'
status: todo
priority: high
urgency: soon
type: INFRA
area: vitest.config.ts
created: 2026-07-26
---

## Problem

An OOM on 2026-07-26 exhausted 23 GB of RAM and 4 GB of swap and the kernel killed the desktop
session. The cause was not a memory leak. Measured across the entire 796-file suite, per-worker
memory is 104–181 MB — normal. The cause was **process count**, produced by two multipliers that
compound and neither of which was bounded:

| Multiplier                          | Measured                                              |
| ----------------------------------- | ----------------------------------------------------- |
| `pnpm run -r` workspace concurrency | **9** simultaneous workspaces                         |
| vitest workers per instance         | **22** (default is `availableParallelism() - 1` = 19) |
| Workspaces declaring a test script  | **80**                                                |

Measured over an identical 40-second window from a clean start:

```
uncapped   84 concurrent test processes,  7066 MB   (still climbing)
capped     27 concurrent test processes,  1845 MB
```

Two agents running tests in separate worktrees at once is enough to exceed the machine.

Aggravating detail from the incident log: each worker the OOM killer reaped was **larger than the
last** (1.6 → 3.8 GB). Killing a worker makes vitest redistribute its remaining files to the
survivors, so each survivor runs more files in one process and grows — the kill loop feeds itself.
Nothing bounds that once it starts.

## What is already fixed

`.npmrc` pins `workspace-concurrency=4`, the root `vitest.config.ts` caps `poolOptions.forks.maxForks`,
and the root `test`/`test:coverage` scripts export `VITEST_MAX_FORKS` so the cap reaches the child
instances too. Verified: identical pass/fail counts (771 passed / 24 failed / 7494 tests, unchanged),
peak RSS for the full suite halved from 2141 MB to 1023 MB.

Also removed there: `threads: true`, which had sat in the root config looking like a parallelism
setting. The option was removed in vitest 1.0 and vitest 3 accepts it silently, so it had configured
nothing for as long as it had been there.

## Why this item still exists

**The caps are conventions, not invariants.** Three specific holes:

1. **31 packages carry their own `vitest.config.ts`, each an independent `defineConfig` with no
   shared base.** They inherit no cap from the root. Today `VITEST_MAX_FORKS` covers them only
   because the root scripts happen to export it — anyone running `pnpm --filter <pkg> test`, or a
   CI job that invokes vitest directly, gets the uncapped default back.
2. **Nothing fails when a new package is added without a cap.** The 32nd config will be written the
   same way and nothing will say so.
3. **The topology itself is the real cost.** Running all 796 files under ONE vitest instance peaked
   at 26 workers / 2141 MB. Running the same files as 80 instances is both heavier and slower. The
   per-package split exists so `--filter` works, not because the full run needs it.

## Proposed direction

- A shared base config the package configs merge with (`mergeConfig`), so the ceiling is inherited
  rather than repeated — and a check that fails when a `vitest.config.*` does not extend it.
- Make the root full-suite run use a single instance, keeping per-package invocation for `--filter`.
- Derive the ceiling from `availableParallelism()` rather than a literal, so a 2-core CI runner and
  a 20-core workstation both stay near their core count instead of its square.

Whatever lands must be proven by measurement, not by reading the config: run the recursive path and
count concurrent processes and peak RSS, the way the numbers above were obtained. A cap that is
present in a file but not reached by the process that spawns the workers is exactly the defect this
item is about.

## Done when

- A package added without its own ceiling still runs capped, proven by adding one and measuring.
- Bypassing the root scripts (`pnpm --filter <pkg> test`) stays capped, proven by measuring.
- The ceiling scales with the host's core count, proven on at least two different core counts.
