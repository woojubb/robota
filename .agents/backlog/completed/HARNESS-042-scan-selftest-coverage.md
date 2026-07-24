---
title: 'HARNESS-042: close the scan self-test gap (14 registered scans without direct tests)'
status: todo
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
