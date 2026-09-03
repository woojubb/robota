---
title: 'TRANS-014: bind WS, protocol, and WebRTC adapters to exact session ports'
issue: https://github.com/woojubb/robota/issues/2116
status: todo
created: 2026-09-03
priority: medium
urgency: later
area: WebSocket, protocol, and WebRTC transports
depends_on: [TRANS-011]
---

# TRANS-014: bind WS, protocol, and WebRTC adapters to exact session ports

## Objective

Implement [issue #2116](https://github.com/woojubb/robota/issues/2116) by replacing broad session dependencies in WS, protocol, and WebRTC adapters with exact owner-defined ports.

## Plan

- [ ] Inventory operations each adapter actually consumes.
- [ ] Bind minimal capability ports at composition roots and remove concrete-session imports.
- [ ] Add contract and integration tests for connection, streaming, lifecycle, and teardown paths.
- [ ] Run affected tests, typecheck, build, and boundary scans.

## User Execution Test Scenarios

Run representative WS and WebRTC sessions with fixtures exposing only declared capabilities. Expected: connection, messaging, and teardown are preserved without broad session access. Evidence pending implementation.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
