# @robota-sdk/agent-provider-openai

OpenAI Provider for Robota SDK - type-safe integration with the official OpenAI Responses API, structured outputs, streaming, and function calling.

## 🚀 Features

### Core Capabilities

- **🎯 Type-Safe Integration**: Complete TypeScript support with zero `any` types
- **🤖 OpenAI Model Support**: Official OpenAI models through the Responses API by default
- **⚡ Real-Time Streaming**: Asynchronous streaming responses with proper error handling
- **🛠️ Function Calling**: Native OpenAI function calling with type validation
- **🧩 Structured Outputs**: JSON object and JSON Schema response formats
- **🌐 Capability Reporting**: Explicit native web search/fetch capability state without hidden local-tool fallback
- **Provider-Owned Model Catalog Refresh**: `/model` can discover OpenAI models through the provider definition without CLI/TUI-owned model lists
- **🔄 Provider-Agnostic Design**: Seamless integration with other Robota providers
- **📊 Payload Logging**: Optional API request/response logging for debugging

### Architecture Highlights

- **Provider Base Contract**: `AbstractAIProvider` implementation for the Robota provider interface
- **Facade Pattern**: Modular design with separated concerns
- **Error Safety**: Comprehensive error handling without any-type compromises
- **OpenAI SDK Compatibility**: Direct integration with official OpenAI SDK types

## 📦 Installation

```bash
npm install @robota-sdk/agent-provider-openai @robota-sdk/agent-core openai
```

## 🔧 Basic Usage

### Simple Chat Integration

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

// Create type-safe OpenAI provider
const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  defaultModel: 'gpt-4o',
});

// Create Robota agent with OpenAI provider
const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.7,
    systemMessage: 'You are a helpful AI assistant specialized in technical topics.',
  },
});

// Execute conversation
const response = await agent.run('Explain the benefits of TypeScript over JavaScript');
console.log(response);

// Clean up
await agent.destroy();
```

### OpenAI-Compatible Endpoints

The official OpenAI profile uses the Responses API by default. Set `baseURL`, or set `apiSurface: 'chat-completions'`, only when you intentionally need an OpenAI-compatible Chat Completions endpoint. For LM Studio, the local API typically listens on `http://localhost:1234/v1` and accepts a local placeholder API key:

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const provider = new OpenAIProvider({
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
  defaultModel: '<local-openai-compatible-model>',
});
```

Gemma-family local models should use `@robota-sdk/agent-provider-gemma` instead of this
OpenAI provider so Gemma chat-template channel markers are projected out of user-facing
streamed text.

For provider packages that share OpenAI-compatible transport code, the reusable primitives live in `@robota-sdk/agent-provider-openai-compatible`. This package owns OpenAI product semantics and an explicit compatibility mode; model-family behavior such as Gemma reasoning/tool-call projection belongs in that model-family provider.

OpenAI-compatible Chat Completions profiles, including LM Studio-style `baseURL` profiles, are custom function-tool capable but are not treated as provider-native hosted web search/fetch providers. Use Robota local `WebSearch`/`WebFetch` tools for explicit local web access unless a concrete provider package documents hosted web support.

### Model Catalog Refresh

`createOpenAIProviderDefinition()` exposes a provider-owned `refreshModelCatalog` hook. SDK command
common APIs may call this hook to query the OpenAI Models API with the effective provider profile and
surface catalog freshness in `/model` output. CLI/TUI layers must render that result rather than
owning OpenAI model metadata.

### Streaming Responses

```typescript
// Real-time streaming for immediate feedback
const stream = await agent.runStream('Write a detailed explanation of machine learning');

for await (const chunk of stream) {
  if (chunk.content) {
    process.stdout.write(chunk.content);
  }

  // Handle streaming metadata
  if (chunk.metadata?.isComplete) {
    console.log('\n✓ Stream completed');
  }
}
```

When `chat()` receives an `onTextDelta` callback, the provider uses the selected API surface's streaming path internally, forwards text deltas to the callback, assembles streamed tool-call chunks, and returns the final assistant message.

### Native Replay Payload Capture

When `IChatOptions.onProviderNativeRawPayload` is provided, the provider emits exact OpenAI SDK request, response, and stream event payloads with `apiSurface` set to either `responses` or `chat-completions`. `agent-core` routes these provider-owned callbacks into provider-neutral `provider_native_raw_payload` execution events for replay-grade session logs.

## 🛠️ Function Calling

OpenAI Provider supports type-safe function calling with automatic parameter validation:

```typescript
import { FunctionTool } from '@robota-sdk/agent-core';
import { z } from 'zod';

