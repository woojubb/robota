---
title: 'HARNESS-062: five implementations of "a cited repo path must resolve", giving three verdicts on one sentence'
status: todo
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
