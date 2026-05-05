# @robota-sdk/agent-tools

Tool registry, tool creation infrastructure, 8 built-in CLI tools, sandbox execution ports, and sandbox workspace manifests for the Robota SDK.

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

| Export          | Tool Name | Description                                               |
| --------------- | --------- | --------------------------------------------------------- |
| `bashTool`      | Bash      | Execute shell commands via host process or sandbox client |
| `readTool`      | Read      | Read file contents with line numbers (cat -n)             |
| `writeTool`     | Write     | Write content to a file (creates parent dirs)             |
| `editTool`      | Edit      | Replace a specific string in a file                       |
| `globTool`      | Glob      | Find files matching a glob pattern (fast-glob)            |
| `grepTool`      | Grep      | Search file contents with regex patterns                  |
| `webFetchTool`  | WebFetch  | Fetch URL content (HTML-to-text conversion)               |
| `webSearchTool` | WebSearch | Web search via Brave Search API                           |

Factory exports (`createBashTool`, `createReadTool`, `createWriteTool`, `createEditTool`) accept an optional `sandboxClient`. The default singleton exports keep host-local behavior.

## Sandbox Execution

`ISandboxClient` is the provider-neutral execution-plane port used by sandbox-aware built-in tools:

```typescript
import { E2BSandboxClient, createBashTool, createReadTool } from '@robota-sdk/agent-tools';
import { Sandbox } from 'e2b';

const e2b = await Sandbox.create();
const sandboxClient = new E2BSandboxClient({ sandbox: e2b });

const bashTool = createBashTool({ sandboxClient });
const readTool = createReadTool({ sandboxClient });
```

The package does not depend on E2B directly. `E2BSandboxClient` adapts an E2B-compatible object with `commands.run`, `files.read`, `files.write`, and optional `pause`/`connect` methods, so applications can choose whether to install the provider SDK. `InMemorySandboxClient` is available for deterministic tests and contract verification.

### Workspace Manifests

`IWorkspaceManifest` declares the fresh sandbox workspace before a session starts. Paths are workspace-relative and cannot escape the target root.

```typescript
import { applyWorkspaceManifest, E2BSandboxClient } from '@robota-sdk/agent-tools';
import { Sandbox } from 'e2b';

const sandbox = await Sandbox.create();
const sandboxClient = new E2BSandboxClient({ sandbox });

await applyWorkspaceManifest(sandboxClient, {
  entries: {
    'task.md': { type: 'file', content: 'Analyze this repository.\n' },
    repo: { type: 'gitRepo', url: 'https://github.com/example/project.git', ref: 'main' },
    output: { type: 'dir' },
  },
});
```

The generic applicator writes inline/local files, creates directories, and clones Git repositories through `ISandboxClient`. Cloud storage mount entries are part of the contract, but they return `unsupported` until a provider-specific adapter implements native mounting.

## Edit and Write Safety

Recent file tool updates keep write/edit behavior atomic and make Edit tool results easier for higher layers to display. Atomic replacements preserve existing target mode bits, so executable scripts remain executable after Write or Edit updates. The Edit tool returns line metadata for changed regions, allowing the CLI to render concise context hunks instead of dumping full files or opaque summaries.

## Tool Infrastructure

| Export                   | Description                                            |
| ------------------------ | ------------------------------------------------------ |
| `ToolRegistry`           | Central tool registration and schema lookup            |
| `FunctionTool`           | JS function tool with Zod schema validation            |
| `createFunctionTool`     | Factory for creating function tools                    |
| `createZodFunctionTool`  | Factory with Zod validation and JSON Schema conversion |
| `OpenAPITool`            | Tool generated from OpenAPI specification              |
| `createOpenAPITool`      | Factory for creating OpenAPI tools                     |
| `zodToJsonSchema`        | Converts Zod schemas to JSON Schema format             |
| `TToolResult`            | Result type for built-in CLI tool invocations          |
| `ISandboxClient`         | Provider-neutral sandbox execution port                |
| `IWorkspaceManifest`     | Declarative sandbox workspace setup contract           |
| `applyWorkspaceManifest` | Generic manifest applicator for sandbox clients        |
| `E2BSandboxClient`       | Adapter for E2B-compatible sandbox instances           |
| `InMemorySandboxClient`  | Deterministic sandbox client for tests                 |

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
