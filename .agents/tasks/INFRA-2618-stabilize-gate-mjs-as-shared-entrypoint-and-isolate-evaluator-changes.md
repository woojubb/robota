---
title: 'INFRA-2618: stabilize gate.mjs as shared entrypoint and isolate evaluator changes'
issue: https://github.com/woojubb/robota/issues/2618
status: in-progress
created: 2026-09-06
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# INFRA-2618: stabilize gate.mjs as shared entrypoint and isolate evaluator changes

## Objective

Make `scripts/harness/gate.mjs` a stable shared CLI facade that changes only during a deliberate
harness-structure migration. Split its current CLI, document, catalogue, criteria, and lifecycle
responsibilities into owned modules. Preserve the existing command, exit-code, stdout, evidence, and
fail-closed contracts while mechanically refusing accidental facade edits.

## Plan

- [ ] Complete the approved INFRA-2618 spec and keep the implementation scope limited to the gate
      entrypoint/evaluator boundary.
- [ ] Extract CLI, document, catalogue, criteria, operation, and public-API modules; add the stable
      facade and preserve all supported exports/importers.
- [ ] Update evaluator-isolation for all extracted evaluator modules, add the facade stability scan
      and its tests, and register the scan.
- [ ] Update baselines/fixtures and run focused tests plus affected harness verification.
- [ ] Record completion evidence and close the paired spec/Task together.

## Test Plan

- Run `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs scripts/harness/__tests__/scan-gate-evaluator-isolation.test.mjs scripts/harness/__tests__/scan-gate-entrypoint-stability.test.mjs` and require the complete focused suites to pass.
- Run `pnpm exec vitest run scripts/harness/__tests__/gate-entrypoint-compatibility.test.mjs` and require the facade subprocess and stability-refusal assertions to pass.
- Run `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` and require the affected harness scans to exit 0.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is an internal harness-maintenance change with no shipped Robota product surface or user-facing product behavior; its CLI and scan assertions are maintainer engineering verification.
