---
status: in-progress
type: INFRA
tags: [typescript]
---

# DOCAUDIT-002: Remove phantom / stale symbol references (P1)

## Problem

The 2026-06-19 audit found doc references to symbols that no longer exist in code (left by
refactors). See `.design/architecture-audit/2026-06-19/conformance-audit-report.md`.

## Scope (AF-09, AF-16, AF-17)

- **AF-09** — `createModelCommandModule` / `agent-command/src/model/` do not exist. Remove all
  references across `class-interface-inventory.md`, `composition-tree.md`,
  `commands-and-provider-flow.md`; document the real default module set (mode/preset/schedule/
  settings).
- **AF-16** — `classifyFetchError` is listed in `agent-tools` SPEC Public API Surface but is not
  exported from `src/index.ts`. Align the SPEC to reality (remove from the public surface; it
  remains at the `builtins` barrel). NOTE: if exposing it publicly was intended, that is a separate
  code change — flagged for intent confirmation.
- **AF-17** — `agent-playground` SPEC: drop `IPlaygroundBootState` (nonexistent), `usePlaygroundBoot`,
  `PlaygroundAgentSession`, `usePlaygroundData` (stale); fix `PLAYGROUND_STATISTICS_EVENTS` (declared
  `const`, not exported).

## Done When

- Every symbol named in the affected docs/SPECs resolves in code, or is removed.
- `pnpm harness:scan` passes.

## Evidence Log
