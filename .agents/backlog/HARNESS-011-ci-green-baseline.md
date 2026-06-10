---
title: 'HARNESS-011: CI green baseline — stop normalizing red runs'
status: todo
created: 2026-06-11
priority: critical
urgency: now
area: .github/workflows, scripts/harness, apps/agent-web
depends_on: []
---

# HARNESS-011: CI green baseline — stop normalizing red runs

## Problem

Every recent develop/main CI run concludes "failure" (security audit advisories, Cloudflare
Pages, compat-node18 jest arg mismatch, release-grade scan chain). Consequences observed
2026-06-10/11: a REAL build failure (PR #688 lockfile) was invisible at the run level and only
found by job-level digging; release-grade verification's `&&`-chained scans mask every failure
behind the first one (fixing capability-placement immediately surfaced a hidden
`missing-cli-sdk-detail-reader` finding that had been failing unseen on every release).

## Scope

1. compat-node18: `pnpm --filter !agent-cli run test -- --coverage --coverage.thresholds.lines=80`
   passes vitest-style args to jest-based `robota-web` — exclude it from the filter or normalize
   its test script.
2. release-grade verification: run scans with continue-on-failure aggregation (report ALL scan
   findings, fail at the end) instead of `&&` chaining.
3. Resolve or explicitly quarantine: pre-existing background-workspace scan findings on
   packages/agent-transport/src/tui/hooks/useInteractiveSession.ts
   (`missing-cli-sdk-snapshot-consumption`, `missing-cli-sdk-workspace-event-consumption`,
   `missing-cli-sdk-detail-reader` — confirmed present on clean develop, masked behind the
   capability-placement failure in the && chain), security-audit advisories
   (dependency upgrades or documented waiver), Cloudflare Pages check.
4. Target end state: overall run conclusion is green on develop; any red run means a NEW problem.

## Test Plan

- CI workflow changes validated on a draft PR (all jobs green or explicitly quarantined).
- harness scan aggregator unit-tested (multiple failures all reported in one run).

## User Execution Test Scenarios

Not applicable — CI/infra change; evidence is green pipeline runs on the PR.
