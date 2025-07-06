---
title: Getting Started
description: Getting started with Robota
lang: en-US
---

# Getting Started

Learn how to build powerful AI agents with the Robota SDK.

## 🎯 What You'll Achieve

In just **5 minutes**, you'll have:
- ✅ A fully functional AI agent with streaming responses
- ✅ Type-safe tool integration with automatic parameter validation
- ✅ Multi-provider support with seamless switching
- ✅ Built-in performance monitoring and analytics

## Quick Start

### Installation

Install the unified agents package with your preferred AI provider:

```bash
# Core agents package (includes everything you need)
npm install @robota-sdk/agents

# AI Providers (choose one or more)
npm install @robota-sdk/openai openai
npm install @robota-sdk/anthropic @anthropic-ai/sdk
npm install @robota-sdk/google @google/generative-ai

# Optional: Additional packages
npm install @robota-sdk/team    # For multi-agent collaboration
npm install dotenv              # For environment variables
```

### Environment Setup

Create a `.env` file in your project root:

```env
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key  # Optional
GOOGLE_AI_API_KEY=your_google_api_key     # Optional
```

### Your First Agent

Create a simple AI agent in under 5 minutes:

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    // Create OpenAI provider
    const openaiProvider = new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY!
    });

    // Create your first agent
    const agent = new Robota({
        name: 'MyFirstAgent',
        aiProviders: [openaiProvider],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            systemMessage: 'You are a helpful AI assistant.'
        }
    });

    // Have a conversation
    const response = await agent.run('Hello! Tell me about TypeScript.');
    console.log('Agent:', response);

    // Clean up
    await agent.destroy();
}

main().catch(console.error);
```

## 🌟 Key Advantages

### ✅ Type-Safe Architecture
**Why It Matters**: Catch bugs at compile-time, not in production
- **Zero `any` types**: Complete TypeScript safety
- **Generic type system**: Fully parameterized components
- **Compile-time validation**: Catch errors before runtime
- **IntelliSense everywhere**: Your IDE knows everything

### 🔌 Multi-Provider Support
**Why It Matters**: Never get locked into one AI vendor
- **OpenAI**: GPT-3.5, GPT-4, GPT-4o-mini models
- **Anthropic**: Claude 3 family (Haiku, Sonnet, Opus)
- **Google AI**: Gemini 1.5 (Flash, Pro) models
- **Provider switching**: Change providers with one line of code

### 🛠️ Advanced Tool System
**Why It Matters**: Extend AI capabilities beyond conversation
- **Function calling**: Type-safe tool integration
- **Automatic schema conversion**: JSON Schema → Function calls
- **Built-in error handling**: Robust tool execution
- **Real-world integrations**: Databases, APIs, file systems

### 🌊 Real-Time Streaming
**Why It Matters**: Better user experience with instant feedback
- **Streaming responses**: See AI thinking in real-time
- **Cross-provider**: Works with all supported providers
- **Performance monitoring**: Built-in metrics
- **Token-by-token control**: Fine-grained response handling

### 📊 Built-in Analytics
**Why It Matters**: Optimize costs and performance
- **Execution tracking**: Monitor agent performance
- **Usage analytics**: Track token usage and costs
- **Error monitoring**: Comprehensive error tracking
- **Performance insights**: Identify bottlenecks

### 👥 Team Collaboration
**Why It Matters**: Solve complex problems with AI teamwork
- **Multi-agent coordination**: Orchestrate multiple agents working together
- **Role-based assignment**: Assign specific roles to different agents
- **Task delegation**: Automatically distribute work across team members
- **Collective intelligence**: Combine strengths of different AI models

### 🗓️ Future-Proof Architecture
**Why It Matters**: Your code grows with the SDK
- **Advanced Planning System**: Sophisticated planning strategies (ReAct, Plan-and-Execute, Reflection, CAMEL)
- **Hierarchical Task Networks**: Complex workflow management
- **Autonomous Agent Systems**: Self-directed agent behaviors
- **Plugin ecosystem**: Extend with community plugins

## Key Features

### ✅ Type-Safe Architecture
- **Zero `any` types**: Complete TypeScript safety
- **Generic type system**: Fully parameterized components
- **Compile-time validation**: Catch errors before runtime

### 🔌 Multi-Provider Support
- **OpenAI**: GPT-3.5, GPT-4, GPT-4o-mini models
- **Anthropic**: Claude 3 family (Haiku, Sonnet, Opus)
- **Google AI**: Gemini 1.5 (Flash, Pro) models
- **Provider switching**: Dynamic provider changes

### 🛠️ Advanced Tool System
- **Function calling**: Type-safe tool integration
- **Automatic schema conversion**: JSON Schema → Function calls
- **Built-in error handling**: Robust tool execution

### 🌊 Real-Time Streaming
- **Streaming responses**: Real-time AI responses
- **Cross-provider**: Works with all supported providers
- **Performance monitoring**: Built-in metrics

### 📊 Built-in Analytics
- **Execution tracking**: Monitor agent performance
- **Usage analytics**: Track token usage and costs
- **Error monitoring**: Comprehensive error tracking

### 👥 Team Collaboration
- **Multi-agent coordination**: Orchestrate multiple agents working together
- **Role-based assignment**: Assign specific roles to different agents
- **Task delegation**: Automatically distribute work across team members
- **Collective intelligence**: Combine strengths of different AI models

### 🗓️ Future Roadmap
- **Advanced Planning System**: Sophisticated planning strategies (ReAct, Plan-and-Execute, Reflection, CAMEL)
- **Hierarchical Task Networks**: Complex workflow management
- **Autonomous Agent Systems**: Self-directed agent behaviors

## Basic Examples

### Streaming Responses

Get real-time responses as they're generated:

```typescript
const agent = new Robota({
    name: 'StreamingAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful assistant.'
    }
});

