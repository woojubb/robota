---
title: 'MCP-2525: bound MCP results and spill oversized output securely'
issue: https://github.com/woojubb/robota/issues/2525
status: in-progress
created: 2026-09-21
priority: high
urgency: now
area: MCP tool-result admission, provider-context bounds, and secure external-payload lifecycle
depends_on: [MCP-002, PAYLOAD-2153]
---

# MCP-2525: bound MCP results and spill oversized output securely

## Objective

Deliver the direct model-context and data-lifecycle outcome of [issue #2525](https://github.com/woojubb/robota/issues/2525): enforce warning and hard bounds before provider conversion, honor strictly validated bounded per-tool metadata, and replace oversized admitted output with an opaque stable reference backed by secure spill storage and explicit retention/cleanup semantics.

## Source Constraints

- A generic session/tool-result admission owner measures output in one documented unit before any provider sees it; the MCP adapter only interprets protocol/vendor metadata. HTTP bodies and stdio frames also have a separate byte cap before protocol parsing.
- Per-tool upward overrides must be typed, range-checked, and capped by a repository hard limit; malformed metadata is rejected or ignored visibly according to the approved contract.
- Spill paths are contained, collision-safe, permission-restricted, and resistant to traversal and symlink escape. References are stable, non-secret, and never raw storage paths.
- Logs, status, errors, and provider context never embed spilled payload bytes, credentials, source metadata, or a context body beyond its supported bound.
- Missing files, partial writes, disk-full conditions, retention expiry, and session-end cleanup fail visibly and leave no silent or leaked fallback path.

## Plan

- [x] Revalidate current result handling, provider conversion, external-payload boundaries, and current MCP output-limit documentation.
- [x] Specify one bounded admission and spill lifecycle with explicit units, limits, metadata validation, opaque references, retention, and failure taxonomy.
- [x] Implement the generic owner and adapter projection without duplicating policy in individual provider or tool paths.
- [x] Add warning/hard-boundary, malformed metadata, overflow/reference, containment, disk failure, cleanup, and redaction coverage.
- [x] Update affected package contracts and record the bounded-result public scenario evidence.

## Completion Criteria

- [x] TC-01: Default warning/hard limits and the repository maximum are configurable, documented, and enforced before provider conversion.
- [x] TC-02: Valid per-tool metadata can raise an admitted limit only within the repository cap; malformed or excessive metadata cannot widen admission.
- [x] TC-03: Oversized output produces an opaque reference backed by secure contained storage, while raw payload and source credentials remain absent from all observable diagnostics.
- [x] TC-04: Traversal, symlink, partial-write, disk-full, missing-file, expiry, and session-end cleanup paths fail visibly and maintain containment.
- [x] TC-05: Focused result-admission tests, typecheck/build, affected scans, and the public bounded-result scenario pass.
- [x] TC-06: HTTP response bodies and stdio frames stop at 8 MiB before SDK parsing; the live model can read a saved reference in bounded 4,000-character chunks.

## Test Plan

Add unit/integration cases at the generic admission owner and MCP metadata adapter. Use controlled payloads and a temporary restricted storage root to assert positive bounds, overflow reference behavior, negative filesystem conditions, cleanup, redaction, and provider-context refusal. Run affected package tests/typechecks/builds and repository boundary scans.

## Verification

2026-09-23 local evidence: `@robota-sdk/agent-mcp` full suite passed (226 tests before a final two-case transport closeout check, which also passed); focused core, session, CLI composition, HTTP receive-bound, and stdio overflow tests passed. Core, MCP, session, framework, and CLI typechecks/builds passed. Dependency-direction, command-layering, SPEC public-surface, SPEC coverage, and task test-plan scans passed. Both public CLI result-admission scenarios passed. PR review and CI remain the delivery gate.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1: bounded MCP result is admitted without exceeding provider context

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=MCP tool execution result
- Prerequisites: the CLI composition example supplies a controlled MCP response and a recording provider boundary through the shipped session path.
- Command: `pnpm --filter @robota-sdk/agent-cli run scenario:verify:mcp-result-admission --within-limit`
- Observable type: sdk-result
- Observable rationale: source=recorded admission and provider request summary
- Expected observable: `result=admitted; providerBoundRespected=true; spillCreated=false`
- Cleanup: the example removes its temporary context and storage roots before exit.
- Evidence: passed locally on 2026-09-23; `result=admitted; providerBoundRespected=true; spillCreated=false`.

### Scenario 2: oversized MCP result becomes an opaque reference and is cleaned up

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=MCP tool execution result lifecycle
- Prerequisites: use the same provider-free example with a response exceeding the configured hard limit and an isolated spill root.
- Command: `pnpm --filter @robota-sdk/agent-cli run scenario:verify:mcp-result-admission --overflow`
- Observable type: sdk-result
- Observable rationale: source=opaque reference, redacted diagnostics, and cleanup result
- Expected observable: `result=spilled; opaqueReference=true; payloadLeaked=false; cleanupRemoved=true`
- Cleanup: the example ends its session and proves that the spill root no longer contains the sidecar.
- Evidence: passed locally on 2026-09-23; `result=spilled; opaqueReference=true; payloadLeaked=false; cleanupRemoved=true`.