// Define type-safe function tools
const weatherTool = new FunctionTool({
  name: 'getWeather',
  description: 'Get current weather information for a location',
  parameters: z.object({
    location: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
  }),
  handler: async ({ location, unit }) => {
    // Type-safe handler implementation
    const weatherData = await fetchWeatherAPI(location, unit);
    return {
      temperature: weatherData.temp,
      condition: weatherData.condition,
      location,
      unit,
    };
  },
});

const calculatorTool = new FunctionTool({
  name: 'calculate',
  description: 'Perform mathematical operations',
  parameters: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  handler: async ({ operation, a, b }) => {
    const operations = {
      add: a + b,
      subtract: a - b,
      multiply: a * b,
      divide: a / b,
    };
    return { result: operations[operation] };
  },
});

// Register tools with the agent
agent.registerTool(weatherTool);
agent.registerTool(calculatorTool);

// Execute with function calling
const result = await agent.run("What's the weather in Tokyo and what's 25 * 4?");
```

## 🔄 Multi-Provider Architecture

Seamlessly integrate with other providers:

```typescript
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { GoogleProvider } from '@robota-sdk/agent-provider-google';

const openaiProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropicProvider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const googleProvider = new GoogleProvider({
  apiKey: process.env.GOOGLE_AI_API_KEY,
});

const agent = new Robota({
  name: 'MultiProviderAgent',
  aiProviders: [openaiProvider, anthropicProvider, googleProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4o',
  },
});

// Dynamic provider switching
const openaiResponse = await agent.run('Respond using GPT-4o');

agent.setModel({ provider: 'anthropic', model: 'claude-3-sonnet-20240229' });
const claudeResponse = await agent.run('Respond using Claude');
```

## ⚙️ Configuration Options

```typescript
interface IOpenAIProviderOptions {
  // Model Configuration
  defaultModel?: string; // Used when chat options do not provide a model

  // API Configuration
  apiKey?: string; // API key (if not set in client)
  client?: OpenAI; // OpenAI SDK client instance
  organization?: string; // OpenAI organization ID
  timeout?: number; // Request timeout (ms)
  baseURL?: string; // Custom API base URL; defaults to Chat Completions compatibility
  apiSurface?: 'responses' | 'chat-completions';

  // Response Configuration
  responseFormat?: 'text' | 'json_object' | 'json_schema';
  jsonSchema?: {
    // For structured outputs
    name: string;
    description?: string;
    schema?: Record<string, string | number | boolean | object>;
    strict?: boolean;
  };
  reasoning?: {
    effort?: 'low' | 'medium' | 'high';
    summary?: 'auto' | 'concise' | 'detailed';
  };
  store?: boolean;
  includeEncryptedReasoning?: boolean;
  strictTools?: boolean;

  // Debugging & Logging
  payloadLogger?: IPayloadLogger; // Environment-specific payload logger

