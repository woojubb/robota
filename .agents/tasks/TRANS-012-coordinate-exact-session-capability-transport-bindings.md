---
title: 'TRANS-012: coordinate exact session capability transport bindings'
issue: https://github.com/woojubb/robota/issues/2069
status: todo
created: 2026-09-03
priority: medium
urgency: soon
area: transport architecture
depends_on: [TRANS-011]
---

# TRANS-012: coordinate exact session capability transport bindings

## Objective

Replace the broad `IInteractiveSession` transport boundary described by [issue #2069](https://github.com/woojubb/robota/issues/2069) with explicit capabilities, coordinating TRANS-011 and TRANS-013 through TRANS-015 under canonical issue #2079.

## Plan

- [ ] Freeze the exact capability matrix for registry, HTTP, MCP, WebSocket, protocol, and WebRTC adapters.
- [ ] Sequence TRANS-011, TRANS-013, TRANS-014, and TRANS-015 so no parallel broad-session seam remains.
- [ ] Define repository-wide completion evidence for removal of production `IInteractiveSession` transport dependencies.
- [ ] Update architecture specifications and verify every transport composition root.

## User Execution Test Scenarios

Prerequisite: all child transport Tasks are complete. Exercise HTTP, MCP, WebSocket, protocol, and WebRTC host paths. Expected: behavior is preserved while each adapter receives only exact capabilities. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
