# Agent Package Test Coverage Audit

Status: completed on `chore/agent-package-coverage-audit`.

## What

Measure and publish the current test coverage for every `@robota-sdk/agent-*` package, then turn the result into a prioritized coverage improvement plan.

## Why

The repository now exposes package-level coverage commands, but there is no current, package-by-package view of actual coverage for the agent package family. Without a baseline, it is hard to decide which packages need characterization tests before refactors, which packages can accept coverage gates, and which packages intentionally have little executable code.

## Current Signals

- Root commands exist:
  - `pnpm test:coverage`
  - `pnpm test:coverage:packages`
  - `pnpm --filter "./packages/**" run --if-present test:coverage`
- `INFRA-BL-011-package-test-coverage-commands` added consistent coverage scripts and a static harness scan for script presence.
- CI currently keeps broad coverage out of normal PR checks and reserves broader verification for release-grade paths.
- Older completed tasks mention previous low coverage, but those numbers are stale and should not be used as the current baseline.

## Scope

- [x] Enumerate every package whose name starts with `@robota-sdk/agent-`.
- [x] Run each package's `test:coverage` command or a filtered batch strategy that preserves per-package reports.
- [x] Capture line, branch, function, and statement coverage for each package.
- [x] Distinguish packages with no source, no tests, generated-only code, or intentional pass-with-no-tests behavior.
- [x] Produce a repository-owned report, for example `.agents/reports/agent-package-coverage.md`.
- [x] Identify the top coverage gaps by risk, not only by lowest percentage.
- [x] Recommend whether package-specific thresholds should be added now, deferred, or limited to critical packages.

## Non-Goals

- Do not add or raise CI coverage thresholds before the baseline is measured.
- Do not treat partial affected-test coverage as a full package coverage signal.
- Do not rewrite test architecture as part of the audit.
- Do not include `dag-*` packages unless the task is explicitly expanded.

## Acceptance Criteria

- [x] Every `@robota-sdk/agent-*` package has a recorded coverage result or an explicit exclusion reason.
- [x] The report includes package name, test command, coverage percentages, and notable uncovered public surfaces.
- [x] The report separates "no tests" from "no executable source" packages.
- [x] The report identifies high-risk gaps in CLI, SDK, sessions, core, providers, transports, runtime, and tools.
- [x] The follow-up plan ranks coverage work by public API risk and refactor risk.
- [x] The audit documents whether current coverage scripts are reliable enough for recurring measurement.

## Test Plan

- Run the package coverage commands from a clean checkout.
- Verify generated coverage artifacts are either ignored or cleaned up after reporting.
- Re-run at least one high-risk package coverage command independently to confirm the collected number.
- Run `pnpm harness:scan:coverage-scripts` to confirm the command surface still matches policy.

## Promotion Path

1. [x] Move to `.agents/tasks/agent-package-coverage-audit.md` when prioritized.
2. [x] Create the coverage report as a task artifact.
3. [x] Capture targeted coverage expansion recommendations in the report.
