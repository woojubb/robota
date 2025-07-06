---
title: Core Concepts
description: Core concepts of the Robota library
lang: en-US
---

# Core Concepts

Understanding the fundamental concepts and architecture of the Robota SDK.

## 🎯 Why Robota's Architecture Matters

### The Problem with Traditional AI SDKs
- **Vendor Lock-in**: Tied to specific AI providers
- **Type Unsafety**: Runtime errors from untyped responses
- **Limited Extensibility**: Hard to add custom functionality
- **Poor Abstraction**: Provider-specific code everywhere

### Robota's Solution
- **Provider Agnostic**: Write once, run with any AI provider
- **100% Type Safe**: Compile-time guarantees with zero `any` types
- **Plugin Architecture**: Extend without modifying core
- **Clean Abstractions**: Unified interfaces across all providers

## Overview

The Robota SDK is built around a unified agent architecture that provides type-safe, extensible AI agent development. This guide covers the core concepts you need to understand to effectively use the SDK.

## 🏗️ Architectural Advantages

### 1. **Unified Agent Architecture**
Instead of learning different APIs for each AI provider, Robota provides a single, consistent interface:

```typescript
// Same code works with OpenAI, Anthropic, and Google
const agent = new Robota({
    aiProviders: { openai, anthropic, google },
    currentProvider: 'openai',  // Switch anytime
});

// Provider switching is seamless
await agent.switchProvider('anthropic', 'claude-3-sonnet');
```

### 2. **Type Safety as a First-Class Citizen**
Every interaction is fully typed, preventing common runtime errors:

```typescript
// Full IntelliSense support
const response = await agent.run('Hello');  // response is typed as string

// Tool parameters are validated at compile time
const tool = createFunctionTool(
    'calculate',
    'Math operations',
    { /* JSON Schema */ },
    async (params) => {
        // params is fully typed based on schema
        return { result: params.a + params.b };
    }
);
```

### 3. **Plugin-Based Extensibility**
Add functionality without touching core code:

```typescript
// Add monitoring
agent.addPlugin(new PerformancePlugin());

// Add logging
agent.addPlugin(new LoggingPlugin({ level: 'debug' }));

// Add custom behavior
agent.addPlugin(new CustomPlugin());
```

## Agent Architecture

### BaseAgent Foundation

All agents in Robota extend from the `BaseAgent` class, which provides:

- **Type Safety**: Generic type parameters for configuration and context
- **Provider Abstraction**: Unified interface across different AI providers
- **Plugin System**: Extensible architecture for additional functionality
- **Tool Integration**: Built-in support for function calling and external tools

```typescript
// Basic agent creation
const agent = new Robota({
    name: 'MyAgent',
    model: 'gpt-4',
    provider: 'openai',
    aiProviders: { openai: openaiProvider },
    systemMessage: 'You are a helpful assistant.'
});
```

## Plugin vs Module Architecture

The Robota SDK features a clear separation between **Plugins** and **Modules** to provide maximum flexibility and clarity.

### 🔌 Plugin Definition

**Plugins extend agent lifecycle and behavior with optional functionality**

#### Characteristics:
- **Runtime Control**: Dynamic activation/deactivation
- **Optional Extensions**: Add/remove without affecting core agent operations
- **Lifecycle Hooks**: Intervene in agent execution process
- **Observation & Enhancement**: Monitor and augment basic operations
- **Cross-cutting Concerns**: Logging, monitoring, notifications, validation

#### Plugin Categories:
- **LOGGING**: Structured logging and audit trails
- **MONITORING**: Performance, usage, and analytics tracking
- **STORAGE**: Data persistence and retrieval
- **NOTIFICATION**: Alerts and external communications
- **LIMITS**: Rate limiting and resource management
- **ERROR_HANDLING**: Error recovery and resilience
- **EVENT**: Event management and propagation

