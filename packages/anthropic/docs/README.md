# @robota-sdk/anthropic

Anthropic Claude provider for the Robota SDK with full agents standard integration.

## Overview

The `@robota-sdk/anthropic` package provides seamless integration with Anthropic's Claude models within the Robota agent framework. It includes support for chat completions, streaming responses, and tool calling.

## Installation

```bash
npm install @robota-sdk/anthropic @robota-sdk/agents
```

## Quick Start

```typescript
import { Robota } from '@robota-sdk/agents';
import { AnthropicProvider } from '@robota-sdk/anthropic';

const agent = new Robota({
  name: 'Claude Agent',
  aiProviders: { 
    anthropic: new AnthropicProvider({ 
      apiKey: process.env.ANTHROPIC_API_KEY 
    }) 
  },
  currentProvider: 'anthropic',
  currentModel: 'claude-3-sonnet-20240229'
});

const response = await agent.run('What is artificial intelligence?');
console.log(response);
```

## Features

### ✅ Full Agents Standard Integration
- **UniversalMessage Support**: Automatic message format conversion
- **Streaming Support**: Real-time response streaming with `runStream`
- **Tool Calling**: Tool use integration with Robota tool system
- **Error Handling**: Comprehensive error management and recovery

### 🔧 Anthropic-Specific Features
- **Claude Models**: Claude 3 Opus, Sonnet, and Haiku models
- **Advanced Parameters**: Temperature, max tokens, top-p, top-k support
- **Tool Use**: Native Anthropic tool use integration
- **System Messages**: Proper system message handling for Claude models

### 🌊 Streaming Implementation
- **Real-time Processing**: Chunk-by-chunk response processing
- **Tool Integration**: Streaming responses with tool calling support
- **Error Recovery**: Robust error handling during streaming

## API Reference

### AnthropicProvider

```typescript
class AnthropicProvider extends BaseAIProvider<AnthropicProviderOptions, UniversalMessage, AnthropicResponse>
```

#### Configuration Options

```typescript
interface AnthropicProviderOptions {
  apiKey: string;
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;
}
```

#### Methods

- `run(messages, options)`: Execute message completion
- `runStream(messages, options)`: Execute streaming message completion
- `configure(options)`: Update provider configuration

## Architecture

### Module Structure

```
packages/anthropic/src/
├── provider.ts              # Main AnthropicProvider class
├── parsers/
│   └── response-parser.ts  # Response parsing utilities
├── streaming/              # Streaming implementation
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
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
```

## Model Support

### Claude 3 Models
- `claude-3-opus-20240229` - Most capable model for complex tasks
- `claude-3-sonnet-20240229` - Balanced performance and speed
- `claude-3-haiku-20240307` - Fast and efficient for simpler tasks

### Tool Use
All Claude 3 models support tool use with the Robota tool system.

### Streaming
All Claude 3 models support real-time streaming responses.

## Examples

- [Basic Chat](../../../docs/examples/anthropic-basic.md)
- [Streaming Responses](../../../docs/examples/anthropic-streaming.md)
- [Tool Use](../../../docs/examples/anthropic-tools.md)
- [Claude Models](../../../docs/examples/anthropic-models.md)

## Migration from Legacy

If migrating from custom Anthropic integration:

```typescript
// New way with Robota agents
import { Robota } from '@robota-sdk/agents';
import { AnthropicProvider } from '@robota-sdk/anthropic';

const agent = new Robota({
  aiProviders: { 
    anthropic: new AnthropicProvider({ apiKey: 'sk-ant-...' }) 
  },
  currentProvider: 'anthropic'
});
```

## License

MIT 