# Tools Specification

## Scope

Owns the tool registry, tool implementations, tool result types, sandbox execution ports, and sandbox workspace manifest contracts for the Robota SDK. This package provides both the infrastructure for defining and managing tools (`ToolRegistry`, `FunctionTool`, `createZodFunctionTool`) and a set of 8 built-in CLI tools (`bash`, `read`, `write`, `edit`, `glob`, `grep`, `webFetch`, `webSearch`) used by the agent CLI.

## Boundaries

- Does not own the abstract tool base class (`AbstractTool`) or tool interface contracts (`IToolWithEventService`, `IToolResult`, `IToolExecutionContext`). Those belong to `@robota-sdk/agent-core`.
- Does not own permission evaluation or hook execution. Tool permission wrapping is performed by consumers (e.g., `@robota-sdk/agent-sessions`).
- Does not own MCP tool protocol. MCP tools live in `@robota-sdk/agent-tool-mcp`.
- Does not own provider-specific behavior. Tools are provider-agnostic.
- Does not own provider SDK installation. Provider sandbox adapters are structural adapters; applications decide whether to install concrete provider SDKs such as E2B.
- Does not own CLI manifest file parsing. YAML/JSON CLI parsing belongs to the CLI composition layer and must converge into the `IWorkspaceManifest` contract owned here.

## Architecture Overview

```
registry/
  tool-registry.ts      -- ToolRegistry: central tool management and lookup
implementations/
  function-tool.ts      -- FunctionTool: JS function tool with Zod schema validation
  function-tool/
    index.ts            -- Re-exports FunctionTool, createFunctionTool, createZodFunctionTool
    schema-converter.ts -- zodToJsonSchema: converts Zod schemas to JSON Schema
    types.ts            -- FunctionTool-specific types
  openapi-tool.ts       -- OpenAPITool: tool generated from OpenAPI spec
types/
  tool-result.ts        -- TToolResult: result type for CLI tool invocations
sandbox/
  types.ts                       -- ISandboxClient and command/file contracts
  in-memory-sandbox-client.ts    -- deterministic contract-test adapter
  e2b-sandbox-client.ts          -- structural adapter for E2B-compatible sandboxes
  workspace-manifest.ts          -- workspace manifest validation and generic sandbox application
builtins/
  index.ts              -- Re-exports all 8 built-in CLI tools
  atomic-file-write.ts  -- Same-directory temp write + atomic rename helper for UTF-8 file replacement
  bash-tool.ts          -- Bash: execute shell commands
  read-tool.ts          -- Read: read file contents with line numbers
  write-tool.ts         -- Write: write content to a file
  edit-tool.ts          -- Edit: replace a string in a file
  glob-tool.ts          -- Glob: find files matching a pattern (uses fast-glob)
  grep-tool.ts          -- Grep: search file contents with regex
  web-fetch-tool.ts     -- WebFetch: fetch URL content (HTML→text conversion)
  web-search-tool.ts    -- WebSearch: web search via Brave Search API
```

**Design patterns used:**

- **Registry** -- `ToolRegistry` provides central tool registration, lookup, and schema management.
- **Factory** -- `createFunctionTool` and `createZodFunctionTool` provide ergonomic tool construction.
- **Adapter** -- `zodToJsonSchema` adapts Zod schemas into the JSON Schema format expected by AI providers; `E2BSandboxClient` adapts E2B-compatible sandbox instances to `ISandboxClient`.
- **Ports and adapters** -- `ISandboxClient` separates tool execution intent from the concrete execution plane.
- **Declarative workspace setup** -- `IWorkspaceManifest` describes fresh-session sandbox files, directories, Git repositories, and future ephemeral storage mounts without putting manifest algorithms in SDK or CLI layers.

**Dependency direction:** `@robota-sdk/agent-tools` has a peer dependency on `@robota-sdk/agent-core`. No reverse dependency exists.

## Type Ownership

Types owned by this package (SSOT):

