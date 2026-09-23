---
title: 'MCP-2522: add a safe stdio MCP client transport'
issue: https://github.com/woojubb/robota/issues/2525
status: in-progress
created: 2026-09-21
priority: high
urgency: now
area: shared MCP client transport, local subprocess authority, and activation admission
depends_on: [MCP-002, MCP-2520]
---

# MCP-2522: add a safe stdio MCP client transport

## Objective

Deliver the independent local-subprocess security boundary retained from [issue #2522](https://github.com/woojubb/robota/issues/2522). Add an official-SDK `StdioClientTransport` through the shared MCP client owner, not through a CLI-local or DAG-product implementation, with explicit authority over executable, arguments, working directory, environment, and lifecycle.

## Source Constraints

- Activation admission completes before a project or plugin definition can spawn a local process.
- Command, arguments, working directory, and environment are independently validated; shell interpolation and ambient full-environment inheritance are forbidden.
- The requested working directory is resolved against an explicitly allowed project root before spawn; lexical traversal and symlink-mediated escape outside that root are refused rather than normalized into ambient authority.
- Diagnostics, stderr handling, errors, and audit/status output redact credentials and never echo secret-bearing environment values.
- Spawn, initialization, cancellation, timeout, early exit, stderr, shutdown, and cleanup are bounded and deterministic.
- The implementation must not introduce an agent-product dependency on a DAG product package or reimplement a third MCP client.

## Plan

- [x] Revalidate the shared client transport port, activation-admission contract, and official SDK seam against the current tree.
- [x] Define explicit, fail-closed subprocess authority data, including canonical allowed-root containment for the requested working directory, and the lower transport adapter that consumes it.
- [x] Integrate admission-before-spawn and deterministic child lifecycle ownership without a CLI-local transport path.
- [x] Add denied-command/argument/environment/cwd, traversal and symlink-root escape, untrusted-source, timeout/cancellation/early-exit, and success coverage.
- [x] Update affected package contracts and record the public stdio scenario evidence.

## Completion Criteria

- [x] TC-01: A trusted, allowlisted stdio definition discovers and calls an MCP tool through the shared client transport owner.
- [x] TC-02: Disallowed executable, dangerous arguments/environment, invalid root, lexical traversal, symlink-mediated root escape, and untrusted provenance are refused before spawn.
- [x] TC-03: Child cancellation, timeout, early exit, stderr, and session shutdown have bounded, deterministic, secret-redacted results.
- [x] TC-04: Focused MCP tests, typecheck/build, dependency-boundary checks, and the public stdio scenario pass without an agent-to-DAG product dependency.

## Test Plan

The current simplified harness governs this implementation: the public SDK example, focused adapter
and CLI composition tests, affected typechecks, and the relevant dependency boundary check own local
verification. Full repository scan suites remain CI-owned. Host-provided exact executable/argv/env/root
authority is separate from settings and activation approval. The CLI's default executable provisions no
authority; embedding hosts may supply `IStartCliOptions.mcpStdioAuthorities`. SDK cleanup observes the
direct child; process-tree containment is not claimed by this unit.

Exercise the shared transport with a controlled local MCP fixture and assert both the admitted discovery/call path and every refusal path. Resolve the requested cwd against a temporary allowed root before spawn, then prove that `..` traversal and an in-root symlink targeting outside the root are both refused with a zero spawn count. Add integration coverage for lifecycle events, run affected package tests/typechecks/builds, check dependency direction, and run the relevant repository security scans.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1: denied stdio definition never spawns a process

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=shared MCP client admission and transport
- Prerequisites: the provider-free `agent-mcp` stdio transport example and `scenario:verify:stdio-transport`; denied mode uses an untrusted activation request and records SDK transport starts in memory.
- Command: `pnpm --filter @robota-sdk/agent-mcp run scenario:verify:stdio-transport --denied`
- Observable type: sdk-result
- Observable rationale: source=admission result plus spawn counter
- Expected observable: `result=denied; spawned=false; secretLeaked=false`
- Cleanup: the fixture creates no child process when denied and removes its temporary workspace before exit.
- Evidence: 2026-09-23, final example executed with isolated HOME and physical Node: `result=denied; spawned=false; secretLeaked=false`.

### Scenario 2: admitted allowlisted stdio transport completes a discovery and call

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=shared MCP client transport
- Prerequisites: use the same provider-free example with an allowlisted local fixture server; no network or provider credential is required.
- Command: `pnpm --filter @robota-sdk/agent-mcp run scenario:verify:stdio-transport --allowed`
- Observable type: sdk-result
- Observable rationale: source=tool discovery and call result
- Expected observable: `result=called; discovered=true; spawned=true; shutdownClean=true`
- Cleanup: the example cancels or exits the child, waits for its deterministic shutdown, and removes the temporary workspace.
- Evidence: 2026-09-23, final example executed with isolated HOME and physical Node: `result=called; discovered=true; spawned=true; shutdownClean=true`.

## Local Implementation Result — 2026-09-23

Shared definition/adapter/session coverage passed 60 tests across eight focused files before review.
The review repair batch passed ten stdio integration tests and nine failure-classification tests;
the final late-close cleanup regression failed before its repair and then passed. CLI composition
and startup passed 22 tests, including real settings-to-SDK discovery, `local__ping` invocation,
and shutdown. New CLI wiring, inherited-property refusal and cleanup-option assertions were proven
RED before their respective changes. Both affected package typechecks, the owning agent-mcp build,
and the dependency-direction check passed. CLI typecheck required refreshing stale generated
interface-session/framework outputs left by earlier branch work; no unrelated source change was
made. Lint reported no errors, with existing/size warnings retained.

Independent review found and verified repairs for four lifecycle defects: returning before child
cleanup, revocation during asynchronous start checks, reuse of a cancelled session, and duplicate
concurrent starts. Cleanup failures now propagate and prevent automatic retry; later independent
requests reconnect after successful cancellation cleanup, without replaying the cancelled call.
The same reviewer confirmed all four repairs. Full repository CI remains remote-owned.

This record remains `in-progress`: local acceptance is verified, but publication and integration
landing are pending the initiative's integration-base publication decision. The SDK observes the
direct child only. Default SDK environment keys remain present with empty or host-selected values;
filesystem path checks are not an OS sandbox against concurrent replacement. No process-tree
termination or persistent host policy is claimed.
