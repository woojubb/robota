# @robota-sdk/agents Architecture

## 🏗️ Architecture Overview

The `@robota-sdk/agents` package is built with a comprehensive multi-layered architecture designed for modularity, type safety, and extensibility.

## 📦 Core Architecture Layers

### 1. Abstract Base Classes
All core components extend from type-safe abstract base classes:

```typescript
BaseAgent<TConfig, TContext, TMessage>
├── Robota (Main Implementation)

BaseAIProvider<TConfig, TMessage, TResponse>
├── OpenAIProvider (via @robota-sdk/openai)
├── AnthropicProvider (via @robota-sdk/anthropic)
└── GoogleProvider (via @robota-sdk/google)

BaseTool<TParameters, TResult>
├── FunctionTool (Zod schema-based)
├── OpenAPITool (API specification-based)
└── MCPTool (Model Context Protocol)

BasePlugin<TOptions, TStats>
├── ConversationHistoryPlugin
├── UsagePlugin
├── LoggingPlugin
├── PerformancePlugin
├── ErrorHandlingPlugin
├── LimitsPlugin
├── EventEmitterPlugin
└── WebhookPlugin
```

### 2. Service Layer (Stateless Business Logic)
- **ConversationService**: Message handling and conversation flow
- **ToolExecutionService**: Tool discovery, validation, and execution
- **ExecutionService**: Agent execution orchestration with streaming support

### 3. Manager Layer (Resource Management)
- **AIProviderManager**: Dynamic provider registration and management
- **ToolManager**: Tool registry and schema management
- **ConversationHistoryManager**: Conversation storage across different backends
- **PluginManager**: Plugin lifecycle and coordination

### 4. Plugin System Architecture
Eight core plugins with specialized functionality:

#### ConversationHistoryPlugin
- **Storage Options**: Memory, File, Database
- **UniversalMessage Standard**: Consistent message format across providers
- **History Management**: Load, save, clear conversation history

#### UsagePlugin
- **Metrics Collection**: API calls, tokens, costs
- **Storage Backends**: Memory, File, Database
- **Analytics**: Usage patterns and optimization insights

#### LoggingPlugin
- **Multi-Storage**: Console, File, Remote endpoints
- **Environment Control**: Log level and destination management
- **Format Support**: JSON, text, custom formatters

#### PerformancePlugin
- **System Metrics**: Response time, memory usage, CPU utilization
- **Storage Options**: Memory-based performance tracking
- **Optimization**: Performance bottleneck identification

#### ErrorHandlingPlugin
- **Error Logging**: Comprehensive error tracking and reporting
- **Recovery Strategies**: Automatic retry and fallback mechanisms
- **Context Preservation**: Error context for debugging

#### LimitsPlugin
- **Rate Limiting**: Request rate and token usage limits
- **Cost Control**: Budget and spending limits
- **Quota Management**: Usage quotas and alerts

#### EventEmitterPlugin
- **Tool Events**: Tool execution and completion events
- **Event Propagation**: Cross-system event broadcasting
- **Custom Events**: User-defined event handling

#### WebhookPlugin
- **External Notifications**: HTTP webhook integrations
- **Event Filtering**: Selective webhook triggering
- **Retry Logic**: Robust webhook delivery

## 🔧 Tool System Architecture

### Tool Registry System
```typescript
interface ToolRegistry {
  registerTool(tool: BaseTool): void;
  getTool(name: string): BaseTool | undefined;
  getSchema(name: string): ToolSchema | undefined;
  validateParameters(name: string, params: unknown): boolean;
}
```

### Function Tool Implementation
- **Zod Integration**: Schema-first tool definition
- **Type Safety**: Compile-time parameter validation
- **Runtime Validation**: Parameter checking at execution time

### Tool Execution Flow
1. **Discovery**: Find available tools
2. **Validation**: Validate parameters against schema
3. **Execution**: Execute tool with validated parameters
4. **Result Processing**: Handle tool results and errors

## 🌊 Streaming Architecture

### Provider-Agnostic Streaming
Each provider implements streaming through dedicated handlers:

```typescript
interface StreamHandler {
  handleChunk(chunk: unknown): Promise<void>;
  handleError(error: Error): Promise<void>;
  handleComplete(): Promise<void>;
}
```

### Streaming Integration Points
- **Real-time Processing**: Chunk-by-chunk response handling
- **Tool Integration**: Tool calling within streaming responses
- **Error Recovery**: Graceful error handling during streams
- **Plugin Events**: Stream events propagated through plugin system

## 🔒 Type Safety System

