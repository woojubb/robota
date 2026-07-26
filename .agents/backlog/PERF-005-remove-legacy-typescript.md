---
id: PERF-005
title: Remove the legacy TypeScript compiler — eliminate every avoidable use, then gate on upstream
status: todo
priority: medium
type: INFRA
created: 2026-07-26
depends_on: [PERF-004]
---

# PERF-005: remove `typescript@5.9.3`

## Goal

PERF-004 switched `typecheck` to the native compiler (`tsgo`, 30.0 s → 6.2 s, byte-identical
diagnostics on 99/99 projects) but deliberately kept `typescript@5.9.3` installed. The goal now is to
remove it entirely. This item does the removable part and states precisely what blocks the rest.

## What actually holds it in place — measured, not assumed

Every consumer of the `typescript` package, enumerated:

| Consumer                             | What it actually requires                                                               | Verdict            |
| ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------ |
| `scan-interface-runtime.mjs`         | `createSourceFile`, `forEachChild`, `isXxx`, `SyntaxKind`, `ScriptTarget`, `ScriptKind` | **movable**        |
| `check-spec-public-surface.mjs`      | same syntactic set                                                                      | **movable**        |
| `scan-composition-neutrality.mjs`    | same syntactic set                                                                      | **movable**        |
| `scripts/audit/audit-implements.mjs` | same syntactic set                                                                      | **movable**        |
| `apps/action` (`"build": "tsc"`)     | the compiler binary                                                                     | **movable**        |
| `tsdown` (builds 56 packages)        | peer `^5.0.0 \|\| ^6.0.0 \|\| ^7.0.0`, **optional**; already resolves against both      | already compatible |
| `vitest`, `@commitlint/cli`, `next`  | no `typescript` dependency                                                              | not a consumer     |
| **`@typescript-eslint`**             | `typescript-estree@8.61.0` **imports `typescript` at runtime**; peer `>=4.8.4 <6.1.0`   | **hard blocker**   |
| **`knip`**                           | peer `>=5.0.4 <7` — the range excludes 7 outright                                       | **hard blocker**   |

**No code in this repository uses the type checker.** A sweep for `createProgram`, `getTypeChecker`,
`getTypeAtLocation` and `LanguageService` returns nothing — the only matches are the unrelated
`createProgrammaticAgent`. All four scans are parser/AST walks. That is what makes them cheap to move.

**The native compiler does expose a programmatic API**, contrary to what PERF-003 and PERF-004 both
recorded. `@typescript/native-preview` exports `unstable/ast` (409 symbols including `SyntaxKind`,
`ScriptTarget`, `ScriptKind`, `createScanner`), `unstable/ast/is` (347 type guards — every guard the
four scans use is present), and `unstable/sync` (`Program`, `Checker`, `Emitter`, `Project`). The
earlier "no programmatic API" claim was wrong and is corrected here.

**ESLint does not use type-aware linting.** `.eslintrc.json` sets no `parserOptions.project`, so
`@typescript-eslint` is running as a pure syntactic parser. It still imports `typescript` internally,
so this does not remove the blocker — but it does mean nothing of value depends on the type
information, which matters if a parser swap is ever weighed.

## Phase 1 — eliminate every avoidable use (this item)

1. **Move the four scans to `@typescript/native-preview`**, behind a single adapter module (e.g.
   `scripts/harness/lib/ts-ast.mjs`) that the four import. Rationale for the indirection, and it is
   not stylistic: the API is namespaced `unstable/` with no stability guarantee, and the pinned
   version is a **dated dev build** (`7.0.0-dev.20260707.2`). These scans gate CI. One swap point
   keeps a breaking upstream change from becoming a four-file emergency.
2. **Switch `apps/action` from `tsc` to `tsgo`.** It is the last package building with the legacy
   binary; the other 56 use `tsdown`.
3. **Drop `knip`.** It is a hard blocker on its peer range, and it is wired into neither CI nor the
   git hooks — `package.json` declares the script and nothing invokes it. Removing it costs nothing
   measurable and closes one of the two blockers. If its dead-code reporting is wanted later, it can
   return when its peer range admits 7.
4. **Add a scan that fails on a NEW `typescript` import or dependency**, with the remaining known
   consumer (`@typescript-eslint`) as a declared, reasoned exemption. Without this the surface
   silently regrows — the anti-rot shape `scan-no-fallback` and `LEGACY_EVIDENCE_DEBT` already use.

After phase 1, **no first-party code depends on the legacy compiler.** Only the ESLint toolchain does.

### Verification for phase 1

- Each migrated scan must produce **identical findings** to its pre-migration form across the whole
  repo — capture both outputs and diff them. A scan that silently stops finding things is the failure
  mode here, and it looks exactly like success.
- Red-first per scan: reintroduce the defect each one exists to catch and confirm it still fires.
- The new import guard proven RED against the current tree (which has four such imports) and GREEN
  after the migration.
- `pnpm harness:verify-like-ci` (now a real CI mirror after INFRA-056), `pnpm build`, `pnpm lint`.

## Phase 2 — gated on upstream, not scheduled here

Remove `typescript` from `package.json` once **both** hold:

- `@typescript-eslint` supports the native compiler or drops its `typescript` runtime import;
- any reintroduced tool's peer range admits 7.

Track by re-checking the two peer ranges; no work is possible before then.

## The option deliberately NOT taken

Full removal today is achievable only by **replacing ESLint** (oxlint, Biome — Rust-based, no
`typescript` dependency). Rejected for now, and the reason is coverage rather than effort:
`.eslintrc.json` carries substantial accumulated policy — the type-safety rules, the
`no-floating-promises` rollout (INFRA-040), `eslint-comments`, `jsx-a11y` — and rule equivalence is
not 1:1, so the risk is a **silent** loss of lint coverage. It is also the wrong thing to bundle with
a compiler migration: two shared-ground changes in one PR make every downstream failure ambiguous,
which is the reasoning that made PERF-004 serial-only in the first place.

If the owner decides the linter swap is worth it, it belongs in its own item with its own
rule-by-rule coverage audit.

## Note on cost

`typescript` is a **devDependency and ships in nothing**. What its presence actually costs is install
size and the conceptual ambiguity of two compilers in one repo — not runtime risk. That is why phase 2
is worth waiting for rather than forcing.

## References

- `.agents/backlog/completed/PERF-004-tsconfig-ts7-compatibility-migration.md`
- `.agents/backlog/completed/PERF-003-*` — the two-compiler equivalence criterion
- `scripts/harness/scan-interface-runtime.mjs`, `check-spec-public-surface.mjs`,
  `scan-composition-neutrality.mjs`, `scripts/audit/audit-implements.mjs`
