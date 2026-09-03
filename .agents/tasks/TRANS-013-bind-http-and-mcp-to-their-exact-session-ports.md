---
title: 'TRANS-013: bind HTTP and MCP to their exact session ports'
issue: https://github.com/woojubb/robota/issues/2107
status: todo
created: 2026-09-03
priority: critical
urgency: now
area: HTTP and MCP transports
depends_on: [TRANS-011]
---

# TRANS-013: bind HTTP and MCP to their exact session ports

## Objective

Implement [issue #2107](https://github.com/woojubb/robota/issues/2107) by binding HTTP and MCP adapters to explicit minimal session ports rather than the concrete interactive-session aggregate.

## Plan

- [ ] Enumerate the exact HTTP and MCP operations used at each adapter boundary.
- [ ] Introduce owner-defined ports and bind them at composition roots without transport-local policy duplication.
- [ ] Add contract tests that reject undeclared session access and preserve request/stream behavior.
- [ ] Run HTTP/MCP integration tests, typecheck, build, and dependency scans.

## User Execution Test Scenarios

Start HTTP and MCP transports against a session fixture exposing only the declared ports; execute request, streaming, and cancellation paths. Expected: all paths succeed without a broad session object. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
