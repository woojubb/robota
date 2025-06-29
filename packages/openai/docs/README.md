# @robota-sdk/openai

OpenAI provider for the Robota SDK with full agents standard integration.

## Overview

The `@robota-sdk/openai` package provides seamless integration with OpenAI's GPT models within the Robota agent framework. It includes support for chat completions, streaming responses, and tool calling.

## Installation

```bash
npm install @robota-sdk/openai @robota-sdk/agents
```

## Quick Start

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const agent = new Robota({
  name: 'GPT Agent',
  aiProviders: { 
    openai: new OpenAIProvider({ 
      apiKey: process.env.OPENAI_API_KEY 
    }) 
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4'
});

const response = await agent.run('What is artificial intelligence?');
console.log(response);
```

## Features

### ✅ Full Agents Standard Integration
- **UniversalMessage Support**: Automatic message format conversion
- **Streaming Support**: Real-time response streaming with `runStream`
- **Tool Calling**: Function calling integration with Robota tool system
- **Error Handling**: Comprehensive error management and recovery

### 🔧 OpenAI-Specific Features
- **Multiple Models**: GPT-4, GPT-3.5, and other OpenAI models
- **Advanced Parameters**: Temperature, max tokens, presence penalty support
- **Function Calling**: Native OpenAI function calling integration
- **Payload Logging**: Detailed request/response logging

### 🌊 Streaming Implementation
- **Real-time Processing**: Chunk-by-chunk response processing
- **Tool Integration**: Streaming responses with tool calling support
- **Error Recovery**: Robust error handling during streaming

## API Reference

### OpenAIProvider

```typescript
class OpenAIProvider extends BaseAIProvider<OpenAIProviderOptions, UniversalMessage, OpenAIResponse>
```

#### Configuration Options

```typescript
interface OpenAIProviderOptions {
  apiKey: string;
  baseURL?: string;
  organization?: string;
  project?: string;
  dangerouslyAllowBrowser?: boolean;
  timeout?: number;
  maxRetries?: number;
}
```

#### Methods

- `run(messages, options)`: Execute chat completion
- `runStream(messages, options)`: Execute streaming chat completion
- `configure(options)`: Update provider configuration

### OpenAIConversationAdapter

Handles message format conversion between Robota's UniversalMessage and OpenAI's chat format.

```typescript
class OpenAIConversationAdapter {
  static convertToOpenAI(messages: UniversalMessage[]): OpenAI.Chat.ChatCompletionMessageParam[]
  static convertFromOpenAI(response: OpenAI.Chat.ChatCompletion): UniversalMessage
}
```

## Architecture

### Module Structure

```
packages/openai/src/
├── provider.ts              # Main OpenAIProvider class
├── adapter.ts              # Message format conversion
├── payload-logger.ts       # Request/response logging
├── parsers/
│   └── response-parser.ts  # Response parsing utilities
├── streaming/
│   └── stream-handler.ts   # Streaming implementation
└── types.ts               # TypeScript definitions
```

### Integration Points

- **BaseAIProvider**: Extends the agents standard base class
- **UniversalMessage**: Uses Robota's universal message format
- **Tool System**: Integrates with Robota's tool execution system
- **Plugin System**: Compatible with all Robota plugins

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm run test
```

### Linting

```bash
npm run lint
npm run lint:fix
```

## Environment Variables

Required environment variables:

```bash
OPENAI_API_KEY=sk-your-api-key-here
```

Optional environment variables:

```bash
OPENAI_BASE_URL=https://api.openai.com/v1  # Custom API endpoint
OPENAI_ORGANIZATION=org-your-org-id        # Organization ID
OPENAI_PROJECT=proj-your-project-id        # Project ID
```

## Model Support

### Chat Models
- `gpt-4` - Most capable model
- `gpt-4-turbo` - Faster, cost-effective alternative
- `gpt-3.5-turbo` - Fast and efficient for simpler tasks

### Function Calling
All chat models support function calling with the Robota tool system.

### Streaming
All chat models support real-time streaming responses.

## Examples

- [Basic Chat](../../../docs/examples/openai-basic.md)
- [Streaming Responses](../../../docs/examples/openai-streaming.md)
- [Function Calling](../../../docs/examples/openai-functions.md)
- [Multi-Model Usage](../../../docs/examples/openai-models.md)

## Migration from Legacy

If migrating from `@robota-sdk/core` with OpenAI:

```typescript
// Old way (deprecated)
import { createOpenAIProvider } from '@robota-sdk/core';

// New way (recommended)
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const agent = new Robota({
  aiProviders: { 
    openai: new OpenAIProvider({ apiKey: 'sk-...' }) 
  },
  currentProvider: 'openai'
});
```

## License

MIT 