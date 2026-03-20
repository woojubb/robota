# @robota-sdk/agent-provider-anthropic

Anthropic Claude provider for the Robota SDK. Implements `AbstractAIProvider` with support for Claude models, streaming, tool calling, and server-side web search.

## Installation

```bash
npm install @robota-sdk/agent-provider-anthropic @anthropic-ai/sdk
```

Peer dependency: `@robota-sdk/agent-core`

## Quick Start

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const agent = new Robota({
  name: 'Assistant',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    systemMessage: 'You are a helpful assistant.',
  },
});

const response = await agent.run('Hello!');
```

## Supported Models

- `claude-opus-4-6` (1M context)
- `claude-sonnet-4-6` (200K context)
- `claude-haiku-4-5` (200K context)

## Features

### Streaming

```typescript
provider.onTextDelta = (delta) => process.stdout.write(delta);
const response = await agent.run('Write a poem');
// Text streams in real-time, response is the complete text
```

### Web Search

Server-side web search via Anthropic's `web_search_20250305` tool:

```typescript
provider.enableWebTools = true;
provider.onServerToolUse = (name, input) => {
  console.log(`Searching: ${input.query}`);
};
```

### Tool Calling

Tool calls are handled automatically by the Robota execution loop. The provider converts between the universal message format and Anthropic's `input_schema`-based tool format.

## Configuration

```typescript
const provider = new AnthropicProvider({
  apiKey: 'sk-ant-...', // API key
  timeout: 60000, // Request timeout (ms)
  baseURL: 'https://...', // Custom base URL
  client: anthropicClient, // Pre-configured SDK client
  executor: remoteExecutor, // Delegate to remote executor
});
```

## Public Instance Fields

| Field             | Type                  | Default | Description                    |
| ----------------- | --------------------- | ------- | ------------------------------ |
| `enableWebTools`  | `boolean`             | `false` | Include web search server tool |
| `onTextDelta`     | `TTextDeltaCallback?` | —       | Streaming text callback        |
| `onServerToolUse` | `function?`           | —       | Server tool execution callback |

## Known Limitations

- `chatStream()` does not apply `enableWebTools`, system message extraction, or `onServerToolUse` (use `chat()` for full feature support)
- `validateConfig()` returns false for executor-based providers (functional but reports invalid)

## License

MIT
