---
id: PERF-005
title: Remove the legacy TypeScript compiler — eliminate every avoidable use, then gate on upstream
status: done
priority: medium
type: INFRA
completed: 2026-07-27
created: 2026-07-26
depends_on: [PERF-004]
---

> **Phase 1 is DONE (2026-07-26).** All four steps landed; see
> [Phase 1 outcome](#phase-1-outcome-done-2026-07-26) at the end of this file for what shipped, the
> verification evidence, and the two things the work discovered that this item's premise had wrong.
> The file stays in `.agents/tasks/` (not `completed/`) because **phase 2 is still open** and
> gated on upstream.

# PERF-005: remove `typescript@5.9.3`

## Goal

PERF-004 switched `typecheck` to the native compiler (`tsgo`, 30.0 s → 6.2 s, byte-identical
diagnostics on 99/99 projects) but deliberately kept `typescript@5.9.3` installed. The goal now is to
remove it entirely. This item does the removable part and states precisely what blocks the rest.

## What actually holds it in place — measured, not assumed

> **Two entries below were corrected by phase 1 — read this before scoping phase 2.**
>
> - **`knip` is gone** (removed in phase 1), so it is no longer a blocker.
> - **The package is declared by 99 workspace manifests, not one root devDependency.** The
>   "Note on cost" section below still says "a devDependency", singular; that is wrong. None of the
>   99 is a code consumer, but phase 2's real size is 96 baselined manifest entries plus the root —
>   not one line. See [Phase 1 outcome](#4-the-anti-regrowth-guard).
> - **`unstable/ast` exports no parser**, contrary to the paragraph below it and to PERF-003/PERF-004.
>   The working route is `unstable/sync` + a virtual filesystem + tsgo's inferred project; it is
>   documented in full at the top of `scripts/harness/lib/ts-ast.mjs`, which is the file to open.

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

> **Corrected again by phase 1.** The API exists, but `unstable/ast` does **not** contain a parser —
> only `createScanner` (tokens, no tree) and a factory `createSourceFile` that builds a node from
> already-parsed statements. The parser lives in the Go binary. A single-file syntactic parse goes
> through `unstable/sync`: an `API` with a virtual filesystem, the source presented at a path no
> tsconfig covers, so `getDefaultProjectForFile` resolves it to tsgo's **inferred project**
> (`/dev/null/inferred`) and parses it without loading any configured project. Three documents
> carried the wrong version of this fact; the authoritative account now lives in the module header of
> `scripts/harness/lib/ts-ast.mjs`, next to the code that depends on it.

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

- `.agents/tasks/completed/PERF-004-tsconfig-ts7-compatibility-migration.md`
- `.agents/tasks/completed/PERF-003-*` — the two-compiler equivalence criterion
- `scripts/harness/scan-interface-runtime.mjs`, `check-spec-public-surface.mjs`,
  `scan-composition-neutrality.mjs`, `scripts/audit/audit-implements.mjs`

---

## Phase 1 outcome (DONE 2026-07-26)

All four steps landed. **No first-party code in the repository imports the legacy compiler**, and a
mechanical guard now keeps it that way.

### 1. The four scans, moved behind one adapter

`scripts/harness/lib/ts-ast.mjs` is the single swap point; the four scans import it and nothing else
changed about how they work.

**The parse entry point — found, but not where this item assumed.** This item recorded that
`unstable/ast` exports the parser. It does not. Probed directly against the shipped `.d.ts` and at
runtime:

- `unstable/ast` has 409 exports and **no `createSourceFile(text)`**. The only parse-adjacent names
  are `createScanner` (a token scanner — no tree) and `isSourceFile` (a guard).
- `unstable/ast/factory`'s `createSourceFile(statements, endOfFileToken, text, fileName, path)` is a
  node CONSTRUCTOR over already-parsed statements, not a parser.
- The parser lives in the Go binary. The only route to a tree is `unstable/sync`, which spawns the
  tsgo server and answers over a synchronous RPC channel.

**It is nonetheless viable, via the inferred project.** `unstable/sync`'s `API` accepts a virtual
filesystem (`APIOptions.fs`). Presenting the source at a path no tsconfig covers puts it in tsgo's
_inferred project_ — `getDefaultProjectForFile` returns `/dev/null/inferred` — which parses and
binds the file without loading any configured project or touching the real build graph. That is the
standalone syntactic parse, and it is what the adapter does. Measured on 400 real repo files, the
native walk visits **239,234 nodes — exactly the legacy count**.

Four real API differences, all reconciled at the swap point rather than by weakening a caller:

| Difference                             | Native form                                                                                | Handling                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| No standalone parser                   | `unstable/sync` + virtual FS + inferred project                                            | adapter's `createSourceFile`               |
| `ImportClause.isTypeOnly` not declared | `phaseModifier === SyntaxKind.TypeKeyword`                                                 | `isTypeOnlyImportClause()` helper          |
| Array holes                            | `BindingElement` with no `name` (legacy: `OmittedExpression`)                              | nameless elements skipped in `bindPattern` |
| Three guards renamed                   | `isParameterDeclaration`, `isMethodSignatureDeclaration`, `isPropertySignatureDeclaration` | aliased back to legacy names               |

An import-time assertion in the adapter fails loudly if the pinned dev build stops exporting any
re-exported guard. That matters because a missing guard destructures to `undefined`, which only
throws if that branch is reached — a rare-path guard could otherwise go missing and quietly turn a
scan into a weaker version of itself.

**Cost.** A parse is one RPC round-trip, ~4.8 ms vs ~0.8 ms in-process. The three CI scans parse
tens of files each (interface-runtime: 17). The repo-wide `audit-implements` parses 1,832 and takes
a few seconds. Batching reaches near-parity but was deliberately not done — it would restructure
each scan's control flow, and the whole point was that the finding sets do not move.

### 2. `apps/action` → `tsgo`

`"build": "tsc"` → `"build": "tsgo"`, and `typescript` dropped from its devDependencies (`typecheck`
was already on `tsgo`). **Byte-identical emit** across all 8 output files, md5-compared before and
after:

```
a6e89e84d749b75cc408f75984799613  dist/build-invocation.d.ts
41270038ab16bfbeb5fd244a7c8be765  dist/build-invocation.js
38a9997bacc2b978b590f73ab4ff6e7a  dist/index.d.ts
b790439cf2e2cf171e36872ef291bf2c  dist/index.js
```

(plus the four `.map` files, likewise identical). Its 6 tests pass with `typescript` uninstalled.
No new devDependency was added: `tsgo` resolves from the root declaration, the same way every other
package's `typecheck` already does.

### 3. `knip` removed — it was genuinely unwired

Verified before removing, not assumed. Live references were exactly three: the `package.json`
script, the devDependency, and `knip.json`. **Zero** matches across all of `.github/` (14 workflows),
`.husky/`, and `scripts/`. Nothing invoked the script. All three removed plus the config file; the
lockfile diff is **240 lines, pure deletions** (knip and its `@oxc-resolver` transitives), with no
additions — so nothing was silently upgraded alongside.

The remaining `knip` mentions are historical (CHANGELOG, completed task docs) and were left alone.

### 4. The anti-regrowth guard

`scripts/harness/scan-legacy-typescript.mjs`, registered in `run-all-scans.mjs` as
`legacy-typescript` (69 scans now) and as `pnpm harness:scan:legacy-typescript`. Detection is a
token prefilter plus an **AST confirmation** on the module specifier, so `@typescript-eslint/*`,
`@typescript/native-preview`, and the word in prose or a string do not false-positive.

Following `scan-no-fallback`'s anti-rot conventions, with one deliberate strengthening: it
implements **stale**-suppression detection, which `scan-no-fallback` had to defer. It can, because
the construct here is exact — an import specifier — so an annotation covering no flagged import is
unambiguously dead rather than merely inert.

Six finding kinds, each proven to fire (see evidence below): `legacy-typescript-import`,
`legacy-typescript-dependency`, `reasonless-annotation`, `stale-annotation`, `unused-exemption`, and
a ratchet-tightening notice.

**A correction to this item's premise, found by building the guard.** This item says `typescript` is
"a devDependency" — singular, root. It is not: **99 workspace manifests declare it**. None is a code
consumer (phase 1 removed the last import; these packages build with `tsdown`, whose peer admits 7,
and typecheck with `tsgo`), but deleting 98 manifest entries is its own change with its own blast
radius, and nearly all of those files were outside this item's scope. They are frozen as a path
ratchet in `legacy-typescript-baseline.json` (96 entries after `apps/action` was cleared and the
root took its reasoned exemption) — the same shape `check-spec-public-surface` uses. A manifest not
already baselined may not start declaring it, and the list may only shrink. **This is new work phase
2 must absorb**, and it is larger than "delete one devDependency".

### Verification

**Finding-set equivalence — the check that actually mattered.** Each scan's detection functions were
run over the WHOLE repo (2,699 files — far wider than any of their production scopes, so the sets
are big enough that a silent regression shows), before and after, and diffed:

| Scan                          | Finding set                | Before vs after |
| ----------------------------- | -------------------------- | --------------- |
| `scan-interface-runtime`      | 3,624 findings             | identical       |
| `check-spec-public-surface`   | 24 packages / 602 names    | identical       |
| `scan-composition-neutrality` | 1,044 IO + 30 conditionals | identical       |
| `audit-implements`            | 1,832 files / 340 classes  | identical       |

`diff -rq` over all five captured JSON files: **no differences**, sha256-equal, 33,259 lines of
findings in total. Re-run again after formatting; still identical.

**Red-first, per scan** — the defect each exists to catch was reintroduced and each still fires:

- `scan-interface-runtime` — 9 planted violations, all reported with correct lines and correct
  classification (value / namespace / default / side-effect / `export *`, and abstract-class vs
  const-enum). The two legitimate `import type` forms alongside them correctly stayed silent.
- `scan-composition-neutrality` — the exact HARNESS-048 evasion probe replanted (aliased global,
  bracket form, member access split across lines, dynamic `import()`, destructured identity, aliased
  identity, and all four conditional forms). **All 12 caught.** Array holes added no false positives.
  Guard (a) is pure manifest inspection, untouched by the AST migration, and is covered by tests.
- `check-spec-public-surface` — both edges: a phantom table identifier fires the forward edge; four
  new runtime exports fire the reverse ratchet, and the two type-only exports beside them were
  correctly excluded.
- `audit-implements` — planted an interface, an abstract base implementing it, and two derived
  classes; all appear with correct names, lines, `isAbstract` flags, `extendsName`, and the
  base-implements-then-extends chain.

**The new guard, RED then GREEN.** Restoring the four pre-migration `import ts from 'typescript'`
lines from `HEAD` produced exactly four findings with correct line numbers; the migrated tree passes.
The other five paths were each driven to fire and then to clear.

**Suites.** `pnpm build`, `pnpm typecheck`, `pnpm lint` (0 errors, 1,882 pre-existing warnings),
`pnpm harness:scan` (**69/69**), and the harness test suite (**1,075 tests, 87 files**) all green.
`pnpm harness:verify-like-ci` green on all 11 mirrored stages.

Two stages `verify-like-ci` flags as relevant but cannot mirror locally, both from the manifest and
lockfile edits: `security-audit` (needs network + the osv-scanner binary) and `windows-shell` (needs
a Windows host). The lockfile change is **deletions only**, so no new package entered the tree.

### Drive-by fix

`audit-implements.mjs` crashed with `ENOENT` on a fresh clone — its output directory is gitignored
and it never created it. It now does. This was blocking the very baseline capture this migration
needed, so it is fixed rather than reported.

## Phase 2 — still open, unchanged

Removing `typescript` from `package.json` remains gated on `@typescript-eslint` dropping its runtime
import (peer `>=4.8.4 <6.1.0`). Re-check that range to know when it is possible. Phase 2 must also
absorb the 96 baselined manifest declarations catalogued above.

## Closed 2026-07-27

Phase 1 complete — no first-party code imports the legacy compiler and a mechanical guard keeps it that way. Phase 2 is stated in the document as gated on upstream and explicitly not scheduled here, so it is not an open obligation of this item.
