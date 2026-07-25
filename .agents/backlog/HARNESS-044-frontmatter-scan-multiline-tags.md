---
title: 'HARNESS-044: check-spec-doc-frontmatter must parse prettier-wrapped multi-line YAML arrays'
status: todo
created: 2026-07-25
priority: low
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-044: frontmatter scan vs prettier multi-line arrays

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
