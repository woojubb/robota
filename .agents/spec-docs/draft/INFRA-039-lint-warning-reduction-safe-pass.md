---
status: draft
type: INFRA
tags: [lint, code-quality, maintainability, dag-cli]
---

# INFRA-039: high-leverage lint-warning reduction (magic-numbers + oversized functions), rules unchanged

## Problem

`pnpm lint` reports **0 errors / ~1798 warnings**. The build is green by design — the lint script
(`package.json:24`, `eslint packages apps --ext .ts,.tsx --cache`) sets **no `--max-warnings` gate**, and no
CI job enforces zero warnings. The warnings are an **intentional two-tier policy**, not accidental debt:

- **Hard errors (block CI):** `@typescript-eslint/no-explicit-any`, hardcoded event names, `no-require-imports`,
  and `eslint-comments/no-restricted-disable` (`.eslintrc.json:117-125`, which makes it illegal to
  `// eslint-disable` `ban-types`/`no-explicit-any` inside `packages/*/src` and `apps/*/src`).
- **Soft warnings (visible, non-blocking nudges):** `@typescript-eslint/ban-types` on `unknown` (`.eslintrc.json:24`,
  `unknown은 조건부 허용` — conditionally allowed at boundaries), `no-magic-numbers` / `complexity:15` /
  `max-lines-per-function:50` (`.eslintrc.json:96-108`). All `off` in tests/config/examples.

The warning volume erodes the signal: a genuinely-new warning in a PR is invisible in a 1798-line haystack. This
spec reduces the two **mechanical, low-risk** warning classes so the count drops without touching any rule.

## Current State (verified 2026-07-16)

Warning breakdown from a full `pnpm lint` run (health-skill measurement):

| Rule                                | Count | Nature                                       | In scope here    |
| ----------------------------------- | ----- | -------------------------------------------- | ---------------- |
| `@typescript-eslint/ban-types`      | 737   | `unknown`/`any` in shipped src — type-safety | ❌ (gated)       |
| `no-magic-numbers`                  | 485   | unnamed numeric literals                     | ✅               |
| `max-lines-per-function` (>50)      | 314   | oversized functions                          | ✅               |
| `complexity` (>15)                  | 242   | over-branchy functions                       | ✅               |
| `@typescript-eslint/no-unused-vars` | 85    | dead bindings (already `^_`-ignored)         | ➖ opportunistic |

**Concentration (Pareto):** the largest source files are dominated by `packages/dag-cli/src/commands/*` —
7 of the top 11 by line count: `run.ts` (2389), `node.ts` (1484), `benchmark.ts` (907), `validate.ts` (814),
`explain.ts` (785), `lint.ts` (732), `compare.ts` (701), plus `agent-framework/src/interactive/interactive-session.ts`
(854) and `agent-transport-tui/src/TuiInteractionChannel.ts` (692). `max-lines-per-function` + `complexity`
warnings co-occur in these god-functions, so a small file set holds a disproportionate share of the 556 combined.

## Prior Art Research

- **eslint rule semantics (product docs).** `no-magic-numbers` (`enforceConst`), `complexity`, and
  `max-lines-per-function` are standard maintainability rules; the recommended remediation (extract named
  consts, split oversized functions) is the eslint-documented intent, not a novel approach.
- **Warning-debt convention (common behavior).** Large TS monorepos ratchet warnings down without a blanket
  `--max-warnings 0` flip (which would block CI on legitimate complex code) — matching this repo's
  intentional two-tier policy. The reduction is mechanical, per-file, and test-backed.
- **Constraint for Robota.** No external product dictates the naming/threshold choices here; the design
  derives from the repo's own `.eslintrc.json` policy. No comparable commercial product behavior applies —
  this is internal code-quality cleanup.

## Proposed Change

Two independent, sequenceable work streams. **No `.eslintrc.json` change of any kind** — no threshold bumps
(`complexity 15→N`, `max-lines-per-function 50→N`), no rule disables, no per-file `eslint-disable`. Reducing the
count by blinding the nudge is explicitly rejected.

### Stream A — `no-magic-numbers` const-extraction (485)

Extract repeated/meaningful numeric literals into named `const`s (module- or class-scoped, `SCREAMING_SNAKE`
for true constants). The rule already ignores `-1, 0, 1, 2`, array indexes, and default values, so every
remaining hit is a literal that genuinely reads better named (timeouts, byte offsets, retry counts, UI px,
exit codes). `enforceConst: true` is already set, so the fix direction is unambiguous.

