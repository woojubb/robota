---
title: 'HARNESS-033: sweep pre-existing test-double-named shipped code (fake/mock/stub)'
status: done
created: 2026-07-19
priority: medium
urgency: later
area: packages
depends_on: ['HARNESS-032']
---

# Sweep pre-existing test-double-named shipped code (HARNESS-033)

## Problem

HARNESS-032 (`scan-no-fake-in-src.mjs`) now fences NEW `Fake*`/`Mock*`/`Stub*` declarations out of shipped
`packages/<pkg>/src`, but a documented allowlist (`KNOWN_PREEXISTING` in the scan) carries the pre-existing
violations so the floor could land without a risky mass-refactor. This item removes that debt and empties the
allowlist.

## Allowlisted files to fix (then delete from `KNOWN_PREEXISTING`)

- **`packages/dag-adapters-local/`** — `FakeClockPort` (`clock-ports.ts`), `MockTaskExecutorPort`
  (`mock-task-executor-port.ts`), `createStubPromptBackend` (`stub-prompt-backend.ts`), all re-exported from
  `src/index.ts`. These are **test-support ports** consumed almost entirely by dag-\* tests (≈94 refs, mostly
  `__tests__`) yet shipped in the package main entry. Fix: **relocate to a `./testing` subpath** (a `testing/`
  dir exported via a `./testing` package entry, mirroring `@robota-sdk/agent-core/testing`'s `scripted-provider`),
  and rename to what they ARE where a name still helps (`ManualClockPort`, `RecordingTaskExecutorPort`,
  `createEchoPromptBackend`). Update the ≈94 import sites (mostly tests) to the `./testing` entry.
- **`packages/agent-playground/`** — `createMockUsageSnapshot`
  (`components/playground/usage-monitor/mock-usage-snapshot.ts`, used by the live usage-monitor UI) and the
  browser-sandbox stub provider/plugin classes (`Mock*Provider`/`MockOpenAI`/… in
  `lib/playground/remote-injection-setup.ts`, placeholders when no real SDK is injected in the browser). Fix:
  rename the browser stubs to `Stub*`/`Placeholder*` (they are genuine in-browser placeholders, not "mocks"), and
  either wire real usage data or rename `createMockUsageSnapshot` → `createEmptyUsageSnapshot` / gate it to a
  dev-only path. Note `remote-injection.ts` also emits `class Mock*` inside injected-code **string literals**
  (not flagged by the scan since they are strings) — rename those in the same pass for consistency.

## Done when

- Every `KNOWN_PREEXISTING` entry is removed from `scan-no-fake-in-src.mjs` and the scan is green with an EMPTY
  allowlist (the floor then rests entirely on rename/relocation, no baseline).
- No behavior change to the affected packages (pure rename/relocation + import updates).

## Resolution (2026-07-19)

`KNOWN_PREEXISTING` in `scan-no-fake-in-src.mjs` is now EMPTY — the floor rests entirely on rename/relocation.

**dag-adapters-local** — the three test-support ports moved from the package main export to a dedicated
`@robota-sdk/dag-adapters-local/testing` entry (mirrors `@robota-sdk/agent-core/testing`; new tsdown entry +
package.json `./testing` export), renamed for what they ARE:

- `FakeClockPort` → `ManualClockPort` (manually-advanced clock)
- `MockTaskExecutorPort` → `ScriptedTaskExecutorPort` (runs a caller-supplied handler; default echoes)
- `createStubPromptBackend` → `createCannedPromptBackend` (in-memory backend returning canned data)
  `SystemClockPort` (a real port) stays on the main entry. ~9 dag-\* test files updated to the `/testing` import;
  SPEC.md Public API updated (main entry trimmed + a `./testing` Public API subsection).

**agent-playground** — in-browser placeholders (no real SDK injected) renamed off the `Mock*` prefix:

- `createMockUsageSnapshot` → `createSampleUsageSnapshot` (file `mock-usage-snapshot.ts` → `sample-usage-snapshot.ts`)
- the 9 `class Mock*` provider/plugin placeholders in `remote-injection-setup.ts` + the 2 in the
  `remote-injection.ts` injected-code strings → `Placeholder*` (note: `Stub*` is also a fenced prefix, so
  `Placeholder*` — not the backlog's `Stub*` suggestion — is used).

No behavior change (pure rename/relocation + import updates). All dag package tests green (dag-adapters-local
54, dag-api 34, dag-worker 49, dag-scheduler 16, dag-runtime 11, …); agent-playground typecheck clean;
`scan-no-fake-in-src` green with the empty allowlist; 62/62 run-all-scans.

## Notes

Filed alongside the HARNESS-032 floor (owner governance 2026-07-19: `fake`/`mock`/`stub` name test doubles only,
never shipped code). Follow the spec-gate. See `.agents/rules/` no-fake rule + `.agents/memory/no-fake-in-src.md`.
