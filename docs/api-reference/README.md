agents / [Exports](modules.md)

# @robota-sdk/agents

The comprehensive AI agent framework with type-safe architecture and advanced plugin system.

## Overview

The `@robota-sdk/agents` package is the unified core of the Robota SDK, providing a complete AI agent system with advanced capabilities for conversation management, tool execution, and extensible plugin architecture.

## Installation

```bash
npm install @robota-sdk/agents
```

## Quick Start

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: { 
    openai: new OpenAIProvider({ apiKey: 'sk-...' }) 
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4'
});

const response = await agent.run('Hello, world!');
console.log(response);
```

## Key Features

### 🤖 Agent System
- **Type-Safe Architecture**: Full TypeScript support with generic type parameters
- **Robota Class**: Complete AI agent implementation with conversation + tool system + plugin integration
- **Stateless Service Layer**: ConversationService, ToolExecutionService, ExecutionService for business logic
- **Manager Layer**: AIProviders, Tools, AgentFactory, Plugins, ConversationHistory for resource management
- **Parallel Tool Execution**: Concurrent multi-tool calling support

### 🌊 Streaming Response System
- **Real-time Streaming**: Full streaming support across all AI providers
- **Modular Architecture**: Separate streaming/parsing logic for each provider
- **Provider Support**: OpenAI, Anthropic, Google with dedicated stream handlers

### 🔧 Tool System
- **Type-Safe Tools**: `BaseTool<TParameters, TResult>` with compile-time type checking
- **ToolRegistry**: Schema storage and validation system
- **Function Tools**: Zod schema-based function tool implementation
- **OpenAPI/MCP Support**: Basic structure for extensibility

### 🔌 Plugin System
Eight core plugins with type-safe configuration:

- **ConversationHistoryPlugin**: Conversation storage (memory/file/database)
- **UsagePlugin**: Usage statistics collection (calls, tokens, costs)
- **LoggingPlugin**: Operation logging (Console/File/Remote with environment control)
- **PerformancePlugin**: Performance metrics (response time, memory, CPU)
- **ErrorHandlingPlugin**: Error logging, recovery, and retry handling
- **LimitsPlugin**: Token/request limits (Rate limiting, cost control)
- **EventEmitterPlugin**: Tool event detection and propagation
- **WebhookPlugin**: Webhook notifications for external systems

### 🔒 Type Safety Features
- **Generic Type Parameters**: `BaseAgent<TConfig, TContext, TMessage>`
- **Provider Agnostic**: Dynamic provider registration with type safety
- **Extended RunContext**: Provider-specific options with type preservation
- **Plugin Type Parameters**: `BasePlugin<TOptions, TStats>` for specialized configurations

## Architecture

### Core Abstraction Layers

```
BaseAgent<TConfig, TContext, TMessage> (Abstract Class)
└── Robota (Implementation - AI conversation + tool system + plugins)

BaseAIProvider<TConfig, TMessage, TResponse>
├── OpenAIProvider (via @robota-sdk/openai)
├── AnthropicProvider (via @robota-sdk/anthropic)
└── GoogleProvider (via @robota-sdk/google)

BaseTool<TParameters, TResult>
├── FunctionTool (Zod schema-based)
├── OpenAPITool (API specification-based)
└── MCPTool (Model Context Protocol)

BasePlugin<TOptions, TStats>
├── Core Plugins (8 essential plugins)
└── Custom Plugins (User-defined extensions)
```

### Module Structure

```
packages/agents/src/
├── abstracts/           # Abstract base classes with type parameters
├── interfaces/          # Type-safe interface definitions
├── agents/             # Main agent system
│   ├── managers/       # Resource managers
│   ├── services/       # Stateless business logic
│   └── tools/          # Tool system
├── plugins/            # Plugin system with Facade pattern
└── utils/              # Core utilities
```

## Development

See [development.md](development.md) for detailed development guidelines.

## API Reference

See [api.md](api.md) for complete API documentation.

## Architecture Guide

See [architecture.md](architecture.md) for detailed architecture information.

## Examples

- [Basic Usage](../../../docs/examples/basic-usage.md)
- [Tool Integration](../../../docs/examples/tool-integration.md)
- [Plugin Development](../../../docs/examples/plugin-development.md)
- [Streaming Responses](../../../docs/examples/streaming.md)

## Package Compatibility

### Integrated Packages
- **@robota-sdk/openai**: Complete agents standard migration
- **@robota-sdk/anthropic**: Complete agents standard migration  
- **@robota-sdk/google**: Complete agents standard migration
- **@robota-sdk/team**: Full integration with team collaboration features

### Deprecated Packages
- **@robota-sdk/core**: Deprecated - functionality moved to agents
- **@robota-sdk/agents**: Comprehensive AI agent framework with tools and plugins

## License

MIT
