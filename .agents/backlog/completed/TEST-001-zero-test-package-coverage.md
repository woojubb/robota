---
title: 'TEST-001: Add tests to shipped packages with zero/near-zero coverage'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: medium
urgency: soon
area: packages
depends_on: []
---

## Evidence Log (2026-06-27)

- Closed the worst case — the **zero-test** `agent-interface-tui`. It is a type-only contract
  package (runtime guards live in the consuming runtime package), so the added
  `command-interaction.test.ts` is a contract test: it constructs each interface, asserts the
  `onMissingArgs` discriminated union narrows (with an exhaustive `never` check), and covers the
  `TOnMissingArgsAction` union — so a breaking contract change fails here. 4 tests pass; typecheck clean.
- The low-ratio packages (agent-interface-transport, agent-subagent-runner, agent-tool-mcp,
  agent-preset) already have a harness + tests (not blind spots); raising them to a baseline is an
  open-ended multi-package effort split to **TEST-002**.

# Add tests to shipped packages with zero/near-zero coverage

## What

Several published packages ship real source with **zero or near-zero tests** (file counts
verified 2026-06-27):

- **`packages/agent-interface-tui`** — 2 src files, **0 test files** (has a `test` script).
- `packages/agent-interface-transport` — 11 src files, 1 test (~9%).
- `packages/agent-subagent-runner` — 8 src files, 1 test (~12%).
- `packages/agent-tool-mcp` — 6 src files, 1 test (~16%).
- `packages/agent-preset` — 11 src files, 2 tests (~18%).

(`agent-web-ui` zero-test is already owned by WEBUI-001 — excluded here.)

Add focused unit tests for the public behavior of the zero-test package first
(`agent-interface-tui`), then raise the lowest-ratio packages to a baseline (cover each
public export's happy path + one error path). Where a package is a thin façade, document that
and assert the contract rather than padding.

## Why

The repo's TDD rule and `check-test-coverage-scripts.mjs` ensure a `test` _script_ exists, but
not that meaningful tests exist behind it — a shipped package with 0 tests can regress
silently. Closing the zero-test cases removes the worst blind spots.

## Done When

- `agent-interface-tui` has tests covering its public surface (command-interaction + exports).
- The listed low-ratio packages have at least happy-path + one error-path test per public
  export (or a documented rationale where a façade needs only a contract test).
- `pnpm test` passes; new tests run in CI.

## Test Plan

- Per package: `pnpm --filter @robota-sdk/<pkg> test` green with the new tests.
- Confirm the new tests actually exercise public exports (not trivial `expect(true)`).

## User Execution Test Scenarios

Not applicable — internal test-coverage hardening; no user-facing behavior change. Evidence =
the passing new test files + counts.
