# Building Agents

This guide covers building AI agents with `@robota-sdk/agent-core` — the foundation layer of the Robota SDK.

## Robota Class

`Robota` is the main agent class. It wraps an AI provider with conversation history, tool execution, and plugin support.

```typescript
import { Robota } from '@robota-sdk/agent-core';

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemMessage: 'You are a helpful assistant.',
  },
});

const response = await agent.run('Hello!');
```

### IAgentConfig

| Field                        | Type                      | Required | Description                                                          |
| ---------------------------- | ------------------------- | -------- | -------------------------------------------------------------------- |
| `name`                       | `string`                  | yes      | Agent name (for logging and identification)                          |
| `aiProviders`                | `IAIProvider[]`           | yes      | One or more provider instances                                       |
| `defaultModel`               | `object`                  | yes      | Default provider, model, and system message                          |
| `defaultModel.provider`      | `string`                  | yes      | Provider name (must match an `aiProviders` entry)                    |
| `defaultModel.model`         | `string`                  | yes      | Model identifier (e.g., `claude-sonnet-4-6`)                         |
| `defaultModel.systemMessage` | `string`                  | no       | System prompt for the agent                                          |
| `tools`                      | `IToolWithEventService[]` | no       | Tools the agent can call                                             |
| `plugins`                    | `IPluginContract[]`       | no       | Plugins for lifecycle hooks                                          |
| `systemMessage`              | `string`                  | no       | Top-level system message (alternative to defaultModel.systemMessage) |

### Key Methods

| Method                          | Description                                                           |
| ------------------------------- | --------------------------------------------------------------------- |
| `run(input)`                    | Send a message and get a response. Executes tool calls automatically. |
| `getHistory()`                  | Get the full conversation history as `TUniversalMessage[]`.           |
| `clearHistory()`                | Clear the conversation history.                                       |
| `setModel({ provider, model })` | Switch provider and model mid-conversation.                           |

## AI Providers

Providers implement the `IAIProvider` interface from `agent-core`. Each provider translates between the universal message format and the provider-specific API.

### Anthropic (Claude)

```typescript
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

Supported models: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`

### OpenAI (not yet published)

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
});
```

### Google (not yet published)

```typescript
import { GoogleProvider } from '@robota-sdk/agent-provider-google';

