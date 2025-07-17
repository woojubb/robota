# Robota SDK Architecture Guide

## Overview

The Robota SDK is built around a unified agent architecture that combines conversation management, tool execution, and plugin systems into a cohesive framework for building intelligent AI applications.

### Core Principles

1. **Type Safety First**: Complete TypeScript safety with zero `any`/`unknown` types
2. **Modular Design**: Plugin-based extensible architecture with clear separation of concerns
3. **Provider Agnostic**: Seamless integration with multiple AI providers (OpenAI, Anthropic, Google)
4. **Cross-Platform Compatibility**: Universal support for Node.js, browsers, and WebWorkers
5. **Performance Focused**: Built-in analytics, monitoring, and optimization
6. **Developer Experience**: Intuitive APIs with comprehensive IntelliSense support

### Cross-Platform Compatibility

The Robota SDK is designed to work seamlessly across all JavaScript runtime environments with zero breaking changes for existing users.

#### Environment Support Matrix
| Feature | Node.js | Browser | WebWorker | Notes |
|---------|---------|---------|-----------|--------|
| Core AI Conversations | ✅ | ✅ | ✅ | Full compatibility |
| Tool Execution | ✅ | ✅ | ✅ | Function tools with Zod validation |
| Streaming Responses | ✅ | ✅ | ✅ | Fetch API based |
| Plugin System | ✅ | ✅ | ✅ | All plugins compatible |
| Memory Storage | ✅ | ✅ | ✅ | In-memory data structures |
| File Storage | ✅ | ❌ | ❌ | Use memory storage in browsers |
| System Metrics | ✅ | ⚠️ | ⚠️ | Limited browser metrics available |
| WebHook Signatures | ✅ | ✅ | ✅ | Pure JavaScript crypto implementation |

#### Browser-Specific Implementation

**Pure JavaScript Implementation**: All core functionality uses browser-compatible JavaScript without Node.js-specific APIs:

- **Timer System**: Uses standard `setTimeout`/`clearTimeout` with `TimerId` type for cross-platform compatibility
- **Cryptography**: WebHook signatures use `jsSHA` library instead of Node.js crypto module
- **HTTP Requests**: Fetch API for universal HTTP client support
- **Configuration**: All settings injected through constructors, no `process.env` dependencies

**Recommended Browser Configuration**:
```typescript
const robota = new Robota({
  name: 'BrowserAgent',
  aiProviders: [openaiProvider],
  plugins: [
    new LoggingPlugin({ strategy: 'console' }),    // Console logging
    new UsagePlugin({ strategy: 'memory' }),       // Memory storage
    new ConversationHistoryPlugin({ 
      storage: { strategy: 'memory' }              // Memory storage
    })
  ]
});
```

**Zero Breaking Changes**: All browser compatibility improvements are internal implementation changes that maintain 100% API compatibility with existing Node.js applications.

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

#### Enhanced Plugin Classification System
- **Plugin Categories**: LOGGING, MONITORING, STORAGE, NOTIFICATION, LIMITS, ERROR_HANDLING, EVENT
- **Priority System**: CRITICAL, HIGH, NORMAL, LOW priority levels for execution ordering
- **Module Event Subscription**: Plugins can subscribe to module lifecycle events

#### Core Plugins
- **ConversationHistoryPlugin**: Multi-backend storage (memory/file/database) with auto-save [STORAGE/HIGH]
- **ExecutionAnalyticsPlugin**: Real-time performance monitoring and statistics [MONITORING/NORMAL]
- **LoggingPlugin**: Multi-level logging with console/file/remote backends [LOGGING/HIGH]
- **ErrorHandlingPlugin**: Multiple error strategies (simple, exponential-backoff, circuit-breaker) [ERROR_HANDLING/HIGH]
- **LimitsPlugin**: Advanced rate limiting (token-bucket, sliding-window, fixed-window) [LIMITS/NORMAL]
- **PerformancePlugin**: System metrics and performance optimization [MONITORING/NORMAL]
- **UsagePlugin**: Token tracking, cost calculation, and usage analytics [MONITORING/NORMAL]
- **EventEmitterPlugin**: Event-driven architecture with filtering and buffering [EVENT/CRITICAL]
- **WebhookPlugin**: HTTP notifications with batch processing and retry logic [NOTIFICATION/LOW]

### Modular Architecture System

#### Module Infrastructure
- **BaseModule**: Abstract foundation for all module implementations with lifecycle management
- **ModuleRegistry**: Centralized module registration and dependency-based initialization
- **ModuleTypeRegistry**: Dynamic type system with validation and compatibility checking
- **Event-Driven Communication**: Loose coupling between modules and plugins via EventEmitter

#### Module System Features
- **Dependency Resolution**: Automatic dependency ordering and circular dependency detection
- **Type Safety**: Complete TypeScript type system with generic parameters
- **Lifecycle Management**: Standardized initialize, execute, and dispose phases
- **Event Broadcasting**: Module activities automatically broadcast to subscribed plugins

## Architecture Overview

