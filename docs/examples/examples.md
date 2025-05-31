# Robota SDK Examples

This document provides comprehensive examples demonstrating how to use the Robota SDK effectively. All examples are located in the `apps/examples` directory and showcase real-world usage patterns.

## Prerequisites

Before running the examples, ensure you have:

1. **Dependencies installed**:
```bash
pnpm install
```

2. **Environment variables configured**:
Create a `.env` file in the project root:
```env
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here    # Optional
GOOGLE_API_KEY=your_google_api_key_here          # Optional
```

## Running Examples

All examples are located in the `apps/examples` directory. You can run them in two ways:

### Method 1: Direct File Execution (Recommended)

Navigate to the examples directory and run TypeScript files directly:

```bash
# Navigate to examples directory
cd apps/examples

# Run examples directly with bun (fastest)
bun run 01-basic/01-simple-conversation.ts
bun run 01-basic/02-ai-with-tools.ts
bun run 01-basic/03-multi-ai-providers.ts

# Or with pnpm + tsx
pnpm tsx 01-basic/01-simple-conversation.ts
pnpm tsx 02-functions/01-zod-function-tools.ts
```

### Method 2: Using Package Scripts

The examples package provides convenient npm scripts for common workflows:

```bash
# Navigate to examples directory
cd apps/examples

# Run individual examples
pnpm start:simple-conversation
pnpm start:using-ai-client
pnpm start:multi-ai-providers
pnpm start:provider-switching
pnpm start:zod-function-provider
pnpm start:using-tool-providers

# Run example groups
pnpm start:all-basic          # All basic examples
pnpm start:all-tool-providers # All tool provider examples
pnpm start:all-examples       # All examples sequentially
pnpm start:all                # Quick demo (selected examples)
```

> **Note**: All example commands should be run from the `apps/examples` directory, not from the project root.

## Example Categories

### 1. Basic Examples (`01-basic/`)

#### `01-simple-conversation.ts`
Demonstrates the fundamental usage of Robota SDK:
- Setting up OpenAI client and provider
- Basic conversation with `run()` method
- Streaming responses with `runStream()` method

**Key Features:**
```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';

// Create OpenAI client
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Create provider
const openaiProvider = new OpenAIProvider(openaiClient);

// Initialize Robota
const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    systemPrompt: 'You are a helpful AI assistant.'
});

// Simple conversation
const response = await robota.run('Hello! Tell me about TypeScript.');

// Streaming response
const stream = await robota.runStream('Explain TypeScript advantages briefly.');
for await (const chunk of stream) {
    process.stdout.write(chunk.content || '');
}
```

#### `02-ai-with-tools.ts`
Shows how to integrate AI with function tools:
- Creating Zod-based function tools
- Tool provider setup with `createZodFunctionToolProvider`
- AI automatically calling tools when needed
- Custom logging and debug modes

**Key Features:**
```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

// Define calculator tool
const calculatorTool = {
    name: 'calculate',
    description: 'Performs mathematical calculations',
    parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number().describe('First number'),
        b: z.number().describe('Second number')
    }),
    handler: async (params) => {
        const { operation, a, b } = params;
        switch (operation) {
            case 'add': return { result: a + b };
            case 'subtract': return { result: a - b };
            case 'multiply': return { result: a * b };
            case 'divide': return b !== 0 ? { result: a / b } : { error: 'Cannot divide by zero' };
        }
    }
};

// Create tool provider
const toolProvider = createZodFunctionToolProvider({
    tools: { calculate: calculatorTool }
});

// Initialize Robota with tools
const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    toolProviders: [toolProvider],
    debug: true  // Enable tool call logging
});
```

#### `03-multi-ai-providers.ts`
Demonstrates working with multiple AI providers:
- Registering multiple providers (OpenAI, Anthropic, Google)
- Switching between providers dynamically
- Using different models within the same provider
- Runtime provider addition

**Key Features:**
```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';

// Setup multiple providers
const robota = new Robota({
    aiProviders: {
        'openai': openaiProvider,
        'anthropic': anthropicProvider,
        'google': googleProvider
    },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo'
});

// Switch providers dynamically
robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');
robota.setCurrentAI('google', 'gemini-1.5-pro');

// Add new provider at runtime
const anotherProvider = new OpenAIProvider(openaiClient);
robota.addAIProvider('openai-alternative', anotherProvider);
```

#### `04-provider-switching.ts`
Advanced provider switching with multiple AI services:
- Comprehensive multi-provider setup (OpenAI, Anthropic, Google)
- Comparing responses across different providers
- Testing conversation history persistence across provider switches
- Streaming responses with different providers
- Performance comparison between providers

**Key Features:**
- **Provider Comparison**: Ask the same question to different AI providers
- **History Continuity**: Verify conversation history is maintained when switching providers
- **Performance Testing**: Measure response times across providers
- **Graceful Fallbacks**: Handle missing API keys gracefully

