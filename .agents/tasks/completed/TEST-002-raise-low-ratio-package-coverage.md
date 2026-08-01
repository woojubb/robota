---
title: 'TEST-002: Raise low test:src-ratio packages to a baseline'
status: done
created: 2026-06-27
completed: 2026-06-27
priority: low
urgency: later
area: packages
depends_on: []
---

# Raise low-ratio packages to a coverage baseline

Split from TEST-001 (which closed the worst case — the **zero-test** `agent-interface-tui`,
now a type-contract test). These packages already have a test harness and some tests (not
blind spots), but a thin ratio:

- `packages/agent-interface-transport` — ~1 test / 11 src files
- `packages/agent-subagent-runner` — ~1 / 8
- `packages/agent-tool-mcp` — ~1 / 6
- `packages/agent-preset` — ~2 / 11

## What

For each, add at least a happy-path + one error-path test per public export (or, where a module
is a thin façade, a contract test asserting the surface). Prioritize the packages exercising
real runtime logic (`agent-subagent-runner`, `agent-tool-mcp`) over pure-type packages.

## Why

These are continuous-improvement coverage gaps, not silent blind spots — but raising them
reduces regression risk on the runtime paths. Deferred from TEST-001 because it is an
open-ended, multi-package effort distinct from closing the zero-test case.

## Done When

- Each listed package has happy-path + error-path coverage for its public runtime exports (or a
  documented contract-test rationale for façade/type modules).
- `pnpm test` passes; new tests run in CI.

## Test Plan

- Per package: `pnpm --filter @robota-sdk/<pkg> test` green with the new tests; confirm they
  exercise real exports.

## User Execution Test Scenarios

Not applicable — internal test-coverage hardening; no user-facing behavior change.

## Evidence Log (completed 2026-06-27)

Each package was inspected for its actual public-export coverage (the raw test:src ratio
undercounted — the existing single test files were already rich integration suites). New tests
target the genuine untested public exports:

- **`agent-tool-mcp`** (+13 tests) — `RelayMcpTool` had no test: new `relay-mcp-tool.test.ts`
  covers the happy path (ownerPath augmented with one `agent` segment, parameters forwarded) and
  all three error paths (missing `eventService` / `baseEventService` / empty `ownerPath` →
  `ToolExecutionError`) plus `validate`/`getDescription`. New `mcp-protocol.test.ts` covers the
  pure helpers `buildMCPRequest` (request shape + unique ids) and `processMCPResponse` (text join,
  empty content, JSON-RPC error, missing result/error, `isError`). 22 tests pass.
- **`agent-subagent-runner`** (+6 tests) — the public IPC guards were only lightly asserted: new
  `ipc-guards.test.ts` exercises every `isSubagentWorkerParentMessage` /
  `isSubagentWorkerChildMessage` variant (happy + malformed) and asserts
  `getDefaultSubagentWorkerPath` returns an absolute path to the worker module. 12 tests pass.
- **`agent-preset`** (+12 tests) — new `preset-validation.test.ts` covers `validateExternalPreset`
  across every field-type branch (string/scalar/NaN/boolean/enum/string-array reject paths) and
  the previously-untested `registerExternalPresets` / `clearExternalPresets` directly (fresh
  register, built-in collision, duplicate-id rejection, clear-leaves-built-ins). 67 tests pass.
- **`agent-interface-transport`** — rationale (not new runtime tests): every export is a
  `type`/`interface` with no runtime logic; the existing `contracts.test.ts` is the appropriate
  `expectTypeOf` contract test for a pure-type package, satisfying the "documented contract-test
  rationale for façade/type modules" clause.

**Verification:** all three packages typecheck clean, lint clean (0 errors), and `pnpm harness:scan`
stays 32/32 green.
