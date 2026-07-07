# DAG MCP Server Specification

## Scope

Model Context Protocol server that exposes the Robota DAG orchestration HTTP API as MCP tools for AI agents and MCP-compatible clients.

## Boundaries

- Does not own DAG domain contracts. Those belong to `@robota-sdk/dag-core`.
- Does not own operational HTTP client contracts. Those belong to `@robota-sdk/dag-orchestration-client`.
- Does not own server-side API response mapping. That belongs to `@robota-sdk/dag-api`.
- Does not import or extend `@robota-sdk/agent-cli`; the agent TUI remains separate.
- In **embedded mode** (no `--server-url`), executes DAGs locally via `dag-framework`.
- In **HTTP mode** (with `--server-url`), delegates all calls to a DAG runtime server over HTTP.

## Architecture Overview

- `bin.ts` — stdio entrypoint; parses args, resolves mode, starts server.
- `runner.ts` — `resolveDagMcpConfig()` determines HTTP vs embedded mode; lazy-imports `dag-framework` in embedded mode.
- `mcp-server.ts` — creates the low-level MCP `Server`, registers `tools/list` and `tools/call` handlers.
- `dag-mcp-tools.ts` — owns all 25 Tier 1 tool definitions and dispatch via `IDagOrchestrationPort`.
- `@robota-sdk/dag-orchestration-client` — provides `DagOrchestrationHttpClient` (HTTP mode) and `IDagOrchestrationPort` (both modes).
- `@robota-sdk/dag-framework` — lazy-imported for embedded mode; provides in-process `IDagOrchestrationPort` implementation.

## Server Mode Resolution

| Priority | Condition                       | Mode                     |
| -------- | ------------------------------- | ------------------------ |
| 1        | `--server-url <url>` CLI arg    | HTTP                     |
| 2        | `ROBOTA_DAG_SERVER_URL` env var | HTTP                     |
| 3        | Neither set                     | Embedded (dag-framework) |

In embedded mode the server boots with no external dependencies. In HTTP mode it proxies all tool calls to the configured runtime server.

## MCP Tool Surface Tiers

The Robota DAG ecosystem has two MCP server entry points. Each exposes a different tool surface:

| Entry point                     | Server name  | Tools                | Mode            |
| ------------------------------- | ------------ | -------------------- | --------------- |
| `npx @robota-sdk/dag-cli mcp`   | `robota-dag` | ~17 CLI-native tools | Embedded only   |
| `dag-mcp-server` (this package) | `robota-dag` | 25 standard tools    | HTTP + Embedded |

### Tier 1 — Standard Orchestration Tools (25 tools, this package)

Available in both HTTP and embedded modes via `IDagOrchestrationPort`. These tools mirror
the full runtime server HTTP API surface:

- `dag_definitions_list`
- `dag_definitions_get`
- `dag_definitions_create`
- `dag_definitions_update_draft`
- `dag_definitions_validate`
- `dag_definitions_publish`
- `dag_nodes_list`
- `dag_assets_upload`
- `dag_assets_get_metadata`
- `dag_assets_get_content_info`
- `dag_cost_meta_list`
- `dag_cost_meta_get`
- `dag_cost_meta_create`
- `dag_cost_meta_update`
- `dag_cost_meta_delete`
- `dag_cost_meta_validate_formula`
- `dag_cost_meta_preview_formula`
- `dag_runs_create`
- `dag_runs_start`
- `dag_runs_status`
- `dag_runs_result`
- `dag_run_drafts_create`
- `dag_run_drafts_get`
- `dag_run_drafts_replace`
- `dag_run_drafts_reset_node_result`
- `dag_run_drafts_overwrite_node_result`
- `dag_workflows_start_run`

These 25 tools are available in this package only.

### Tier 2 — CLI-Native Tools (~17 tools, dag-cli mcp only)

Tools that require direct filesystem access — only available via `npx @robota-sdk/dag-cli mcp`:

| Tool                                | Description                                         |
| ----------------------------------- | --------------------------------------------------- |
| `dag_nodes_list`                    | List all available node manifests                   |
| `dag_node_packages_list`            | Discover third-party node packages in node_modules  |
| `dag_nodes_info`                    | Full manifest for a specific node type              |
| `dag_run_definition`                | Execute a DAG definition object directly            |
| `dag_runs_poll_progress`            | Poll a completed run by dagRunId                    |
| `dag_runs_cancel`                   | Cancel a running DAG                                |
| `dag_run_file`                      | Execute a `.dag.json` or `.dag.md` file             |
| `dag_validate`                      | Validate a DAG definition without execution         |
| `dag_build`                         | Build a DAG definition from a natural-language spec |
| `dag_catalog_list`                  | List DAGs in the local `.dag/` catalog              |
| `dag_catalog_search`                | Search catalog by keyword                           |
| `dag_catalog_run`                   | Run a cataloged DAG by name                         |
| `dag_instant_node_create`           | Create a prompt-backed node in the current session  |
| `dag_instant_node_create_composite` | Create a composite instant node                     |
| `dag_instant_node_list`             | List instant nodes in the current session           |
| `dag_templates_list`                | List available DAG templates                        |
| `dag_build_from_template`           | Build a DAG from a named template                   |

### Tier 3 — Promoted Tools (future)

`dag_build` and `dag_validate` are currently Tier 2 (CLI-native). They are candidates for
promotion to Tier 1 (IDagOrchestrationPort methods) once the transport-neutral interface
is extended. See ARCH-005 in `.agents/backlog/README.md`.

### Which tier should I use?

- **Agent connecting to a remote server**: use `dag-mcp-server` (Tier 1, HTTP mode)
- **Agent running locally via npx**: use `dag-cli mcp` (Tier 2, embedded mode)
- **Embedding in a Node.js app**: use `dag-framework` directly + `dag-mcp-server` in embedded mode

## Type Ownership

This package is SSOT for:

- `IDagMcpEnvironment`
- `IDagMcpRunOptions`
- `IDagMcpServerOptions`
- `IDagMcpToolDefinition`
- `IDagMcpToolCallResult`

Imported from other packages:

- `DagOrchestrationHttpClient`, asset request aliases, cost metadata request aliases, run draft request aliases, `IDagOrchestrationPublishedWorkflowRunRequest`, and response payload types from `@robota-sdk/dag-orchestration-client`
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

- Unit tests cover tool definition registration, required argument validation, run draft tool dispatch, published workflow version/override dispatch, asset upload/metadata/content-info dispatch, cost metadata CRUD/formula dispatch, and client dispatch payloads.
- Tests inject a fake `IDagOrchestrationPort`; no network access is required.
- Run: `pnpm --filter @robota-sdk/dag-mcp-server test`