#### Plugin Examples:
```typescript
// Usage tracking plugin - collects agent execution statistics
class UsagePlugin extends BasePlugin {
    category = PluginCategory.MONITORING;
    priority = PluginPriority.NORMAL;
    
    async beforeRun(input: string): Promise<void> {
        this.startTime = Date.now();
    }
    
    async afterRun(input: string, output: string): Promise<void> {
        this.recordUsage({
            duration: Date.now() - this.startTime,
            inputTokens: this.countTokens(input),
            outputTokens: this.countTokens(output)
        });
    }
}

// Performance monitoring plugin - tracks execution time and memory usage
class PerformancePlugin extends BasePlugin {
    category = PluginCategory.MONITORING;
    priority = PluginPriority.NORMAL;
    
    async beforeExecution(): Promise<void> {
        this.metrics.memoryBefore = process.memoryUsage();
    }
    
    async afterExecution(): Promise<void> {
        this.metrics.memoryAfter = process.memoryUsage();
        this.recordPerformance(this.metrics);
    }
}
```

### 🧩 Module Definition

**Modules provide optional capabilities that extend what agents can do**

#### True Meaning of Modules:
**Modules are "optional extensions that add capabilities LLMs cannot do natively"**

#### Characteristics:
- **Capability Providers**: Add specific domain functionality
- **Optional Extensions**: Agent works without them (basic conversation remains possible)
- **LLM Limitations**: Handle tasks LLMs cannot perform directly
- **Interface Implementation**: Concrete implementations of standard interfaces
- **Domain Expertise**: Specialized functionality for specific areas

#### What Should Be Modules (LLM cannot do + optional):
```typescript
// RAG Search Module - LLMs cannot do real-time document search
interface RAGModule {
    addDocument(id: string, content: string): Promise<void>;
    searchRelevant(query: string): Promise<string[]>;
    generateAnswer(query: string, context: string[]): Promise<string>;
}

// Speech Processing Module - LLMs cannot process audio
interface SpeechModule {
    speechToText(audio: Buffer): Promise<string>;
    textToSpeech(text: string): Promise<Buffer>;
    detectLanguage(audio: Buffer): Promise<string>;
}

// File Processing Module - LLMs cannot parse files directly
interface FileProcessingModule {
    processImage(image: Buffer): Promise<string>;
    processPDF(pdf: Buffer): Promise<string>;
    processAudio(audio: Buffer): Promise<string>;
}

// Database Connector Module - LLMs cannot access databases directly
interface DatabaseModule {
    query(sql: string): Promise<any[]>;
    insert(table: string, data: any): Promise<void>;
    update(table: string, id: string, data: any): Promise<void>;
}
```

#### What Should NOT Be Modules (Core internal classes):
**These are essential components - removing them breaks Robota:**
- **AI Providers**: Essential for conversation (internal classes)
- **Tool Execution**: Core function calling logic (internal classes)
- **Message Processing**: Message conversion/processing (internal classes)
- **Session Management**: Session handling (internal classes)

### Key Distinction

#### One-Line Summary:
- **Plugin**: "What should we observe and enhance when the agent runs?" (cross-cutting concerns)
- **Module**: "What capabilities should the agent have?" (core abilities)

#### Decision Criteria:
1. **"Can Robota work normally without this feature?"**
   - **Yes** → Module or Plugin candidate
   - **No** → Internal core class (not Module/Plugin)

2. **"Does this add new optional capabilities?"**
   - **Yes** → **Module**
   - **No** → "Does it observe/enhance existing behavior?" → **Plugin**

3. **"Is this essential to Robota's main logic?"**
   - **Yes** → Internal class (AI Provider, Tool Execution, etc.)
   - **No** → Consider Module or Plugin

### Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    ROBOTA CORE (Required)                   │
│  AI Providers, Message Processing, Tool Execution,         │
│  Session Management, Conversation History                   │
└─────────────────────────────────────────────────────────────┘
           ↑ Without these, Robota cannot function

┌─────────────────── OPTIONAL MODULES ───────────────────────┐
│  RAG │ Speech │ Image Analysis │ File Processing │ DB      │
│      │        │               │                 │ Connector│
└─────────────────────────────────────────────────────────────┘
           ↑ Without these, Robota still works (basic conversation)

┌─────────────────── CROSS-CUTTING PLUGINS ──────────────────┐
│  Monitoring │ Logging │ Security │ Notification │ Analytics│
└─────────────────────────────────────────────────────────────┘
           ↑ Without these, Robota still works (additional features)
