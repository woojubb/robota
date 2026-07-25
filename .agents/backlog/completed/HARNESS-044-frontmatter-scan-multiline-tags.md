---
title: 'HARNESS-044: check-spec-doc-frontmatter must parse prettier-wrapped multi-line YAML arrays'
status: done
completed: 2026-07-25
created: 2026-07-25
priority: low
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-044: frontmatter scan vs prettier multi-line arrays

## Outcome (DONE 2026-07-25)

`check-spec-doc-frontmatter.mjs` now parses the frontmatter block properly instead of matching
`^tags:\s*(.+)$` on one line. A dependency-free line-based reader (`parseFrontmatterBlock`, exported)
maps each top-level key to a scalar or a list, resolving all four forms the toolchain emits:

- inline flow — `tags: [a, b]`
- compact prettier wrap — `tags:` then the whole `[...]` on one indented line
- exploded prettier wrap — `tags:` then one item per indented line (the ARCH-005 / #1369 shape)
- YAML block sequence — `tags:` then `- a` / `- b`

No YAML dependency was added: the repo declares none (the only `js-yaml` mention in `package.json` is
a pnpm audit override), so a new dep was not worth it for one frontmatter block.

Both prettier wrappings in the fixtures are byte-exact — produced by running the repo's own prettier
over a single-line source, not hand-written. The check is not weakened: empty wrapped arrays
(`tags:\n  [\n  ]`), a bare `tags:` key, and `tags: []` all still block, and a corrupted `status`
placed _after_ a wrapped array is still reported (proving the wrapped block does not swallow the keys
below it). Differential check over all real spec-docs: old vs new parser agree on every file
(0 diffs) — the change is purely additive.

## Problem

`scripts/harness/check-spec-doc-frontmatter.mjs` only recognizes the single-line form
`tags: [a, b, c]`. But prettier (the repo's SSOT formatter, run via lint-staged on commit) wraps a
`tags` array that exceeds printWidth onto multiple lines:

```
tags:
  [
    architecture,
    ...
  ]
```

The scan then reports "tags missing or empty" and FAILS — a false negative caused purely by the
formatter the repo mandates. Observed on ARCH-005 (#1369): the spec passed on develop only because an
earlier commit used `--no-verify` (skipping prettier), and failed the moment a normal
lint-staged commit wrapped the array. Worked around there by shortening the tag list to fit one line —
but any spec with enough tags will recur.

## What

Make the frontmatter parser accept both forms — parse the YAML block properly (or a multi-line array
matcher) so a prettier-wrapped `tags`/any array frontmatter field is read correctly. Red-first: a
fixture spec-doc with a prettier-wrapped multi-line `tags` array must PASS after the fix and FAIL
before it.

## Test Plan

Fixture-based: single-line tags (green), multi-line prettier-wrapped tags (RED before, green after),
genuinely-missing tags (still fails). `pnpm harness:test` + `run-all-scans` green.

## Related

- **HARNESS-045** — a single local verification entry that reproduces the CI scans/quality gate
  exactly. This item is a member of that broader "green locally ≠ green in CI" class (the
  formatter-drift-not-caught-locally instance).
