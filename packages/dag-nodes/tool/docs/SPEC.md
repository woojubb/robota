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
- **Containment (SEC-007).** Every builtin is constructed per invocation and bound to a containment root; none is taken from `agent-tools`' module-level singletons, which are documented as uncontained because a singleton is context-free by construction.
  - The root is the required trusted canonical absolute `INodeExecutionContext.executionRoot`; the node never reads `process.cwd()`.
  - `config.cwd` may only **narrow** that root. A `cwd` resolving outside the execution root — including via `..` or an escaping symlink — fails the node with `DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT`. It cannot widen the root, because it arrives in the same LLM-authorable `.dag.json` as the paths it would be containing.
  - Containment is decided on **canonical** (symlink-resolved) paths through `@robota-sdk/agent-core`'s `isPathInside` SSOT.
  - For `read`/`write`/`edit`/`glob`/`grep` the root is a **boundary**: an out-of-root path or search root is refused, and no entry whose canonical path escapes is enumerated or disclosed.
  - For `shell`/`bash` the root is the **default working directory and deliberately not a boundary** — a cwd guard on arbitrary command execution is undone by the first `cd ..`, so it would constrain nothing while reading as a boundary in review. The boundary for command execution is the permission layer and the sandbox seam.
  - `web-fetch`/`web-search` have no filesystem path and ignore the root.
- Result mapping:
  - The builtin throws (`ValidationError` / `ToolExecutionError`) → node returns `ok: false` with `DAG_TASK_EXECUTION_TOOL_CALL_FAILED`.
  - The builtin returns a JSON-encoded `IToolInvocationResult` with `success: false` (a soft, tool-reported failure — e.g. binary file) → node returns `ok: true` with `output` = the error text and `isError: true`.
  - Otherwise → `ok: true`, `output` = the tool's text, `isError: false`.
- Cost estimate: `config.baseCredits` (default 0).

## Type Ownership

| Type                     | Location                | Purpose                                     |
| ------------------------ | ----------------------- | ------------------------------------------- |
| `ToolNodeDefinition`     | `src/index.ts`          | Node definition class                       |
| `ToolNodeConfigSchema`   | `src/index.ts`          | Zod config schema (exported)                |
| `TToolNodeConfig`        | `src/index.ts`          | Inferred config type (exported)             |
| `TOOL_FACTORIES`         | `src/tool-factories.ts` | Builtin allowlist and per-tool construction |
| `resolveContainmentRoot` | `src/containment.ts`    | Decides the security boundary for the node  |

## Public API Surface

- `ToolNodeDefinition` — class
- `createToolNodeDefinition()` — factory function
- `ToolNodeConfigSchema` — Zod schema (for external config validation)
- `TToolNodeConfig` — TypeScript type
- `TOOL_NODE_ALLOWED_TOOLS` — the allowlist of builtin names (readonly)

## Extension Points

- Config `toolName`: one of `read`, `write`, `edit`, `shell`, `bash`, `glob`, `grep`, `web-fetch`, `web-search`.
- Config `params`: static arguments merged under the `params` input.
- Config `cwd`: **narrows** the containment root; must resolve inside `context.executionRoot` (see Architecture Overview).
- Config `baseCredits`: base cost per successful call.
- Error codes: `DAG_VALIDATION_TOOL_UNKNOWN_TOOL`, `DAG_VALIDATION_TOOL_INVALID_PARAMS`, `DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT`, `DAG_TASK_EXECUTION_TOOL_CALL_FAILED`.
- Adding a builtin: extend the `TOOL_FACTORIES` map in `src/tool-factories.ts` (`TOOL_NODE_ALLOWED_TOOLS` derives from its keys). A new builtin that touches the filesystem must accept and honour the containment root.
