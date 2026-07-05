# Building Agents

This guide covers building AI agents with `@robota-sdk/agent-core` — the foundation layer of the Robota SDK.

## Robota Class

`Robota` is the main agent class. It wraps an AI provider with conversation history, tool execution, and plugin support.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  },
  systemMessage: 'You are a helpful assistant.',
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
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

Supported models: `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5`

### OpenAI

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider/openai';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
});
```

### Gemini

```typescript
import { GeminiProvider } from '@robota-sdk/agent-provider/gemini';

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY!,
  defaultModel: 'gemini-3-flash-preview',
});
```

Gemini system prompts are sent as Gemini `systemInstruction`. The provider also supports structured output through `responseSchema` or `responseJsonSchema`, provider-level `safetySettings`, and `thinkingConfig`.

### Gemma

```typescript
import { GemmaProvider } from '@robota-sdk/agent-provider/gemma';

const provider = new GemmaProvider({
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
  defaultModel: 'gemma-local-model',
});
```

Use the Gemma provider for Gemma-family local models served through LM Studio or another OpenAI-compatible endpoint. It owns Gemma-specific reasoning marker filtering and native tool-call text projection.

LM Studio and other OpenAI-compatible Chat Completions endpoints support Robota local tools through normal function calling. They are not treated as provider-native web search/fetch providers, so configure web access with local `WebSearch`/`WebFetch` tools unless a concrete provider package documents hosted web support.

### Qwen

```typescript
import { QwenProvider } from '@robota-sdk/agent-provider/qwen';

const provider = new QwenProvider({
  apiKey: process.env.DASHSCOPE_API_KEY,
  defaultModel: 'qwen-plus',
});
```

Qwen can also enable provider-side hosted web search and extraction through `builtInWebTools`; those tools are separate from Robota local tools and do not bypass local permission checks.

### DeepSeek

```typescript
import { DeepSeekProvider } from '@robota-sdk/agent-provider/deepseek';

const provider = new DeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY,
  defaultModel: 'deepseek-v4-flash',
});
```

DeepSeek uses the documented OpenAI-compatible API at `https://api.deepseek.com`. Provider-owned
profile options can enable thinking controls such as `thinking: 'enabled'` and
`reasoningEffort: 'high'`.

### Switching Providers

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const anthropicProvider: IAIProvider;
declare const openaiProvider: IAIProvider;
declare const geminiProvider: IAIProvider;
declare const gemmaProvider: IAIProvider;
declare const qwenProvider: IAIProvider;
declare const deepSeekProvider: IAIProvider;

const agent = new Robota({
  name: 'FlexAgent',
  aiProviders: [
    anthropicProvider,
    openaiProvider,
    geminiProvider,
    gemmaProvider,
    qwenProvider,
    deepSeekProvider,
  ],
  defaultModel: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
});

// Switch at any time
agent.setModel({ provider: 'openai', model: 'gpt-4o' });
agent.setModel({ provider: 'gemini', model: 'gemini-2.5-pro' });
agent.setModel({ provider: 'gemma', model: 'gemma-local-model' });
agent.setModel({ provider: 'qwen', model: 'qwen-plus' });
```

## Tools

Tools let agents call functions during a conversation. The agent decides when to use a tool based on the conversation context.

### Creating Tools with Zod

`createZodFunctionTool` takes positional arguments: name, description, Zod schema, and handler function. The handler receives validated parameters and returns a value (string or JSON-serializable).

```typescript
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

// Any glob implementation works here (e.g. the `glob` npm package)
declare function glob(pattern: string, options?: { cwd?: string }): Promise<string[]>;

const searchTool = createZodFunctionTool(
  'search_files',
  'Search for files by name pattern',
  z.object({
    pattern: z.string().describe('Glob pattern to match'),
    directory: z.string().optional().describe('Directory to search in'),
  }),
  async ({ pattern, directory }) => {
    const files = await glob(pattern, { cwd: directory ?? '.' });
    return JSON.stringify(files);
  },
);
```

### Creating Tools with FunctionTool

`FunctionTool` takes a schema object and a handler function as separate arguments.

```typescript
import { FunctionTool } from '@robota-sdk/agent-tools';

