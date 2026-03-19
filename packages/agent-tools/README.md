# @robota-sdk/agent-tools

Tool registry, tool creation infrastructure, and built-in CLI tools for the Robota SDK. Provides everything needed to define custom tools with Zod schema validation and includes six ready-to-use file system tools.

## Installation

```bash
pnpm add @robota-sdk/agent-tools
```

## Quick Start

Create a custom tool with `createZodFunctionTool`:

```typescript
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';

const weatherTool = createZodFunctionTool({
  name: 'GetWeather',
  description: 'Get current weather for a city',
  schema: z.object({
    city: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  execute: async ({ city, unit }) => {
    // Your implementation here
    return { temperature: 22, unit, city };
  },
});
```

## Built-in Tools

Six CLI tools are included for file system operations:

| Export      | Tool Name | Description                              |
| ----------- | --------- | ---------------------------------------- |
| `bashTool`  | `Bash`    | Execute shell commands via child_process |
| `readTool`  | `Read`    | Read file contents with line numbers     |
| `writeTool` | `Write`   | Write content to a file                  |
| `editTool`  | `Edit`    | Replace a specific string in a file      |
| `globTool`  | `Glob`    | Find files matching a glob pattern       |
| `grepTool`  | `Grep`    | Search file contents with regex          |

```typescript
import {
  bashTool,
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
} from '@robota-sdk/agent-tools';
```

Each tool implements `getName()`, `getDescription()`, `getSchema()`, and `execute()`.

## Tool Infrastructure

| Export                  | Description                                 |
| ----------------------- | ------------------------------------------- |
| `ToolRegistry`          | Central tool registration and schema lookup |
| `FunctionTool`          | JS function tool with Zod schema validation |
| `createFunctionTool`    | Factory for creating function tools         |
| `createZodFunctionTool` | Factory with Zod validation and conversion  |
| `OpenAPITool`           | Tool generated from OpenAPI specification   |
| `zodToJsonSchema`       | Converts Zod schemas to JSON Schema format  |

## TToolResult

Built-in tools return results using the `TToolResult` type:

```typescript
interface TToolResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}
```

## Documentation

See [docs/SPEC.md](./docs/SPEC.md) for the full specification, architecture details, and type ownership.

## License

MIT
