---
title: Guide
description: Robota SDK Documentation Guide
lang: en-US
---

# Robota SDK Guide

Comprehensive guide to building AI agents with the Robota SDK.

## What is Robota SDK?

Robota SDK is a TypeScript-first library for building sophisticated AI agents with:

- **🔥 Unified Architecture**: Everything you need in `@robota-sdk/agents`
- **⚡ Type-Safe**: Zero `any` types, complete TypeScript safety
- **🔌 Multi-Provider**: OpenAI, Anthropic, Google AI with seamless switching
- **🛠️ Advanced Tools**: Type-safe function calling and tool integration
- **📊 Built-in Analytics**: Performance monitoring and usage tracking
- **🌊 Real-time Streaming**: Streaming responses across all providers
- **🤝 Team Collaboration**: Multi-agent workflows and task assignment
- **🧠 Future Planning**: Advanced planning strategies on the roadmap

## Architecture Overview

The Robota SDK v2.0 is built around a unified agents package that includes:

```
@robota-sdk/agents (Core Package)
├── 🤖 BaseAgent           # Foundation for all agents
├── 🔌 BaseAIProvider      # Multi-provider abstraction
├── 🛠️ BaseTool            # Tool system foundation
├── 📊 Plugin System       # Extensible plugin architecture
├── 🏭 AgentFactory        # Agent creation and templates
├── 📈 Analytics           # Performance and usage tracking
└── 🔧 Utilities           # Type-safe utilities
```

## Learning Path

### 1. 🚀 Getting Started
**Perfect for**: First-time users, quick prototypes

Start here to create your first AI agent and understand basic concepts.

- **[Getting Started](../getting-started/README.md)** - Installation, setup, and first agent
- **[Basic Examples](../examples/basic-conversation.md)** - Simple conversation patterns

### 2. 🧠 Core Concepts
**Perfect for**: Understanding the architecture, building robust applications

Learn the fundamental concepts and architecture patterns.

- **[Core Concepts](./core-concepts.md)** - Architecture and design patterns
- **[Building Agents](./building-agents.md)** - Agent development best practices

### 3. 🛠️ Advanced Features
**Perfect for**: Complex applications, production deployments

Master advanced features like tools, streaming, and analytics.

- **[Function Calling](./function-calling.md)** - Tool integration and custom functions
- **[Multi-Provider](../examples/multi-provider.md)** - Provider switching and management
- **[Team Collaboration](../examples/team-collaboration.md)** - Multi-agent workflows

### 4. 🏗️ Production Ready
**Perfect for**: Production deployments, enterprise applications

Learn about monitoring, error handling, and deployment strategies.

- **[Performance Monitoring](../examples/execution-analytics.md)** - Analytics and monitoring
- **[Error Handling](../development/error-handling-guidelines.md)** - Robust error handling
- **[Development Guidelines](../development/README.md)** - Best practices and standards

## Key Features Deep Dive

### Type-Safe Architecture
```typescript
// Zero 'any' types - complete TypeScript safety
const agent = new Robota({
    name: 'TypeSafeAgent',
    model: 'gpt-3.5-turbo',
    provider: 'openai',
    // Full IntelliSense and compile-time validation
    systemMessage: 'You are a helpful assistant.'
});
```

### Multi-Provider Support
```typescript
// Switch between providers seamlessly
await agent.switchProvider('anthropic', 'claude-3-haiku-20240307');
await agent.switchProvider('openai', 'gpt-4');
await agent.switchProvider('google', 'gemini-1.5-flash');
```

### Advanced Plugin System
```typescript
// Extensible plugin architecture
const agent = new Robota({
    plugins: [
        new ExecutionAnalyticsPlugin(),
        new ConversationHistoryPlugin(),
        new LoggingPlugin()
    ]
    // ... other config
});
```

### Real-time Streaming
```typescript
// Streaming responses with full type safety
const stream = await agent.stream('Explain quantum computing');
for await (const chunk of stream) {
    console.log(chunk.content); // Type-safe content access
}
```

## Quick Reference

