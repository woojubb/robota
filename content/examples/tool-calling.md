# Tool Calling

Agents that use Zod-validated function tools.

## Basic Tool

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { z } from 'zod';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const calculatorTool = createZodFunctionTool(
  'calculator',
  'Evaluate a math expression',
  z.object({
    expression: z.string().describe('The math expression to evaluate'),
  }),
  async ({ expression }) => ({
    data: String(eval(expression)),
  }),
);

const agent = new Robota({
  name: 'MathAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemMessage: 'You are a math assistant. Use the calculator tool for calculations.',
  },
  tools: [calculatorTool],
});

const response = await agent.run('What is (42 * 17) + 256?');
console.log(response);
// The agent calls calculator({ expression: '(42 * 17) + 256' }) and reports the result
```

## Multiple Tools

```typescript
const fileSearchTool = createZodFunctionTool(
  'search_files',
  'Search for files by name pattern',
  z.object({
    pattern: z.string().describe('Glob pattern'),
  }),
  async ({ pattern }) => {
    const { glob } = await import('fast-glob');
    const files = await glob(pattern);
    return { data: JSON.stringify(files) };
  },
);

const readFileTool = createZodFunctionTool(
  'read_file',
  'Read the contents of a file',
  z.object({
    path: z.string().describe('File path to read'),
  }),
  async ({ path }) => {
    const { readFileSync } = await import('fs');
    return { data: readFileSync(path, 'utf-8') };
  },
);

const agent = new Robota({
  name: 'FileAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [fileSearchTool, readFileTool],
});

// The agent may call search_files first, then read_file on the results
const response = await agent.run('Find all .ts files in src/ and show me the smallest one');
```

## Using Built-in Tools

```typescript
import { bashTool, readTool, globTool, grepTool } from '@robota-sdk/agent-tools';

const agent = new Robota({
  name: 'DevAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [bashTool, readTool, globTool, grepTool],
});

const response = await agent.run('Find all TODO comments in the project');
```

## Sandbox-Aware Built-in Tools

Use factory exports when Bash or file tools should run inside a provider sandbox instead of the host workspace:

```typescript
import {
  E2BSandboxClient,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from '@robota-sdk/agent-tools';
import { Sandbox } from 'e2b';

const sandbox = await Sandbox.create();
const sandboxClient = new E2BSandboxClient({ sandbox });

const agent = new Robota({
  name: 'SandboxedDevAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [
    createBashTool({ sandboxClient }),
    createReadTool({ sandboxClient }),
    createWriteTool({ sandboxClient }),
    createEditTool({ sandboxClient }),
  ],
});
```

`E2BSandboxClient` is a structural adapter. Install and construct the concrete provider SDK in your application, then pass the adapter to Robota tools or `InteractiveSession`.
