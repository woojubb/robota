---
title: 'ARCH-044: subagent child wire reuses live runtime contracts'
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2047#issuecomment-5454657685
created: 2026-08-22
priority: critical
urgency: now
area: packages/agent-subagent-runner, packages/agent-interface-transport, packages/agent-framework
depends_on: []
---

# ARCH-044: subagent child wire reuses live runtime contracts

Registered as GitHub issue https://github.com/woojubb/robota/issues/2047.

## Problem

The child-process wire DTO reuses the in-process semantic spawn request and live framework types.
Future fields therefore cross IPC by default. A nested provider profile can carry credentials and
destinations, and nested agent-definition extras survive projections whose guards validate only a
few required properties.

This blocks `SECURITY-001`: top-level omission tests cannot establish a least-authority boundary while
the wire contract structurally inherits new live fields.

## Existing Evidence

- The start payload embeds the complete semantic spawn request.
- The request can contain a secret-bearing provider profile.
- Agent-definition projection uses object spread, and its guard neither validates every allowed field
  nor rejects unknown keys.
- Issue #2047 independently recorded the missing total JSON-safe DTO before this finding.

## Directions Considered

- Define a runner-owned, minimal, JSON-safe child DTO and explicit encoder/total decoder.
- Reject omission-only guards on reused framework objects.
- Require field-coverage tests so adding a wire field without codec and canary coverage fails.

## Completion Criteria

- [ ] The child wire DTO references no live in-process dependency bag or semantic request type.
- [ ] Encoding is field-by-field and decoding rejects unknown, missing, malformed, and non-JSON values.
- [ ] Credentials, raw endpoints, provider options, callbacks, tools, terminals, and capabilities are
      absent from the generic wire.
- [ ] Codec round-trip and nested canary tests cover every allowed field.

## Test Plan

- Red-first encoder/decoder tests, including nested secret and unknown-field canaries.
- Real child-process round trips through IPC-equivalent serialization.
- Runner/framework builds, typechecks, unit tests, and a real self-fork integration scenario.

## User Execution Test Scenarios

### Scenario: a real child receives only the declared safe request

- Prerequisites: build the CLI and subagent runner; use an isolated project and deterministic scripted
  provider; enable a child-process subagent.
- Exact steps: invoke the delivered CLI scenario that spawns the child with canary fields present on
  the parent semantic request and capture the child's decoded diagnostic projection.
- Expected observable result: the child completes the safe request, while every undeclared canary is
  absent or rejected before worker construction.
- Cleanup: remove the isolated project and captured diagnostic output.
- Evidence:
