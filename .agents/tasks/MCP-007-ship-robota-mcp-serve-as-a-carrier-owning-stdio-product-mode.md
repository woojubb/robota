---
title: 'MCP-007: ship robota mcp serve as a carrier-owning stdio product mode'
issue: https://github.com/woojubb/robota/issues/2531
status: done
created: 2026-09-03
priority: critical
urgency: now
area: MCP stdio server
depends_on: [TRANS-013, MCP-006]
---

# MCP-007: ship robota mcp serve as a carrier-owning stdio product mode

## Objective

Preserve and deliver the independently verifiable outcome of [issue #2531](https://github.com/woojubb/robota/issues/2531) after its redundant child-Issue queue entry is absorbed into the RULE-023 Task graph.

## Source Constraints

- The source Issue remains the complete historical problem and acceptance record.
- Closing it as `NOT_PLANNED` means only that GitHub no longer schedules it independently; this Task remains `todo` until the product outcome is delivered.
- Preserve every security, data-correctness, dependency, and direct-replacement constraint from the source Issue; do not add compatibility shims unless a current runtime consumer proves necessity.

## Plan

- [x] Revalidate the source Issue against the current tree and name the exact owner boundary.
- [x] Implement the target behavior without parallel ownership or a forwarding facade.
- [x] Add negative and positive regression evidence for the source acceptance conditions.
- [x] Update affected specifications and run package, type, build, and boundary verification.

## Test Plan

Exercise the source Issue's primary success path and at least one failure or refusal path, then run affected package tests, typecheck, build, and repository boundary scans. Record exact commands and outputs in the implementation lifecycle.

## User Execution Test Scenarios

The built `robota` CLI is launched from an isolated project directory through the official SDK
`StdioClientTransport`. The client lists canonical tools, reads a file using an admitted `Read`
tool, receives a denied `Bash` result, and closes stdin. A leading CLI flag before `mcp serve`
uses the same parsed mode decision and keeps stdout reserved. Separate built-binary cases assert an
invalid mode combination and an untrusted Git workspace emit no stdout and exit 1, and SIGTERM
after MCP initialization exits 0 with only JSON-RPC frames on stdout. The MCP transport test sends
a real stdio initialize frame, observes the server response, and closes input. A delayed catalog
test closes stdin before readiness, and a mode test fires SIGTERM while startup is pending; both
reach cleanup promptly. No WebSocket or TUI mode is needed.

Verification: `pnpm --filter @robota-sdk/agent-transport-mcp test` (27 passed),
`pnpm --filter @robota-sdk/agent-transport-mcp typecheck`,
`pnpm --filter @robota-sdk/agent-cli test` (623 passed, 18 skipped),
`pnpm --filter @robota-sdk/agent-cli typecheck`, `pnpm --filter @robota-sdk/agent-cli build`,
`pnpm --filter @robota-sdk/agent-cli test:bin` (15 passed),
and `pnpm install --frozen-lockfile --ignore-scripts` passed locally.

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`
