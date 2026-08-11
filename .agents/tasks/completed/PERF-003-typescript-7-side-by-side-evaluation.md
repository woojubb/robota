---
title: 'PERF-003: evaluate TypeScript 7 (native) side-by-side for typecheck — measured 8.8x, not yet adoptable'
status: done
completed: 2026-07-25
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

## Outcome (DONE 2026-07-25)

Side-by-side evaluation done. **Adoption criterion MET — diagnostics agree — but the switch is still
blocked on PERF-004.**

### What shipped

- `@typescript/native-preview` (7.0.0-dev.20260707.2, bin `tsgo`) as a root devDependency, installed
  **beside** `typescript@5.9.3`. The legacy compiler is untouched and the four legacy-API consumers
  (`scripts/audit/audit-implements.mjs`, `scripts/harness/{check-spec-public-surface,scan-composition-neutrality,scan-interface-runtime}.mjs`)
  were re-run and still exit 0.
- `scripts/perf/compare-typecheck.mjs` + `pnpm typecheck:compare` — the diagnostics comparison made
  **reproducible**, so PERF-004 can re-run the criterion instead of trusting one session's scrollback.
- The existing `typecheck` entry point is **unchanged**, as this item required.

### Diagnostics comparison — 5/5 agree

Both compilers run against an identical synthesized probe config, so the compiler is the only variable:

| Package         | legacy  | native | speed-up | diagnostics |
| --------------- | ------- | ------ | -------- | ----------- |
| agent-core      | 2383 ms | 530 ms | 4.5×     | identical   |
| agent-framework | 3191 ms | 596 ms | 5.4×     | identical   |
| agent-tools     | 1552 ms | 422 ms | 3.7×     | identical   |
| agent-session   | 992 ms  | 355 ms | 2.8×     | identical   |
| agent-cli       | 1797 ms | 444 ms | 4.0×     | identical   |

### Two findings that change PERF-004's scope

1. **`typecheck:fast` could NOT be wired per-package, and adding it would have been a lie.** The native
   compiler rejects the real tsconfigs _outright_ on the removed options, before it ever looks at code:
   `error TS5102: Option 'baseUrl' has been removed`, `TS5108: moduleResolution=node10 has been removed`,
   `TS5102: downlevelIteration has been removed`. A root script guarded by `--if-present` would have
   silently no-op'd to green. So this item ships the comparison tool instead, and **PERF-004 is the
   hard prerequisite for any `typecheck:fast`** — the reverse of this item's original ordering.
2. **The compilers disagree on AUTOMATIC `@types` discovery under pnpm's symlinked `node_modules`** —
   this was not in the source investigation. With `types` unset, the legacy compiler picks up the hoisted
   `@types/jest` (which supplies `describe`/`it`/`expect` to vitest files) and the native one does not,
   producing 41 phantom `Cannot find name 'describe'` errors in `agent-core` alone. Setting
   `types: ['node','jest']` explicitly makes both compilers agree exactly. **PERF-004 must decide the
   repo-wide answer** (explicit `types` per package, or a different `@types` arrangement) — otherwise the
   switch would surface dozens of phantom errors and look like a code regression.

### Constraint honored

`typescript@5.9.3` remains a devDependency and must never be removed — the four harness scans,
`@typescript-eslint`, vitest and IDE tooling all depend on the legacy programmatic API, which the native
compiler does not expose.
