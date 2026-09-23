---
title: 'MCP-008: prove an MCP-served session can also consume MCP tools'
issue: https://github.com/woojubb/robota/issues/2532
status: done
created: 2026-09-03
completed: 2026-09-23
priority: high
urgency: soon
area: MCP end-to-end integration
depends_on: [MCP-001, MCP-002, MCP-007]
---

# MCP-008: prove an MCP-served session can also consume MCP tools

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2532](https://github.com/woojubb/robota/issues/2532) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Closing it as `NOT_PLANNED` means only that GitHub no longer schedules it independently; this Task remains `todo` until the product outcome is delivered.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the source Issue; do not add compatibility shims unless a current runtime consumer proves necessity.
- Treat retained security issue #2520 and its fail-closed activation-trust boundary as a mandatory external prerequisite before MCP-008 starts.

## Plan

- [x] Revalidated #2532 and #2520: `agent-cli` already assembles one client and served session;
      the missing boundary was host-owned approval and HTTP transport dependencies reaching startup.
- [x] Forward those existing capabilities through `IStartCliOptions` to the canonical MCP client
      composition. No second resolver, catalog, trust engine, client, or served runtime was added.
- [x] Add a deterministic headless scenario: an embedding host approves a user MCP definition through
      the canonical control plane, then starts the normal CLI product session. The external MCP host
      invokes `robota_submit`, its agent turn invokes discovered `probe__echo`, the tool arguments
      and returned value are checked, a later outbound failure is surfaced, and `Read` still works.
      Closing the host carrier also closes the outbound event stream. Existing stdio cases cover denied tools, untrusted
      workspaces, invalid startup and signal shutdown.
- [x] Update the CLI SPEC and README. Focused typecheck, 24 MCP startup/composition tests, five
      MCP stdio execution cases, dependency direction and agent-server boundary scans passed.
      The local build was unnecessary because this scenario runs source assembly; PR CI owns the
      clean build and consumer checks.

## Test Plan

Exercise the source Issue's primary success path and at least one failure or refusal path, then run affected package tests, typecheck, build, and repository boundary scans. Record exact commands and outputs in the implementation lifecycle.

## User Execution Test Scenarios

Execute the source Issue's operator-observable workflow from a clean fixture with
`pnpm --filter @robota-sdk/agent-cli exec vitest run --config vitest.bin.config.ts src/__tests__/e2e/mcp-stdio.bintest.ts`.
The `serves and consumes MCP tools through one admitted product session` case creates an isolated
home and workspace, runs the normal CLI product assembly, observes the served catalog and outbound
`tools/call` name, arguments and result, then injects an outbound failure and verifies served `Read`
still succeeds. Closing the host carrier ends the outbound event stream.

**Author verdict:** `SCENARIO EXECUTED: pass | 5`