```

## Universal Message System

All AI providers in Robota use a standardized message format for consistency:

```typescript
interface UniversalMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: ToolCall[];
    metadata?: Record<string, unknown>;
}
```

This allows seamless switching between providers while maintaining conversation context.

## Provider System

### Multi-Provider Support

Robota supports multiple AI providers with a unified interface:

```typescript
// Configure multiple providers
const config = {
    aiProviders: {
        openai: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY }),
        anthropic: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
        google: new GoogleProvider({ apiKey: process.env.GOOGLE_AI_API_KEY })
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4'
};

// Switch providers dynamically
await agent.switchProvider('anthropic', 'claude-3-sonnet');
```

### Provider Abstraction

All providers implement the `BaseAIProvider` interface:

```typescript
abstract class BaseAIProvider {
    abstract chat(messages: UniversalMessage[]): Promise<UniversalMessage>;
    abstract chatStream(messages: UniversalMessage[]): AsyncIterable<UniversalMessage>;
}
```

## Tool System

### Function Tools

Create type-safe tools with automatic parameter validation:

```typescript
import { createFunctionTool } from '@robota-sdk/agents';

const weatherTool = createFunctionTool(
    'getWeather',
    'Get current weather for a location',
    {
        type: 'object',
        properties: {
            location: { type: 'string', description: 'City name' },
            unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }
        },
        required: ['location']
    },
    async (params) => {
        const { location, unit = 'celsius' } = params;
        // Implementation
        return { temperature: 22, unit, location };
    }
);
```

### Tool Registry

Tools are automatically registered and available to the AI:

```typescript
const agent = new Robota({
    // ... other config
    tools: [weatherTool, calculatorTool, searchTool]
});

// AI can now call these tools automatically
await agent.run('What\'s the weather like in Paris?');
```

## Configuration System

### Agent Configuration

```typescript
interface AgentConfig {
    name: string;
    model: string;
    provider: string;
    aiProviders: Record<string, BaseAIProvider>;
    currentProvider: string;
    currentModel: string;
    systemMessage?: string;
    tools?: BaseTool[];
    plugins?: BasePlugin[];
    modules?: BaseModule[];  // New: Module support
    maxTokens?: number;
    temperature?: number;
}
```

### Runtime Updates

Configuration can be updated at runtime:

```typescript
// Update system message
agent.updateConfig({ systemMessage: 'You are now a coding assistant.' });

// Add plugins dynamically
agent.addPlugin(new LoggingPlugin({ level: 'debug' }));

// Switch models
await agent.switchProvider('openai', 'gpt-4-turbo');
```

## Event System

### EventEmitter Integration

Robota uses EventEmitter for loose coupling between components:

```typescript
// Plugins can subscribe to module events
class LoggingPlugin extends BasePlugin {
    constructor(options) {
        super();
        this.moduleEvents = [
            'module.initialize.complete',
            'module.execution.complete'
        ];
    }
    
    async onModuleEvent(eventType: string, eventData: any): Promise<void> {
        console.log(`Module event: ${eventType}`, eventData);
    }
}
```

### Event Types

Standard events include:
- **Agent Events**: `agent.start`, `agent.stop`, `agent.error`
- **Execution Events**: `execution.start`, `execution.complete`, `execution.error`
- **Tool Events**: `tool.call`, `tool.complete`, `tool.error`
- **Module Events**: `module.initialize.start`, `module.execution.complete`

## Type Safety

### Generic Type Parameters

Robota maintains complete type safety throughout:

```typescript
// Type-safe agent configuration
interface MyAgentConfig extends AgentConfig {
    customOption: string;
}

// Type-safe plugin options
interface MyPluginOptions extends BasePluginOptions {
    setting: number;
}

