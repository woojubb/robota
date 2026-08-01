---
title: 'HARNESS-016: Promote no-explicit-any from warn to error so CI blocks `any`'
status: done
created: 2026-06-27
completed: 2026-06-27
priority: high
urgency: now
area: root (.eslintrc.json)
depends_on: []
---

## Evidence Log (2026-06-27)

- `.eslintrc.json:23` `@typescript-eslint/no-explicit-any` flipped `warn` → `error`; test
  override (`:183`) keeps `off`, so tests stay exempt and `no-restricted-disable` still bars
  disabling it in `packages/*/src`+`apps/*/src`.
- The only shipped `any` was 5 mdast traversal sites in `apps/docs/src/lib/remark-fix-links.ts`
  - `remark-mermaid.ts`. Replaced with a typed `IMdastNode`/`IMdastAttribute` SSOT in new
    `apps/docs/src/lib/mdast-types.ts` (no new deps, no `any`/`unknown`).
- Verification: `apps/docs` `tsc --noEmit` clean; `pnpm lint` → **0 errors** (689 pre-existing
  warnings, none from this change). A planted `const x: any` in shipped src now errors.

---

# Promote `no-explicit-any` from warn to error

## What

`.eslintrc.json:23` sets `@typescript-eslint/no-explicit-any` to `"warn"`. The only
mechanical block on `any` today is the agent edit-time hook
(`.claude/hooks/check-forbidden-patterns.sh`), which catches **agent** edits only — an `any`
introduced by a human, a refactor tool, or an agent that bypasses the hook still passes
`pnpm lint` (CI) green, because a warning is not a failure.

Change the rule to `"error"` for shipped source. Keep the existing test/`*.config`/`*.d.ts`
overrides that already set it to `off` (`.eslintrc.json:183` and the per-glob overrides), so
tests remain exempt — this only tightens shipped `src/`.

## Why

The repo's `code-quality.md` rule "no `any`" is currently enforced only against one author
(the agent) at one moment (edit time). Making it an ESLint `error` closes the gap so the
existing CI `lint` step (`ci.yml`) fails on any `any` in shipped source, from any author —
turning a documented MUST-NOT into a mechanical gate (AGENTS.md: "prefer a mechanical check
over adding more prose").

## Done When

- `@typescript-eslint/no-explicit-any` is `"error"` for shipped source; test/config/d.ts
  overrides keep their current `off`.
- `pnpm lint` passes on the current tree (i.e. no existing shipped `any` regressions — if any
  surface, fix them or scope the override explicitly and note why).
- CI fails when a deliberate `any` is added to a shipped `src/` file.

## Test Plan

- `pnpm lint` on the current tree → clean (or enumerate + fix the offenders the bump surfaces).
- Add a throwaway `const x: any = 1` to a shipped src file → `pnpm lint` errors; remove it.

## User Execution Test Scenarios

1. Add `any` to a shipped source file and run `pnpm lint` → it reports an error (not a
   warning) and exits non-zero. Evidence: _to fill._
