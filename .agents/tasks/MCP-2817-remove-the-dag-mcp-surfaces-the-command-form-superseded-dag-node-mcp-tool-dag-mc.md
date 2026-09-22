---
title: 'MCP-2817: Remove the DAG↔MCP surfaces the command form superseded: dag-node-mcp-tool, dag-mcp-server, dag-cli/src/mcp'
issue: https://github.com/woojubb/robota/issues/2817
status: todo
created: 2026-09-22
priority: medium
urgency: soon
area: dag-nodes/mcp-tool, dag-mcp-server, dag-cli, publish-registry
depends_on: []
---

# MCP-2817: Remove the DAG↔MCP surfaces the command form superseded: dag-node-mcp-tool, dag-mcp-server, dag-cli/src/mcp

## Objective

Remove the three DAG↔MCP surfaces that predate the command-form DAG (`agent-cli` `/workflows` via
`agent-command-workflows`) and that nothing in it uses, on the owner's decision of 2026-09-22
(verbatim: `MCP-002에서 분리, 별도 제거 유닛`, given after stating the DAG is wired in command form,
not MCP form).

## Problem

| Surface                       | What it is                                      | Measured 2026-09-22                                                                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dag-mcp-server`     | the DAG exposed as an MCP server                | `private: true`; no package or app depends on it                                                                                                                                                                                                              |
| `packages/dag-cli/src/mcp/`   | the same exposure inside the `dag-cli` shell    | `dag-cli` is private with no consumer but itself; README calls it an internal shell                                                                                                                                                                           |
| `packages/dag-nodes/mcp-tool` | a workflow node that calls an external MCP tool | 0 references in `agent-command-workflows`, `dag-nodes-default`, `dag-builder`, `dag-framework`; absent from the product's default catalog; no user docs; constructed outside its own factory and tests only at `dag-cli/src/local-runner/node-registry.ts:28` |

`AGREEMENT-015` / issue #1986 concerns exposing Robota **sessions** as an MCP server and does not own
these. ADR-005 originally assigned MCP-002 the migration of the node onto the shared MCP client seam;
that obligation is withdrawn by amendment and the node's fate is this item's. `MCP-2816` (wire the node
into `/workflows`) is superseded by this removal.

## Plan

- [ ] Decide whether `packages/dag-cli` survives without its MCP half or is removed whole; record the
      decision and the reason in the spec
- [ ] Remove `packages/dag-nodes/mcp-tool`, `packages/dag-mcp-server` and `packages/dag-cli/src/mcp/`
      with their tests, manifests and `@modelcontextprotocol/sdk` declarations
- [ ] Remove the `dag-cli` local-runner registration of the node and any remaining import
- [ ] Update `.agents/publish-registry.md` (Private table rows), `.agents/project-structure.md`,
      `ARCHITECTURE.md` package listings, and `packages/dag-cli/README.md`
- [ ] Note in `MCP-2522`'s record that "restores DAG stdio execution" is moot; its agent-line stdio
      adapter scope is unchanged
- [ ] Prove `/workflows` is unaffected: the default node catalog is identical before and after

## Test Plan

- Absence: `grep -rl '"@robota-sdk/dag-mcp-server"\|"@robota-sdk/dag-node-mcp-tool"' packages/*/package.json apps/*/package.json` returns nothing; the directories are gone; `dag-cli` (if kept) has no `src/mcp/` and no SDK dependency
- Catalog invariance: `createDefaultNodeRegistrySync()` node-type list is byte-identical before and after
- Harness: `family-siblings`, `check-dependency-direction`, `check-dep-kind`, `scan-publish-registry`, and `run-all-scans --affected --context pr` report no NEW failure
- Package: `pnpm -r --filter './packages/dag-*' test` and `build` green for the survivors

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This item deletes surfaces no product path loads: the command-form DAG (`/workflows`) does
not reference the node, the server, or the `dag-cli` MCP half, so a user running Robota observes
identical behaviour before and after. There is no runnable product surface whose output changes;
catalog invariance is an engineering check and lives in `## Test Plan`.
