# Tools Specification

## Scope

Owns the tool registry, tool implementations, and tool result types for the Robota SDK. This package provides both the infrastructure for defining and managing tools (`ToolRegistry`, `FunctionTool`, `createZodFunctionTool`) and a set of 8 built-in CLI tools (`bash`, `read`, `write`, `edit`, `glob`, `grep`, `webFetch`, `webSearch`) used by the agent CLI.

## Boundaries

- Does not own the abstract tool base class (`AbstractTool`) or tool interface contracts (`IToolWithEventService`, `IToolResult`, `IToolExecutionContext`). Those belong to `@robota-sdk/agent-core`.
- Does not own permission evaluation or hook execution. Tool permission wrapping is performed by consumers (e.g., `@robota-sdk/agent-sessions`).
- Does not own MCP tool protocol. MCP tools live in `@robota-sdk/agent-tool-mcp`.
- Does not own provider-specific behavior. Tools are provider-agnostic.

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
builtins/
  index.ts              -- Re-exports all 8 built-in CLI tools
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
- **Adapter** -- `zodToJsonSchema` adapts Zod schemas into the JSON Schema format expected by AI providers.

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

## Public API Surface

### Tool Infrastructure

| Export                  | Kind     | Description                                 |
| ----------------------- | -------- | ------------------------------------------- |
| `ToolRegistry`          | Class    | Central tool registration and schema lookup |
| `FunctionTool`          | Class    | JS function tool with Zod schema validation |
| `createFunctionTool`    | Function | Factory for creating function tools         |
| `createZodFunctionTool` | Function | Factory with Zod validation and conversion  |
| `OpenAPITool`           | Class    | Tool generated from OpenAPI specification   |
| `createOpenAPITool`     | Function | Factory for creating OpenAPI tools          |
| `zodToJsonSchema`       | Function | Converts Zod schemas to JSON Schema format  |
| `TToolResult`           | Type     | Result shape for CLI tool invocations       |

### Built-in CLI Tools

| Export          | Kind   | Tool Name   | Description                                      |
| --------------- | ------ | ----------- | ------------------------------------------------ |
| `bashTool`      | Object | `Bash`      | Execute shell commands via `child_process.spawn` |
| `readTool`      | Object | `Read`      | Read file contents with line numbers (cat -n)    |
| `writeTool`     | Object | `Write`     | Write content to a file (creates parent dirs)    |
| `editTool`      | Object | `Edit`      | Replace a specific string in a file              |
| `globTool`      | Object | `Glob`      | Find files matching a glob pattern (fast-glob)   |
| `grepTool`      | Object | `Grep`      | Search file contents with regex patterns         |
| `webFetchTool`  | Object | `WebFetch`  | Fetch URL content with HTML-to-text conversion   |
| `webSearchTool` | Object | `WebSearch` | Web search via Brave Search API                  |

Each built-in tool is an `IToolWithEventService`-compatible object with `getName()`, `getDescription()`, `getSchema()`, and `execute()` methods.

**WriteTool output**: Reports actual UTF-8 byte count via `Buffer.byteLength(content, 'utf8')`, not JS `content.length` (which is character count and differs for multibyte content).

### TToolResult Shape

```typescript
interface TToolResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}
```

This is the inner result type used by built-in tools. It is serialized to JSON and placed inside the `IToolResult.data` field before being returned to the Robota execution loop.

## Extension Points

1. **ToolRegistry** -- Consumers register custom tools via `ToolRegistry.register()`. The registry manages name-based lookup and schema retrieval.

2. **FunctionTool / createZodFunctionTool** -- Consumers create custom tools from plain functions with Zod schemas for parameter validation.

3. **OpenAPITool / createOpenAPITool** -- Consumers create tools from OpenAPI specifications for API integration.

## Error Taxonomy

This package does not define a custom error hierarchy. Built-in tools return errors via the `TToolResult.error` field rather than throwing. Schema conversion errors from `zodToJsonSchema` are thrown as standard `Error` instances.

## Class Contract Registry

### Interface Implementations

| Interface                    | Implementor    | Kind       | Location                               |
| ---------------------------- | -------------- | ---------- | -------------------------------------- |
| `IFunctionTool` (agent-core) | `FunctionTool` | production | `src/implementations/function-tool.ts` |
| `ITool` (agent-core)         | `OpenAPITool`  | production | `src/implementations/openapi-tool.ts`  |
| `IToolRegistry` (agent-core) | `ToolRegistry` | production | `src/registry/tool-registry.ts`        |

### Inheritance Chains

None. `FunctionTool` and `OpenAPITool` implement their respective interfaces directly (`implements IFunctionTool`, `implements ITool`) without extending `AbstractTool`, to avoid circular runtime dependencies between agent-tools and agent-core.

### Cross-Package Port Consumers

| Port (Owner)                  | Consumer           | Location                               |
| ----------------------------- | ------------------ | -------------------------------------- |
| `IFunctionTool` (agent-core)  | `FunctionTool`     | `src/implementations/function-tool.ts` |
| `ITool` (agent-core)          | `OpenAPITool`      | `src/implementations/openapi-tool.ts`  |
| `IToolWithEventService` shape | Built-in CLI tools | `src/builtins/*.ts`                    |

## Test Strategy

### Current Test Coverage

| File                                     | Scope | Description                                         |
| ---------------------------------------- | ----- | --------------------------------------------------- |
| `src/__tests__/function-tool.test.ts`    | Unit  | FunctionTool creation, execution, schema validation |
| `src/__tests__/schema-converter.test.ts` | Unit  | Zod-to-JSON-Schema conversion                       |
| `src/__tests__/tool-registry.test.ts`    | Unit  | ToolRegistry registration, lookup, listing          |

### Gaps

- **Built-in tools** -- No unit tests for `bashTool`, `readTool`, `writeTool`, `editTool`, `globTool`, or `grepTool`.
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