class MyPlugin extends BasePlugin<MyPluginOptions, MyPluginStats> {
    // Fully typed implementation
}
```

### Runtime Validation

Type safety is enforced at runtime through:
- JSON Schema validation for tool parameters
- Configuration validation at startup
- Provider response validation

## Performance Considerations

### Lazy Loading

Components are loaded only when needed:

```typescript
// Modules are initialized only when first used
const ragModule = new RAGModule({
    vectorStore: 'pinecone',
    lazyInit: true  // Initialize on first use
});
```

### Streaming Support

Real-time response streaming for better user experience:

```typescript
// Stream responses for immediate feedback
for await (const chunk of agent.runStream('Tell me a story')) {
    process.stdout.write(chunk);
}
```

### Resource Management

Automatic cleanup and resource management:

```typescript
// Plugins and modules are properly disposed
await agent.dispose(); // Cleans up all resources
```

## Best Practices

### 1. Configuration Management

- Use environment variables for API keys
- Validate configuration at startup
- Provide sensible defaults

### 2. Error Handling

- Implement comprehensive error handling
- Use appropriate error types
- Provide meaningful error messages

### 3. Performance Optimization

- Use streaming for long responses
- Implement caching where appropriate
- Monitor resource usage

### 4. Type Safety

- Define clear interfaces
- Use generic type parameters
- Validate inputs at runtime

### 5. Modularity

- Keep plugins focused on single concerns
- Design modules for specific capabilities
- Maintain loose coupling between components

This architecture provides a solid foundation for building sophisticated AI agents while maintaining flexibility, type safety, and performance.

## Unified Architecture

Robota SDK v2.0 introduces a unified architecture centered around the `@robota-sdk/agents` package, which consolidates all core functionality into a single, cohesive system.

### Key Design Principles

1. **Type Safety First**: Zero `any` types, complete TypeScript safety
2. **Modular Design**: Plugin-based extensible architecture
3. **Provider Agnostic**: Seamless switching between AI providers
4. **Performance Focused**: Built-in analytics and monitoring
5. **Developer Experience**: Intuitive APIs with full IntelliSense

## Core Components

### 1. Agent System

The `Robota` class is the main entry point for creating AI agents:

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const agent = new Robota({
    name: 'MyAgent',                    // Agent identifier
    model: 'gpt-3.5-turbo',            // AI model
    provider: 'openai',                // Provider identifier
    aiProviders: {                     // Provider instances
        openai: new OpenAIProvider({ client: openaiClient })
    },
    currentProvider: 'openai',         // Active provider
    currentModel: 'gpt-3.5-turbo',    // Active model
    systemMessage: 'You are helpful.' // System prompt
});
```

### 2. BaseAgent Architecture

All agents inherit from `BaseAgent`, providing:

```typescript
// Core agent capabilities
export abstract class BaseAgent<TStats = AgentStats> {
    abstract run(input: string): Promise<string>;
    abstract stream(input: string): AsyncIterable<StreamChunk>;
    abstract getStats(): TStats;
    abstract destroy(): Promise<void>;
    
    // Plugin management
    protected plugins: BasePlugin[] = [];
    addPlugin(plugin: BasePlugin): void;
    getPlugin(name: string): BasePlugin | undefined;
}
```

### 3. Provider System

The `BaseAIProvider` creates a unified interface across all AI services:

```typescript
export abstract class BaseAIProvider {
    abstract generateResponse(
        messages: UniversalMessage[],
        options?: GenerationOptions
    ): Promise<string>;
    
    abstract generateStream(
        messages: UniversalMessage[],
        options?: GenerationOptions
    ): AsyncIterable<StreamChunk>;
    
    abstract getSupportedModels(): string[];
}
```

#### Supported Providers

- **OpenAI**: GPT-3.5, GPT-4, GPT-4o-mini
- **Anthropic**: Claude 3 (Haiku, Sonnet, Opus)
- **Google AI**: Gemini 1.5 (Flash, Pro)

### 4. Plugin System

Plugins extend agent functionality through a standardized interface:

```typescript
export abstract class BasePlugin<TStats = PluginStats> {
    abstract name: string;
    abstract onAgentStart?(): Promise<void>;
    abstract onAgentStop?(): Promise<void>;
    abstract getStats(): TStats;
}
```

#### Built-in Plugins

```typescript
import { 
    ExecutionAnalyticsPlugin,
    ConversationHistoryPlugin,
    LoggingPlugin,
    ErrorHandlingPlugin 
} from '@robota-sdk/agents';

const agent = new Robota({
    plugins: [
        new ExecutionAnalyticsPlugin({
            maxEntries: 1000,
            trackErrors: true
        }),
        new ConversationHistoryPlugin({
            maxMessages: 100
        }),
        new LoggingPlugin({
            level: 'info'
        })
    ]
    // ... other config
});
```

### 5. Tool System

