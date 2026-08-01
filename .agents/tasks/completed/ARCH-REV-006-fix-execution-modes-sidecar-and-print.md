---
title: 'ARCH-REV-006: Fix execution-modes.md — WebSocket sidecar marks as planned, print mode API update'
status: done
created: 2026-05-18
priority: high
urgency: now
area: .agents/specs/architecture-map/agent-cli/execution-modes.md
depends_on: []
---

## Problem

Two issues in `execution-modes.md`:

1. **WebSocket Sidecar Mode documents a non-existent feature**: The section documents `startWebSidecarServer()`, `--web` and `--web-port` flags, and `agent-cli/src/web-sidecar/web-sidecar-server.ts`. None of these exist in the codebase:
   - `find packages/agent-cli/src -name "*sidecar*"` → no results
   - `grep -r "startWebSidecarServer" packages/agent-cli/src/` → no results
   - `grep -r "\-\-web\b" packages/agent-cli/src/cli-args.ts` → no results

   The `agent-web-ui/docs/SPEC.md` references `startWebSidecarServer` as a known entity in agent-cli, suggesting this was planned. The architecture document should reflect current reality and clearly mark it as planned/unimplemented.

2. **Print mode sequence diagram uses wrong API**: Shows `CLI->>SDK: new InteractiveSession(...)` but actual code uses `runtime.createSession()` via `IAgentRuntime`. This matches the broader stale pre-refactor pattern found in `composition-tree.md`.

Source: Senior Developer (C-05, mn-04), Senior Planner (M-03).

## Recommendation

**Proceed without user approval** — both fixes are factual and verified against the codebase.

1. Add a `> **[Planned — not yet implemented]**` callout box at the top of the WebSocket Sidecar Mode section. Do not remove the section, as the design intent is documented in the SPEC and is valuable.
2. Update the print mode sequence diagram: change `CLI->>SDK: new InteractiveSession(...)` to `CLI->>SDK: runtime.createSession(...)`.

## Test Plan

- `grep -r "startWebSidecarServer\|web-sidecar" packages/agent-cli/src/` must return no results (confirming feature absent)
- `grep -r "runtime.createSession\|createSession" packages/agent-cli/src/` must confirm actual call pattern
- `pnpm harness:scan` must pass after the change

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
