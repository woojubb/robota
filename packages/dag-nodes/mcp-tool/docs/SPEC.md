# MCP Tool Node Specification

## Scope

- Owns the `mcp-tool` DAG node definition.
- Connects to a Model Context Protocol (MCP) server over HTTP or stdio and invokes a named tool, emitting its text output.

## Boundaries

- Extends `AbstractNodeDefinition` from `@robota-sdk/dag-node`. Does not redefine core DAG contracts.
- Uses `@modelcontextprotocol/sdk` for MCP client transport (`StreamableHTTPClientTransport`, `StdioClientTransport`).
- SSRF protection: HTTP URLs are validated against a private IP blocklist. Stdio commands are validated against an allowlist (`npx`, `node`, `python`, `python3`, `uvx`, `deno`).
- Environment variable values are never serialised into config — only env var names (`serverEnvRefs`) are stored.

## Architecture Overview

- `McpToolNodeDefinition` — node that accepts an optional `args` input port (JSON string) and produces `text` and `isError` output ports.
- Transport selection: `config.serverType='http'` uses `StreamableHTTPClientTransport`; `'stdio'` uses `StdioClientTransport`.
- Per-call timeout enforced by `config.timeoutMs` (default 30 000 ms) with `client.close()` on expiry.
- Tool arguments are parsed from the `args` input port as JSON; invalid JSON defaults to `{}`.
- Cost estimate: `config.baseCredits` (default 0).

## Type Ownership

| Type                      | Location       | Purpose                         |
| ------------------------- | -------------- | ------------------------------- |
| `McpToolNodeDefinition`   | `src/index.ts` | Node definition class           |
| `McpToolNodeConfigSchema` | `src/index.ts` | Zod config schema (exported)    |
| `TMcpToolNodeConfig`      | `src/index.ts` | Inferred config type (exported) |

## Public API Surface

- `McpToolNodeDefinition` — class
- `createMcpToolNodeDefinition()` — factory function
- `McpToolNodeConfigSchema` — Zod schema (for external config validation)
- `TMcpToolNodeConfig` — TypeScript type

## Extension Points

- Config `serverType`: `'http'` | `'stdio'`.
- Config `serverUrl`: HTTP/HTTPS endpoint (required for `serverType='http'`).
- Config `serverCommand` / `serverArgs`: stdio executable and arguments.
- Config `serverEnvRefs`: env var names forwarded to stdio child process.
- Config `toolName`: name of the MCP tool to invoke.
- Config `timeoutMs`: per-call timeout.
- Config `baseCredits`: base cost per successful call.
- Error codes: `DAG_VALIDATION_MCP_TOOL_MISSING_URL`, `DAG_VALIDATION_MCP_TOOL_SSRF_BLOCKED`, `DAG_VALIDATION_MCP_TOOL_STDIO_NOT_ALLOWED`, `DAG_TASK_EXECUTION_MCP_TOOL_CALL_FAILED`.
