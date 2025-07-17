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

const openaiProvider = new OpenAIProvider({ apiKey: 'sk-...' });

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [openaiProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4',
    systemMessage: 'You are a helpful assistant.'
  }
});

const response = await agent.run('Hello, world!');
console.log(response);
```

### Browser Quick Start

```typescript
import { Robota, LoggingPlugin, UsagePlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const openaiProvider = new OpenAIProvider({ 
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY // or proxy endpoint
});

// Browser-optimized configuration
const agent = new Robota({
  name: 'BrowserAgent',
  aiProviders: [openaiProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-3.5-turbo'
  },
  plugins: [
    new LoggingPlugin({ strategy: 'console' }),    // Console logging
    new UsagePlugin({ strategy: 'memory' })        // Memory storage
  ]
});

const response = await agent.run('Hello from browser!');
console.log(response);
```

## Key Features

### 🌐 Cross-Platform Compatibility
- **Universal Runtime Support**: Works seamlessly in Node.js, browsers, and WebWorkers
- **Zero Breaking Changes**: Existing Node.js code runs unchanged in browsers
- **Pure JavaScript Implementation**: No Node.js-specific dependencies in core functionality
- **Browser-Optimized Storage**: Memory-based alternatives for file system operations
- **Secure API Patterns**: Proxy server support for secure browser deployments

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
Eight core plugins with type-safe configuration and BasePluginOptions integration:

- **ConversationHistoryPlugin**: Comprehensive conversation storage with support for memory, file, and database backends. Features auto-save, batch processing, and configurable limits.
- **UsagePlugin**: Advanced usage analytics including token counting, cost calculation, aggregated statistics, and multiple storage strategies (memory/file/remote).
- **LoggingPlugin**: Multi-level logging system with console, file, and remote endpoints. Supports custom formatters, batch processing, and structured logging.
- **PerformancePlugin**: Real-time performance monitoring including execution time tracking, memory usage, CPU metrics, and customizable performance thresholds.
- **ErrorHandlingPlugin**: Robust error management with multiple strategies (simple, exponential-backoff, circuit-breaker, silent) and custom error handlers.
- **LimitsPlugin**: Advanced rate limiting with token bucket, sliding window, and fixed window strategies. Supports cost tracking and custom calculators.
- **EventEmitterPlugin**: Comprehensive event system with async/sync event handling, filtering, buffering, and lifecycle event tracking.
- **WebhookPlugin**: HTTP webhook notifications with batch processing, retry logic, custom transformers, and concurrent request management.

#### Plugin Features
- **Type Safety**: All plugins extend BasePluginOptions for consistent configuration
- **Lifecycle Integration**: Automatic integration with agent lifecycle events
- **Resource Management**: Built-in cleanup and resource optimization
- **Performance Monitoring**: All plugins include built-in statistics and monitoring
- **Error Resilience**: Graceful error handling across all plugin operations

#### Plugin Control and Configuration
- **Clear Disable Options**: Every plugin provides multiple ways to disable functionality
- **No Arbitrary Decisions**: Plugins avoid making policy decisions without explicit configuration
- **Explicit Configuration**: All automatic behaviors can be controlled through configuration
- **Silent Modes**: Most plugins support 'silent' strategies for performance-critical scenarios

```typescript
// Complete plugin disable
const agent = new Robota({
  plugins: [] // No plugins
});

// Selective plugin disable
const agent = new Robota({
  plugins: [
    new LoggingPlugin({ strategy: 'silent', enabled: false }),
    new LimitsPlugin({ strategy: 'none' }),
    new UsagePlugin({ strategy: 'silent' })
  ]
});
```

#### Plugin Documentation
- **[Plugin Behaviors](plugin-automatic-behaviors.md)**: Detailed documentation of all automatic behaviors and default policies
- **[Configuration Examples](plugin-configuration-examples.md)**: Comprehensive examples for each plugin including disable options
- **[Best Practices](plugin-best-practices.md)**: Guidelines for plugin configuration and performance optimization

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
- [Browser Usage](../../../docs/examples/browser-usage.md) 🌐
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
- **@robota-sdk/tools**: Deprecated - functionality moved to agents

## License

MIT 