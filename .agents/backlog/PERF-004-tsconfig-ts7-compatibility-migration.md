---
title: 'PERF-004: migrate tsconfig off options TypeScript 7 removed, then switch typecheck'
status: todo
created: 2026-07-25
priority: medium
urgency: later
depends_on: [PERF-003]
area: tsconfig.base.json, packages, apps
---

# PERF-004: tsconfig migration + the actual switch

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
§6-2. TypeScript 7 removed options this repo uses. Re-measured against the current tree 2026-07-25 — two
of the three are broader than the source doc estimated:

| Option                       | Where it actually is                                                                       | TS7 state        | Action                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------- |
| `"moduleResolution": "Node"` | `tsconfig.base.json:9`                                                                     | removed (node10) | → `"bundler"` or `"nodenext"` — decide deliberately, they differ |
| `"baseUrl": "."`             | `tsconfig.base.json:27`                                                                    | removed          | delete (`paths` resolve relative to the tsconfig)                |
| `"downlevelIteration": true` | **38 tsconfig files** across `packages/`+`apps/` (NOT in base, contrary to the source doc) | removed          | delete — `target: ES2022` makes it unnecessary                   |

Also removed in TS7: `target: es5`, AMD/UMD/SystemJS.

**`baseUrl`/`paths` blast radius — corrected.** The source doc checked only `agent-core` (0 hits) and
flagged that a full sweep was needed. The sweep: **9 `from '@/…'` imports, all confined to
`packages/agent-playground`.** So the removal is contained to one package, but it is not zero — that
package needs its alias strategy settled (relative imports, or `paths` re-expressed without `baseUrl`).

## Measured baseline — how much of the machine the current compiler leaves idle

Sampled 2026-07-26 on a 20-core box, during a real `pnpm typecheck` of the whole workspace (already on
`--workspace-concurrency=-1`, i.e. core-relative, from PERF-002):

| Metric                     | Measured  | Reading                                                     |
| -------------------------- | --------- | ----------------------------------------------------------- |
| mean utilisation, 20 cores | **9.1 %** | roughly 1.8 cores' worth of work spread over 20             |
| busiest single core        | 36.6 %    | nothing is pinned — this is not one core saturated          |
| concurrent `tsc` processes | **1**     | the dependency graph serialises most of the run             |
| cores above 70 %           | **0**     | no core is the bottleneck                                   |
| load average               | 13.5      | the queue is long while the CPUs are idle — the wait is I/O |
| iowait                     | 21 %      | each worktree reads its own `node_modules` from disk        |
| CPU package temperature    | 68 °C     | enough to spin the fan up, for 1.8 cores of useful work     |

Two distinct facts sit in that table, and only the first is PERF-004's to fix:

1. **`tsc` is single-threaded per project, and `pnpm -r` must honour topological order**, so raising
   workspace concurrency only overlaps _independent_ packages — it cannot break a dependency chain. That
   is the ceiling the native compiler is expected to lift, and it is the measured justification for this
   item.
2. **The remaining wait is disk, not CPU** — concurrent worktrees each reading a separate `node_modules`.
   The native compiler does not address this; it is a function of how many isolated worktrees run at
   once. Recorded here only so a post-migration measurement is not misread as a partial win.

## What

1. Migrate the three option classes above. `downlevelIteration` is a 38-file mechanical sweep — verify
   each package's `target` really is ES2022 before deleting, rather than assuming.
2. Settle `agent-playground`'s `@/` alias.
3. **Only after PERF-003 confirms the two compilers produce identical error lists**, switch `typecheck`
   to the native compiler.
4. Keep `typescript@5.9.3` installed for the four harness TS-API scans, `@typescript-eslint`, vitest and
   IDE tooling — per PERF-003, never remove it.

## Test Plan

Per migration step, `pnpm typecheck` on the OLD compiler must stay green — the tsconfig changes must be
compiler-agnostic, so a regression here is a real regression, not a migration artifact. Then the new
compiler's error list must match the old one (PERF-003's criterion) on the real repo. The four TS-API
harness scans must pass throughout. `pnpm harness:verify-like-ci` green at every step.
Red-first where a behavior can regress: assert `agent-playground` still resolves its imports after the
alias change (a build + its test suite, not just typecheck).

**Prove the win, do not assume it.** After the switch, re-take the baseline measurement above on the same
machine and report mean core utilisation, busiest core, and concurrent compiler processes alongside wall
time. Wall-clock alone cannot distinguish "the compiler now uses the machine" from "the disk happened to
be quieter". A migration that leaves mean utilisation near 9 % has not delivered what this item is for,
whatever the stopwatch says.

## Note (desktop responsiveness — optional side item)

The source doc's §7 also observed builds running at `nice 0`, competing with `gnome-shell` and stuttering
the cursor under load. If an agent-facing build wrapper is ever added, the doc suggests:
`systemd-run --user --scope -p CPUWeight=20 -p IOWeight=20 nice -n 15 pnpm typecheck`. Not required for
this item; recorded so it is not lost.
