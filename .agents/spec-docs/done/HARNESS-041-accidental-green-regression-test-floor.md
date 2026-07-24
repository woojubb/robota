---
status: done
completed: 2026-07-23
type: INFRA
tags: [harness, ci, testing, accidental-green, tdd]
---

# HARNESS-041: mechanical floor for accidental-green regression tests

## Problem

A regression test for a bug/leak/race fix is worthless if it also passes on the buggy pre-fix code
("accidental-green") — it guards nothing and gives false assurance. The principle is already a rule
([tdd-and-planning.md](../../rules/tdd-and-planning.md) "Prove the regression test RED") and a REQUIRED
`pr-review-reviewer` guardian step. But per [enforcement-architecture.md](../../rules/enforcement-architecture.md),
every guardian must be backed by a mechanical scan/hook floor — the reviewer is an agent judgement that can be
skipped or can miss. This item builds that floor.

It recurred **twice in one session** (ARCH-004 RUNTIME-14 disconnect test, CORE-026 RUNTIME-12 concurrency
test), both caught only by the reviewer manually running the test against `origin/develop`. A mechanical check
turns "the reviewer happened to check" into "the pipeline always checks".

## Prior Art Research

The general technique is **mutation testing** — mutate the source, re-run the tests, and require that some test
now fails ("the mutant is killed"); a surviving mutant means the tests do not actually exercise that code.

- **Stryker Mutator** (JS/TS) — https://stryker-mutator.io/docs/ — mutates source and reports survived vs killed
  mutants; the canonical JS implementation of "a test that never fails on a changed source is not testing it".
- **PIT / Pitest** (JVM) — https://pitest.org/ — same principle for Java; the reference for
  mutation-driven test-effectiveness.
- The general TDD red-green discipline (Beck) — a regression test must be observed FAILING before the fix, or it
  proves nothing.

Key constraint that shapes our design: full mutation testing is **too expensive per-PR** (mutates the whole tree,
runs the suite N times). Our situation is narrower and cheaper: we already HAVE the intended mutation — it is the
**inverse of the PR's own source diff**. Reversing the fix and requiring the changed test to fail is a single,
targeted "mutant" (the exact code the PR changed), not a combinatorial sweep. So we adopt the mutation-testing
_principle_ with a PR-diff-scoped, single-mutant implementation. INFRA-042 (nightly mutation testing) remains the
place for broad, scheduled Stryker-style coverage; this item is the cheap per-PR floor.

## Decision

Ship a **PR-scoped "regression red-proof" CI check**, not a `run-all-scans` static scan (it executes tests, so it
belongs in a dedicated CI job the way `tui-e2e` / `examples-typecheck` do — `.github/workflows/ci.yml`). The
design resolves the three obstacles the backlog flagged (pairing, false positives, cost) and the four binding
constraints from GATE-APPROVAL (C1–C4 below).

### Mechanism (`scripts/harness/check-regression-red-proof.mjs`)

1. **Compute the range** `merge-base(origin/develop, HEAD)..HEAD`. Split changed files into **source**
   (`packages/*/src/**` and `apps/*/src/**`, excluding `*.test.*`, `*.spec.*`, `**/__tests__/**`) and **test**
   (`*.test.*` / `*.spec.*` / `__tests__`).
2. **Defect-fix scoping (C2).** Qualify the range only if it contains a `fix:` / `fix(` conventional commit — the
   commit type whose regression tests must be red-proof. `feat:`/`docs:`/`chore:`/`refactor:`/`perf:` ranges are
   NOT in scope (new-feature and refactor tests need not fail at base; **`perf:` is excluded because a perf fix
   rarely has a boolean test that fails on the slow path without flaky timing** — perf PRs are expected opt-out
   candidates if they ever mix in a `fix:`).