const timeTool = new FunctionTool(
  {
    name: 'current_time',
    description: 'Get the current date and time',
    parameters: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: 'IANA timezone' },
      },
    },
  },
  async (params) => {
    return new Date().toLocaleString('en-US', { timeZone: (params.timezone as string) ?? 'UTC' });
  },
);
```

### Registering Tools with an Agent

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { FunctionTool } from '@robota-sdk/agent-tools';

declare const provider: IAIProvider;
declare const searchTool: FunctionTool;
declare const timeTool: FunctionTool;

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

`@robota-sdk/agent-tools` ships ready-to-use tools for file system operations and web access:

| Tool            | Description                                             |
| --------------- | ------------------------------------------------------- |
| `shellTool`     | Execute host shell commands (OS-aware: bash/PowerShell) |
| `bashTool`      | Alias of `shellTool` (model-familiar name)              |
| `readTool`      | Read file contents with line numbers                    |
| `writeTool`     | Write content to a file                                 |
| `editTool`      | Replace a string in a file                              |
| `globTool`      | Find files by glob pattern                              |
| `grepTool`      | Search file contents with regex                         |
| `webFetchTool`  | Fetch URL content (HTML-to-text)                        |
| `webSearchTool` | Web search via Brave Search API                         |

These are used by `agent-framework` to assemble the CLI agent, but can also be used independently.

### Decision agents — the tool call IS the answer

For router/orchestrator/classifier agents, the useful output is a tool call, not prose. By default
a turn that ends in tool calls triggers one extra model call to produce a text summary; set
`allowToolOnlyCompletion: true` to make the tool call itself a valid completion and skip that
one-call tax. Read the decision from your tool's executor (or the run's execution events) — the
returned text may be empty.

```typescript
import { z } from 'zod';
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';

declare const provider: IAIProvider;

let decision: string | undefined;
const routeTool = createZodFunctionTool(
  'route',
  'Choose the team that should handle the ticket',
  z.object({ team: z.enum(['billing', 'bugs', 'sales']) }),
  async (args) => {
    decision = String(args.team);
    return { success: true, data: `routed to ${String(args.team)}` };
  },
);

const router = new Robota({
  name: 'Router',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  tools: [routeTool],
});

await router.run('Ticket: "I was charged twice this month."', {
  allowToolOnlyCompletion: true,
  toolChoice: { tool: 'route' },
});
// decision === 'billing' — no summary call was made
```

`toolChoice` directs tool invocation per run (or agent-wide via `defaultModel.toolChoice`):
`'auto'` lets the model decide, `'none'` suppresses tool calls, `'required'` forces some
tool call, and `{ tool: name }` forces the named tool — here it guarantees the router
actually routes instead of replying in prose. Forcing applies to the run's first model call
only; follow-up rounds revert to `'auto'` so the model can consume tool results and finish.

For a fixed-schema JSON answer (rather than a routing decision), prefer structured output:
`run(prompt, { output: schema })` returns a validated typed object directly.

## Plugins

Plugins hook into the agent lifecycle to add cross-cutting concerns.

### Using Plugins

```typescript
import { Robota, EventEmitterPlugin } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

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

`EventEmitterPlugin` is built into `agent-core`. 8 plugins are also available via `@robota-sdk/agent-plugin`:

| Plugin Export               | Purpose                       |
| --------------------------- | ----------------------------- |
| `LoggingPlugin`             | Multi-backend logging         |
| `UsagePlugin`               | Token usage and cost tracking |
| `PerformancePlugin`         | Metrics collection            |
| `ExecutionAnalyticsPlugin`  | Execution analytics           |
| `ErrorHandlingPlugin`       | Error recovery strategies     |
| `LimitsPlugin`              | Rate limiting                 |
| `ConversationHistoryPlugin` | Persistent history            |
| `WebhookPlugin`             | HTTP notifications            |

### Creating Custom Plugins

```typescript
import { AbstractPlugin } from '@robota-sdk/agent-core';

class MyPlugin extends AbstractPlugin {
  name = 'my-plugin';
  version = '1.0.0';

  async afterRun(input: string, response: string): Promise<void> {
    console.log(`Agent responded with ${response.length} characters`);
  }
}
```

## Streaming

### Text Delta Streaming

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

declare const provider: AnthropicProvider;

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
import { Robota } from '@robota-sdk/agent-core';
import type { IAgentConfig } from '@robota-sdk/agent-core';

declare const config: IAgentConfig;

const agent = new Robota(config);

await agent.run('My name is Alice.');
const response = await agent.run('What is my name?');
// response: "Your name is Alice."

// Access the full history
const history = agent.getHistory(); // TUniversalMessage[]
// Each message has: id, timestamp, state, role, content, metadata

