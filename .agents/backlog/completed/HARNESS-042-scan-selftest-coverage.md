---
title: 'HARNESS-042: close the scan self-test gap (14 registered scans without direct tests)'
status: done
completed: 2026-07-25
created: 2026-07-25
priority: medium
urgency: soon
area: scripts/harness/__tests__
depends_on: []
---

# HARNESS-042: scan self-test coverage completion

## Problem

HARNESS-023's mechanically computed table (see its Outcome in `backlog/completed/`) found **14 of 58
registered scans lack direct tests** — an untested guardian can rot silently (the vacuous-gate class the
diet just purged). Priority-High per that table: `scan-dist-freshness`, `scan-conflict-markers`.

## What

Fixture-based red/green tests per untested scan, HARNESS-023's pattern (exported pure finding-collector +
CLI exit tests). Batch by area; start with the two High items. Each test must include at least one RED
fixture per rule class (no green-only suites — accidental-green rule).

## Test Plan

The tests ARE the deliverable; `pnpm harness:test` green; per-scan red fixtures demonstrated in the PR.

## Outcome (2026-07-25)

Recomputed the untested set against the current `run-all-scans.mjs` registry (58 registered scan
scripts): 18 had no direct test file; 3 of those are covered indirectly (`scan-consistency.mjs` and
`audit-spec-coverage.mjs` via `harness-smoke.test.mjs`, `check-interface-imports.mjs` via
`check-interface-package-deps.test.mjs`) — leaving **15** genuinely untested (HARNESS-023's 14 plus the
since-registered `check-functional-coverage.mjs`). All 15 are now closed with fixture-based red/green
suites in `scripts/harness/__tests__/`:

| Scan                                      | Refactor                                                                                | Red fixtures (per rule class)                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `scan-dist-freshness.mjs` (High)          | exported `collectDistFreshnessResults(root, scopes)` + entry guard                      | missing dist, empty dist, bin-only missing dist; CLI exit 1                                        |
| `scan-conflict-markers.mjs` (High)        | root threaded through walk + entry guard (collector existed but ignored `root`)         | fallback-advocacy pattern, hierarchy-naming pattern, AGENTS.md target; CLI exit 1                  |
| `scan-memory-mirror.mjs`                  | exported `collectMemoryMirrorFindings(root)` + entry guard                              | missing index, dangling link, orphan fact file; CLI exit 1                                         |
| `scan-spec-research.mjs`                  | exported `collectSpecResearchFindings(root)` + entry guard                              | missing section, unsubstantiated section; CLI exit 1                                               |
| `scan-orchestration-map.mjs`              | exported `collectOrchestrationMapFindings(root)` + entry guard                          | missing map, unlisted agent, nameless-agent fallback; CLI exit 1 (both shapes)                     |
| `scan-review-findings.mjs`                | exported `collectReviewFindingsFindings(root)` + entry guard                            | missing reviewer file + one red per contract regex (5); CLI exit 1                                 |
| `check-nested-package-glob-coverage.mjs`  | none needed (already collector + guard)                                                 | nested group omitted from one-level dist glob; CLI exit 1                                          |
| `check-spec-doc-frontmatter.mjs`          | none needed                                                                             | no frontmatter, bad status, bad type, empty tags (+ duplicate-ID warning stays exit 0); CLI exit 1 |
| `scan-deprecated-markers.mjs`             | entry guard added (collector existed; scan ran on import)                               | `@deprecated` in publishable src, nested-group member; CLI exit 1                                  |
| `check-functional-coverage.mjs`           | exported `collectFunctionalCoverageFindings(root, manifestPath)` + entry guard          | manifest missing/invalid/empty, test missing, marker missing, dup/short entries; CLI exit 1        |
| `check-architecture-map-paths.mjs`        | map dir derived from `root` (collector's `root` param previously ignored for discovery) | ghost cited path; CLI exit 1                                                                       |
| `check-architecture-map-completeness.mjs` | optional `mapDir` param (default unchanged)                                             | missing H1/scope/up-link/structure block; CLI exit 1                                               |
| `check-document-standards-index.mjs`      | none needed                                                                             | missing index, ghost pointer, missing table, bad status, missing follow-on; CLI exit 1             |
| `check-design-doc-completeness.mjs`       | none needed                                                                             | one red per MUST section (5); CLI exit 1                                                           |
| `check-adr-completeness.mjs`              | none needed                                                                             | one red per MUST section (5) + illegal Status; CLI exit 1                                          |

Every refactor is behavior-identical, asserted by running each scan CLI on the repo before/after and
diffing stdout/stderr/exit byte-for-byte. Scans anchored at `<script dir>/../..` get their CLI exit-code
tests by copying the unmodified script into the fixture's `scripts/harness/` (plus
`workspace-packages.mjs` for the deprecated-markers scan); cwd-anchored scans run in the fixture cwd;
arg-taking scans get the fixture path as the CLI argument.

Registry coverage after this change: 58/58 registered scans have direct or indirect test coverage
(55 direct, 3 indirect as above). Harness suite green (`pnpm harness:test`).
