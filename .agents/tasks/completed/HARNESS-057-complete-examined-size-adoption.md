---
title: 'HARNESS-057: complete examined-size adoption'
issue: https://github.com/woojubb/robota/issues/2462
status: done
created: 2026-09-06
completed: 2026-09-06
priority: high
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-057: complete examined-size adoption

## Objective

Ensure every registered harness command contributes an examined-size declaration, using the
registry-owned subject boundary for command-owned scans that cannot emit native stdout markers.

## Result

The scan runner now preserves precise native declarations and derives a measured fallback from each
registration's `examines` boundary. The adoption baseline is re-frozen over the complete registered
set.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/run-all-scans.test.mjs`
- `pnpm harness:scan -- --context integration --skip dist --skip build-contracts --skip work-run-measurement`