// Clear and start fresh
agent.clearHistory();
```

### History lifetime & cost

History **accumulates for the lifetime of the instance and the full history is sent to the
provider on every call** — token cost grows with every turn until you act:

- `clearHistory()` resets the conversation. The `systemMessage` from config is not lost — it is
  re-applied as the log head on the next run.
- One `Robota` instance = one conversation. For independent requests (for example one per HTTP
  request), create an instance per conversation instead of sharing one.
- History is append-only and read-only: there is no edit/delete API by design.
- **Run-isolated mode**: set `retainHistory: false` in the config to make the store ephemeral per
  run — each run sees the system prompt (+ any context you inject before the run) and the prompt,
  and the store resets after the run settles. Declared once, immune to a missed `clearHistory()`;
  the natural fit for coordinator patterns that reconstruct context per call. For a
  "provider + system prompt + stream, nothing else" thin path, this on a plain `Robota` is all you
  need — `createQuery` (agent-framework) is the larger assembly that adds CLI tools and permissions.

```typescript
import { Robota } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

declare const provider: IAIProvider;

const stateless = new Robota({
  name: 'Coordinator',
  aiProviders: [provider],
  defaultModel: { provider: 'anthropic', model: 'claude-haiku-4-5' },
  systemMessage: 'Answer in one sentence.',
  retainHistory: false,
});

await stateless.run('First');
await stateless.run('Second'); // sends system + "Second" only — flat token profile
```

### Message State

Messages have a `state` field that tracks completion:

| State           | Meaning                                             |
| --------------- | --------------------------------------------------- |
| `'complete'`    | Normal response — fully received                    |
| `'interrupted'` | User pressed ESC during streaming — partial content |

When the model receives history for the next turn, interrupted messages are annotated with `[This response was interrupted by the user]` so the model is aware of the interruption.

### Streaming Buffer

During streaming, `ConversationStore` manages a streaming buffer internally:

1. `beginAssistant()` — opens a new streaming buffer for the assistant turn
2. `appendStreaming(delta)` — accumulates text from `onTextDelta` callbacks
3. `commitAssistant(state, metadata)` — commits the buffer to history as a confirmed message

This is a single path — both normal completion (`'complete'`) and abort (`'interrupted'`) use the same `commitAssistant` call with different state values. History is append-only and read-only; text content is always preserved. The CLI's `onTextDelta` callback is preserved as a passthrough for real-time display.

## Execution Contracts

Behavior guarantees of `run()`/`runStream()` that matter in production hosts.

### Execution rounds

A **round** is one model call plus the execution of every tool call that reply requested; a reply
with no tool calls ends the loop (a plain Q&A turn is exactly 1 round). `maxExecutionRounds` caps
rounds within one `run()` — it is not a tool-count limit and not a conversation-turn limit. Set it
per run or as a config default; `0` means no cap.

```typescript
import type { Robota } from '@robota-sdk/agent-core';

declare const agent: Robota;

await agent.run('Research this topic and summarize.', { maxExecutionRounds: 5 });
```

### Concurrency

One instance owns one conversation history, so concurrent `run()`/`runStream()` calls on the same
instance are **serialized on an internal FIFO queue** — fire-and-forget calls are safe and always
produce sequential history, never interleaved messages. A queued call whose `AbortSignal` fires
while waiting throws without touching the provider or history. `runStream()` holds its queue slot
until the stream is fully consumed. Separate instances are fully concurrent.

### destroy()

`destroy()` is **best-effort and never rejects for cleanup failures** — `void agent.destroy()` is
safe to fire-and-forget. Every cleanup step (modules, plugin subscriptions, event emitters) runs
even if an earlier one fails; failures are logged and returned as
`Promise<{ errors: Error[] }>` for callers that want a hard signal:

```typescript
import type { Robota } from '@robota-sdk/agent-core';

declare const agent: Robota;

const { errors } = await agent.destroy();
if (errors.length > 0) {
  // cleanup failures — already logged; decide whether to alert
}
```

The same disposal convention applies across the stack: `Session.shutdown()` and transport
`stopAll()` never reject for cleanup errors either.

## Error Handling

All errors extend `RobotaError` with `code`, `category`, and `recoverable` properties:

```typescript
import { ProviderError, RateLimitError } from '@robota-sdk/agent-core';
import type { Robota } from '@robota-sdk/agent-core';

declare const agent: Robota;

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

| v2.0.0                                     | v3.0.0                                                             |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Plugins built into `agent-core`            | 8 plugins available in `@robota-sdk/agent-plugin`                  |
| `FunctionTool` in `agent-core`             | Moved to `@robota-sdk/agent-tools`                                 |
| `ToolRegistry` in `agent-core`             | Moved to `@robota-sdk/agent-tools`                                 |
| `MCPTool` / `RelayMcpTool` in `agent-core` | Moved to `@robota-sdk/agent-tool-mcp`                              |
| No permission/hook system                  | Permission evaluation + shell hook system in `agent-core`          |
| No session management                      | `InteractiveSession` in `agent-framework` with compaction          |
| No CLI                                     | `agent-cli` with Ink TUI                                           |
| No SDK layer                               | `agent-framework` with runtime assembly and `createAgentRuntime()` |
