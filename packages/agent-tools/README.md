# @robota-sdk/agent-tools

Tool registry, tool creation infrastructure, and 8 built-in CLI tools for the Robota SDK.

## Installation

```bash
npm install @robota-sdk/agent-tools
```

Peer dependency: `@robota-sdk/agent-core`

## Quick Start

### Create a Tool with Zod

```typescript
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

const weatherTool = createZodFunctionTool({
  name: 'get_weather',
  description: 'Get current weather for a city',
  schema: z.object({
    city: z.string().describe('City name'),
  }),
  handler: async ({ city }) => ({
    data: JSON.stringify({ city, temperature: 22, condition: 'sunny' }),
  }),
});
```

### Use Built-in Tools

```typescript
import { bashTool, readTool, globTool, grepTool } from '@robota-sdk/agent-tools';
import { Robota } from '@robota-sdk/agent-core';

const agent = new Robota({
  name: 'DevAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [bashTool, readTool, globTool, grepTool],
});
```

## Built-in Tools (8)

| Export          | Tool Name | Description                                      |
| --------------- | --------- | ------------------------------------------------ |
| `bashTool`      | Bash      | Execute shell commands via `child_process.spawn` |
| `readTool`      | Read      | Read file contents with line numbers (cat -n)    |
| `writeTool`     | Write     | Write content to a file (creates parent dirs)    |
| `editTool`      | Edit      | Replace a specific string in a file              |
| `globTool`      | Glob      | Find files matching a glob pattern (fast-glob)   |
| `grepTool`      | Grep      | Search file contents with regex patterns         |
| `webFetchTool`  | WebFetch  | Fetch URL content (HTML-to-text conversion)      |
| `webSearchTool` | WebSearch | Web search via Brave Search API                  |

## Tool Infrastructure

| Export                  | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `ToolRegistry`          | Central tool registration and schema lookup            |
| `FunctionTool`          | JS function tool with Zod schema validation            |
| `createFunctionTool`    | Factory for creating function tools                    |
| `createZodFunctionTool` | Factory with Zod validation and JSON Schema conversion |
| `OpenAPITool`           | Tool generated from OpenAPI specification              |
| `createOpenAPITool`     | Factory for creating OpenAPI tools                     |
| `zodToJsonSchema`       | Converts Zod schemas to JSON Schema format             |
| `TToolResult`           | Result type for built-in CLI tool invocations          |

## TToolResult Shape

```typescript
interface TToolResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
  startLine?: number; // Start line number of the edit in the original file (Edit tool only)
}
```

`TToolResult` is the inner result type used by built-in tools. It is serialized to JSON and placed inside the `IToolResult.data` field before being returned to the Robota execution loop.

## Dependencies

| Dependency               | Kind | Purpose                                                |
| ------------------------ | ---- | ------------------------------------------------------ |
| `@robota-sdk/agent-core` | Peer | Abstract tool base class, tool interfaces, event types |
| `fast-glob`              | Prod | High-performance glob matching for the Glob tool       |
| `zod`                    | Prod | Schema validation for function tool parameters         |

## License

MIT
