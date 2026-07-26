---
title: 'PERF-004: migrate tsconfig off options TypeScript 7 removed, then switch typecheck'
status: done
completed: 2026-07-26
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

## User Execution Test Scenarios

**Scenario — the owner runs the shared typecheck gate and sees it finish in seconds, not half a minute.**

- Prerequisites: a clone on this branch, `pnpm install`, `pnpm build` (declaration files must exist).
- Command: `pnpm typecheck`
- Expected observable result: exits 0; every project line reads `typecheck$ tsgo …` rather than `tsc`;
  wall clock ~6 s where it was ~30 s.
- Cleanup: none.
- Evidence (agent-run, 2026-07-26): run three times on the 20-core host — 6.28 s / 6.21 s / 6.30 s,
  exit 0 each time, against 30.55 s / 29.97 s / 30.12 s / 29.90 s for the same command before the
  switch. Full log in the measurement table below.

## Outcome (DONE 2026-07-26)

Both halves shipped: the tsconfig migration **and** the switch. The native compiler turned out to be
adoptable — the diagnostics agree on the real repo, not just on PERF-003's synthesized probe.

### What migrated

| Option               | Where                                                | Action taken                                                                                            |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `downlevelIteration` | 38 tsconfigs                                         | deleted from all 38 — **0 of the 38 actually needed it**                                                |
| `moduleResolution`   | `tsconfig.base.json`, root `tsconfig.json`, 3 others | → `bundler` (→ `Node16` for the CommonJS electron project)                                              |
| `baseUrl`            | base, `agent-playground`, `dag-nodes/image-source`   | deleted; `paths` re-anchored where they had been repo-root-relative                                     |
| `types` (new)        | 6 projects                                           | stated explicitly, replacing reliance on pnpm hoisting — the open question PERF-003 handed to this item |

**`downlevelIteration` — verified, not assumed.** `tsc -p <file> --showConfig` was run for each of the
38 files; every one resolves to `target: es2022`, at which the option is inert (it only changes emit
below ES2015). Confirmed empirically too: rebuilding `agent-core` + `dag-core` with and without it
produces byte-identical JS (md5 `c7597884fdba1815ca9319c967d909e2` both ways), against a build first
proven deterministic by a repeat run. So the answer to "how many of the 38 actually needed the removal"
is **none of them behaviourally — all 38 were already dead config**; the removals are required only
because TS7 rejects the key.

**`moduleResolution`: `bundler`, not `nodenext`.** Decided on measurement, not preference:

1. 33 of the 38 configs that set `moduleResolution` at all already declared `bundler`. Only 47 packages
   actually inherited the base value, so `bundler` makes the base agree with what the workspace already
   does instead of making it disagree harder.
2. `bundler` is compatible with the `module: ESNext` the base already sets. `nodenext` forces
   `module: nodenext`, changing emit for all 47 inheriting packages as a side effect of a typecheck
   migration.
3. `nodenext` requires explicit extensions on relative imports. Those 47 packages hold **1253
   extensionless relative imports** (871 in `agent-core` alone) — a config migration would have become a
   1253-site source rewrite with runtime consequences.
4. `bundler` is the closest behavioural match to the node10 it replaces, which also permitted
   extensionless relative imports.

The one project that cannot use `bundler` is `apps/agent-app/electron` — it emits CommonJS, and
`bundler` requires `module` to be `preserve`/`es2015`+. It moved to `Node16`, TS7's supported successor
for Node CommonJS, with **byte-identical emit** before and after (`main.js`
`b50a7bf5d4048a1297c4eed29b85d401`, `preload.js` `7cba480819dd4e45fa1174e65bac6c3d`, `sidecar.js`
`4df60c81947bd64c818ba719fcf34b24`).

**The alias, settled.** This item's premise said 9 `@/…` imports confined to `agent-playground`. That
count is right for the alias that needed a decision, but the repo has more `@/` importers — `apps/docs`,
`apps/www`, `apps/starter-nextjs`, `apps/agent-web` and `examples/nextjs` all map `@/*` **with no
`baseUrl` today**. That is the in-repo proof that `paths` resolve relative to the declaring tsconfig, so
`agent-playground` needed no alias strategy change at all: deleting `baseUrl: "."` leaves `@/* → ./src/*`
pointing exactly where it did. Red-first proof that the green is real rather than accidental — pointing
`@/*` at a non-existent directory produces **exactly 9 `TS2307` errors**, one per import; restored, the
package is green on typecheck, on its `tsdown` build (0 "module not found" warnings; `@/lib/utils`
survives only in sourcemap sources, i.e. it was inlined) and on its 168 tests.

Two observations recorded rather than acted on, since neither is this item's to fix:

- `agent-playground`'s bundler **does not fail** on an unresolvable `@/` specifier — it warns "Module
  not found, treating it as an external dependency" and exits 0. Typecheck is the only real gate on that
  alias. Pre-existing; unchanged by this item.
- `packages/dag-nodes/image-source`'s two `paths` entries are inert — breaking them changes nothing,
  because `@robota-sdk/dag-core` resolves through the workspace link regardless. They were re-anchored
  correctly rather than deleted, to keep the diff minimal.