Type-safe function calling with automatic schema conversion:

```typescript
import { createFunctionTool } from '@robota-sdk/agents';

// Create a tool with JSON Schema
const weatherTool = createFunctionTool(
    'getWeather',
    'Get current weather for a location',
    {
        type: 'object',
        properties: {
            location: {
                type: 'string',
                description: 'City name'
            },
            units: {
                type: 'string',
                enum: ['celsius', 'fahrenheit'],
                default: 'celsius'
            }
        },
        required: ['location']
    },
    async (params) => {
        // Tool implementation
        return { 
            temperature: 22,
            condition: 'sunny',
            location: params.location 
        };
    }
);

// Add to agent
const agent = new Robota({
    tools: [weatherTool],
    // ... other config
});
```

### 6. Message System

Universal message format for cross-provider compatibility:

```typescript
interface UniversalMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    toolCalls?: ToolCall[];
    toolCallId?: string;
}
```

## Team Collaboration

The Robota SDK supports intelligent multi-agent collaboration through the `@robota-sdk/team` package:

```typescript
import { createTeam } from '@robota-sdk/team';

// Create a team with AI providers
const team = createTeam({
    aiProviders: {
        openai: openaiProvider,
        anthropic: anthropicProvider,
        google: googleProvider
    },
    maxMembers: 5,
    maxTokenLimit: 50000,
    debug: true
});

// Team automatically analyzes tasks and delegates to specialist agents
const result = await team.execute(
    'Create a market analysis report for renewable energy including trends, competition, and investment opportunities'
);

console.log('Team result:', result);

// Get team performance statistics
const stats = team.getStats();
console.log(`Team created ${stats.totalAgentsCreated} specialist agents`);
console.log(`Total execution time: ${stats.totalExecutionTime}ms`);
```

### Team Features

- **Intelligent Task Analysis**: Team coordinator analyzes complexity and delegates appropriately
- **Template-Based Specialists**: Pre-configured expert agents (researcher, writer, analyst, etc.)
- **Cross-Provider Optimization**: Uses optimal AI providers for each task type
- **Automatic Delegation**: Complex tasks are broken down and distributed
- **Performance Tracking**: Built-in analytics for team performance monitoring

## Future: Advanced Planning System

The Robota SDK roadmap includes sophisticated planning strategies for autonomous agent systems:

```typescript
// Future roadmap - Advanced Planning System
import { createPlanner } from '@robota-sdk/planning';
import { 
    ReActPlanner,        // Reason + Act cycles
    CAMELPlanner,        // Multi-agent communication
    ReflectionPlanner,   // Self-improvement loops
    PlanExecutePlanner   // Hierarchical planning
} from '@robota-sdk/planner-strategies';

// This is planned for future releases
const planner = createPlanner({
    baseAgentConfig: {
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai'
    },
    maxAgents: 10,
    strategies: ['react', 'camel', 'reflection']
});

// Register planning strategies
planner.registerPlanner(new ReActPlanner());
planner.registerPlanner(new CAMELPlanner()); 
planner.registerPlanner(new ReflectionPlanner());

// Execute complex autonomous workflows
await planner.execute(
    'Build a complete e-commerce website with payment integration',
    ['camel', 'react', 'reflection'],
    'sequential'
);
```

### Planned Planning Strategies

| Strategy | Description | Use Case |
|----------|-------------|----------|
| **ReAct** | Reason + Act cycles | Tool-heavy, iterative tasks |
| **CAMEL** | Multi-agent communication | Complex collaborative projects |
| **Reflection** | Self-improvement loops | Quality assurance, error correction |
| **Plan-and-Execute** | Hierarchical planning | Large, structured projects |
| **AutoGPT Style** | Goal-driven autonomous loops | Long-term autonomous execution |

## Advanced Patterns

### Factory Pattern

Use `AgentFactory` for template-based agent creation:

```typescript
import { AgentFactory } from '@robota-sdk/agents';

const factory = new AgentFactory({
    providers: { openai: openaiProvider },
    defaultProvider: 'openai'
});

// Create from template
const assistant = await factory.createFromTemplate('helpful-assistant', {
    model: 'gpt-4',
    customizations: {
        personality: 'friendly and professional'
    }
});
```

