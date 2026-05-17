---
title: 'ARCH-REV-013: Expand agent-system.md — MCP disambiguation, WebSocket sidecar cross-reference, playground data-flow'
status: done
created: 2026-05-18
priority: high
urgency: soon
area: .agents/specs/architecture-map/agent-system.md, .agents/specs/architecture-map/apps-and-deployment.md
depends_on: [ARCH-REV-011, ARCH-REV-012]
---

## Problem

Three under-documented areas in `agent-system.md`:

1. **MCP dual role**: `agent-tool-mcp` (agent consuming external MCP tool servers) and `agent-transport/mcp` (agent exposed as MCP server) appear side-by-side in diagram labels with no prose distinguishing them. This is captured separately in ARCH-REV-012 but `agent-system.md` needs at minimum a disambiguation note with a pointer.

2. **WebSocket Sidecar cross-reference absent**: The sidecar feature (`--web` mode) spans 4 packages (`agent-cli`, `agent-transport/ws`, `agent-web-ui`, `apps/agent-web`) but no architecture-map document connects all four. `agent-system.md` is the right place for a "WebSocket Sidecar Mode" section pointing to `execution-modes.md` for the sequence diagram. Note: since the sidecar is currently **planned but not implemented** (per ARCH-REV-006), this section should be marked `[Planned]`.

3. **Playground data-flow missing**: `agent-system.md` has a playground flowchart but no documented data flow for `browser → apps/agent-web → apps/agent-server → AI provider`. The intentional "no session stack" architectural decision is only in `agent-playground/docs/SPEC.md` and not referenced from the architecture map. Also missing: the `Playground --> Orchestration` edge (`agent-playground` is the sole consumer of `agent-team`).

Source: Senior Planner (C-02, M-02, M-03, M-07).

## Recommendation

**Proceed without user approval** — content creation based on facts from existing SPECs and code, plus the ARCH-REV-002 fix (Playground→Orchestration edge).

1. Add a "MCP Roles" disambiguation paragraph to the transport section of `agent-system.md` (pointing to `transport-architecture.md` for full detail once ARCH-REV-012 is done).
2. Add a "WebSocket Sidecar Mode [Planned]" section in `agent-system.md` connecting the 4 packages with a reference to `execution-modes.md`.
3. Expand the playground section: add a data-flow description and a link to `agent-playground/docs/SPEC.md`'s ADR for the no-session-stack decision. Add `Playground --> agent-team` edge to the playground stack diagram.

## Test Plan

- Read `packages/agent-playground/docs/SPEC.md` to verify playground data-flow accuracy
- Read `packages/agent-playground/package.json` to confirm `agent-team` dependency
- `pnpm harness:scan` must pass

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
