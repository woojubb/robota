# Robota SDK Architecture Guide

## Overview

The Robota SDK is built around a unified agent architecture that combines conversation management, tool execution, and plugin systems into a cohesive framework for building intelligent AI applications.

### Core Principles

1. **Type Safety First**: Complete TypeScript safety with zero `any`/`unknown` types
2. **Modular Design**: Plugin-based extensible architecture with clear separation of concerns
3. **Provider Agnostic**: Seamless integration with multiple AI providers (OpenAI, Anthropic, Google)
4. **Performance Focused**: Built-in analytics, monitoring, and optimization
5. **Developer Experience**: Intuitive APIs with comprehensive IntelliSense support

## Core Features

### Unified Agent System
- **Type-Safe Architecture**: Complete TypeScript safety with `BaseAgent` foundation
- **Robota Class**: Main agent implementation combining conversation, tools, and plugins
- **Configuration Management**: Unified `AgentConfig` system with runtime updates
- **Execution Service**: Safe command execution with comprehensive error handling

### Multi-Provider Support
- **Provider Abstraction**: `BaseAIProvider` interface for consistent AI integration
- **Supported Providers**: OpenAI (GPT-3.5, GPT-4, GPT-4o-mini), Anthropic (Claude 3.5), Google (Gemini 1.5)
- **Real-Time Streaming**: Live response streaming across all providers
- **Universal Messages**: Cross-provider message format compatibility

### Advanced Tool System
- **Function Tools**: Type-safe tools with Zod schema validation
- **Tool Registry**: Centralized tool management and execution
- **Parameter Validation**: Automatic type checking and parameter validation
- **MCP Integration**: Model Context Protocol support for external tools

### Intelligent Team Collaboration
- **Template-Based Experts**: 6 built-in specialist templates (coordinator, researcher, creative ideator, etc.)
- **Automatic Task Analysis**: AI-powered request analysis and expert selection
- **Dynamic Agent Creation**: On-demand expert agent instantiation
- **Workflow Visualization**: Team interaction flowcharts and relationship diagrams

### Comprehensive Plugin Ecosystem
- **ConversationHistoryPlugin**: Multi-backend storage (memory/file/database) with auto-save
- **ExecutionAnalyticsPlugin**: Real-time performance monitoring and statistics
- **LoggingPlugin**: Multi-level logging with console/file/remote backends
- **ErrorHandlingPlugin**: Multiple error strategies (simple, exponential-backoff, circuit-breaker)
- **LimitsPlugin**: Advanced rate limiting (token-bucket, sliding-window, fixed-window)
- **PerformancePlugin**: System metrics and performance optimization
- **UsagePlugin**: Token tracking, cost calculation, and usage analytics
- **EventEmitterPlugin**: Event-driven architecture with filtering and buffering
- **WebhookPlugin**: HTTP notifications with batch processing and retry logic

## Architecture Overview

### Layered Architecture
```
@robota-sdk/agents (Core Package)
├── abstracts/          # Base abstract classes with type parameters
├── agents/             # Main Robota agent implementation
├── interfaces/         # TypeScript type definitions
├── managers/           # Agent factory and resource management
├── plugins/            # Extensible plugin system
├── services/           # Core business logic services
├── tools/              # Tool implementation and registry
└── utils/              # Utility functions and helpers
```

### Core Abstractions
- **BaseAgent**: Foundation class for all agent implementations
- **BaseAIProvider**: Unified interface for AI provider integration
- **BaseTool**: Type-safe tool system with parameter validation
- **BasePlugin**: Extensible plugin architecture with lifecycle hooks
- **AgentFactory**: Agent creation and template management
- **ExecutionService**: Safe command execution with error handling

## Package Ecosystem

### Integrated Packages
- **@robota-sdk/team**: Intelligent multi-agent collaboration with template-based expert selection
- **@robota-sdk/openai**: OpenAI provider with GPT-3.5, GPT-4, and streaming support
- **@robota-sdk/anthropic**: Anthropic provider with Claude 3.5 Sonnet integration
- **@robota-sdk/google**: Google AI provider with Gemini 1.5 support

### Type System
- **Complete Type Safety**: Zero `any`/`unknown` types throughout the codebase
- **Generic Type Parameters**: Flexible type system with `BaseAgent<TConfig, TStats>`
- **Universal Message Format**: Standardized message structure across all providers
- **Unified Configuration**: `AgentConfig` system with runtime updates

## Extension and Development

### Adding New AI Providers
1. **Extend BaseAIProvider**: Implement the unified provider interface
2. **Define Types**: Create provider-specific type definitions
3. **Message Conversion**: Implement `UniversalMessage` conversion logic  
4. **Streaming Support**: Add real-time streaming capabilities

```typescript
class CustomProvider extends BaseAIProvider {
  async chat(messages: UniversalMessage[]): Promise<UniversalMessage> {
    // Implementation
  }
  
  async *chatStream(messages: UniversalMessage[]): AsyncIterable<UniversalMessage> {
    // Streaming implementation
  }
}
```

### Creating Custom Plugins
1. **Extend BasePlugin**: Use the plugin foundation with type parameters
2. **Define Configuration**: Create plugin-specific options interface
3. **Implement Lifecycle**: Add event handlers for agent lifecycle
4. **Add Statistics**: Provide plugin-specific metrics

```typescript
class CustomPlugin extends BasePlugin<CustomOptions, CustomStats> {
  name = 'CustomPlugin';
  
  async beforeExecution(context: ExecutionContext): Promise<void> {
    // Pre-execution logic
  }
  
  getStats(): CustomStats {
    // Return plugin statistics
  }
}
```

### Building Tools
1. **Extend BaseTool**: Create type-safe tool implementations
2. **Parameter Validation**: Use Zod schemas for type safety
3. **Execution Logic**: Implement the tool's core functionality
4. **Error Handling**: Add robust error management

```typescript
const customTool = createFunctionTool(
  'toolName',
  'Tool description',
  zodSchema,
  async (params) => {
    // Tool implementation
    return result;
  }
);
```

## Performance and Monitoring

### Built-in Analytics
- **Execution Tracking**: Automatic performance monitoring across all operations
- **Resource Usage**: Memory, CPU, and token consumption tracking
- **Error Analysis**: Comprehensive error logging and pattern analysis
- **Cost Optimization**: Multi-provider cost tracking and optimization

### Plugin-Based Monitoring
- **ExecutionAnalyticsPlugin**: Real-time performance metrics
- **PerformancePlugin**: System resource monitoring
- **UsagePlugin**: Cost and consumption analytics
- **LoggingPlugin**: Structured logging across all components

### Team Collaboration Analytics
- **Workflow Visualization**: Generate flowcharts of agent interactions
- **Expert Usage Statistics**: Track which templates are used most frequently
- **Performance Optimization**: Identify bottlenecks in multi-agent workflows
- **Cost Distribution**: Analyze costs across different AI providers and models
