---
title: 'PERF-003: evaluate TypeScript 7 (native) side-by-side for typecheck — measured 8.8x, not yet adoptable'
status: todo
created: 2026-07-25
priority: medium
urgency: later
depends_on: [PERF-002]
area: package.json, tsconfig
---

# PERF-003: TypeScript 7 native compiler — side-by-side evaluation

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

## Problem / Opportunity

Source investigation: [`TYPESCRIPT-7-TYPECHECK-PERFORMANCE.md`](../../TYPESCRIPT-7-TYPECHECK-PERFORMANCE.md)
(2026-07-25). Measured on 852 files / 6 packages, same tsconfig injected into both compilers:

| Allowed cores | tsc 5.9.3 | tsc 7.0.2  |
| ------------- | --------- | ---------- |
| 1             | 9.75 s    | 2.06 s     |
| 4             | 5.32 s    | 0.91 s     |
| 16            | 4.51 s    | **0.51 s** |

**8.8× at 16 cores** = 4.7× native code × 1.9× parallel scaling. Startup drops 0.28 s → 0.09 s (material
at 66 packages). Error counts were **identical** on both compilers (41 / 584 on the benchmark config),
which is the signal that diagnostics agree.

Two facts that bound the work: **6.x is still the JS compiler** (no multicore benefit — upgrading to 6 is
pointless for performance), and TS7's `--checkers` defaults to 4 and **saturates there** for a project of
this size, so package-level concurrency (PERF-002) is the bigger lever; the two multiply.

## Blocker — TS7 has no stable programmatic API

`typescript@7` does not export the legacy compiler API (`require('typescript')` → `MODULE_NOT_FOUND`;
only `./unstable/*`). **Four in-repo consumers import it directly** (verified 2026-07-25):

```
scripts/audit/audit-implements.mjs
scripts/harness/check-spec-public-surface.mjs
scripts/harness/scan-composition-neutrality.mjs
scripts/harness/scan-interface-runtime.mjs
```

plus `@typescript-eslint/*`. Replacing `typescript` wholesale would break all four harness scans and
eslint. This is why the work is **side-by-side**, not an upgrade.

## What

1. `pnpm add -Dw @typescript/native-preview` (bin `tsgo` — deliberately does not collide with `tsc`).
2. Add `"typecheck:fast": "tsgo -p tsconfig.json --noEmit"` as a SEPARATE script. **Do not touch the
   existing `typecheck`.**
3. Run both paths and **diff the error lists**. Agreement is the adoption criterion — record the
   comparison, not just the timing.
4. Keep `typescript@5.9.3` as a devDependency permanently (harness scans + eslint + vitest + IDE).
   **Never remove it.**

## Test Plan

Both paths run on the real repo (not the benchmark config); the error lists are compared line-by-line and
the diff recorded in the Outcome. Timing measured on the same machine with the method in the source doc's
§8 (`/usr/bin/time -v`, `taskset` for core-count isolation). `pnpm harness:verify-like-ci` green — the
four TS-API scans must still pass, proving side-by-side did not disturb them.

## Out of scope

Switching `typecheck` to tsgo — that is PERF-004, gated on this evaluation's error-list agreement AND on
the tsconfig migration.