### Two-compiler equivalence — 99/99 on the real repo

PERF-003 could only compare synthesized probe configs, because the native compiler rejected the real
ones outright. With the migration landed it accepts them, so the comparison was re-run against **each
project's own tsconfig** — the thing CI actually runs:

| scope                    | projects | identical diagnostics |
| ------------------------ | -------- | --------------------- |
| `packages/**`, `apps/**` | 86       | 86                    |
| `examples/**`            | 13       | 13                    |
| **total**                | **99**   | **99**                |

The first pass was 78/86. All 8 differences were resolution artifacts, none a disagreement about code,
and each was fixed at its cause rather than papered over:

1. **Automatic `@types` discovery under pnpm** (6 projects). PERF-003 flagged this and asked PERF-004 to
   pick the repo-wide answer. The answer taken: **state the ambient dependency instead of inheriting it
   from a hoisting accident** — already the dominant convention here (`agent-framework`, `agent-tools`
   and every `dag-*` package declare `types` explicitly). This also fixed a genuine hygiene defect —
   `agent-core` and `agent-provider-openai` were typechecking their test files against ambient
   `@types/jest` while running under **vitest**, so they now declare `types: ["node", "vitest/globals"]`.
   `agent-executor`, `agent-session` and `agent-playground` take `types: ["node"]`; `apps/agent-web`,
   which genuinely runs jest, takes `types: ["jest", "node"]`.
2. **`TS2882` on CSS side-effect imports** (3 Next.js apps). A deliberate TS7 behaviour change: TS5
   silently ignored a side-effect import it could not resolve. `next-env.d.ts` only declares
   `*.module.css`, so each app gets a checked-in `declare module '*.css'`.

### The measurement — before/after, and a correction to this item's own baseline

Sampled per-core busy% from `/proc/stat` across the whole run (not inferred, not a single window), on
the same idle 20-core host, back-to-back:

| metric                     | legacy `tsc` 5.9.3 | native `tsgo` 7.0.0-dev |
| -------------------------- | ------------------ | ----------------------- |
| wall clock                 | 30.12 s / 29.90 s  | **6.21 s / 6.30 s**     |
| mean utilisation, 20 cores | 60.3 % / 60.2 %    | 54.7 % / 54.9 %         |
| busiest single core        | 66.8 % / 68.6 %    | 62.3 % / 66.8 %         |
| busiest 5 s window (mean)  | 98.0 % / 97.6 %    | 64.4 % / 64.1 %         |
| cores above 70 % (peak)    | 20                 | 1                       |
| max concurrent compilers   | 19                 | 57                      |
| iowait                     | 0 %                | 0 %                     |

**4.8× on wall clock, and ~5.3× less CPU consumed** (361 core-seconds → 68).

**Mean utilisation went DOWN, and that is the honest result, not a shortfall.** This item's stated
acceptance criterion — "a migration that leaves mean utilisation near 9 % has not delivered what this
item is for" — rested on a baseline that does not reproduce. The 9.1 % / one-concurrent-`tsc` / 21 %
iowait / load-13.5 figures in the Problem section were sampled while several worktrees contended for the
same disk. Re-measured on an idle machine, the **legacy** path already reaches 60 % mean utilisation over
the whole run, 98 % across a 5-second window with all 20 cores above 70 %, 19 concurrent `tsc`, and 0 %
iowait. The compiler was never leaving the machine idle on a quiet host — PERF-002's
`--workspace-concurrency=-1` had already taken that win.

So the ceiling this item lifts is not "the machine is idle"; it is **how much work there is to do**. The
native compiler does the same typecheck for a fifth of the CPU, which is why utilisation falls while wall
clock collapses: with the work cut 5×, pnpm's fixed serial orchestration is a larger share of a much
shorter run. The disk-bound share the Problem section warned about is confirmed as separate — it is 0 %
here on an idle box, and it is a function of how many worktrees run at once, which no compiler fixes.

### Constraint honored

`typescript@5.9.3` remains a devDependency and is untouched. The four TS-API consumers
(`scripts/audit/audit-implements.mjs`, `scripts/harness/{check-spec-public-surface,scan-composition-neutrality,scan-interface-runtime}.mjs`)
were re-run and still work, `@typescript-eslint` and vitest are unaffected, and all 67 harness scans pass.

**No CI change was needed.** The native compiler's platform binaries are already optional dependencies in
the lockfile (added by PERF-003), so `pnpm install --frozen-lockfile` provisions `tsgo` without any
workflow edit.

### Verification

`pnpm build`, `pnpm typecheck`, `pnpm lint` (0 errors), `pnpm harness:scan` (67/67), and
`pnpm harness:verify-like-ci` (5/5 stages) all green. Because `verify-like-ci` runs neither the build nor
the package tests (INFRA-056), the full workspace suite was run separately and is green — including the
directly affected packages: agent-core 906 tests, agent-executor 89, agent-session 155, agent-playground
168, agent-provider-openai 162, and apps/agent-web 8 (jest).
