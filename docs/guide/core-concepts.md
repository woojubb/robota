---
title: Core Concepts
description: Core concepts of the Robota library
lang: en-US
---

# Core Concepts

Understanding the architecture and design patterns of the Robota SDK.

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