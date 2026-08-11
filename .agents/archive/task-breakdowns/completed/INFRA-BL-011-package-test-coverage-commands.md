# INFRA-BL-011 Package Test Coverage Commands

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: feat/package-test-coverage-commands
- **Scope**: `package.json`, `packages/*/package.json`, `apps/*/package.json`, `scripts/harness`

## Objective

Add consistent package-level coverage commands across testable workspace packages and expose root commands for all, package-only, and app-only coverage runs without making normal test or pre-push flows slower by default.

## Prior Art Research

- Vitest v1.6 coverage docs recommend enabling coverage with the CLI `--coverage` flag and show `vitest run --coverage` as the package script shape. They also recommend defining `coverage.include` when configuring deeper coverage behavior.
  - Source: <https://v1.vitest.dev/guide/coverage>
- pnpm 8 recursive docs state `run`/`test` operate across workspace projects, excluding the root package by default, and filtering can limit commands to subsets of packages.
  - Source: <https://pnpm.io/8.x/cli/recursive>
  - Source: <https://pnpm.io/8.x/filtering>
- Jest 29 CLI docs expose `--coverage` / `--collectCoverage` and document passing Jest args through package-manager test commands, including pnpm.
  - Source: <https://jestjs.io/docs/29.7/cli>

## Plan

- [x] Create feature branch from updated `develop`.
- [x] Promote backlog item to active task.
- [x] Record official docs research and local package audit.
- [x] Add a failing harness unit test for coverage script policy.
- [x] Implement static harness scan for coverage script presence.
- [x] Add root coverage commands and wire the static scan into `harness:scan`.
- [x] Add missing package-level `test:coverage` scripts.
- [x] Update harness documentation.
- [x] Run targeted verification and coverage smoke checks.

## Progress

### 2026-05-02

- Created branch `feat/package-test-coverage-commands` from updated `develop`.
- Confirmed current gaps with a static scan: root coverage commands are missing and many Vitest workspace packages expose `test` without `test:coverage`.
- Added RED test coverage for the planned harness policy module, then implemented the policy functions and CLI script.
- Added root `test:coverage`, `test:coverage:packages`, and `test:coverage:apps` commands.
- Added package-level `test:coverage` scripts for testable Vitest workspaces that were missing one.
- Preserved existing Vitest and Jest coverage scripts.
- Wired `harness:scan:coverage-scripts` into `harness:scan` as a static script-presence check.
- Documented the new harness scan behavior and added `pnpm test:coverage` to common commands.

## Decisions

- Coverage execution remains explicit and opt-in. It is not added to default `test`, pre-push, or scoped verification.
- `test:coverage` is the package-level convention.
- Existing Jest coverage commands in app packages are preserved.
- Existing Vitest coverage scripts are preserved; missing Vitest package scripts use `vitest run --coverage --passWithNoTests` to match the package's existing `test` no-tests tolerance.
- `harness:scan` gets only a static script-presence check, not coverage execution.

## Acceptance Criteria

- [x] Every testable workspace package has a documented coverage command, or an explicit note explaining why it is excluded.
- [x] Root `package.json` exposes coverage commands for all workspaces, packages only, and apps only.
- [x] Existing package-specific coverage scripts are preserved or normalized without breaking behavior.
- [x] Coverage output is excluded from git.
- [x] CI/harness policy keeps coverage opt-in while statically enforcing script presence.
- [x] Tests or harness checks verify that required package scripts exist where expected.

## Test Plan

- Run `pnpm exec vitest run scripts/harness/__tests__/check-test-coverage-scripts.test.mjs`.
- Run `node scripts/harness/check-test-coverage-scripts.mjs`.
- Run `pnpm harness:scan:coverage-scripts`.
- Run representative package coverage commands:
  - `pnpm --filter @robota-sdk/agent-cli run test:coverage`
  - `pnpm --filter @robota-sdk/dag-node-input run test:coverage`
- Run `pnpm harness:scan`.

## Blockers

None.

## Verification

- `pnpm exec vitest run scripts/harness/__tests__/check-test-coverage-scripts.test.mjs` passed.
- `pnpm exec vitest run scripts/harness/__tests__` passed: 81 tests.
- `node scripts/harness/check-test-coverage-scripts.mjs` passed.
- `pnpm harness:scan:coverage-scripts` passed.
- `pnpm --filter @robota-sdk/dag-node-input run test:coverage` passed.
- `pnpm --filter @robota-sdk/agent-cli run test:coverage -- update-check cli-update-check` passed.
- `pnpm --filter @robota-sdk/agent-server run test:coverage` passed.
- `pnpm --filter './packages/**' run --if-present test:coverage --help` exited successfully, confirming filtered package script dispatch.
- `pnpm harness:scan` passed.

## Result

Completed. Workspace packages with Vitest/Jest tests now expose `test:coverage`, root coverage commands are available for all/packages/apps, and `harness:scan` statically enforces the command surface without running coverage.
