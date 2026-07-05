# Tool Node Specification

## Scope

- Owns the `tool` DAG node definition.
- Wraps a single **in-process** `@robota-sdk/agent-tools` builtin (Read, Write, Edit, Shell, Bash, Glob, Grep, WebFetch, WebSearch) as one DAG step, emitting its text output.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Distinct from the `mcp-tool` node: `mcp-tool` calls an **external** MCP server over HTTP/stdio; this node runs an agent builtin **in the current process**. No network transport, no MCP client.
- Depends on `@robota-sdk/agent-tools` directly (a published agent package). DAG-node packages are permitted to depend on agent packages — `instant-node` already depends on `agent-core`. The DAG subsystem itself stays `private`; this package is `private: true`.
- Tool selection is a static allowlist (`toolName` → agent-tools factory). Only the enumerated builtins are constructible; an unknown `toolName` yields a `set_config` validation error listing the allowed names.

## Architecture Overview

- `ToolNodeDefinition` — node with an optional `params` input port (JSON string) and `output` + `isError` output ports.
- `config.toolName` selects the builtin. `config.params` supplies static tool arguments; the `params` input port (parsed as JSON) is merged over them (input wins).
- File/shell builtins (`read`/`write`/`edit`/`shell`/`bash`) receive `config.cwd` as a path restriction (`ISandboxToolOptions.cwd`); pure builtins (`glob`/`grep`/`web-fetch`/`web-search`) ignore it.
- Result mapping:
  - The builtin throws (`ValidationError` / `ToolExecutionError`) → node returns `ok: false` with `DAG_TASK_EXECUTION_TOOL_CALL_FAILED`.
  - The builtin returns a JSON-encoded `IToolInvocationResult` with `success: false` (a soft, tool-reported failure — e.g. binary file) → node returns `ok: true` with `output` = the error text and `isError: true`.
  - Otherwise → `ok: true`, `output` = the tool's text, `isError: false`.
- Cost estimate: `config.baseCredits` (default 0).

## Type Ownership

| Type                   | Location       | Purpose                         |
| ---------------------- | -------------- | ------------------------------- |
| `ToolNodeDefinition`   | `src/index.ts` | Node definition class           |
| `ToolNodeConfigSchema` | `src/index.ts` | Zod config schema (exported)    |
| `TToolNodeConfig`      | `src/index.ts` | Inferred config type (exported) |

## Public API Surface

- `ToolNodeDefinition` — class
- `createToolNodeDefinition()` — factory function
- `ToolNodeConfigSchema` — Zod schema (for external config validation)
- `TToolNodeConfig` — TypeScript type
- `TOOL_NODE_ALLOWED_TOOLS` — the allowlist of builtin names (readonly)

## Extension Points

- Config `toolName`: one of `read`, `write`, `edit`, `shell`, `bash`, `glob`, `grep`, `web-fetch`, `web-search`.
- Config `params`: static arguments merged under the `params` input.
- Config `cwd`: path restriction forwarded to file/shell builtins.
- Config `baseCredits`: base cost per successful call.
- Error codes: `DAG_VALIDATION_TOOL_UNKNOWN_TOOL`, `DAG_VALIDATION_TOOL_INVALID_PARAMS`, `DAG_TASK_EXECUTION_TOOL_CALL_FAILED`.
- Adding a builtin: extend `TOOL_NODE_ALLOWED_TOOLS` and the `TOOL_FACTORIES` map.
