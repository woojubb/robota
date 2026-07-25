---
title: 'HARNESS-046: converge harness frontmatter parsing on one SSOT parser'
status: todo
created: 2026-07-25
priority: medium
urgency: soon
area: scripts/harness
depends_on: [HARNESS-044]
---

# HARNESS-046: one frontmatter parser, not four

## Problem

HARNESS-044 (#1380) fixed `check-spec-doc-frontmatter.mjs` to read prettier-wrapped multi-line YAML
arrays and exported a reusable `parseFrontmatterBlock`. But the same single-line-only assumption is
**forked into other harness scans**, each with its own hand-rolled regex:

- `scan-capability-reachability.mjs` (`parseFrontmatter`)
- `check-agent-def-convention.mjs` (`parseAgentFile`)
- `check-backlog-placement.mjs` (reads only `status`/`completed` — safe today)

Those are **latent, not live**: they read short scalars, and prettier reflows only `[...]` flow
arrays, which those files currently lack. But the hazard is real and armed — `.agents/backlog/`
already carries **441 `depends_on: [`** and **24 `related: [`** flow arrays, so the day any scan
reads one of those fields, it silently mis-parses exactly as #1369 did.

Root class (per the recurring-mistake-prevention principle): the same parsing truth is duplicated
per-scan, so a fix in one place leaves the others broken. Fixing the instance does not close it.

## What

Converge every harness frontmatter reader on the single exported `parseFrontmatterBlock` SSOT from
`check-spec-doc-frontmatter.mjs` (or lift it into `scripts/harness/shared.mjs` if that is the better
home — decide when implementing, one owner module either way). Delete the forked regexes. Then add
the mechanical floor: a test (or scan) asserting no harness script hand-rolls a
`^<key>:\s*(.+)$`-style frontmatter regex outside the SSOT module.

## Test Plan

Red-first per converged scan: a fixture with a prettier-wrapped array in the field that scan reads
must FAIL before conversion and PASS after. The anti-fork floor must FAIL when a hand-rolled
frontmatter regex is planted in a harness script, then PASS once removed. `pnpm harness:test` +
`run-all-scans` green.