### Multi-Provider Strategy

Implement provider-specific optimizations:

```typescript
class SmartAgent extends Robota {
    async run(input: string): Promise<string> {
        // Use different providers for different tasks
        if (this.isComplexReasoning(input)) {
            await this.switchProvider('openai', 'gpt-4');
        } else if (this.isCreativeTask(input)) {
            await this.switchProvider('anthropic', 'claude-3-sonnet');
        } else {
            await this.switchProvider('openai', 'gpt-3.5-turbo');
        }
        
        return super.run(input);
    }
}
```

### Streaming with Error Handling

Robust streaming implementation:

```typescript
async function processStreamWithErrorHandling(agent: Robota, input: string) {
    try {
        const stream = await agent.stream(input);
        let fullResponse = '';
        
        for await (const chunk of stream) {
            if (chunk.error) {
                console.error('Stream error:', chunk.error);
                break;
            }
            
            if (chunk.content) {
                process.stdout.write(chunk.content);
                fullResponse += chunk.content;
            }
        }
        
        return fullResponse;
    } catch (error) {
        console.error('Streaming failed:', error);
        throw error;
    }
}
```

## Configuration Patterns

### Environment-Based Configuration

```typescript
interface AgentConfig {
    name: string;
    model: string;
    provider: string;
    systemMessage?: string;
    tools?: Tool[];
    plugins?: BasePlugin[];
}

function createProductionAgent(): Robota {
    const config: AgentConfig = {
        name: process.env.AGENT_NAME || 'DefaultAgent',
        model: process.env.AI_MODEL || 'gpt-3.5-turbo',
        provider: process.env.AI_PROVIDER || 'openai',
        systemMessage: process.env.SYSTEM_MESSAGE
    };
    
    return new Robota({
        ...config,
        aiProviders: getProviders(),
        plugins: getProductionPlugins()
    });
}
```

### Plugin Configuration

```typescript
function getProductionPlugins(): BasePlugin[] {
    return [
        new ExecutionAnalyticsPlugin({
            maxEntries: 10000,
            trackErrors: true,
            performanceThreshold: 5000
        }),
        new LoggingPlugin({
            level: process.env.LOG_LEVEL || 'info',
            destination: 'file'
        }),
        new ErrorHandlingPlugin({
            retryAttempts: 3,
            retryDelay: 1000
        })
    ];
}
```

## Performance Considerations

### Resource Management

```typescript
// Always clean up resources
async function processWithCleanup(agent: Robota, input: string) {
    try {
        return await agent.run(input);
    } finally {
        await agent.destroy(); // Clean up resources
    }
}
```

### Monitoring and Analytics

```typescript
// Get comprehensive performance metrics
const stats = agent.getStats();
console.log(`Uptime: ${stats.uptime}ms`);
console.log(`Messages: ${stats.historyLength}`);

// Plugin-specific analytics
const analyticsPlugin = agent.getPlugin('ExecutionAnalyticsPlugin');
if (analyticsPlugin && 'getAggregatedStats' in analyticsPlugin) {
    const analytics = (analyticsPlugin as any).getAggregatedStats();
    console.log(`Success rate: ${(analytics.successRate * 100).toFixed(1)}%`);
    console.log(`Avg duration: ${analytics.averageDuration.toFixed(0)}ms`);
}
```

## Type Safety Features

### Generic Type Parameters

```typescript
// Custom agent with specialized stats
interface CustomAgentStats extends AgentStats {
    customMetric: number;
}

class CustomAgent extends BaseAgent<CustomAgentStats> {
    getStats(): CustomAgentStats {
        return {
            ...super.getStats(),
            customMetric: this.calculateCustomMetric()
        };
    }
}
```

### Strict Type Checking

```typescript
// No 'any' types allowed - everything is strictly typed
const agent = new Robota({
    name: 'TypeSafeAgent',
    model: 'gpt-3.5-turbo', // Autocomplete available
    provider: 'openai',     // Type-checked against available providers
    // TypeScript will catch any configuration errors
});
```

## Next Steps

- **[Function Calling](./function-calling.md)** - Learn about tool integration
- **[Building Agents](./building-agents.md)** - Advanced agent patterns
- **[Examples](../examples/README.md)** - See these concepts in action 