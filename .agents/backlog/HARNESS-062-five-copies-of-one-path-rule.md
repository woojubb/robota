---
title: 'HARNESS-062: five implementations of "a cited repo path must resolve", giving three verdicts on one sentence'
status: in-progress
priority: medium
urgency: soon
type: HARNESS
area: scripts/harness
created: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1553
---

# HARNESS-062 — the same rule, five times, disagreeing

## Problem

An audit of the 83 registered scans (2026-08-01) found **no scan safe to delete** — every plausible
overlap had an input where only one fired. What is redundant is IMPLEMENTATION, and it is measurably
inconsistent.

**Five implementations of "a path cited in prose must exist":** `check-spec-paths`,
`check-architecture-map-paths`, `check-ghost-package-refs`, `check-done-evidence`,
`check-harness-config-paths`. Two share a byte-identical `REPO_PATH_PATTERN`; a third's comment
admits the fork ("keeps a local, intentionally-narrow copy"). Each carries its own exemption
vocabulary.

Measured on one sentence — `The loader was relocated; packages/ghost-pkg/src/loader.ts is gone.` —
placed in both an arch-map doc and a package SPEC:

```
arch-map-paths : 0 findings   ('relocated' is in its NEGATION set)
ghost-pkg-refs : 1 finding    ('relocated' is not in its ABSENCE_VOCAB)
spec-paths     : 1 finding    (only '(planned)' is exempt)
```

**Twenty-eight hand-rolled tree walkers with six different exclusion sets.** Measured: a file at
`packages/pub/src/dist/legacy.ts` carrying `@deprecated`, `TODO: Implement` and `export class
FakeThing` is opened by `stub-markers` (2 findings) and `deprecated-markers` (1), and **never opened
at all** by `no-fake-in-src`, whose walker skips any directory named `dist`.

## Direction

Extract `citedRepoPaths(line)` and one shared absence vocabulary next to the already-exported
`PATH_PATTERN`; extract `listSourceFiles(dir, { excludeTests })` into `workspace-packages.mjs` with
ONE exclusion set. Corpora and per-scan exemption markers stay where they are — the corpus is each
scan's own business.

**What must not be flattened:** `check-spec-paths`' strictness is deliberate (a SPEC saying a module
"was relocated" should still name a path that exists), and `check-interface-imports`' walker
deliberately descends into `__tests__` while its stated mirror does not. Unifying the exclusion set
without deciding those two changes coverage silently, which is the failure this item exists to
prevent, not to cause.

## Done when

- One implementation of the path rule, one of the tree walk, imported rather than copied.
- The three verdicts above become one, and the chosen exemption vocabulary is stated with its reason.
- The two deliberate divergences are named options, not casualties.

## Resolution

### The path rule

`scripts/harness/cited-paths.mjs` owns the patterns (`REPO_SOURCE_PATH_PATTERN`,
`LOCAL_SOURCE_PATH_PATTERN`, `REPO_FILE_PATH_PATTERN`, `QUOTED_REPO_FILE_PATH_PATTERN`), the
vocabulary, and `citedRepoPaths(line, { pattern, vocabulary })`. All five scans import it;
`check-done-evidence` re-exports `PATH_PATTERN` from there so `scan-unearned-done-claims` keeps its
existing import.

The chosen vocabulary is the NARROW one — explicit parenthetical annotations (`(planned)`,
`(removed)`, `(deleted)`, `(renamed)`) plus `no longer` / `does not exist` — measured before choosing:

| corpus             | measurement                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| architecture-map   | 8 lines carry a cited source path; **0** were exempted by the wide set — it was live only in the two historical logs the scan skips wholesale |
| ghost-package-refs | **0** lines change verdict either way; every wide-but-not-narrow line sits in a doc tree already excluded as immutable history         |

So the choice costs no false positives and no coverage, and the narrow set is the better rule: it
exempts on an annotation the author wrote for the guard, never on narrative words like "stale",
"migrated" or "relocated" appearing anywhere on the line.

Three strictness LEVELS remain, as named options rather than forks:

- `ABSENCE_VOCABULARY` — `arch-map-paths`, `ghost-package-refs`.
- `PLANNED_ONLY_VOCABULARY` — `spec-paths`, `harness-config-paths`. **Deliberately not flattened**: a
  package SPEC is the contract for what the package IS, not a changelog; a hardcoded path literal in
  a scan is configuration, not prose, and already carries an explicit allow-missing marker.
- `NO_VOCABULARY` — `done-evidence`. Its exemption is the `evidence-superseded` annotation, which
  names a reason.

The issue's sentence now gets the same verdict from all three path scans. Measured finding delta on
the real tree, all five scans: **0**.

### The tree walk

`listSourceFiles(dir, { excludeTests, extensions })` in `workspace-packages.mjs` owns the walk, with
ONE exclusion set — the `SKIP_DIRS` the module already declared (`node_modules`, `dist`, `coverage`).
Six walkers route through it, replacing four distinct private exclusion sets. Every delta measured by
running the old walker and the new one over the real tree and diffing the resulting path sets:

| walker                        | old exclusion set                   | files before → after | delta |
| ----------------------------- | ----------------------------------- | -------------------- | ----- |
| `check-stub-markers`          | `__tests__`, `node_modules`         | 1620 → 1620          | 0     |
| `scan-deprecated-markers`     | `__tests__`, `node_modules`         | 1620 → 1620          | 0     |
| `scan-no-fake-in-src`         | `node_modules`, `dist`              | 1606 → 1606          | 0     |
| `check-interface-imports`     | (nothing at all)                    | 2142 → 2142          | 0     |
| `scan-no-fallback`            | `__tests__`, `node_modules`, `dist` | 1620 → 1620          | 0     |
| `scan-composition-neutrality` | `node_modules`, `dist`              | 2443 → 2443          | 0     |

**Deliberately not flattened:** `check-interface-imports` descends into `__tests__` via the named
`excludeTests: false` option — an import-layering violation in a test file is still a violation, and
the import it writes is the one the next author copies. What it gains from the shared lister is the
exclusion set it never had.

**Deliberately not routed:** `scan-memory-neutrality`'s `walkSourceAllFiles` skips the `__tests__`
DIRECTORY but keeps co-located `*.test.ts` files, and `excludeTests` excludes both. Measured: routing
it would drop **113 files (1736 → 1623)** from a neutrality guard's corpus. Silently narrowing
coverage is the failure this item exists to prevent, so the contract stays and the measurement is
recorded at the function.

## Test Plan

- `scripts/harness/__tests__/cited-paths.test.mjs` — the issue's sentence, placed in an arch-map doc
  and a package SPEC, must get ONE verdict; plus the vocabulary levels and the extraction rules.
  Red-proof: before the fix `arch-map-paths` returned 0 findings while `spec-paths` and
  `ghost-package-refs` returned 1.
- `scripts/harness/__tests__/list-source-files.test.mjs` — the three marker scans must agree about a
  file under `src/dist/`, and `listSourceFiles` must honour `excludeTests` in both directions.
  Red-proof: before the fix `stub-markers` reported
  `[stub-marker] packages/pub/src/dist/legacy.ts` while `no-fake-in-src` reported nothing, and
  `listSourceFiles` did not exist.
- `npx vitest run scripts/harness/__tests__/` and `pnpm harness:scan`.

## User Execution Test Scenarios

Not applicable — a harness-internal refactor with no runnable user-facing behavior. The verification
is the scan suite in the Test Plan.
