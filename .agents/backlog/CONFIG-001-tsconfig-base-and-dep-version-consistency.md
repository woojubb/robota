---
title: 'CONFIG-001: Align package tsconfig base + resolve rimraf version skew'
status: todo
created: 2026-06-27
priority: low
urgency: later
area: packages (tsconfig, package.json)
depends_on: []
---

# Align package tsconfig base + resolve dep version skew

## What

1. **tsconfig base inconsistency.** 6 packages extend the **root** `../../tsconfig.json`
   (the monorepo dev config: `noEmit`, workspace `references`, `verbatimModuleSyntax`) instead
   of `../../tsconfig.base.json` (the library config the other 17 packages extend):
   `agent-interface-transport`, `agent-interface-tui`, `agent-preset`, `agent-remote-client`,
   `agent-session-analytics`, `agent-web-ui` (each `tsconfig.json:2`).
   **Accurate impact (verified):** this does NOT break shipped declarations — the build uses
   `tsdown --dts` and these packages DO emit `dist/**/*.d.ts` (checked agent-web-ui +
   agent-preset). The real problem is that each package's `typecheck` (`tsc --noEmit`) runs
   under a **different compiler-option baseline** than the rest, so typecheck strictness/flags
   are inconsistent across the monorepo. Point all six at `tsconfig.base.json` (or whichever is
   canonical for package typecheck) so every package typechecks under the same rules.
2. **rimraf version skew.** `rimraf` is `^6.1.3` in `agent-command`, `agent-plugin`,
   `agent-subagent-runner` but `^5.0.10` in 18 other packages → two majors installed. Pin to a
   single range (devDep, low risk, but unnecessary duplication). Consider a root `pnpm`
   `overrides`/catalog entry to prevent future drift.

## Why

A consistent typecheck baseline means "passes typecheck" has one meaning repo-wide (a package
on the dev config could pass under looser/different flags than CI expects). The dep skew is
minor hygiene but trivially fixable and avoids duplicate installs.

## Done When

- All packages extend the same canonical base for typecheck; `pnpm typecheck` passes repo-wide
  with the unified config.
- `rimraf` resolves to a single version; `pnpm install --frozen-lockfile` passes with a
  minimal lockfile diff.

## Test Plan

- Grep `packages/*/tsconfig.json` `extends` → single canonical base.
- `pnpm typecheck` green after the change (fix anything the unified config surfaces).
- `pnpm why rimraf` (or lockfile grep) → one version.

## User Execution Test Scenarios

Not applicable — build/config hygiene; no runtime behavior change. Evidence = unified
`extends` + single rimraf version + green typecheck.