| Type                             | Kind      | File                                     | Description                                      |
| -------------------------------- | --------- | ---------------------------------------- | ------------------------------------------------ |
| `TToolResult`                    | Interface | `types/tool-result.ts`                   | Result shape for CLI tool invocations            |
| `IZodSchema`                     | Interface | `implementations/function-tool/types.ts` | Zod schema shape for function tools              |
| `IZodParseResult`                | Interface | `implementations/function-tool/types.ts` | Zod parse result shape                           |
| `IZodSchemaDef`                  | Interface | `implementations/function-tool/types.ts` | Zod schema definition shape                      |
| `IFunctionToolValidationOptions` | Interface | `implementations/function-tool/types.ts` | Validation options for function tools            |
| `ISchemaConversionOptions`       | Interface | `implementations/function-tool/types.ts` | Options for Zod-to-JSON-Schema conversion        |
| `IFunctionToolExecutionMetadata` | Interface | `implementations/function-tool/types.ts` | Metadata returned by function tool execution     |
| `IFunctionToolResult`            | Interface | `implementations/function-tool/types.ts` | Extended result type for function tool execution |
| `ISandboxClient`                 | Interface | `sandbox/types.ts`                       | Provider-neutral command and file sandbox port   |
| `ISandboxRunOptions`             | Interface | `sandbox/types.ts`                       | Sandbox command execution options                |
| `ISandboxRunResult`              | Interface | `sandbox/types.ts`                       | Sandbox command execution result                 |
| `ISandboxToolOptions`            | Interface | `sandbox/types.ts`                       | Built-in tool factory options for sandbox use    |
| `IWorkspaceManifest`             | Interface | `sandbox/types.ts`                       | Declarative sandbox workspace setup contract     |
| `IWorkspaceManifestApplyOptions` | Interface | `sandbox/types.ts`                       | Generic manifest application options             |
| `IWorkspaceManifestApplyResult`  | Interface | `sandbox/types.ts`                       | Per-entry manifest application result            |
| `IWorkspaceManifestAppliedEntry` | Interface | `sandbox/types.ts`                       | Per-entry manifest application status            |
| `IE2BSandboxAdapter`             | Interface | `sandbox/e2b-sandbox-client.ts`          | Structural E2B-compatible adapter input          |
| `IE2BSandboxClientOptions`       | Interface | `sandbox/e2b-sandbox-client.ts`          | E2B adapter construction options                 |
| `IInMemorySandboxClientOptions`  | Interface | `sandbox/in-memory-sandbox-client.ts`    | In-memory sandbox construction options           |

## Public API Surface

### Tool Infrastructure

| Export                          | Kind     | Description                                              |
| ------------------------------- | -------- | -------------------------------------------------------- |
| `ToolRegistry`                  | Class    | Central tool registration and schema lookup              |
| `FunctionTool`                  | Class    | JS function tool with Zod schema validation              |
| `createFunctionTool`            | Function | Factory for creating function tools                      |
| `createZodFunctionTool`         | Function | Factory with Zod validation and conversion               |
| `OpenAPITool`                   | Class    | Tool generated from OpenAPI specification                |
| `createOpenAPITool`             | Function | Factory for creating OpenAPI tools                       |
| `zodToJsonSchema`               | Function | Converts Zod schemas to JSON Schema format               |
| `TToolResult`                   | Type     | Result shape for CLI tool invocations                    |
| `E2BSandboxClient`              | Class    | Adapter for E2B-compatible sandbox instances             |
| `InMemorySandboxClient`         | Class    | Deterministic sandbox client for tests                   |
| `ISandboxClient`                | Type     | Provider-neutral sandbox execution port                  |
| `IWorkspaceManifest`            | Type     | Provider-neutral sandbox workspace manifest              |
| `applyWorkspaceManifest`        | Function | Applies a workspace manifest through an `ISandboxClient` |
| `validateWorkspaceManifestPath` | Function | Validates and normalizes manifest entry paths            |

### Built-in CLI Tools

| Export          | Kind   | Tool Name   | Description                                        |
| --------------- | ------ | ----------- | -------------------------------------------------- |
| `bashTool`      | Object | `Bash`      | Execute shell commands via host process by default |
| `readTool`      | Object | `Read`      | Read file contents with line numbers (cat -n)      |
| `writeTool`     | Object | `Write`     | Write content to a file (creates parent dirs)      |
| `editTool`      | Object | `Edit`      | Replace a specific string in a file                |
| `globTool`      | Object | `Glob`      | Find files matching a glob pattern (fast-glob)     |
| `grepTool`      | Object | `Grep`      | Search file contents with regex patterns           |
| `webFetchTool`  | Object | `WebFetch`  | Fetch URL content with HTML-to-text conversion     |
| `webSearchTool` | Object | `WebSearch` | Web search via Brave Search API                    |

Each built-in tool is an `IToolWithEventService`-compatible object with `getName()`, `getDescription()`, `getSchema()`, and `execute()` methods.

`createBashTool`, `createReadTool`, `createWriteTool`, and `createEditTool` create sandbox-aware tool instances. When an `ISandboxClient` is supplied, Bash command execution plus Read/Write/Edit filesystem operations are routed through the sandbox client. When no sandbox client is supplied, the singleton exports keep existing host-local behavior.

**WriteTool output**: Reports actual UTF-8 byte count via `Buffer.byteLength(content, 'utf8')`, not JS `content.length` (which is character count and differs for multibyte content).

**Atomic write semantics**: `Write` and `Edit` replace UTF-8 file content by writing to a temporary file in the same directory and then renaming it into place. When replacing an existing target, the temporary file is assigned the target's existing mode bits before the rename so executable scripts and other permission-sensitive files keep their permissions. The temporary file is removed after failed writes when possible. This keeps built-in filesystem mutations provider-agnostic while preventing partially written target files during self-hosting edit/build/verify loops.

### TToolResult Shape

```typescript
interface TToolResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
  startLine?: number; // Start line number of the edit in the original file (Edit tool only)
}
```

This is the inner result type used by built-in tools. It is serialized to JSON and placed inside the `IToolResult.data` field before being returned to the Robota execution loop.

## Extension Points

