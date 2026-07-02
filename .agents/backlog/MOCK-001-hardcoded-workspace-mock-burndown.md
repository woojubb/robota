---
title: 'MOCK-001: burn down the 36 allowlisted hardcoded workspace-module mocks'
status: todo
created: 2026-07-02
priority: medium
urgency: later
area: packages/* test suites, scripts/harness
depends_on: []
---

# Hardcoded workspace-mock burn-down

The `test-module-mocks` harness scan (added 2026-07-02) blocks NEW
`vi.mock('@robota-sdk/agent-core', () => ({ hardcoded }))` factories: such a stub severs every other export
of the package for the whole import graph and breaks when the real module grows — the exact failure
that blocked every `git push` when TERM-008 added `resolvePlatformShell` while agent-playground's
2-export stub of agent-core was in place (CI stayed green; only the full local suite caught it).

The scan's `ALLOWLIST` (in `scripts/harness/check-test-module-mocks.mjs`) pins the 36 pre-existing
violation files so the gate could land without a mass rewrite. This item tracks the burn-down.

## What

For each allowlisted file, either:

1. Convert to a partial mock — `vi.mock(mod, async (importOriginal) => ({ ...(await importOriginal()),
<overrides> }))` — and delete its allowlist entry; or
2. If the full replacement is deliberate (e.g. a leaf test isolating a provider SDK from the network
   and the import graph genuinely never reaches other exports), annotate the `vi.mock` line with
   `// allow-module-mock: <reason>` and delete its allowlist entry.

Work in per-package batches (each batch = suite green). Highest risk first: broad-import-graph
packages (agent-framework, agent-session, agent-transport-tui, agent-cli), then agent-provider,
then the dag-\* leaves. Done when `ALLOWLIST` is empty and the scan text drops the legacy note.

## Test Plan

- Per batch: converted files' suites pass; `node scripts/harness/check-test-module-mocks.mjs` exit 0.
- Final: `ALLOWLIST` empty; `pnpm harness:scan` green; full `pnpm test` green.

## User Execution Test Scenarios

- Not applicable (test-infrastructure refactor; the scan itself is the maintained gate). Evidence is
  the shrinking allowlist + green suites per batch, recorded here.
- Evidence: _to fill per batch._
