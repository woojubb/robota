---
title: 'INFRA-024: dep-kind conformance — runtime value imports must be dependencies/peerDependencies, never devDependencies-only'
status: done
completed: 2026-07-04
created: 2026-07-04
priority: high
urgency: now
area: packages/agent-cli, scripts/harness
depends_on: []
---

# Dep-kind conformance

Architecture audit finding F1 (2026-07-04): `packages/agent-cli/src/cli.ts:38` value-imports
`createDefaultBackgroundTaskRunners` from `@robota-sdk/agent-executor` at runtime, but
agent-cli declares agent-executor only in **devDependencies**. The published CLI (beta)
currently resolves it by hoisting accident (agent-framework's regular dep) and can break
under strictly-isolated installs. The composition-root exemption permits the _import_, not
the dep misclassification. Neither the `deps` nor `dependency-direction` scan checks dep
KIND — direction-only checking is why this sat silent.

## What

1. **Fix**: move `@robota-sdk/agent-executor` from devDependencies to dependencies in
   `packages/agent-cli/package.json` (type-only imports like `print-mode.ts` remain valid
   against devDeps). Lockfile refresh.
2. **Mechanize (`dep-kind` scan)**: for every workspace package, a non-type import of a
   `@robota-sdk/*` module in production source (src/, excluding tests/testing surfaces)
   must resolve to `dependencies` or `peerDependencies`. Known false-positive classes from
   the audit probe must be excluded by construction: JSDoc example lines (`* import ...`),
   generated-code string literals (line does not start with `import`), and type-only
   imports. Allowlist with mandatory reason strings, reported never silent (harness
   convention).
3. **Prove the mechanism** (lesson-to-harness step 9): the scan FAILS on the pre-fix
   agent-cli state and PASSES after the dep move — recorded in evidence.
4. Wire into `pnpm harness:scan` + unit tests in the harness suite (fixture packages).

## Test Plan

- Harness unit tests: fixture with (a) value import declared only in devDeps → finding;
  (b) type-only import in devDeps → clean; (c) peerDependencies value import → clean;
  (d) JSDoc/string-literal mention → clean.
- Full `pnpm harness:scan` green after fix; scan red when the dep move is reverted (prove).
- `pnpm --filter @robota-sdk/agent-cli build` + CLI smoke (`--version`) green after the
  lockfile refresh.

## User Execution Test Scenarios

Not applicable — packaging/harness-tooling change with no user-facing behavior delta
(the CLI already resolves the module in this workspace; the defect only manifests at
isolated install time, which is not reachable pre-publish). Engineering evidence: the
prove-the-mechanism red/green run in the Test Plan.

## Evidence (engineering verification, 2026-07-04)

- **Prove (red → green)**: the new scan run against the PRE-fix tree failed with exit 1,
  naming the audit finding — `@robota-sdk/agent-cli imports @robota-sdk/agent-executor
(packages/agent-cli/src/cli.ts)` — **and swept the class**: 49 additional findings in
  `@robota-sdk/dag-cli`, which declared ALL 19 of its runtime `@robota-sdk/dag-*` imports
  as devDependencies (`private: false`, ships a `robota-dag` bin — same latent break at
  publish time). After moving agent-executor (agent-cli) and the 18 flagged dag modules
  (dag-cli) to `dependencies` (dag-api stays devDeps — type-only), the scan passes with
  exit 0. Lockfile refreshed (`pnpm install`, workspace-field moves only).
- Mechanism: `scripts/harness/check-dep-kind.mjs`, wired as the `dep-kind` scan (45 scans
  total); allowlist requires reason strings and reports on every run (empty today).
- Fixture tests: 4 cases in `scripts/harness/__tests__/check-dep-kind.test.mjs`
  (devDeps-only value import flagged; type-only + peerDeps clean; JSDoc/string-literal/
  test-surface exclusions; undeclared imports left to the deps scan) — harness suite 235
  green.
- Builds + smoke: both CLI binaries build and execute post-move (`robota 3.0.0-beta.76`;
  `robota-dag` loads and reports its structured usage error — all runtime imports
  resolve). agent-cli 150 / dag-cli 992 tests green; repo typecheck 0 errors; lint 0
  errors; 45 harness scans green.