### Generic Type Parameters
- **BaseAgent<TConfig, TContext, TMessage>**: Agent configuration and context types
- **BaseAIProvider<TConfig, TMessage, TResponse>**: Provider-specific type safety
- **BaseTool<TParameters, TResult>**: Tool parameter and result validation
- **BasePlugin<TOptions, TStats>**: Plugin configuration and statistics

### Dynamic Provider Support
```typescript
interface ExtendedRunContext {
  [key: string]: unknown; // Provider-specific options
  // Common options
  temperature?: number;
  maxTokens?: number;
  // ... other common options
}
```

### Type Ownership System
- **Centralized Types**: Core types in `src/interfaces/`
- **Plugin-Specific Types**: Each plugin owns its Options/Stats types
- **Export-Based Dependencies**: No type duplication across modules

## 📊 Analytics and Monitoring

### Team Integration
- **TeamContainer**: Multi-agent orchestration
- **Workflow Management**: Complex task coordination
- **Performance Aggregation**: Team-wide metrics collection

### Plugin Statistics
Each plugin provides specialized statistics:
- **Usage**: API calls, tokens, costs
- **Performance**: Response times, resource usage
- **Errors**: Error rates and recovery statistics
- **Events**: Event emission and handling metrics

## 🔄 Provider Integration

### Universal Message System
All providers convert to/from UniversalMessage format:
```typescript
interface UniversalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
}
```

### Provider Adapter Pattern
Each provider implements message conversion:
- **OpenAI**: Chat completion format
- **Anthropic**: Messages API format
- **Google**: Gemini API format

## 🏭 Factory Patterns

### Agent Factory
```typescript
class AgentFactory {
  createAgent(config: AgentConfig): Promise<BaseAgent>;
  createFromTemplate(templateName: string): Promise<BaseAgent>;
  getTemplates(): AgentTemplate[];
}
```

### Template System
Pre-configured agent templates for common use cases:
- **Basic Agent**: Simple conversation agent
- **Tool Agent**: Agent with function calling
- **Research Agent**: Information gathering specialist
- **Writing Agent**: Content creation specialist

## 🔧 Facade Pattern Implementation

Several components use the Facade pattern for clean architecture:

### Webhook Plugin Facade
```
src/plugins/webhook/
├── types.ts              # Type definitions
├── transformer.ts        # Data transformation
├── http-client.ts        # HTTP communication
├── webhook-plugin.ts     # Main plugin class
└── index.ts             # Public interface
```

### Function Tool Facade
```
src/tools/implementations/function-tool/
├── types.ts              # Type definitions
├── schema-converter.ts   # Zod schema conversion
├── index.ts             # Tool implementation
└── function-tool.ts     # Legacy compatibility
```

### Error Handling Facade
```
src/plugins/error-handling/
├── types.ts              # Error type definitions
├── context-adapter.ts    # Context adaptation
├── error-handling-plugin.ts # Main plugin
└── index.ts             # Public interface
```

## 🔍 Development Principles

### 1. Type Safety First
- **No any/unknown**: Strict TypeScript enforcement
- **Generic Constraints**: Proper type parameter bounds
- **Runtime Validation**: Type guards and schema validation

### 2. Modular Design
- **Single Responsibility**: Each module has a clear purpose
- **Loose Coupling**: Minimal dependencies between modules
- **High Cohesion**: Related functionality grouped together

### 3. Extensibility
- **Plugin Architecture**: Easy to add new functionality
- **Provider Agnostic**: Support for multiple AI providers
- **Tool Ecosystem**: Extensible tool system

### 4. Performance
- **Streaming Support**: Real-time response processing
- **Parallel Execution**: Concurrent tool calling
- **Resource Management**: Efficient memory and CPU usage

### 5. Developer Experience
- **TypeScript First**: Full type safety and IntelliSense
- **Clear APIs**: Intuitive and consistent interfaces
- **Comprehensive Documentation**: Examples and guides
- **Testing**: Robust test coverage

## 🔧 Build and Development

### Package Structure
```
packages/agents/src/
├── abstracts/           # Abstract base classes
├── interfaces/          # Type definitions
├── agents/
│   ├── robota.ts       # Main agent implementation
│   └── robota.test.ts  # Agent tests
├── managers/           # Resource managers
├── services/           # Business logic services
├── plugins/            # Plugin system
├── tools/              # Tool system
├── utils/              # Utilities
└── index.ts           # Public exports
```

### Testing Strategy
- **Unit Tests**: Individual component testing
- **Integration Tests**: Cross-component functionality
- **Type Tests**: TypeScript compilation validation
- **Performance Tests**: Benchmarking and optimization

### Build Pipeline
- **TypeScript Compilation**: Strict type checking
- **ESLint**: Code quality and consistency
- **Vitest**: Fast unit and integration testing
- **TSUp**: Optimized bundling for distribution 