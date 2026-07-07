# @robota-sdk/dag-cli

Command-line tool for running, validating, and managing Robota DAG workflows — no server required.

> This package is **private** and not published to npm. It is an internal product shell used within
> the Robota monorepo via workspace references; the `/workflows` command surface it powers ships
> inside `@robota-sdk/agent-cli`.

## Usage

The `robota-dag` binary is available within the monorepo via workspace references.

## Commands

Commands operate against the current workspace layout, which defaults to `.workflows/`. Pass a
leading `--workspace <dir>` to point at a different workspace root.

### `run` — Execute a DAG locally

```bash
robota-dag run <file> [--env .env] [--timeout 120000]
```

Runs a DAG definition in-process — no server required.

### `validate` — Validate a DAG definition

```bash
robota-dag validate <file.dag.json>
```

Checks for unknown node types, dependency cycles, and missing input/output nodes.
Exits `0` (valid) or `1` (errors found).

### `node` — Inspect node registry

```bash
robota-dag node list                    # list all available node types
robota-dag node info <nodeType>         # full manifest for one node type
robota-dag node schema <nodeType>       # JSON schema for node config
```

### `catalog` — Browse the workspace workflow catalog

```bash
robota-dag catalog list                 # list saved workflows in the workspace
robota-dag catalog info <name>          # show one workflow's details
robota-dag catalog search <query>       # search saved workflows
robota-dag catalog run <name>           # run a saved workflow by name
robota-dag catalog history              # show recent run history
```

Operates on the workspace layout (default `.workflows/`), the FLOW-007 on-disk format for
authored workflows.

### `mcp` — Start an MCP server

```bash
robota-dag mcp [--transport stdio]
```

Starts a local MCP server exposing DAG tools to AI agents:
`dag_nodes_list`, `dag_nodes_info`, `dag_run_definition`, `dag_run_file`, `dag_validate`.

### Server mode — Connect to a remote orchestrator

```bash
robota-dag run --server --server-url http://localhost:3012 <file.dag.json>
robota-dag definitions list
robota-dag runs status <dagRunId>
```

Server URL resolution order: `--server-url` → `ROBOTA_DAG_SERVER_URL` → `http://localhost:3012`.

## Documentation

See [docs/SPEC.md](docs/SPEC.md) for the full package contract.
