---
title: 'ARCH-REV-012: Create transport-architecture.md architecture-map subdocument'
status: todo
created: 2026-05-18
priority: high
urgency: soon
area: .agents/specs/architecture-map/transport-architecture.md, .agents/specs/ARCHITECTURE-MAP.md
depends_on: [ARCH-REV-002]
---

## Problem

`agent-transport` has 5 production subpaths (`/headless`, `/http`, `/ws`, `/mcp`, `/tui`) each with distinct protocol semantics, React dependency constraints, and consumer sets. There is no architecture-map document for this package family. `ARCHITECTURE-MAP.md` step 5 routes developers to `agent-system.md` for transport changes, but `agent-system.md` has only label-level mentions.

Key undocumented facts:

- Diamond dependency structure: `agent-core ← agent-framework ← agent-transport` plus `agent-core ← agent-interface-transport ← agent-transport` — and why `agent-framework` and `agent-transport` must never import each other (bidirectional allowed at the Assembly↔Transport level)
- React isolation contract: which subpaths are pure-TS (`/headless`, `/http`, `/ws`, `/mcp`), which carry React/Ink (`/tui`)
- Protocol boundary for each subpath and which product shells consume which
- MCP transport server mode (agent exposed as MCP server to MCP clients) vs MCP tool integration (`agent-tool-mcp`, agent consuming external MCP servers) — the two MCP roles are never distinguished in the architecture map

Source: Senior Planner (M-01, C-02).

## Recommendation

**Proceed without user approval** — this is content creation from existing SPECs and source code. No new design decisions.

Create `.agents/specs/architecture-map/transport-architecture.md` covering:

- Subpath inventory (5 subpaths, protocols, consumers, React isolation)
- Diamond dependency diagram
- Assembly↔Transport bidirectional edge rationale
- **MCP disambiguation**: `agent-tool-mcp` (tool client) vs `agent-transport/mcp` (server adapter) — a dedicated section with prose and comparison table
- Type contract ownership (`agent-interface-transport`, `agent-interface-tui`)
- Reading order: when to read this document (before any transport change)

Update `ARCHITECTURE-MAP.md` reading order to add step for transport changes.

## Test Plan

- Read `packages/agent-transport/docs/SPEC.md` to verify the new document accuracy
- Verify `packages/agent-transport/package.json` subpaths match documented subpaths
- Verify `packages/agent-tool-mcp/` and `packages/agent-transport/src/mcp/` existence confirms both MCP roles
- `pnpm harness:scan` must pass

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