1. **ToolRegistry** -- Consumers register custom tools via `ToolRegistry.register()`. The registry manages name-based lookup and schema retrieval.

2. **FunctionTool / createZodFunctionTool** -- Consumers create custom tools from plain functions with Zod schemas for parameter validation. Zod object schemas marked with `passthrough()` are converted to root `additionalProperties: true`, and `FunctionTool` validation accepts unknown root parameters for those schemas.

3. **OpenAPITool / createOpenAPITool** -- Consumers create tools from OpenAPI specifications for API integration.

4. **ISandboxClient** -- Consumers inject provider-backed execution planes into sandbox-aware built-in tool factories. `E2BSandboxClient` adapts E2B-compatible objects without adding an `e2b` package dependency to `agent-tools`; `InMemorySandboxClient` supports deterministic contract tests.

5. **IWorkspaceManifest / applyWorkspaceManifest** -- Consumers declare fresh-session sandbox contents using workspace-relative paths. The generic applicator writes inline/local files, creates directories, and clones Git repositories through `ISandboxClient`; provider-specific storage mounts are represented in the contract but return explicit `unsupported` entries until an adapter supplies native mount capability.

## Error Taxonomy

This package does not define a custom error hierarchy. Built-in tools return errors via the `TToolResult.error` field rather than throwing. Schema conversion errors from `zodToJsonSchema` are thrown as standard `Error` instances.

## Class Contract Registry

### Interface Implementations

| Interface                      | Implementor             | Kind         | Location                                  |
| ------------------------------ | ----------------------- | ------------ | ----------------------------------------- |
| `IFunctionTool` (agent-core)   | `FunctionTool`          | production   | `src/implementations/function-tool.ts`    |
| `ITool` (agent-core)           | `OpenAPITool`           | production   | `src/implementations/openapi-tool.ts`     |
| `IToolRegistry` (agent-core)   | `ToolRegistry`          | production   | `src/registry/tool-registry.ts`           |
| `ISandboxClient` (agent-tools) | `E2BSandboxClient`      | production   | `src/sandbox/e2b-sandbox-client.ts`       |
| `ISandboxClient` (agent-tools) | `InMemorySandboxClient` | test/utility | `src/sandbox/in-memory-sandbox-client.ts` |

### Inheritance Chains

None. `FunctionTool` and `OpenAPITool` implement their respective interfaces directly (`implements IFunctionTool`, `implements ITool`) without extending `AbstractTool`, to avoid circular runtime dependencies between agent-tools and agent-core.

### Cross-Package Port Consumers

| Port (Owner)                       | Consumer                                 | Location                                                                     |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `IFunctionTool` (agent-core)       | `FunctionTool`                           | `src/implementations/function-tool.ts`                                       |
| `ITool` (agent-core)               | `OpenAPITool`                            | `src/implementations/openapi-tool.ts`                                        |
| `IToolWithEventService` shape      | Built-in CLI tools                       | `src/builtins/*.ts`                                                          |
| `ISandboxClient` (agent-tools)     | Built-in CLI tool factories              | `src/builtins/bash-tool.ts`, `read-tool.ts`, `write-tool.ts`, `edit-tool.ts` |
| `IWorkspaceManifest` (agent-tools) | `agent-sdk` interactive session assembly | `packages/agent-sdk/src/interactive/interactive-session-init.ts`             |

## Test Strategy

### Current Test Coverage

| File                                       | Scope | Description                                                             |
| ------------------------------------------ | ----- | ----------------------------------------------------------------------- |
| `src/__tests__/atomic-file-write.test.ts`  | Unit  | Atomic UTF-8 write replacement, mode preservation, cleanup, and handoff |
| `src/__tests__/sandbox-tools.test.ts`      | Unit  | Sandbox client contracts, sandbox-aware tools, and E2B adapter behavior |
| `src/__tests__/workspace-manifest.test.ts` | Unit  | Workspace manifest path validation and generic sandbox application      |
| `src/__tests__/function-tool.test.ts`      | Unit  | FunctionTool creation, execution, schema validation                     |
| `src/__tests__/schema-converter.test.ts`   | Unit  | Zod-to-JSON-Schema conversion                                           |
| `src/__tests__/tool-registry.test.ts`      | Unit  | ToolRegistry registration, lookup, listing                              |

### Gaps

- **Built-in tools** -- `globTool` and `grepTool` still need dedicated unit coverage beyond provider-agnostic composition tests.
- **OpenAPITool** -- No unit tests for OpenAPI tool creation or execution.
- **TToolResult** -- No tests verifying the result shape contract.

## Dependencies

### Production (2)

- `fast-glob` -- High-performance glob matching for the glob built-in tool
- `zod` -- Schema validation for function tool parameters

### Dev (notable)

- `openapi-types` -- OpenAPI V3 type definitions used in `OpenAPITool` type imports. Listed as devDependency since only type-level imports are used, but consumers using `OpenAPITool` may need this installed for `.d.ts` resolution.

### Peer (1)

- `@robota-sdk/agent-core` -- Abstract tool base class, tool interfaces, event service types