// Stream the response
const stream = await agent.runStream('Explain quantum computing in simple terms.');

for await (const chunk of stream) {
    process.stdout.write(chunk);
}
```

### Multiple Providers

Use different AI providers for different tasks:

```typescript
import { AnthropicProvider } from '@robota-sdk/anthropic';

// Create multiple providers
const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! });
const anthropicProvider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });

// Agent with multiple providers
const agent = new Robota({
    name: 'MultiProviderAgent',
    aiProviders: [openaiProvider, anthropicProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful assistant.'
    }
});

// Use OpenAI
const openaiResponse = await agent.run('Quick summary please.');

// Switch to Anthropic for detailed analysis
agent.setModel({
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307'
});
const claudeResponse = await agent.run('Detailed analysis please.');
```

### Function Calling (Tools)

Add custom tools to your agent:

```typescript
import { createFunctionTool } from '@robota-sdk/agents';

// Create a calculator tool
const calculatorTool = createFunctionTool(
    'calculate',
    'Performs mathematical calculations',
    {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['add', 'subtract', 'multiply', 'divide'],
                description: 'Mathematical operation'
            },
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' }
        },
        required: ['operation', 'a', 'b']
    },
    async (params) => {
        const { operation, a, b } = params;
        
        switch (operation) {
            case 'add': return { result: a + b };
            case 'subtract': return { result: a - b };
            case 'multiply': return { result: a * b };
            case 'divide': return { result: b !== 0 ? a / b : 'Error: Division by zero' };
            default: return { error: 'Unknown operation' };
        }
    }
);

// Agent with tools
const agent = new Robota({
    name: 'CalculatorAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful assistant with calculation abilities.'
    },
    tools: [calculatorTool]
});

// Agent will automatically use the calculator tool
const response = await agent.run('What is 25 * 7?');
```

### Team Collaboration

Create a team that intelligently delegates complex tasks:

```typescript
import { createTeam } from '@robota-sdk/team';

// Create a team with AI providers
const team = await createTeam({
    aiProviders: [openaiProvider, anthropicProvider],
    maxMembers: 5,
    debug: true
});

// Team automatically breaks down complex tasks and assigns to specialists
const result = await team.execute(
    'Create a comprehensive blog post about quantum computing for beginners'
);

console.log('Team result:', result);
```

### Performance Monitoring

Monitor your agent's performance:

```typescript
import { ExecutionAnalyticsPlugin } from '@robota-sdk/agents';

// Create analytics plugin
const analyticsPlugin = new ExecutionAnalyticsPlugin({
    maxEntries: 1000,
    trackErrors: true,
    performanceThreshold: 2000
});

// Agent with analytics
const agent = new Robota({
    name: 'MonitoredAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful assistant.'
    },
    plugins: [analyticsPlugin]
});

// Use the agent
await agent.run('Hello!');
await agent.run('Tell me about AI.');

// Get performance stats
const stats = agent.getStats();
console.log(`Total interactions: ${stats.historyLength / 2}`);
console.log(`Uptime: ${Math.round(stats.uptime)}ms`);

// Get detailed analytics
const plugin = agent.getPlugin('ExecutionAnalyticsPlugin');
if (plugin && 'getAggregatedStats' in plugin) {
    const analytics = (plugin as any).getAggregatedStats();
    console.log(`Success rate: ${(analytics.successRate * 100).toFixed(1)}%`);
    console.log(`Average duration: ${analytics.averageDuration.toFixed(0)}ms`);
}
```

## Next Steps

Now that you have a basic agent running, explore these advanced features:

1. **[Core Concepts](../guide/core-concepts.md)** - Understand the architecture
2. **[Function Calling](../guide/function-calling.md)** - Add custom tools and capabilities
3. **[Building Agents](../guide/building-agents.md)** - Advanced patterns and best practices
4. **[Team Collaboration](../examples/team-collaboration.md)** - Multi-agent coordination
5. **[Examples](../examples/README.md)** - Real-world usage examples

## Need Help?

- **[Examples](../examples/README.md)** - Complete working examples
- **[API Reference](../api-reference/README.md)** - Detailed API documentation
- **[Development Guide](../development/README.md)** - Contributing and development setup

## Migration from v1

If you're upgrading from Robota SDK v1, see our [migration guide](../development/code-improvements.md) for breaking changes and upgrade steps. 