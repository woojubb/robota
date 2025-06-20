# Robota Examples

This directory contains comprehensive examples demonstrating how to use the Robota SDK for building AI-powered applications. All examples have been simplified and modernized to showcase the latest architecture improvements.

## Quick Start

All examples are located in [`apps/examples/`](../../apps/examples/) and can be run directly:

```bash
# Navigate to examples directory
cd apps/examples

# Install dependencies
npm install

# Create environment file
cp .env.example .env
# Add your API keys to .env

# Run any example
npx tsx 01-basic-conversation.ts
```

## Core Examples

### 1. [Basic Conversation](./basic-conversation.md)
**File**: `01-basic-conversation.ts`

Learn the fundamentals of Robota:
- Setting up OpenAI provider with the new `BaseAIProvider` architecture
- Simple message exchange and streaming responses
- Proper resource cleanup with `robota.close()`
- Error handling and environment setup

```typescript
// Basic setup with modern provider architecture
const openaiProvider = new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-3.5-turbo'
});

const robota = new Robota({
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    systemPrompt: 'You are a helpful AI assistant.'
});
```

### 2. [Tool Calling](./ai-with-tools.md)
**File**: `02-tool-calling.ts`

Explore advanced tool calling capabilities:
- Define tools using Zod schemas for type safety
- Automatic tool calling by AI agents
- Modern `toolCalls` format (no legacy `functionCall`)
- Complex multi-tool interactions
- Error handling in tool execution

```typescript
// Tool definition with Zod
const tools = {
    calculate: {
        name: 'calculate',
        description: 'Performs mathematical calculations',
        parameters: z.object({
            operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
            a: z.number(),
            b: z.number()
        }),
        handler: async (params) => {
            // Tool implementation
        }
    }
};
```

### 3. [Multi-Provider](./multi-provider.md)
**File**: `03-multi-providers.ts`

Master multi-provider configurations:
- Use OpenAI, Anthropic, and Google AI providers
- Unified `BaseAIProvider` architecture ensures consistency
- Same tool calling interface across all providers
- Dynamic provider switching
- Provider-specific optimizations

```typescript
// All providers extend BaseAIProvider
const providers = {
    openai: new OpenAIProvider({ client, model: 'gpt-3.5-turbo' }),
    anthropic: new AnthropicProvider({ client, model: 'claude-3-sonnet' }),
    google: new GoogleProvider({ client, model: 'gemini-pro' })
};
```

### 4. [Advanced Features](./session-management.md)
**File**: `04-advanced-features.ts`

Explore advanced Robota capabilities:
- Analytics and usage tracking
- Request and token limits
- Conversation history management
- Streaming responses with tool calling
- Custom system messages and callbacks
- Performance monitoring

```typescript
// Advanced configuration
const robota = new Robota({
    aiProviders: { openai: openaiProvider },
    toolProviders: [toolProvider],
    temperature: 0.7,
    maxTokens: 1000,
    maxTokenLimit: 5000,
    maxRequestLimit: 10,
    debug: true,
    onToolCall: (toolName, params, result) => {
        console.log(`Tool ${toolName} called with:`, params);
    }
});
```

### 5. [Multi-Agent Team Collaboration](./team-collaboration.md)
**File**: `05-team-collaboration-ko.ts`

Master intelligent multi-agent teamwork:
- Team coordinator that delegates specialized tasks
- Dynamic expert agent creation for complex workflows
- Collaborative problem-solving for multi-faceted requests
- Automatic result synthesis and resource cleanup
- Performance monitoring and statistics tracking

```typescript
// Create intelligent team
const team = createTeam({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  }),
  maxTokenLimit: 50000,
  logger: console
});

// Team automatically delegates complex requests
const response = await team.execute(`
  Create a comprehensive business plan including:
  1) Market analysis with competitor research
  2) Financial projections for first year
  3) Marketing strategy and brand positioning
`);
```

## Environment Setup

Create a `.env` file in the examples directory:

```bash
# Required for basic examples
OPENAI_API_KEY=your_openai_api_key_here

# Optional - for multi-provider examples
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
```

## Architecture Highlights

### Modern Provider System