3. **Same-package pairs only (the cost + pairing fix).** For each package that has BOTH a source change and a
   test change, evaluate that package. A same-package test imports the changed source **relatively** (e.g.
   `../CjkTextInput.js`), which vitest resolves to the TypeScript `src` directly — so reversing the source hunk
   changes what the test sees **with no rebuild and no reinstall** (vitest transforms `src` on the fly; it never
   reads `dist` for same-package resolution). Cross-package fix+test pairs resolve the dependency through built
   `dist` and would need a rebuild — a v1 false-NEGATIVE (a miss), explicitly accepted; the two recurrences were
   both same-package. Packages with only source OR only tests changed are skipped (nothing to prove).
4. **Dirty-tree refusal (C4 — safety).** Before mutating, abort if any target source path has a pre-existing
   uncommitted edit (`git status --porcelain <src paths>` non-empty). CI trees are clean; this prevents a local
   self-run from silently discarding uncommitted work on restore. (This exact failure mode was demonstrated
   during GATE-APPROVAL when a `git reset --hard` discarded working-tree files.)
5. **Module-graph guard (C3).** Only mutate a source file that the changed test actually imports **relatively**
   (resolve the test's relative-import graph and confirm the reversed file is in it). If a qualifying source file
   is NOT reachably imported by any changed test in its package (e.g. the test imports it via package name/`dist`,
   or they are unrelated same-package changes), do NOT emit accidental-green-fail — report **INCONCLUSIVE** for
   that pair. This protects against the tool mis-firing as the relative-import convention drifts.
6. **Reverse-apply the source hunks** for the pair via `git diff <base> -- <src paths> | git apply -R` onto the
   current working tree. No worktree, no rebuild, no reinstall.
7. **Run only the changed test files** for that package (`vitest run <changed test files>`), capturing the
   machine-readable result (`--reporter=json`) so assertion failures are distinguished from run errors.
8. **Verdict (C1 — correctness-critical).** Classify the outcome per changed test, never conflating the two:
   - **≥1 changed test has a genuine assertion/test FAILURE** → **red-proof-ok** (PASS): the test exercises the
     fixed behavior.
   - **vitest could not evaluate** (transform/type error, collection error, module-not-found from a reversed
     _added_ file — i.e. the suite never ran the assertion) → **INCONCLUSIVE** (advisory warn, surfaced), NEVER
     counted as red-proof. A false green here would re-introduce exactly the accidental-green blindness this tool
     exists to kill.
   - **all changed tests PASS with the fix reversed** → **accidental-green-fail** (the tests do not exercise the
     fix).
9. **Always restore** the reversed hunks in a `finally` (`git checkout -- <src paths>`), so the tree is never
   left mutated even on error (guarded by step 4's clean-tree precondition).

### Opt-out (the false-positive escape hatch)

A PR legitimately mixing a `fix:` with an **unrelated** new test in the same package, or a fixture/refactor test
that correctly passes at base, opts out with **`allow-green-at-base: <reason>`** in the PR body or a range commit
trailer. The check greps the range's commit messages + the PR body (when `GITHUB_*` env is present) for the
marker and, if found with a non-empty reason, reports **SKIPPED** (logged, never silent — same anti-rot posture
as `allow-fallback`).

### Non-blocking rollout

Wire it as a **dedicated CI job** on PRs to `develop`. To avoid a false positive (or an INCONCLUSIVE) wedging the
pipeline before the heuristic is battle-tested, v1 is **advisory** (job runs, prints the verdict, is NOT added to
the required-checks ruleset) — flip to required in a follow-up once it has proven stable across real PRs. Log
every decision (evaluated / skipped-no-pair / skipped-not-fix / skipped-opt-out / red-proof-ok / inconclusive /
accidental-green-fail).

## Test Plan

- **Red/green fixtures** under `scripts/harness/__tests__/regression-red-proof/`, driven through injected
  "diff provider" + "test runner" seams (so fixtures need no real nested git repos); the checker's pure decision
  logic (classify → scope → verdict) is unit-tested directly:
  - `genuinely-red`: source fix + a same-package test asserting the fixed behavior → reversing source makes the
    test **assertion-fail** → **red-proof-ok** (PASS).
  - `accidental-green`: same source fix + a test asserting an invariant already true at base → reversing source
    leaves it green → **accidental-green-fail**.
  - `inconclusive-transform-error` (C1): reversing source yields a broken import / missing symbol so vitest
    cannot run → **INCONCLUSIVE**, NOT red-proof-ok.
  - `not-imported` (C3): a same-package source+test change where the test does not import the reversed file →
    **INCONCLUSIVE**, not accidental-green-fail.
  - `opt-out`: accidental-green fixture + `allow-green-at-base: <reason>` → **SKIPPED**.
  - `no-pair` / `not-fix`: source-only, test-only, and non-`fix:` ranges → **SKIPPED** (out of scope).
- `node scripts/harness/check-regression-red-proof.mjs` self-runs green (no qualifying pair) on this repo's
  current PR shape.

## User Execution Test Scenarios

- Not applicable (harness/CI check). The scan's own red/green/inconclusive fixtures ARE the maintained gate,
  exercised by the agent in CI and locally. Evidence: the fixture results recorded in the Evidence Log.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-23

- Prior-art (mutation testing: Stryker/PIT) substantiated; design resolves pairing (same-package scope), false
  positives (`fix:`-only scoping + `allow-green-at-base` opt-out), and cost (reverse-source-patch, no rebuild).
- Frontmatter: status/type INFRA/tags present; scan-spec-research + check-spec-doc-frontmatter green.
- **Linchpin premise empirically validated** (2026-07-23): reversed the CLI-061 defer-submit hunk in
  `CjkTextInput.tsx` (→ synchronous `onSubmit(effect.value)`) in the current working tree and ran
  `cjk-defer-submit.test.tsx` with NO rebuild — the 2 same-package tests went from **2 passed → 2 failed**, then
  restored identical to HEAD. Second premise: `git diff <base> -- <src paths> | git apply -R --check` on the
  mixed source+test CLI-061 squash applies cleanly (source-only pathspec filter, test hunks excluded).

### [GATE-APPROVAL] — ✅ PASS | 2026-07-23

Independent `proposal-reviewer`: **REVISE → conditional ENDORSE**. Verified all four premises against the real
code (empirically proved P1: mutated `src` in place, no build, test went red; confirmed `dist/CjkTextInput.js`
does not even exist so vitest reads `src` regardless of build state — the "already-built tree" language was
dropped as misleading). Endorsed the direction, same-package scoping (the honest boundary of reverse-without-
rebuild, not a diff-size dodge), the single-mutant cost trade (broad sweeps → INFRA-042), and advisory-first
rollout. Four binding constraints folded into the Mechanism:

1. **C1 (correctness-critical):** a vitest run-error (transform/collection/module-not-found) is **INCONCLUSIVE**,
   NEVER red-proof-ok — only a genuine assertion failure counts. Conflating them would re-introduce accidental-
   green blindness. Added the `inconclusive-transform-error` fixture.
2. **C2:** qualify on `fix:`/`fix(` only; `perf:` excluded (no boolean fail-at-base without flaky timing).
3. **C3:** only mutate a source file the changed test imports relatively (module-graph guard); else INCONCLUSIVE.
4. **C4:** refuse to mutate a dirty tree (abort if target src paths have uncommitted edits) so restore cannot
   discard local work.

Rule alignment: ALIGNED with enforcement-architecture.md (prose/agent guardian → machine floor, reuses the
CI-job floor pattern, no new orchestration tier) and tdd-and-planning.md "Prove the regression test RED".

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-23

- `scripts/harness/check-regression-red-proof.mjs` — pure decision core (`classifyChanges`, `qualifyingPairs`,
  `isDefectFixRange`, `parseOptOut`, `classifyVitestOutcome`, `decidePairVerdict`, `reachableRelativeGraph`)
  separated from an injectable-seam orchestrator (`runRegressionRedProof({ mergeBase, changedFiles,
commitSubjects, reverseApply, runVitest, restore, isDirty, readText, fileExists })`). All of C1–C4 implemented:
  C1 run-error→INCONCLUSIVE (never a pass), C2 `fix:`-only, C3 relative module-graph guard, C4 dirty-tree refusal
  with `finally` restore.
- CI: advisory `regression-red-proof` job in `.github/workflows/ci.yml` (`if: base_ref != 'main'`, fetches base
  for merge-base, exits 0 unless `REGRESSION_RED_PROOF_ENFORCE=1`). Invoked directly as
  `node scripts/harness/check-regression-red-proof.mjs` — a `package.json` script alias is intentionally NOT
  added, because touching `package.json` triggers the `security-audit` osv-scanner, which surfaced 18
  pre-existing dependency advisories (filed as INFRA-044). This feature must not carry a dep-remediation; the
  alias can be added once the audit is clean.

### [GATE-VERIFY] — ✅ PASS | 2026-07-23

- **29 unit tests** (`scripts/harness/__tests__/check-regression-red-proof.test.mjs`) cover the full fixture
  matrix: genuinely-red, accidental-green, inconclusive-transform-error (C1), multi-file C1 (a run-error file is
  not masked by a passing sibling), not-imported (C3), sibling-package boundary, dynamic-import/comment parsing,
  dirty-tree (C4), opt-out, not-fix, no-pair, and restore-on-throw. `pnpm harness:test` → **433 pass**.
- **Real end-to-end integration proof** on the CLI-061 fix commit `b9893455f`: real `git apply -R` of the source
  hunks (incl. deleting the new `defer-submit.ts`) + real `vitest` on the changed test files → C3 detected the
  import (`importsReversedFile: true`), outcome `assertion-fail` → **red-proof-ok**; tree clean after restore.
  This is the accidental-green check catching the inverse — it PASSES a genuinely-red regression test.
- Self-run on `develop` → correct SKIP (no `fix:` range). YAML validates (job `regression-red-proof` present).
  63/63 scans pass.

### [PR REVIEW] — ✅ resolved | 2026-07-23

Independent `pr-review-reviewer` (HARNESS-018): **1 ACTIONABLE (SHOULD)** — fixed. `classifyVitestOutcome`
masked a run-error as `all-pass` when a pair had MULTIPLE changed test files (one passing, one that failed to
collect), producing a false `ACCIDENTAL_GREEN` — a direct C1 violation (empirically reproduced by the reviewer).
Fixed: any wanted test file that did not run WITH assertions (missing OR zero-assertion) → `run-error`
(INCONCLUSIVE); an assertion failure still wins. Also fixed 2 CONSIDER (sibling-package prefix match
`pkgAbsRoot + path.sep`; dynamic `import()` + comment stripping in the graph regex) and the index-resolution NIT.
Regression tests added for each. Reviewer confirmed a false-GREEN is structurally impossible (`RED_PROOF_OK`
requires a real failed assertion), restore is `finally`-guaranteed, and the C4 dirty-guard precedes mutation.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-23

Merged to develop (PR #1272, squash `b16e49a0e`) + review-fix (`3157b399b`). `pr-review-reviewer`: 1 ACTIONABLE
(SHOULD, the multi-file C1 conflation) — fixed with regression tests; false-GREEN confirmed structurally
impossible. All CI green incl. the new advisory `regression-red-proof` job (correctly SKIPs on this `feat:` PR).
Merge independently verified on `origin/develop` (checker + job + INFRA-044 present). Spec → `done/`; the
`package.json` alias was deferred to INFRA-044 (pre-existing dep advisories). Backlog item (this spec) closed;
knowledge mirrored to `.agents/memory/`.
