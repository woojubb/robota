# Tool Calling

Give an agent functions it can call. `createZodFunctionTool()` turns a Zod schema and a handler into a
tool: the schema is sent to the model, and the arguments the model sends back are validated against it
before your handler runs.

## Basic tool

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { z } from 'zod';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const operations = {
  add: (a: number, b: number) => a + b,
  subtract: (a: number, b: number) => a - b,
  multiply: (a: number, b: number) => a * b,
  divide: (a: number, b: number) => a / b,
};

const calculatorTool = createZodFunctionTool(
  'calculator',
  'Apply an arithmetic operation to two numbers',
  z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  async ({ operation, a, b }) => String(operations[operation](a, b)),
);

const agent = new Robota({
  name: 'MathAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a math assistant. Use the calculator tool for calculations.',
  tools: [calculatorTool],
});

const response = await agent.run('What is (42 * 17) + 256?');
console.log(response);
// The agent calls calculator (multiply, then add) and answers 970
```

The handler's return value is what the model sees. Return a string; any other value is sent as its
JSON text.

## Several tools

Register as many tools as the task needs; the model picks one per step and can chain them.

```typescript
import { Robota, type IAIProvider } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

declare const provider: IAIProvider;

const currentTimeTool = createZodFunctionTool(
  'get_current_time',
  'Return the current UTC date and time in ISO 8601 format',
  z.object({}),
  async () => new Date().toISOString(),
);

const daysBetweenTool = createZodFunctionTool(
  'days_between',
  'Count the whole days between two ISO 8601 dates',
  z.object({ from: z.string(), to: z.string() }),
  async ({ from, to }) =>
    String(Math.floor((Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000))),
);

const agent = new Robota({
  name: 'CalendarAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [currentTimeTool, daysBetweenTool],
});

// The agent calls get_current_time first, then days_between with the result
const response = await agent.run('How many days are left until 2027-01-01?');
```

[examples/express](../../examples/express/README.md) passes custom tools to a `createQuery()` session
for each request.

## Built-in tools

`@robota-sdk/agent-tools` ships file and shell tools. Each is created with a `cwd`: the directory the
tool works in and may not leave. There are no ready-made instances, because a file tool with no root
would have no boundary.

```typescript
import { Robota, type IAIProvider } from '@robota-sdk/agent-core';
import {
  createBashTool,
  createReadTool,
  createGlobTool,
  createGrepTool,
} from '@robota-sdk/agent-tools';

declare const provider: IAIProvider;

const workspaceRoot = process.cwd();

const agent = new Robota({
  name: 'DevAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [
    createBashTool({ cwd: workspaceRoot }),
    createReadTool({ cwd: workspaceRoot }),
    createGlobTool({ cwd: workspaceRoot }),
    createGrepTool({ cwd: workspaceRoot }),
  ],
});

const response = await agent.run('Find all TODO comments in the project');
```

A `Robota` agent has no permission prompts: it runs the tools it is given. For permission modes and
approval prompts, use an [`InteractiveSession`](./session-management.md), which also assembles the
built-in tool set for you.

## Tools in a sandbox

Pass a `sandboxClient` to run shell and file tools inside a sandbox instead of on the host. The
example uses the E2B adapter; install the `e2b` package in your application.

<!-- doc-example-skip: requires the optional e2b dependency -->

```typescript
import { Robota, type IAIProvider } from '@robota-sdk/agent-core';
import {
  E2BSandboxClient,
  applyWorkspaceManifest,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from '@robota-sdk/agent-tools';
import { Sandbox } from 'e2b';

declare const provider: IAIProvider;

const sandbox = await Sandbox.create();
const sandboxClient = new E2BSandboxClient({ sandbox });

// Prepare files and directories in the sandbox before the tools run
await applyWorkspaceManifest(sandboxClient, {
  entries: {
    'task.md': { type: 'file', content: 'Run the requested checks.\n' },
    output: { type: 'dir' },
  },
});

const agent = new Robota({
  name: 'SandboxedDevAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [
    // `cwd` is still required: it is the root inside the sandbox.
    createBashTool({ sandboxClient, cwd: '/workspace' }),
    createReadTool({ sandboxClient, cwd: '/workspace' }),
    createWriteTool({ sandboxClient, cwd: '/workspace' }),
    createEditTool({ sandboxClient, cwd: '/workspace' }),
  ],
});
```

`E2BSandboxClient` adapts an E2B sandbox you create with the E2B SDK; the same client can be passed
to `InteractiveSession` as `sandboxClient`. When a session has a session store, a sandbox client that
supports snapshots saves a `sandboxSnapshotId` on shutdown, and resuming the session (not forking it)
restores that workspace.
[examples/capabilities/sandboxed-tools](../../examples/capabilities/sandboxed-tools/README.md) runs
the default tool set against an in-memory sandbox, with no account needed.
