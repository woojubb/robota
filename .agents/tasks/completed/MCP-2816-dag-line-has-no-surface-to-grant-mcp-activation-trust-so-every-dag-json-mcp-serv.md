---
title: 'MCP-2816: The /workflows product path never loads dag-node-mcp-tool, and nothing binds an MCP activation admission where it would be constructed'
issue: https://github.com/woojubb/robota/issues/2816
status: superseded
completed: 2026-09-22
created: 2026-09-22
priority: medium
urgency: soon
area: agent-command-workflows, dag-nodes-default, dag-node-mcp-tool
depends_on: [MCP-002]
---

# MCP-2816: The /workflows product path never loads dag-node-mcp-tool, and nothing binds an MCP activation admission where it would be constructed

## Superseded

Superseded on 2026-09-22 by `MCP-2817` ([issue #2817](https://github.com/woojubb/robota/issues/2817)):
the owner decided the DAG is delivered in command form and the DAG↔MCP surfaces — including
`dag-node-mcp-tool`, the node this item would have wired into `/workflows` — are removed rather than
migrated. There is nothing left to wire or to bind an admission for. The measurements recorded below
(catalog absence, the trust-binding gap, the composition-root location) are carried into `MCP-2817`'s
record as the starting facts for the removal.

## Objective

Make the shared-seam MCP node that `MCP-002` delivers as a library reachable from the product's DAG
surface, with its activation admission bound from the agent family's workspace-trust facts at the
composition root — so a `/workflows` user in a trusted workspace can declare, grant and run an HTTP MCP
server node, and a headless run can be supplied an approval out-of-band.

The allocator's original title read "DAG line has no surface to grant MCP activation trust". That was
measured against `packages/dag-cli`, which is a private development shell and not the product; the
owner corrected it the same day. The filename keeps the allocated slug; the frontmatter title is the
corrected one.

## Problem

- The user surface is `agent-cli` `/workflows` → `agent-command-workflows` (ARCHITECTURE.md § "DAG /
  workflow subsystem"). It executes through `LocalDagRuntimeProvider`
  (`packages/agent-command-workflows/src/workspace-runtime.ts:41`), whose registry defaults to
  `@robota-sdk/dag-nodes-default` (`packages/dag-framework/src/local-dag-runtime-provider.ts:148`).
- `dag-nodes-default` declares fifteen node packages and **not** `dag-node-mcp-tool`. Outside the node's own factory (`index.ts:276`) and its tests, the repository's only `new McpToolNodeDefinition()` is `packages/dag-cli/src/local-runner/node-registry.ts:28`.
- `agent-command-workflows` depends on `agent-framework` (workspace-trust owner) but has zero references
  to `repositoryKey` / `trustState` / `workspaceGeneration` — nothing there constructs the node, so
  nothing binds an admission for it.

## Plan

- [ ] Decide the wiring seam: add `dag-node-mcp-tool` to `dag-nodes-default`, or construct it at the
      `nodeRegistry` seam in `agent-command-workflows` (the latter keeps `dag-nodes-default` free of a
      node that needs a host-bound admission; record the choice and why)
- [ ] Bind an `IMCPActivationAdmission` at that root from `agent-framework`'s workspace-trust facts,
      mapping the declaration onto the `project` source with `origin` = the declaring `.dag.json`
      (per `MCP-002` § Decision); inject it via `new McpToolNodeDefinition({ admission })`
- [ ] Expose the grant step to the `/workflows` user through the existing agent-family trust flow
      (`agent-cli` `workspace-trust-command.ts` / `/mcp` activation), or state why a DAG-specific step
      is needed
- [ ] Headless: define the out-of-band approval-supply path (pre-seeded approval store or `managed`
      authority) for `apps/dag-runtime-server` and CI runs
- [ ] Keep `dag-*` core types free of MCP vocabulary; the admission is bound in the agent family and
      injected (mirror of `MCP-002` § Decision's rejection of extending `INodeExecutionContext`)
- [ ] Leave `dag-cli`'s local runner fail-closed, and say so in its README

## Test Plan

- Unit: node constructed with an admission bound to a trusted workspace invokes; the same node with an
  admission bound to an untrusted workspace refuses `pending`; a rotated `workspaceGeneration`
  invalidates a prior grant (inverse of `MCP-002` TC-29)
- Integration: `/workflows` registry lists the MCP node when wired; a workflow declaring an HTTP MCP
  server executes end to end against the in-process mock server `MCP-002` extends
- Harness: `family-siblings`, `check-dependency-direction`, `check-dep-kind` stay green across the new
  edge(s); `run-all-scans --affected --context pr` reports no NEW failure

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: manual | 1`

**Reason:** This item changes runnable user-facing behaviour in `agent-cli` `/workflows`; a user can
observe it directly. The scenario is `manual` because it needs an HTTP MCP server reachable from the
workspace and an interactive trust grant.

### S1 — declare, grant and run an HTTP MCP server node from `/workflows`

- **Prerequisites:** `robota` (agent-cli) built from this branch; a trusted workspace (`robota trust`);
  an HTTP MCP server reachable at a non-private URL, or the in-process mock server from
  `packages/agent-mcp/src/__tests__/mock-mcp-server.ts` started on loopback with egress policy allowing
  loopback for the test. State whether the mock environment already exists: **it exists after `MCP-002`
  and is extended by it; this item does not build it.**
- **Steps:** `robota` → `/workflows create "call the <tool> tool on <server> and print the result"` →
  when prompted, grant activation for the declared server → run the workflow.
- **Expected observable result:** the run completes and prints the tool's result; re-running without a
  grant prompt succeeds; after `robota trust --revoke` (or a rotated generation) the next run refuses
  with a `pending` activation message rather than executing.
- **Cleanup:** revoke the grant; remove the created workflow.
- **Evidence:** _(to be filled after implementation — command transcript with the printed tool result
  and the post-revoke refusal)_
