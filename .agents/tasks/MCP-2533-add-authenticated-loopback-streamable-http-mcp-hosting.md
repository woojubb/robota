---
title: 'MCP-2533: add authenticated loopback Streamable HTTP MCP hosting'
issue: https://github.com/woojubb/robota/issues/2525
status: todo
created: 2026-09-21
priority: medium
urgency: soon
area: MCP Streamable HTTP carrier, loopback network admission, and protocol-session mapping
depends_on: [MCP-006, MCP-007, TRANS-013]
---

# MCP-2533: add authenticated loopback Streamable HTTP MCP hosting

## Objective

Deliver the independent network boundary retained from [issue #2533](https://github.com/woojubb/robota/issues/2533): an official MCP Streamable HTTP carrier that binds loopback only, authenticates every request, validates Host and Origin before processing, and maps unguessable protocol session identifiers to intended Robota runtime sessions without treating an identifier as authorization.

## Source Constraints

- The MCP carrier is owned separately from Robota HTTP/WebSocket protocol adapters and reuses shared network-admission primitives rather than CLI-local policy.
- `MCP-006` remains the owner of transport-neutral tool execution and cancellation, while `TRANS-013` owns the exact minimal session port; this carrier only validates and projects MCP wire events onto those lower contracts.
- The carrier implements the adopted Streamable HTTP POST, GET, protocol-version, and protocol-session lifecycle requirements explicitly rather than treating a successful POST as protocol conformance.
- The first release is mechanically loopback-only; it uses a high-entropy bearer credential or an equally strong approved admission mechanism, never a credential in a query string.
- Host and Origin validation happens before request/body processing and includes DNS-rebinding and alternate-host refusal coverage.
- `Mcp-Session-Id` is an unguessable server-side mapping key bound to credential context, not a Robota session ID or authorization credential.
- Request concurrency, cancellation, resumption, expiry, disconnect, and shutdown are explicit and bounded; logs/errors redact bearer, protocol-session, response-body, and internal-runtime material.
- Non-loopback binding stays refused until the separate remote authorization capability has landed and is configured.

## Plan

- [ ] Revalidate the current MCP Streamable HTTP POST/GET, protocol-version, and session-lifecycle requirements together with the server product carrier abstraction and shared network-admission owner.
- [ ] Specify the loopback bind, credential, Host/Origin, POST/GET, adopted protocol-version behavior, protocol-session mapping, and lifecycle contracts without reusing a Robota protocol carrier.
- [ ] Implement the carrier as a wire projection over `MCP-006` transport-neutral execution/cancellation and the `TRANS-013` exact session port, with controlled runtime-session mapping and explicit concurrency, expiry, and shutdown behavior.
- [ ] Add real local HTTP coverage for valid/invalid POST, GET, protocol version, Host, Origin, bearer, mapping, concurrent request, cancellation/resume, expiry, disconnect, and shutdown cases.
- [ ] Update affected contracts and record the authenticated loopback operator scenario evidence.

## Completion Criteria

- [ ] TC-01: Valid loopback Streamable HTTP POST and GET flows, with the adopted protocol-version behavior, reach the intended runtime session through a server-side protocol-session mapping.
- [ ] TC-02: Missing/invalid bearer, Host, Origin, alternate-host, non-loopback bind, and guessed protocol-session attempts are refused before execution.
- [ ] TC-03: Concurrent request, transport-neutral cancellation/resume, expiry, disconnect, and shutdown behavior is bounded through the lower runtime/session contracts and redacts secret/session/runtime material.
- [ ] TC-04: Real HTTP integration tests, affected package typecheck/build, security scans, and the loopback operator scenario pass.

## Test Plan

Run real local HTTP tests against a loopback listener, not mocked transport names. Cover POST and GET, adopted protocol-version behavior, valid and invalid bearer/Host/Origin/session mappings, DNS-rebinding-style alternate hosts, lifecycle transitions, transport-neutral cancellation through `MCP-006`, exact session-port use through `TRANS-013`, redaction, and refusal of non-loopback binding. Run the affected package tests/typechecks/builds and repository network/security scans.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: authenticated loopback HTTP request is admitted and hostile requests are refused

- Executability: agent-executable
- Product surface: CLI operator flow
- Surface rationale: shipped-interface=Robota MCP serve mode after `MCP-007`
- Prerequisites: `MCP-007` is delivered; this Task adds a provider-free local loopback fixture and `scenario:verify:mcp-loopback-http` in the owning MCP server package or CLI package. The fixture starts a temporary listener on `127.0.0.1`, prints no credentials, and makes both valid and hostile local HTTP requests.
- Command: `pnpm --filter @robota-sdk/agent-cli run scenario:verify:mcp-loopback-http` <!-- allow-undeclared-script: MCP-2533 creates this package script during implementation before this user execution test scenario is executed. -->
- Observable type: cli-result
- Observable rationale: source=listener admission summary and HTTP status outcomes
- Expected observable: `validRequest=200; unauthorized=401; badOrigin=403; nonLoopbackRefused=true; secretLeaked=false`
- Cleanup: the fixture closes the listener, cancels mapped work, and removes temporary state before exit.
- Evidence: pending implementation.