const provider = new GoogleProvider({
  apiKey: process.env.GOOGLE_API_KEY,
});
```

### Switching Providers

```typescript
const agent = new Robota({
  name: 'FlexAgent',
  aiProviders: [anthropicProvider, openaiProvider, googleProvider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
});

// Switch at any time
agent.setModel({ provider: 'openai', model: 'gpt-4o' });
```

## Tools

Tools let agents call functions during a conversation. The agent decides when to use a tool based on the conversation context.

### Creating Tools with Zod

```typescript
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

const searchTool = createZodFunctionTool({
  name: 'search_files',
  description: 'Search for files by name pattern',
  schema: z.object({
    pattern: z.string().describe('Glob pattern to match'),
    directory: z.string().optional().describe('Directory to search in'),
  }),
  handler: async ({ pattern, directory }) => {
    const files = await glob(pattern, { cwd: directory ?? '.' });
    return { data: JSON.stringify(files) };
  },
});
```

### Creating Tools with FunctionTool

```typescript
import { FunctionTool } from '@robota-sdk/agent-tools';

const timeTool = new FunctionTool({
  name: 'current_time',
  description: 'Get the current date and time',
  parameters: {
    type: 'object',
    properties: {
      timezone: { type: 'string', description: 'IANA timezone' },
    },
  },
  handler: async (params) => {
    const now = new Date().toLocaleString('en-US', { timeZone: params.timezone ?? 'UTC' });
    return { data: now };
  },
});
```

### Registering Tools with an Agent

```typescript
const agent = new Robota({
  name: 'ToolAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  tools: [searchTool, timeTool],
});

// The agent will call tools automatically when appropriate
const response = await agent.run(
  'Find all .ts files in src/ and tell me the current time in Seoul',
);
```

### Built-in CLI Tools

`@robota-sdk/agent-tools` ships 8 ready-to-use tools for file system operations and web access:

| Tool            | Description                          |
| --------------- | ------------------------------------ |
| `bashTool`      | Execute shell commands               |
| `readTool`      | Read file contents with line numbers |
| `writeTool`     | Write content to a file              |
| `editTool`      | Replace a string in a file           |
| `globTool`      | Find files by glob pattern           |
| `grepTool`      | Search file contents with regex      |
| `webFetchTool`  | Fetch URL content (HTML-to-text)     |
| `webSearchTool` | Web search via Brave Search API      |

These are used by `agent-sdk` to assemble the CLI agent, but can also be used independently.

## Plugins

Plugins hook into the agent lifecycle to add cross-cutting concerns.

### Using Plugins

```typescript
import { Robota, EventEmitterPlugin } from '@robota-sdk/agent-core';

const agent = new Robota({
  name: 'PluginAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  plugins: [new EventEmitterPlugin({ enabled: true })],
});
```

### Plugin Lifecycle Hooks

| Hook                  | Timing             | Purpose                          |
| --------------------- | ------------------ | -------------------------------- |
| `beforeRun`           | Before LLM call    | Input transformation, validation |
| `afterRun`            | After LLM response | Output processing, recording     |
| `onError`             | On execution error | Error handling, recovery         |
| `onStreamChunk`       | During streaming   | Chunk processing                 |
| `beforeToolExecution` | Before tool call   | Tool input validation            |
| `afterToolExecution`  | After tool result  | Tool output processing           |

### Available Plugins

`EventEmitterPlugin` is built into `agent-core`. 8 additional plugins are available as separate packages (not yet published — available in the monorepo only):

| Plugin Package                                  | Purpose                       |
| ----------------------------------------------- | ----------------------------- |
| `@robota-sdk/agent-plugin-logging`              | Multi-backend logging         |
| `@robota-sdk/agent-plugin-usage`                | Token usage and cost tracking |
| `@robota-sdk/agent-plugin-performance`          | Metrics collection            |
| `@robota-sdk/agent-plugin-execution-analytics`  | Execution analytics           |
| `@robota-sdk/agent-plugin-error-handling`       | Error recovery strategies     |
| `@robota-sdk/agent-plugin-limits`               | Rate limiting                 |
| `@robota-sdk/agent-plugin-conversation-history` | Persistent history            |
| `@robota-sdk/agent-plugin-webhook`              | HTTP notifications            |

### Creating Custom Plugins

```typescript
import { AbstractPlugin } from '@robota-sdk/agent-core';

class MyPlugin extends AbstractPlugin {
  name = 'my-plugin';
  version = '1.0.0';

  async afterRun(context) {
    console.log(`Agent responded with ${context.response.length} characters`);
  }
}
```

## Streaming

### Text Delta Streaming

```typescript
const agent = new Robota({
  name: 'StreamAgent',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
});

// The provider's onTextDelta callback streams text as it arrives
provider.onTextDelta = (delta) => process.stdout.write(delta);

const response = await agent.run('Write a poem about coding');
// Text appears in real-time via onTextDelta, response is the complete text
```

## Conversation History

Robota maintains conversation history across `run()` calls. Every message has a unique `id` and a `state` (`'complete'` or `'interrupted'`).

```typescript
const agent = new Robota({
  /* config */
});

await agent.run('My name is Alice.');
const response = await agent.run('What is my name?');
// response: "Your name is Alice."

// Access the full history
const history = agent.getHistory(); // TUniversalMessage[]
// Each message has: id, timestamp, state, role, content, metadata

// Clear and start fresh
agent.clearHistory();
```

### Message State

Messages have a `state` field that tracks completion:

| State           | Meaning                                             |
| --------------- | --------------------------------------------------- |
| `'complete'`    | Normal response — fully received                    |
| `'interrupted'` | User pressed ESC during streaming — partial content |

When the model receives history for the next turn, interrupted messages are annotated with `[This response was interrupted by the user]` so the model is aware of the interruption.

### Streaming Buffer

During streaming, `ConversationSession` manages a streaming buffer internally:

1. `appendStreaming(delta)` — accumulates text from `onTextDelta` callbacks
2. `appendToolCall(toolCall)` — accumulates tool calls from provider response
3. `commitAssistant(state, metadata)` — commits the buffer to history as a confirmed message

This is a single path — both normal completion (`'complete'`) and abort (`'interrupted'`) use the same `commitAssistant` call with different state values. The CLI's `onTextDelta` callback is preserved as a passthrough for real-time display.

## Error Handling

All errors extend `RobotaError` with `code`, `category`, and `recoverable` properties:

```typescript
import { ProviderError, RateLimitError } from '@robota-sdk/agent-core';

try {
  const response = await agent.run('Hello');
} catch (error) {
  if (error instanceof RateLimitError) {
    // Wait and retry
  } else if (error instanceof ProviderError) {
    // Provider-specific error
  }
}
```

## Changes from v2.0.0

| v2.0.0                                     | v3.0.0                                                    |
| ------------------------------------------ | --------------------------------------------------------- |
| Plugins built into `agent-core`            | 8 plugins extracted to `agent-plugin-*` packages          |
| `FunctionTool` in `agent-core`             | Moved to `@robota-sdk/agent-tools`                        |
| `ToolRegistry` in `agent-core`             | Moved to `@robota-sdk/agent-tools`                        |
| `MCPTool` / `RelayMcpTool` in `agent-core` | Moved to `@robota-sdk/agent-tool-mcp`                     |
| No permission/hook system                  | Permission evaluation + shell hook system in `agent-core` |
| No session management                      | `Session` class in `agent-sessions` with compaction       |
| No CLI                                     | `agent-cli` with Ink TUI                                  |
| No SDK layer                               | `agent-sdk` with config/context loading and `query()`     |