### Essential Classes
- **`Robota`** - Main agent class
- **`AgentFactory`** - Create agents from templates
- **`ExecutionAnalyticsPlugin`** - Performance monitoring
- **`ConversationHistoryPlugin`** - Conversation management

### AI Providers
- **`OpenAIProvider`** - GPT models (3.5, 4, 4o-mini)
- **`AnthropicProvider`** - Claude models (Haiku, Sonnet, Opus)
- **`GoogleProvider`** - Gemini models (1.5 Flash, Pro)

### Tool System
- **`createFunctionTool`** - Create type-safe tools
- **`ToolRegistry`** - Manage and organize tools
- **`MCP Integration`** - Model Context Protocol support

## Examples by Use Case

### 🤖 Simple AI Assistant
```typescript
const assistant = new Robota({
    name: 'Assistant',
    model: 'gpt-3.5-turbo',
    provider: 'openai',
    systemMessage: 'You are a helpful assistant.'
});
```

### 🔧 AI with Tools
```typescript
const toolAgent = new Robota({
    name: 'ToolAgent',
    tools: [calculatorTool, weatherTool],
    systemMessage: 'You have access to calculation and weather tools.'
});
```

### 📊 Monitored AI Agent
```typescript
const monitoredAgent = new Robota({
    name: 'MonitoredAgent',
    plugins: [new ExecutionAnalyticsPlugin()],
    systemMessage: 'You are monitored for performance.'
});
```

### 🤝 Team of Agents
```typescript
import { createTeam } from '@robota-sdk/team';

const team = createTeam({
    aiProviders: {
        openai: openaiProvider,
        anthropic: anthropicProvider
    },
    maxMembers: 5,
    debug: true
});

// Team intelligently delegates to specialist agents
const result = await team.execute(
    'Research and write about renewable energy trends'
);
```

### 🧠 Future: Advanced Planning
Coming soon - sophisticated planning strategies for complex autonomous workflows:

```typescript
// Future roadmap - Advanced Planning System
import { createPlanner } from '@robota-sdk/planning';
import { ReActPlanner, CAMELPlanner } from '@robota-sdk/planner-strategies';

// This is planned for future releases
const planner = createPlanner({
    strategies: [new ReActPlanner(), new CAMELPlanner()],
    executionMode: 'adaptive'
});

await planner.execute('Build a complete web application');
```

## Best Practices

### ✅ Do
- Use TypeScript for full type safety
- Implement proper error handling with try/catch
- Monitor performance with analytics plugins
- Clean up resources with `agent.destroy()`
- Use specific models for specific tasks

### ❌ Don't
- Ignore TypeScript errors or use `any` types
- Forget to handle API rate limits
- Skip error handling in production
- Leave agents running without cleanup
- Use overpowered models for simple tasks

## Migration Guide

### From v1.x to v2.0
The major changes in v2.0:

1. **Unified Package**: Everything moved to `@robota-sdk/agents`
2. **API Changes**: `systemPrompt` → `systemMessage`, `close()` → `destroy()`
3. **Type Safety**: Complete removal of `any` types
4. **Plugin System**: New extensible architecture

See [Migration Guide](../development/code-improvements.md) for detailed upgrade steps.

## Next Steps

Ready to build your first agent? Start with:

1. **[Getting Started](../getting-started/README.md)** - Set up your development environment
2. **[Basic Examples](../examples/README.md)** - Follow along with working code
3. **[API Reference](../api-reference/README.md)** - Explore the complete API

Need help? Check out our **[Development Guide](../development/README.md)** for contributing and advanced development topics.

## Documentation Sections

- **[Getting Started](../getting-started/README.md)** - Quick setup and basic usage
- **[Core Concepts](./core-concepts.md)** - Understanding the Manager pattern architecture
- **[Function Calling](./function-calling.md)** - Tool integration and function calling
- **[Building Agents](./building-agents.md)** - Advanced agent development patterns

## Quick Navigation

Use the navigation on the left to explore the complete documentation or jump straight to:
- [Getting Started](../getting-started/README.md) - Begin with basic setup
- [Architecture Overview](../development/development-guidelines.md#architecture-patterns) - Understand the Manager pattern
- [Examples](../examples/README.md) - See real-world usage patterns 