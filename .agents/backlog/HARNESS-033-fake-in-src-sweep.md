---
title: 'HARNESS-033: sweep pre-existing test-double-named shipped code (fake/mock/stub)'
status: todo
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

## Notes

Filed alongside the HARNESS-032 floor (owner governance 2026-07-19: `fake`/`mock`/`stub` name test doubles only,
never shipped code). Follow the spec-gate. See `.agents/rules/` no-fake rule + `.agents/memory/no-fake-in-src.md`.