All AI providers now extend `BaseAIProvider`, providing:
- Consistent tool calling interface across providers
- Unified message format conversion
- Standardized error handling
- Automatic resource cleanup

### Tool Calling Evolution

The examples showcase the modern tool calling system:
- **Modern**: `toolCalls` with proper `toolCallId` tracking
- **Type Safe**: Zod schemas for parameter validation
- **Universal**: Same interface works with OpenAI, Anthropic, and Google AI

### Resource Management

All examples demonstrate proper resource cleanup:
```typescript
// Always clean up resources
await robota.close();
process.exit(0);
```

## Running Examples

### Individual Examples
```bash
# Basic conversation
npx tsx 01-basic-conversation.ts

# Tool calling
npx tsx 02-tool-calling.ts

# Multi-provider
npx tsx 03-multi-providers.ts

# Advanced features
npx tsx 04-advanced-features.ts
```

### All Examples
```bash
# Run all examples in sequence
npm run examples

# Team collaboration example
npx tsx 05-team-collaboration-ko.ts
```

## Example Features

| Feature | Basic | Tools | Multi-Provider | Advanced | Team |
|---------|-------|-------|----------------|----------|------|
| Simple Chat | ✅ | ✅ | ✅ | ✅ | ✅ |
| Streaming | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tool Calling | ❌ | ✅ | ✅ | ✅ | ✅ |
| Multiple Providers | ❌ | ❌ | ✅ | ✅ | ✅ |
| Analytics | ❌ | ❌ | ❌ | ✅ | ✅ |
| Rate Limiting | ❌ | ❌ | ❌ | ✅ | ✅ |
| Multi-Agent Coordination | ❌ | ❌ | ❌ | ❌ | ✅ |
| Task Delegation | ❌ | ❌ | ❌ | ❌ | ✅ |
| Expert Agent Creation | ❌ | ❌ | ❌ | ❌ | ✅ |
| Error Handling | ✅ | ✅ | ✅ | ✅ | ✅ |
| Resource Cleanup | ✅ | ✅ | ✅ | ✅ | ✅ |

## Legacy Examples Removed

The following legacy examples have been removed in favor of the simplified structure:

- ❌ `01-basic/` - Consolidated into single files
- ❌ `02-functions/` - Merged into tool calling example
- ❌ `03-advanced/` - Integrated into advanced features
- ❌ Multiple provider-specific directories
- ❌ Redundant setup and configuration examples

## Best Practices Demonstrated

### 1. Environment Management
```typescript
// Always validate environment variables
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
}
```

### 2. Error Handling
```typescript
try {
    const response = await robota.run(query);
    console.log(response);
} catch (error) {
    console.error('❌ Error occurred:', error);
    process.exit(1);
}
```

### 3. Resource Cleanup
```typescript
// Clean up resources to prevent memory leaks
await robota.close();
```

### 4. Tool Design
```typescript
// Use descriptive names and clear parameter validation
const tools = {
    toolName: {
        name: 'toolName',
        description: 'Clear description of what the tool does',
        parameters: z.object({
            param: z.string().describe('Clear parameter description')
        }),
        handler: async (params) => {
            // Robust error handling in tools
            try {
                return { success: true, result: /* result */ };
            } catch (error) {
                return { success: false, error: error.message };
            }
        }
    }
};
```

## Next Steps

After exploring these examples:

1. **Read the [Core Concepts](../guide/core-concepts.md)** for deeper understanding
2. **Explore [API Reference](../api-reference/)** for detailed documentation
3. **Check out [Protocols](../protocols/)** for advanced integrations
4. **Visit [Building Agents](../guide/building-agents.md)** for production patterns

## Troubleshooting

### Common Issues

1. **Missing API Keys**: Ensure all required environment variables are set
2. **Module Import Errors**: Run `npm install` in the examples directory
3. **TypeScript Errors**: Ensure you're using Node.js 18+ with TypeScript support
4. **Rate Limits**: Some examples may hit API rate limits with free tier accounts

### Getting Help

- Check the [troubleshooting guide](../development/README.md)
- Review [API documentation](../api-reference/README.md)
- Look at [development guidelines](../development/development-guidelines.md) 