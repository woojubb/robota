---
title: 'TRANS-013: bind HTTP and MCP to their exact session ports'
issue: https://github.com/woojubb/robota/issues/2107
status: done
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

- [x] Enumerate the exact HTTP and MCP operations used at each adapter boundary.
- [x] Use the existing owner-defined HTTP and MCP ports as the adapters' exact attach contracts; the composition root's `bindTransportAdapter` accepts those ports before registry registration.
- [x] Add contract tests that reject undeclared session access and preserve request/stream behavior.
- [x] Run HTTP/MCP integration tests, typecheck, build, and dependency scans.

## User Execution Test Scenarios

Start HTTP and MCP transports against a session fixture exposing only the declared ports; execute request, streaming, and cancellation paths. Expected: all paths succeed without a broad session object. Evidence: `routes.test.ts` starts the HTTP adapter with only its 13 declared methods and executes `/submit` SSE, `/abort`, and `/cancel-queue`; `mcp-server.test.ts` connects a client to a three-method port and executes catalog, tool, and submit calls. HTTP 61/61 and MCP 23/23 package tests, both typechecks/builds/lint, SPEC public-surface, and dependency scans passed.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