  // Interface-based logger implementations:
  // - FilePayloadLogger: Node.js file-based logging
  // - ConsolePayloadLogger: Browser console-based logging
  // - Custom: Implement IPayloadLogger interface
}
```

## 📋 Model Guidance

| Model     | Description           | Use Cases                                   |
| --------- | --------------------- | ------------------------------------------- |
| `gpt-4o`  | General-purpose model | Multimodal chat, tool use, balanced latency |
| `gpt-4.1` | Strong coding model   | Code generation, refactoring, analysis      |
| `o3`      | Reasoning model       | Complex reasoning and planning              |

## 🔍 API Reference

### OpenAIProvider Class

```typescript
class OpenAIProvider extends AbstractAIProvider {
  // Core methods
  async chat(messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage>;
  async chatStream(
    messages: TUniversalMessage[],
    options?: IChatOptions,
  ): AsyncIterable<TUniversalMessage>;

  // Provider information
  readonly name: string = 'openai';
  readonly version: string = '1.0.0';

  // Utility methods
  supportsTools(): boolean;
  validateConfig(): boolean;
  async dispose(): Promise<void>;
}
```

### Type Definitions

```typescript
// Chat Options
interface IChatOptions {
  tools?: IToolSchema[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

// OpenAI-specific types
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface IOpenAILogData {
  model: string;
  messagesCount: number;
  hasTools: boolean;
  temperature?: number;
  maxTokens?: number;
  timestamp: string;
  requestId?: string;
}
```

## 🐛 Debugging & Logging

### Environment-Specific Payload Logging

The OpenAI Provider supports environment-specific payload logging through interface-based dependency injection:

#### Node.js Environment (File-Based Logging)

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { FilePayloadLogger } from '@robota-sdk/agent-provider-openai/loggers/file';

const provider = new OpenAIProvider({
  client: openaiClient,
  defaultModel: 'gpt-4o',
  payloadLogger: new FilePayloadLogger({
    logDir: './logs/openai-api',
    enabled: true,
    includeTimestamp: true,
  }),
});
```

#### Browser Environment (Console-Based Logging)

```typescript
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { ConsolePayloadLogger } from '@robota-sdk/agent-provider-openai/loggers/console';

const provider = new OpenAIProvider({
  client: openaiClient,
  defaultModel: 'gpt-4o',
  payloadLogger: new ConsolePayloadLogger({
    enabled: true,
    includeTimestamp: true,
  }),
});
```

#### No Logging (Both Environments)

```typescript
const provider = new OpenAIProvider({
  client: openaiClient,
  defaultModel: 'gpt-4o',
  // payloadLogger: undefined (default - no logging)
});
```

### Custom Logger Implementation

You can create custom logger implementations by implementing the IPayloadLogger interface:

```typescript
import type { IPayloadLogger } from '@robota-sdk/agent-provider-openai';

type OpenAILogPayload = Parameters<IPayloadLogger['logPayload']>[0];

class CustomPayloadLogger implements IPayloadLogger {
  isEnabled(): boolean {
    return true;
  }

  async logPayload(payload: OpenAILogPayload, type: 'chat' | 'stream'): Promise<void> {
    // Custom logging implementation
    console.log(`[Custom Logger] ${type}:`, payload);
  }
}

const provider = new OpenAIProvider({
  client: openaiClient,
  payloadLogger: new CustomPayloadLogger(),
});
```

This creates detailed logs of all API requests and responses for debugging purposes.

## 🔒 Security Best Practices

### API Key Management

```typescript
// ✅ Good: Use environment variables
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ❌ Bad: Hardcoded keys
const client = new OpenAI({
  apiKey: 'sk-...', // Never do this!
});
```

### Error Handling

```typescript
try {
  const response = await agent.run('Your query');
} catch (error) {
  if (error instanceof Error) {
    console.error('AI Error:', error.message);
  }
  // Handle specific OpenAI errors
}
```

## 📊 Performance Optimization

### Token Management

```typescript
const provider = new OpenAIProvider({
  client: openaiClient,
  defaultModel: 'gpt-4o',
});

const response = await provider.chat(messages, {
  maxTokens: 1000, // Limit response length
  temperature: 0.3, // More deterministic responses
});
```

### Model Selection Strategy

- Use `gpt-4o` for balanced multimodal chat and tool use
- Use `gpt-4.1` for coding-heavy workflows
- Use reasoning models such as `o3` when explicit reasoning controls are required

## 🤝 Contributing

This package follows strict type safety guidelines:

- Zero `any` or `unknown` types allowed
- Complete TypeScript coverage
- Comprehensive error handling
- Provider-agnostic design principles

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Related Packages

- **[@robota-sdk/agent-core](../agents/)**: Core agent framework
- **[@robota-sdk/agent-provider-anthropic](../anthropic/)**: Anthropic Claude provider
- **[@robota-sdk/agent-provider-google](../google/)**: Google AI provider
- **[@robota-sdk/agent-team](../team/)**: assignTask MCP tool collection (team creation removed)

---

For complete documentation and examples, visit the [Robota SDK Documentation](https://robota.io).