### Stream B — behavior-preserving function splits (556: 314 + 242)

Split the top ~30 oversized/over-complex functions (start with `dag-cli/src/commands/*`) into named helpers.
Pure extraction — no behavior change, no signature change to exported/public API. Each split must keep the
package's existing tests green as the regression net.

### Implementation Details

1. **Generate the inventory first.** `pnpm lint -f json > lint.json`, then group by `ruleId` + `filePath` to
   produce the exact per-file offender list and counts (the numbers above are the aggregate; the per-file
   ranking is the work-list). Commit the ranked list into the PR description, not the repo.
2. **Batch by file, not by warning.** One file's magic-numbers + function-splits land together so review sees a
   coherent before/after per file. Keep each PR to a handful of files (1-3 days of work per the backlog sizing rule).
3. **Verify per PR:** `pnpm typecheck` clean, the touched package's `pnpm --filter <pkg> test` green, and
   `pnpm lint` warning count strictly decreased (capture before/after totals in the PR body).

## Acceptance Criteria

1. `.eslintrc.json` is **byte-identical** to its pre-INFRA-039 state (no rule/threshold/override change) — verified by `git diff`.
2. Total `pnpm lint` warning count drops by **≥ 700** (Stream A ~485 + Stream B ~250 of the 556; conservative).
3. `no-magic-numbers` count drops by **≥ 400**.
4. `max-lines-per-function` + `complexity` combined count drops by **≥ 200**.
5. `pnpm typecheck` reports 0 errors; every touched package's tests pass; no new warnings of any rule introduced.
6. No `eslint-disable` / `eslint-disable-next-line` added anywhere under `packages/*/src` or `apps/*/src`.
7. Zero public API signature changes (verified against each package's `docs/SPEC.md` Public API Surface table).

## Testing Plan

| Layer       | What                                                                              | Count |
| ----------- | --------------------------------------------------------------------------------- | ----- |
| Static      | `pnpm lint` before/after count; `pnpm typecheck`; `git diff .eslintrc.json` empty | gate  |
| Unit        | Existing package tests re-run per touched package (regression net for splits)     | 0 new |
| Integration | `dag-cli` command smoke (run/node/validate) unchanged output for a fixture DAG    | reuse |

No new tests are required — this is behavior-preserving. If a function split reveals an untested branch,
add a unit test for that branch (opportunistic coverage, not a blocker).

## Rollback Plan

Pure mechanical refactor with no data/infra/API change — revert the PR. Each PR is independently revertible
because streams are batched per-file.

## Effort Estimate

Per stream (CC-assisted): Stream A ~ per-file codemod-able, ~15 min/file × ~20 files. Stream B ~ 30-45 min per
god-function (split + re-verify) × ~30 = the larger cost. Total spread across ~6-10 PRs so no single review is huge.

## Files Reference

| File                                                                                  | Change                                     |
| ------------------------------------------------------------------------------------- | ------------------------------------------ |
| `packages/dag-cli/src/commands/run.ts` (2389)                                         | Split god-functions; extract magic numbers |
| `packages/dag-cli/src/commands/node.ts` (1484)                                        | Same                                       |
| `packages/dag-cli/src/commands/{benchmark,validate,explain,lint,compare,tutorial}.ts` | Same                                       |
| `packages/agent-framework/src/interactive/interactive-session.ts` (854)               | Same                                       |
| `packages/agent-transport-tui/src/TuiInteractionChannel.ts` (692)                     | Same                                       |
| `.eslintrc.json`                                                                      | **NO CHANGE** (asserted by AC-1)           |

## Out of Scope

- `@typescript-eslint/ban-types` / `unknown` → SSOT-type migration (737). This is genuine type-safety work
  (`unknown` → `TUniversalValue` + boundary type-guards) that must go per-package through the normal spec-gate,
  not a bulk mechanical sweep. Track separately.
- Any `.eslintrc.json` rule/threshold change.
- New feature work or behavior changes of any kind.

## Related

- Root-cause analysis: `investigate` session 2026-07-16 (lint two-tier policy).
- Policy owner: `.eslintrc.json`; rules doc `.agents/rules/code-quality.md`.
