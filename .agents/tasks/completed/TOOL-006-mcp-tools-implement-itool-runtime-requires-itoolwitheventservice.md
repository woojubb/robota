---
title: "TOOL-006: agent-tool-mcp tools implement the narrow ITool, but the agent runtime's tool intake requires IToolWithEventService — the package's own purpose (register MCP tools as agent tools) is unreachable"
status: done
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-tool-mcp, packages/agent-core
depends_on: []
completed: 2026-08-29
---

# TOOL-006: MCP tools cannot be registered as agent tools

## Terminal disposition

Completed by merged PR #2040 (`a432cd380`). The implementation is already present on develop; this
backlog record is archived as the stale actionable copy. Broader MCP reachability issue #1985 remains
separate and open.

## Problem

`agent-tool-mcp` exists to provide "MCP tool implementations for Robota SDK", but its `MCPTool` and
`RelayMcpTool` implement the narrow `ITool` and lack `getName()`/`setEventService()`, while the SDK's
tool slot requires `IToolWithEventService` and unconditionally calls `setEventService()` on
registration — so the tools cannot be registered as agent tools (type error; runtime `TypeError` if
cast through `updateTools`).

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-tool-mcp/src/mcp-tool.ts:33` — `class MCPTool implements ITool`;
  `relay-mcp-tool.ts:46` — `RelayMcpTool` (a doc comment claims `ITool`-shaped; no `implements` clause).
  Neither defines `getName()` or `setEventService()`.
- `packages/agent-core/src/interfaces/agent.ts:95` — `tools?: Array<IToolWithEventService>`;
  `abstracts/abstract-tool.ts:93-113` — that contract requires `getName()` and `setEventService()`.
- `packages/agent-core/src/core/robota-config-manager.ts:103-106` — `updateTools` calls
  `tool.setEventService(eventService)` (guarded by `if (eventService)`, but Robota always defaults an
  event service, `robota.ts:112`), so a cast MCP tool throws `TypeError` there. The construction-time
  path (`robota-initializer.ts:88-92`) guards with `instanceof AbstractTool`, so a cast tool is
  silently not registered there — either way the tool never runs.
- No adapter exists; no production code consumes the package; the framework SPEC (`SPEC.md:2567`)
  records the intended integration ("Connect when MCP server is configured in InteractiveSession
  options") that this gap blocks.

## Direction

Make `MCPTool`/`RelayMcpTool` satisfy `IToolWithEventService` (`getName()` delegating to
`schema.name`; a stored or no-op `setEventService`), or ship a documented adapter that wraps an MCP
tool into the runtime intake contract. Record the chosen intake contract in the package SPEC's Class
Contract Registry.

## Test Plan

- Red-first: construct a `Robota` (or `InteractiveSession`) with an `MCPTool` in its tools and run a
  turn that calls it — assert it registers and executes (fails today).
- `pnpm harness:verify -- --scope packages/agent-tool-mcp` green.

## User Execution Test Scenarios

**Applies — via the public SDK** (configuring an MCP server's tools on an agent).

- Prerequisites: built workspace; a scratch SDK consumer + a local MCP server exposing one tool
  (fixture authored by this work).
- Steps: construct an agent with the MCP tool wired, ask the model to call it.
- Expected (after fix): the MCP tool registers and the call succeeds.
- Expected (before fix, contrast): registration type-errors or throws at runtime; the tool never runs.
- Cleanup: stop the fixture MCP server.
- Evidence (fill in after implementation): transcript of the successful MCP tool call.
