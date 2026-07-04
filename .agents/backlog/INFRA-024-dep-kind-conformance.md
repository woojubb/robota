---
title: 'INFRA-024: dep-kind conformance — runtime value imports must be dependencies/peerDependencies, never devDependencies-only'
status: todo
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
