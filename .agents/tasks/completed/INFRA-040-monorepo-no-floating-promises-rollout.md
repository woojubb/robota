---
title: 'INFRA-040: roll out no-floating-promises (type-aware ESLint) monorepo-wide'
status: done
completed: 2026-08-21
created: 2026-07-21
priority: low
urgency: later
area: packages, .eslintrc.json
depends_on: ['CORE-026']
---

# Roll out `@typescript-eslint/no-floating-promises` monorepo-wide

CORE-026 enabled the type-aware `no-floating-promises` rule on the three packages it touched (`agent-core`,
`agent-framework`, `agent-transport`) by adding a per-package `parserOptions.project`. The reviewer-endorsed
split deferred the monorepo-wide rollout — a genuine INFRA change (per-package `project` wiring across ~100
workspace projects + the resulting type-aware-finding flood + lint-perf cost) — to this item so a risky
config migration is not bundled with concurrency fixes.

## What

1. Add `parserOptions.project` (the package's `tsconfig.eslint.json` where present, else `tsconfig.json`) +
   `"@typescript-eslint/no-floating-promises": "error"` to each remaining package's `.eslintrc.json`.
2. Clear any new findings per package (await / `void` / route-to-error, matching the CORE-026 pattern — never
   swallow).
3. Consider hoisting the rule + `parserOptions.project` to the root config once every package is clean, to
   avoid per-package drift.
4. Watch CI `quality` lint time — type-aware parsing is slower; measure and, if needed, scope the ESLint
   `project` to `tsconfig.eslint.json` per package to bound the type-check surface.

## Test Plan

- `no-floating-promises` reports 0 errors in every package; `pnpm lint` (CI quality job) green.

## User Execution Test Scenarios

- Not applicable (lint-config rollout; the lint job is the maintained gate).
- Evidence: CI `quality` green with the rule enabled repo-wide.

## Progress

### 2026-08-21

Closed. The rule is on in 57 package/app configs; `pnpm -r lint` exits 0 with **0** parsing errors
and **0** floating promises.

**The premise this item deferred on did not survive being counted.** It reads "the resulting
type-aware-finding flood". Measured across the 55 packages where the rule was off: **SIX**
violations, in five packages. Same shape as INFRA-124, where "hundreds" was thirteen.

All six were real, and two were in production code:

| site                                                            | what it was                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `apps/agent-server/src/server.ts`                               | `startServer()` on the entry point with nothing to report a throw from the catch arm                         |
| `packages/agent-plugin/src/webhook/webhook-queue.ts`            | `drainBatch` inside `setInterval` — a delivery failure rejected on EVERY tick with no caller to propagate to |
| `packages/agent-playground/.../remote-injection-sandbox.ts`     | a synchronous `cleanup` returning BEFORE the `dispose()` it started, dropping any failure                    |
| two `agent-remote-client` cases, one `agent-transport-tui` case | assertions running before the call they are about                                                            |

A seventh appeared once the wiring reached `apps/agent-app`: `app.whenReady().then(createWindow)` in
the Electron main process. If window creation failed the app had no window and no message — the
process just sat there. Routed with `.catch` after `.then`, not `.then(fn, onRejected)`, because the
second argument handles a rejection of `whenReady()` alone and would have let a `createWindow`
failure float on unchanged.

**The WIRING is where the cost actually was, and the item was half right about that.** Three
mechanisms were measured before one worked:

| candidate                                                | why it failed                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parserOptions.project: true`                            | resolves the NEAREST tsconfig, and a package `tsconfig.json` EXCLUDES `**/*.test.ts` — every test file became a parsing error. Two of the six violations were in tests.                                                                                                       |
| `project: "./tsconfig.json"`                             | resolved to the ROOT tsconfig from the root cwd, which includes no package source at all.                                                                                                                                                                                     |
| the rule hoisted to the root config (this item's step 3) | **not achievable.** When a package `.eslintrc.json` extends the root, the root's `overrides.files` globs are matched relative to the PACKAGE directory, so `packages/**/*.ts` never matches. Verified with `eslint --print-config`: project and rule both resolved to `None`. |

So the declaration stays per package, which is the CORE-026 shape, and step 3 is recorded as
**unachievable under ESLint v8 eslintrc cascade semantics** rather than left as pending work.

What made the per-package form finally correct is that every package now carries a
`tsconfig.eslint.json` extending the root one — 46 created, in the one-line shape 42 packages
already used. Lint runs from TWO working directories (root `pnpm lint`, and CI's
`pnpm -r --filter <pkg> lint` with the package as cwd), and a relative `project` is cwd-resolved, so
one string can only satisfy both when the same filename exists at both levels.

That also explains an accident: the three CORE-026 packages appeared to work with a per-package path
only because, from the root, `./tsconfig.eslint.json` silently resolved to the ROOT file rather than
to theirs. It worked, for a reason nobody chose.

**STATED LIMIT — the two Next.js apps.** `apps/agent-web` and `apps/starter-nextjs` have the rule
OFF, with `project` nulled alongside it. `next lint` resolves `parserOptions.project` against the
REPOSITORY ROOT rather than the package, so `./tsconfig.eslint.json` reaches the root config whose
include is `apps/*/src/**` — and a Next.js app keeps its routes in `app/`. Measured:
`app/api/chat/route.ts` came back "TSConfig does not include this file" while that package's OWN
tsconfig includes it by `**/*.ts`. `project` is nulled WITH the rule deliberately: leaving it set
still builds a program per file and still errors on the ones the program misses.

Their config also had to become strict JSON with no comments — `next lint` refuses JSONC, and
ESLint's schema refuses an unknown `_comment` key — which is why this reasoning is here rather than
at the site.

**A test caught the one consequence I did not predict.** `staged-auto-fix.test.mjs` copies the ROOT
`.eslintrc.json` into a temp fixture with no tsconfig, so a top-level `parserOptions.project` made
that fixture fail to lint. It is the reason the scope is stated rather than assumed.

Step 4 of this item asked for the lint-time cost: `pnpm -r lint` runs **207s** with the rule on. The
whole-workspace `eslint packages apps` from the root exhausts the V8 heap under `project: true`; it
completes under the per-package form, which is the shape CI uses anyway.

`pnpm -r lint` — exit 0. `pnpm harness:test` — 226 files / 4319 tests and 73 files / 1113 tests, all
passed. `pnpm harness:scan` — 128 passed, 3 skipped.
