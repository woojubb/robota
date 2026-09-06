---
title: 'INFRA-2635: Fix discovery-loader ENOENT crash when scripts/harness/ is absent'
issue: https://github.com/woojubb/robota/issues/2635
status: todo
created: 2026-09-06
priority: critical
urgency: now
area: 'scripts/harness discovery loader'
depends_on: []
---

# INFRA-2635: Fix discovery-loader ENOENT crash when scripts/harness/ is absent

## Objective

`candidateFiles()` in `scripts/harness/discovery-loader.mjs` calls `readdirSync(harnessDir)`
unconditionally. `run-all-scans.mjs` loads scan commands at module-load time, and
`gate.test.mjs`'s fixtures legitimately build an isolated root with no `scripts/harness/`
subdirectory (gate.mjs's own logic needs none). The unconditional `readdirSync` throws `ENOENT`
there instead of treating "no such directory" as "nothing to discover," crashing 76 of 93
`gate.test.mjs` cases. Since `.husky/pre-push` runs the full test suite before every push, this
currently blocks every push to `develop` regardless of what the branch touches.

## Plan

- [ ] `candidateFiles()`: catch `ENOENT` specifically and return `[]`; any other `readdirSync`
      failure still propagates.
- [ ] Add a regression test in `scripts/harness/__tests__/scan-discovery.test.mjs` asserting
      `discoverAdditionalScans` resolves to `[]` for a root with no `scripts/harness/` directory.
- [ ] Run the previously-crashing suites and the full harness test suite to confirm green.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/scan-discovery.test.mjs scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/task-complete.test.mjs`
- `pnpm harness:test` (full suite).

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This fixes an internal harness test-fixture crash with no runnable Robota CLI, TUI,
browser UI, or public SDK/example surface; it only affects the repository's own local test/CI
harness tooling, not shipped product behavior.
