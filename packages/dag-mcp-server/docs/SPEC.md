# DAG MCP Server Specification

## Scope

Model Context Protocol server that exposes the Robota DAG orchestration HTTP API as MCP tools for AI agents and MCP-compatible clients.

## Boundaries

- Does not own DAG domain contracts. Those belong to `@robota-sdk/dag-core`.
- Does not own operational HTTP client contracts. Those belong to `@robota-sdk/dag-orchestration-client`.
- Does not own server-side API response mapping. That belongs to `@robota-sdk/dag-api`.
- Does not import or extend `@robota-sdk/agent-cli`; the agent TUI remains separate.
- Does not execute DAGs locally. All execution tools call `dag-orchestrator-server`.

## Architecture Overview

- `bin.ts` starts an MCP stdio server.
- `mcp-server.ts` creates the low-level MCP `Server` and registers `tools/list` and `tools/call` handlers.
- `dag-mcp-tools.ts` owns the tool definitions and command dispatch.
- `@robota-sdk/dag-orchestration-client` owns the shared `DagOrchestrationHttpClient`.

## Server URL Resolution

1. `--server-url <url>`
2. `ROBOTA_DAG_SERVER_URL`
3. `http://localhost:3012`

## MCP Tool Surface

- `dag_definitions_list`
- `dag_definitions_get`
- `dag_definitions_create`
- `dag_definitions_update_draft`
- `dag_definitions_validate`
- `dag_definitions_publish`
- `dag_nodes_list`
- `dag_runs_create`
- `dag_runs_start`
- `dag_runs_status`
- `dag_runs_result`
- `dag_run_drafts_create`
- `dag_run_drafts_get`
- `dag_run_drafts_replace`
- `dag_run_drafts_reset_node_result`
- `dag_run_drafts_overwrite_node_result`

The tool surface mirrors existing `dag-orchestrator-server` HTTP endpoints through `DagOrchestrationHttpClient`. DAG deletion and node graph mutation helpers are not exposed until the server owns those endpoint contracts.

## Type Ownership

This package is SSOT for:

- `IDagMcpEnvironment`
- `IDagMcpServerOptions`
- `IDagMcpToolDefinition`
- `TDagMcpToolCallResult`

Imported from other packages:

- `DagOrchestrationHttpClient`, run draft request aliases, and response payload types from `@robota-sdk/dag-orchestration-client`
- `IDagDefinition`, `IPartialRunRequest`, `TPortPayload` from `@robota-sdk/dag-core`

## Public API Surface

- `createDagMcpServer(options)` — factory for a configured MCP `Server`.
- `runDagMcpServer(args, options)` — stdio executable runner.
- `createDagMcpToolDefinitions()` — returns the registered MCP tool metadata.
- `callDagMcpTool(name, args, client)` — pure tool dispatcher used by tests and the MCP handler.

## Class Contract Registry

### Interface Implementations

None. This package uses a low-level MCP `Server` from `@modelcontextprotocol/sdk`.

### Inheritance Chains

None.

### Cross-Package Port Consumers

| Contract Owner                         | Consumer             | Location |
| -------------------------------------- | -------------------- | -------- |
| `dag-orchestration-client` HTTP client | MCP server and tools | `src/`   |
| `dag-core` DAG types                   | MCP tool arguments   | `src/`   |

## Test Strategy

- Unit tests cover tool definition registration, required argument validation, run draft tool dispatch, and client dispatch payloads.
- Tests inject a fake `IDagOrchestrationHttpClient`; no network access is required.
- Run: `pnpm --filter @robota-sdk/dag-mcp-server test`
