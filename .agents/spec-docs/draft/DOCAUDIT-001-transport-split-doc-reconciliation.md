---
status: in-progress
type: INFRA
tags: [typescript]
---

# DOCAUDIT-001: Reconcile architecture docs with the transport-package split (P0)

## Problem

The 2026-06-19 architecture conformance audit
(`.design/architecture-audit/2026-06-19/conformance-audit-report.md`) found that ~half of all
findings share one root cause: docs describe a single `agent-transport` package with
`tui/ws/http/mcp` subpaths, but the code has **five separate packages** (`agent-transport` +
`agent-transport-{tui,ws,http,mcp}`); `agent-transport` retains only `./headless` + `./testing`.
The split is the intended architecture — the docs are stale (one even states the migration in
reverse). Authority docs actively mislead about package boundaries (P0).

## Scope (findings AF-01..AF-08, AF-10..AF-13, AF-18 — doc-only)

- `transport-architecture.md` — rewrite around 5 packages; drop "single package, 5 subpaths";
  fix `ITuiCliAdapter`/handler paths; remove the false `agent-command → agent-interface-tui`
  consumer claim (AF-01, AF-08).
- `repository-overview.md` — add the four `agent-transport-*` packages + `agent-session-analytics`;
  stop modeling transport as one package (AF-03).
- `agent-system.md`, `dependency-direction.md`, `capability-placement.md`,
  `agent-cli-composition.md` — fix transport subpath nodes, stale `ws-handler.ts` / `tui/hooks/*`
  paths, the missing `agent-command → interface-transport` edge, the unbacked
  `remote-client → Adapters` edge (AF-04/05/06/07).
- `agent-cli/class-interface-inventory.md` — fix the reversed header map; relocate all 10 TUI rows
  to `agent-transport-tui` (AF-02).
- `agent-cli/composition-tree.md` + `layering-audit.md` — `createDefaultTransportRegistry` is a
  local helper in `cli.ts:62`, not an `agent-transport` export; fix "no behavior helper / 316
  lines" (actual 329); correct command-module list (AF-10/11).
- `agent-cli/target-architecture.md` — add `CLI → agent-executor`; transport as 5 packages (AF-18).
- `agent-cli/docs/SPEC.md:710` + `agent-interface-transport/docs/SPEC.md` — `TuiInteractionChannel`
  and `TransportRegistry` ownership corrections (AF-12/13).

## Done When

- No doc cites `agent-transport/src/{tui,ws,http,mcp}/...` paths that don't resolve.
- Transport described consistently as 5 packages across all docs.
- `pnpm harness:scan` passes (document-authority, consistency, docs-structure).

## Evidence Log
