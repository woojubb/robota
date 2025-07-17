# @robota-sdk/openai

OpenAI Provider for Robota SDK - Complete type-safe integration with OpenAI's GPT models, featuring function calling, streaming, and advanced AI capabilities.

## 🚀 Features

### Core Capabilities
- **🎯 Type-Safe Integration**: Complete TypeScript support with zero `any` types
- **🤖 GPT Model Support**: GPT-4, GPT-3.5 Turbo, and all OpenAI models
- **⚡ Real-Time Streaming**: Asynchronous streaming responses with proper error handling
- **🛠️ Function Calling**: Native OpenAI function calling with type validation
- **🔄 Provider-Agnostic Design**: Seamless integration with other Robota providers
- **📊 Payload Logging**: Optional API request/response logging for debugging

### Architecture Highlights
- **Generic Type Parameters**: Full `BaseAIProvider<TConfig, TMessage, TResponse>` implementation
- **Facade Pattern**: Modular design with separated concerns
- **Error Safety**: Comprehensive error handling without any-type compromises
- **OpenAI SDK Compatibility**: Direct integration with official OpenAI SDK types

## 📦 Installation

```bash
npm install @robota-sdk/openai @robota-sdk/agents openai
```

## 🔧 Basic Usage

### Simple Chat Integration

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

// Create type-safe OpenAI provider
const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY
});

// Create Robota agent with OpenAI provider
const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4',
    temperature: 0.7,
    systemMessage: 'You are a helpful AI assistant specialized in technical topics.'
  }
});

// Execute conversation
const response = await agent.run('Explain the benefits of TypeScript over JavaScript');
console.log(response);

// Clean up
await agent.destroy();
```

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

## 🛠️ Function Calling

OpenAI Provider supports type-safe function calling with automatic parameter validation:

```typescript
import { FunctionTool } from '@robota-sdk/agents';
import { z } from 'zod';

// Define type-safe function tools
const weatherTool = new FunctionTool({
  name: 'getWeather',
  description: 'Get current weather information for a location',
  parameters: z.object({
    location: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius')
  }),
  handler: async ({ location, unit }) => {
    // Type-safe handler implementation
    const weatherData = await fetchWeatherAPI(location, unit);
    return {
      temperature: weatherData.temp,
      condition: weatherData.condition,
      location,
      unit
    };
  }
});

const calculatorTool = new FunctionTool({
  name: 'calculate',
  description: 'Perform mathematical operations',
  parameters: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number()
  }),
  handler: async ({ operation, a, b }) => {
    const operations = {
      add: a + b,
      subtract: a - b,
      multiply: a * b,
      divide: a / b
    };
    return { result: operations[operation] };
  }
});

// Register tools with the agent
agent.registerTool(weatherTool);
agent.registerTool(calculatorTool);

// Execute with function calling
const result = await agent.run(
  'What\'s the weather in Tokyo and what\'s 25 * 4?'
);
```

## 🔄 Multi-Provider Architecture

Seamlessly integrate with other providers:

```typescript
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';

const openaiProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY
});

const anthropicProvider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const googleProvider = new GoogleProvider({
  apiKey: process.env.GOOGLE_AI_API_KEY
});

const agent = new Robota({
  name: 'MultiProviderAgent',
  aiProviders: [openaiProvider, anthropicProvider, googleProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4'
  }
});

// Dynamic provider switching
const openaiResponse = await agent.run('Respond using GPT-4');

agent.setModel({ provider: 'anthropic', model: 'claude-3-sonnet-20240229' });
const claudeResponse = await agent.run('Respond using Claude');
```

## ⚙️ Configuration Options

```typescript
interface OpenAIProviderOptions {
  // Required
  client: OpenAI;                    // OpenAI SDK client instance
  
  // Model Configuration
  model?: string;                    // Default: 'gpt-4'
  temperature?: number;              // 0-1, default: 0.7
  maxTokens?: number;               // Maximum tokens to generate
  
  // API Configuration
  apiKey?: string;                  // API key (if not set in client)
  organization?: string;            // OpenAI organization ID
  timeout?: number;                 // Request timeout (ms)
  baseURL?: string;                // Custom API base URL
  
  // Response Configuration
  responseFormat?: 'text' | 'json_object' | 'json_schema';
  jsonSchema?: {                   // For structured outputs
    name: string;
    description?: string;
    schema?: Record<string, string | number | boolean | object>;
    strict?: boolean;
  };
  
  // Debugging & Logging
  enablePayloadLogging?: boolean;   // Enable API payload logging
  payloadLogDir?: string;          // Log directory path
  includeTimestampInLogFiles?: boolean; // Include timestamps in log files
}
```

## 📋 Supported Models

| Model | Description | Use Cases |
|-------|-------------|-----------|
| `gpt-4` | Most capable model | Complex reasoning, analysis, creative tasks |
| `gpt-4-turbo` | Faster GPT-4 variant | Balanced performance and cost |
| `gpt-3.5-turbo` | Fast and efficient | Simple conversations, basic tasks |
| `gpt-4-vision-preview` | Vision capabilities | Image analysis and understanding |

## 🔍 API Reference

### OpenAIProvider Class

```typescript
class OpenAIProvider extends BaseAIProvider<
  OpenAIProviderOptions,
  UniversalMessage,
  UniversalMessage
> {
  // Core methods
  async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage>
  async chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage>
  
  // Provider information
  readonly name: string = 'openai'
  readonly version: string = '1.0.0'
  
  // Utility methods
  supportsTools(): boolean
  validateConfig(): boolean
  async dispose(): Promise<void>
}
```

### Type Definitions

```typescript
// Chat Options
interface ChatOptions {
  tools?: ToolSchema[];
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

interface OpenAILogData {
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

Enable environment-specific payload logging:

#### Node.js Environment (File-Based Logging)
```typescript
import { FilePayloadLogger } from '@robota-sdk/openai/loggers/file';

const provider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4',
  payloadLogger: new FilePayloadLogger({
    logDir: './logs/openai-api',
    enabled: true,
    includeTimestamp: true
  })
});
```

#### Browser Environment (Console-Based Logging)
```typescript
import { ConsolePayloadLogger } from '@robota-sdk/openai/loggers/console';

const provider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4',
  payloadLogger: new ConsolePayloadLogger({
    enabled: true,
    includeTimestamp: true
  })
});
```

This creates detailed logs of all API requests and responses for debugging purposes.

## 🔒 Security Best Practices

### API Key Management
```typescript
// ✅ Good: Use environment variables
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ❌ Bad: Hardcoded keys
const client = new OpenAI({
  apiKey: 'sk-...' // Never do this!
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
  model: 'gpt-4',
  maxTokens: 1000,        // Limit response length
  temperature: 0.3        // More deterministic responses
});
```

### Model Selection Strategy
- Use `gpt-3.5-turbo` for simple tasks
- Use `gpt-4` for complex reasoning
- Use `gpt-4-turbo` for balanced performance

## 🤝 Contributing

This package follows strict type safety guidelines:
- Zero `any` or `unknown` types allowed
- Complete TypeScript coverage
- Comprehensive error handling
- Provider-agnostic design principles

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Related Packages

- **[@robota-sdk/agents](../agents/)**: Core agent framework
- **[@robota-sdk/anthropic](../anthropic/)**: Anthropic Claude provider
- **[@robota-sdk/google](../google/)**: Google AI provider
- **[@robota-sdk/team](../team/)**: Multi-agent collaboration

---

For complete documentation and examples, visit the [Robota SDK Documentation](https://robota.io). 