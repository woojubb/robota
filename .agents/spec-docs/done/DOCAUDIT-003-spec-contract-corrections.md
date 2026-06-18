---
status: done
type: INFRA
tags: [typescript]
---

# DOCAUDIT-003: Correct two SPEC contract inaccuracies (P1)

## Problem

Two SPECs state contracts that the code contradicts. See the 2026-06-19 audit report.

## Scope (AF-14, AF-15)

- **AF-14** — `agent-session/docs/SPEC.md`: (a) `TPermissionResult` documented as
  `boolean | 'allow-session'`; actual `permission-types.ts:18` adds `'allow-project'` — add it.
  (b) `ITerminalOutput`/`ISpinner` listed as package-owned SSOT, but `permission-types.ts:7,9`
  re-exports them from `@robota-sdk/agent-core` — re-attribute ownership to core. (c) Fix the
  Type-Ownership File columns (types live in `permission-types.ts`/`session-types.ts`, not
  `permission-enforcer.ts`/`session.ts`). Also document the undocumented exports `ICompactEvent`/
  `TCompactTrigger` (AF-25).
- **AF-15** — `agent-tool-mcp/docs/SPEC.md:5`: "published to npm under `@robota-sdk/agent-tool-mcp`"
  but `package.json` is `private: true`. Align the SPEC to reality (state it is an internal/private
  package). NOTE: if publishing is intended, flipping `private` is a separate release decision —
  flagged for intent confirmation.

## Done When

- `agent-session` SPEC matches `permission-types.ts`/`session-types.ts` for permission/ownership.
- `agent-tool-mcp` SPEC no longer claims npm publication while `private: true`.
- `pnpm harness:scan` passes.

## Evidence Log

- 2026-06-19 — IMPLEMENTED: doc corrections applied + verified; residual stale-path/symbol checks = 0; `pnpm harness:scan` all 26 passed. See `.design/architecture-audit/2026-06-19/`.