### Layered Architecture
```
@robota-sdk/agents (Core Package)
├── abstracts/          # Base abstract classes with type parameters
│   ├── base-agent.ts   # Foundation for all agent implementations
│   ├── base-plugin.ts  # Enhanced plugin system with classification
│   └── base-module.ts  # Module foundation with lifecycle management
├── agents/             # Main Robota agent implementation
│   └── robota.ts       # Integrated module and plugin support
├── interfaces/         # TypeScript type definitions
├── managers/           # Agent factory and resource management
│   ├── agent-factory.ts      # Agent creation and templates
│   ├── module-registry.ts    # Module registration and lifecycle
│   └── module-type-registry.ts # Dynamic type system
├── plugins/            # Extensible plugin system with categories
│   ├── logging/        # [LOGGING/HIGH] Structured logging
│   ├── performance/    # [MONITORING/NORMAL] System metrics
│   ├── usage/          # [MONITORING/NORMAL] Usage analytics
│   ├── conversation-history/ # [STORAGE/HIGH] Conversation storage
│   ├── execution/      # [MONITORING/NORMAL] Execution analytics
│   ├── error-handling/ # [ERROR_HANDLING/HIGH] Error strategies
│   ├── limits/         # [LIMITS/NORMAL] Rate limiting
│   ├── webhook/        # [NOTIFICATION/LOW] HTTP notifications
│   └── event-emitter/  # [EVENT/CRITICAL] Event system
├── services/           # Core business logic services
├── tools/              # Tool implementation and registry
└── utils/              # Utility functions and helpers
```

### Core Abstractions
- **BaseAgent**: Foundation class for all agent implementations
- **BaseAIProvider**: Unified interface for AI provider integration
- **BaseTool**: Type-safe tool system with parameter validation
- **BasePlugin**: Enhanced plugin architecture with classification, priorities, and module event subscription
- **BaseModule**: Abstract foundation for modular functionality with lifecycle management
- **AgentFactory**: Agent creation and template management
- **ModuleRegistry**: Centralized module registration with dependency resolution
- **ModuleTypeRegistry**: Dynamic type system with validation and compatibility checking
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
1. **Extend BasePlugin**: Use the enhanced plugin foundation with type parameters
2. **Define Configuration**: Create plugin-specific options interface extending BasePluginOptions
3. **Set Classification**: Assign category and priority for proper execution ordering
4. **Implement Lifecycle**: Add event handlers for agent lifecycle
5. **Module Event Handling**: Subscribe to module events for cross-component monitoring
6. **Add Statistics**: Provide plugin-specific metrics

```typescript
class CustomPlugin extends BasePlugin<CustomOptions, CustomStats> {
  name = 'CustomPlugin';
  
  constructor(options: CustomOptions) {
    super();
    
    // Set plugin classification
    this.category = PluginCategory.MONITORING;
    this.priority = PluginPriority.NORMAL;
    
    // Configure options with BasePluginOptions
    this.pluginOptions = {
      enabled: options.enabled ?? true,
      category: this.category,
      priority: this.priority,
      moduleEvents: ['module.initialize.complete', 'module.execution.complete'],
      subscribeToAllModuleEvents: false,
      ...options
    };
  }
  
  async beforeExecution(context: ExecutionContext): Promise<void> {
    // Pre-execution logic
  }
  
  async onModuleEvent(eventType: EventType, eventData: EventData): Promise<void> {
    // Handle module events for cross-component monitoring
    const moduleData = eventData.data as any;
    console.log(`Module event: ${eventType}`, moduleData);
  }
  
  override getStats(): CustomStats {
    return {
      enabled: this.enabled,
      calls: this.callCount,
      errors: this.errorCount,
      lastActivity: this.lastActivity,
      // Custom plugin-specific stats
      customMetric: this.customValue
    };
  }
}
```

### Creating Custom Modules
1. **Extend BaseModule**: Use the module foundation with type parameters
2. **Define Module Type**: Specify capabilities and dependencies
3. **Implement Lifecycle**: Add initialize, execute, and dispose methods
4. **Event Broadcasting**: Emit events for plugin monitoring
5. **Dependency Management**: Declare module dependencies

```typescript
class CustomModule extends BaseModule<CustomOptions, CustomStats> {
  readonly name = 'CustomModule';
  readonly version = '1.0.0';
  readonly moduleType = 'processing';
  
  constructor(options: CustomOptions, eventEmitter?: EventEmitter) {
    super(options, eventEmitter);
    
    this.capabilities = ['data-processing', 'transformation'];
    this.dependencies = ['storage-module']; // Optional dependencies
  }
  
  async initialize(): Promise<void> {
    // Module initialization logic
    this.emitModuleEvent('initialize.start', {
      moduleName: this.name,
      moduleType: this.moduleType,
      executionId: this.generateExecutionId()
    });
    
    // Setup module resources
    await this.setupResources();
    
    this.emitModuleEvent('initialize.complete', {
      moduleName: this.name,
      moduleType: this.moduleType,
      executionId: this.lastExecutionId,
      duration: Date.now() - this.startTime
    });
  }
  
  async execute<T>(context: ModuleExecutionContext): Promise<ModuleExecutionResult<T>> {
    this.emitModuleEvent('execution.start', {
      moduleName: this.name,
      moduleType: this.moduleType,
      executionId: this.generateExecutionId(),
      context
    });
    
    try {
      const result = await this.processData(context);
      
      this.emitModuleEvent('execution.complete', {
        moduleName: this.name,
        moduleType: this.moduleType,
        executionId: this.lastExecutionId,
        duration: Date.now() - this.startTime,
        success: true,
        result
      });
      
      return { success: true, data: result };
    } catch (error) {
      this.emitModuleEvent('execution.error', {
        moduleName: this.name,
        moduleType: this.moduleType,
        executionId: this.lastExecutionId,
        duration: Date.now() - this.startTime,
        success: false,
        error: error.message
      });
      
      return { success: false, error: error.message };
    }
  }
  
  async dispose(): Promise<void> {
    // Cleanup module resources
    await this.cleanupResources();
    
    this.emitModuleEvent('dispose.complete', {
      moduleName: this.name,
      moduleType: this.moduleType,
      executionId: this.generateExecutionId()
    });
  }
  
  getStats(): CustomStats {
    return {
      executionCount: this.executionCount,
      averageExecutionTime: this.averageExecutionTime,
      lastExecution: this.lastExecution,
      // Custom module-specific stats
      processedItems: this.processedCount
    };
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