#### `04-provider-switching-simple.ts`
Simplified version focusing on OpenAI model switching:
- Switching between different OpenAI models (GPT-3.5, GPT-4, GPT-4o-mini)
- Comparing model characteristics and response styles
- Dynamic model changing during conversations
- Testing conversation history across model switches

**Key Features:**
```typescript
const models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o-mini'];

// Test each model with the same questions
for (const model of models) {
    robota.setCurrentAI('openai', model);
    const response = await robota.run(question);
    console.log(`${model} response: ${response}`);
}
```

#### `05-conversation-history-test.ts`
Tests conversation history management:
- Conversation history persistence
- History limits and memory management
- Multi-turn conversations
- History serialization and deserialization

#### `06-token-and-request-limits.ts` & `06-token-and-request-limits-simple.ts`
Demonstrates usage tracking and limits:
- Token usage monitoring
- Request rate limiting
- Cost tracking
- Analytics and reporting

### 2. Function Examples (`02-functions/`)

#### `01-zod-function-tools.ts`
Comprehensive function tool creation using Zod schemas:
- Zod schema-based parameter validation
- Multiple tool types (calculator, weather)
- Function-only agent setup (no AI provider required)
- Type-safe function calling

**Key Features:**
```typescript
const tools = {
    add: {
        name: "add",
        description: "Adds two numbers together",
        parameters: z.object({
            a: z.number().describe("First number"),
            b: z.number().describe("Second number")
        }),
        handler: async (params) => {
            return { result: params.a + params.b };
        }
    },
    getWeather: {
        name: "getWeather",
        description: "Gets weather information for a city",
        parameters: z.object({
            location: z.enum(["Seoul", "Busan", "Jeju"]),
            unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius")
        }),
        handler: async (params) => {
            // Weather lookup logic
            return weatherData[params.location];
        }
    }
};

// Function-only setup
const robota = new Robota({
    provider: createZodFunctionToolProvider({ tools }),
    systemPrompt: "You are an AI assistant that uses tools to help users."
});
```

#### `02-custom-function-provider.ts`
Advanced custom function provider implementation:
- Custom provider creation
- Complex function orchestration
- Error handling and validation
- Provider lifecycle management

### 3. Integration Examples (`03-integrations/`)

#### `01-mcp-client.ts`
Model Context Protocol (MCP) integration:
- MCP client setup and usage
- Context management
- Protocol communication patterns

#### `02-openai-functions.ts`
Direct OpenAI Functions API integration:
- Native OpenAI function calling
- Function schema definition
- Response handling and parsing

#### `03-api-integration.ts`
External API integration patterns:
- REST API integration
- Authentication handling
- Data transformation and validation
- Error handling and retries

## Provider-Specific Examples

### OpenAI Provider
```typescript
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiProvider = new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-4',
    temperature: 0.7
});
```

### Anthropic Provider
```typescript
import { AnthropicProvider } from '@robota-sdk/anthropic';
import Anthropic from '@anthropic-ai/sdk';

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const anthropicProvider = new AnthropicProvider({
    client: anthropicClient,
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0.7
});
```

### Google Provider
```typescript
import { GoogleProvider } from '@robota-sdk/google';
import { GoogleGenerativeAI } from '@google/generative-ai';

const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const googleProvider = new GoogleProvider({
    client: googleClient,
    model: 'gemini-1.5-pro',
    temperature: 0.7
});
```

## Common Patterns

### Error Handling
```typescript
try {
    const response = await robota.run(userInput);
    console.log(response);
} catch (error) {
    console.error('AI request failed:', error);
    // Handle specific error types
}
```

### Streaming Responses
```typescript
const stream = await robota.runStream(userInput);
for await (const chunk of stream) {
    if (chunk.content) {
        process.stdout.write(chunk.content);
    }
}
```

### Tool Usage Verification
```typescript
// Check available tools
const availableTools = robota.getAvailableTools();
console.log('Available tools:', availableTools.map(tool => tool.name));

// Get current AI configuration
const currentAI = robota.getCurrentAI();
console.log(`Current: ${currentAI.provider}/${currentAI.model}`);
```

## Best Practices

1. **Environment Setup**: Always use environment variables for API keys
2. **Error Handling**: Implement comprehensive error handling for network issues
3. **Tool Design**: Keep tools focused and well-documented with clear schemas
4. **Provider Selection**: Choose appropriate models based on task complexity
5. **Cost Management**: Monitor token usage and implement limits where necessary
6. **Testing**: Test with multiple providers to ensure robustness

## Troubleshooting

### Common Issues

1. **Missing API Keys**: Ensure all required API keys are set in `.env`
2. **Provider Initialization**: Verify client instances are properly created
3. **Tool Registration**: Check that tools are correctly registered with providers
4. **Model Availability**: Confirm models are available for your API tier

### Debug Mode
Enable debug mode for detailed logging:
```typescript
const robota = new Robota({
    // ... other config
    debug: true,
    logger: customLogger  // Optional custom logger
});
```

This will provide detailed information about tool calls, provider switches, and request/response cycles.