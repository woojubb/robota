# @robota-sdk/dag-cli

Command-line tool for running, validating, and managing Robota DAG workflows — no server required.

## Installation

```bash
# npx (no install)
npx @robota-sdk/dag-cli run workflow.dag.json

# Global install
npm install -g @robota-sdk/dag-cli
robota-dag run workflow.dag.json
```

## Commands

### `run` — Execute a DAG locally

```bash
robota-dag run <file.dag.json> [--env .dag/.env] [--timeout 120000]
```

Runs a DAG definition in-process. Uses `.dag/.env` by default for API keys.

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

### `init` — Scaffold a new DAG project

```bash
robota-dag init
```

Creates `.dag/workflows/hello-world.dag.json`, `.dag/.env.example`, and `README-DAG.md`.

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

## Use with GitHub Actions

Run DAG workflows in CI/CD with `npx` — no custom Action needed:

```yaml
- name: Run AI code review DAG
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    npx @robota-sdk/dag-cli run .dag/workflows/code-review.dag.json \
      --input code="$(git diff origin/main...HEAD)" \
      --output json > result.json
```

See [docs/github-actions.md](docs/github-actions.md) for full examples (PR review, release notes, scheduling).

## Documentation

See [docs/SPEC.md](docs/SPEC.md) for the full package contract.
