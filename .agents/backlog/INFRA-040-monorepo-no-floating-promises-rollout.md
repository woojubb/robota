---
title: 'INFRA-040: roll out no-floating-promises (type-aware ESLint) monorepo-wide'
status: todo
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
