# Examples

Learn Robota SDK through practical examples that demonstrate key features and usage patterns.

## Quick Start Examples

### Basic Usage
```typescript
// Simple conversation
import { Robota, OpenAIProvider } from '@robota-sdk/core';

const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4'
});

const response = await robota.run('Hello!');
```

### With Function Calling
```typescript
// AI agent with tools
import { ZodTool } from '@robota-sdk/tools';
import { z } from 'zod';

const weatherTool = new ZodTool({
    name: 'get_weather',
    description: 'Get current weather',
    schema: z.object({
        location: z.string().describe('City name')
    }),
    execute: async ({ location }) => {
        return `Weather in ${location}: 72°F, sunny`;
    }
});

robota.addTool(weatherTool);
const response = await robota.run('What\'s the weather in Tokyo?');
```

## Example Categories

### 📚 [Basic Examples](./examples.md#basic-examples)
- Simple conversations and streaming
- Multi-provider setup (OpenAI, Anthropic, Google)
- Provider switching and model selection
- Conversation history management

### 🔧 [Function Calling](./examples.md#function-calling)
- Zod-based tools with type safety
- Custom tool providers
- External API integrations
- Complex tool workflows

### 🚀 [Advanced Patterns](./examples.md#advanced-examples)
- MCP (Model Context Protocol) integration
- Analytics and monitoring
- Custom providers and adapters

## Running Examples

All examples are in the `apps/examples` directory:

```bash
# Navigate to examples
cd apps/examples

# Run with bun (recommended)
bun run 01-basic/01-simple-conversation.ts

# Or with pnpm + tsx
pnpm tsx 01-basic/02-ai-with-tools.ts
```

## Next Steps

- Browse [Complete Examples](./examples.md) for detailed code samples
- Learn about [Function Calling](../guide/function-calling.md) for tool integration
- Explore [AI Providers](../providers/) for multi-provider setup
