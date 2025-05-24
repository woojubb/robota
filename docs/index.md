---
layout: home
title: Robota SDK
description: A powerful TypeScript library for building AI agents with multi-provider support
lang: en-US
---

# Robota SDK

A powerful TypeScript library for building AI agents with multi-provider support

## Features

- **Multi-Provider Support**: Work seamlessly with OpenAI, Anthropic, Google AI, and more
- **Type-Safe Architecture**: Full TypeScript support with comprehensive type safety
- **Modular Design**: Clean separation between core functionality, providers, and tools
- **Function Calling**: Enable AI to interact with external systems through custom tools
- **Streaming Support**: Real-time streaming responses from all supported providers
- **Provider Switching**: Dynamically switch between different AI providers and models
- **Tool Ecosystem**: Support for Zod schemas, MCP (Model Context Protocol), and custom functions
- **Conversation Management**: Built-in conversation history and context management

## Quick Start

```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';

// Create OpenAI client
const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Create provider
const openaiProvider = new OpenAIProvider(openaiClient);

// Create Robota instance
const robota = new Robota({
    aiProviders: {
        'openai': openaiProvider
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    systemPrompt: 'You are a helpful AI assistant.'
});

// Simple conversation
const response = await robota.run('Hello! How can I help you today?');
console.log(response);

// Streaming response
const stream = await robota.runStream('Tell me about AI');
for await (const chunk of stream) {
    process.stdout.write(chunk.content || '');
}
```

## Supported AI Providers

### OpenAI (`@robota-sdk/openai`)
- **Models**: GPT-3.5 Turbo, GPT-4, GPT-4o, GPT-4o-mini, GPT-4 Turbo
- **Features**: Function calling, streaming, vision (GPT-4V)

### Anthropic (`@robota-sdk/anthropic`)
- **Models**: Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku
- **Features**: Large context windows, advanced reasoning

### Google AI (`@robota-sdk/google`)
- **Models**: Gemini 1.5 Pro, Gemini 1.5 Flash, Gemini Pro, Gemini Pro Vision
- **Features**: Multimodal capabilities, long context support

### Custom Providers
Easy to implement your own provider by extending the base interfaces.

## Installation

```bash
# Install core package and desired providers
npm install @robota-sdk/core

# OpenAI provider
npm install @robota-sdk/openai openai

# Anthropic provider  
npm install @robota-sdk/anthropic @anthropic-ai/sdk

# Google AI provider
npm install @robota-sdk/google @google/generative-ai

# Tools for function calling
npm install @robota-sdk/tools zod
```

## Multi-Provider Setup

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Create clients
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Create providers
const openaiProvider = new OpenAIProvider({ client: openaiClient, model: 'gpt-4' });
const anthropicProvider = new AnthropicProvider({ client: anthropicClient, model: 'claude-3-5-sonnet-20241022' });
const googleProvider = new GoogleProvider({ client: googleClient, model: 'gemini-1.5-pro' });

// Setup Robota with multiple providers
const robota = new Robota({
    aiProviders: {
        openai: openaiProvider,
        anthropic: anthropicProvider,
        google: googleProvider
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4'
});

// Switch providers dynamically
robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');
robota.setCurrentAI('google', 'gemini-1.5-pro');

// Get current configuration
const currentAI = robota.getCurrentAI();
console.log(`Using: ${currentAI.provider}/${currentAI.model}`);
```

## Function Calling with Tools

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

// Define weather tool with Zod schema
const weatherTool = {
    name: 'getWeather',
    description: 'Get current weather for a location',
    parameters: z.object({
        location: z.string().describe('City name'),
        unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('Temperature unit')
    }),
    handler: async ({ location, unit }) => {
        // Replace with actual weather API call
        return {
            temperature: unit === 'celsius' ? 22 : 72,
            condition: 'Partly cloudy',
            humidity: 65,
            location,
            unit
        };
    }
};

// Define calculator tool
const calculatorTool = {
    name: 'calculate',
    description: 'Perform mathematical calculations',
    parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number().describe('First number'),
        b: z.number().describe('Second number')
    }),
    handler: async ({ operation, a, b }) => {
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
    tools: {
        getWeather: weatherTool,
        calculate: calculatorTool
    }
});

// Setup Robota with tools
const robota = new Robota({
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    toolProviders: [toolProvider],
    systemPrompt: 'You are a helpful assistant with access to weather and calculation tools.'
});

// AI will automatically use tools when needed
const response = await robota.run('What is 25 + 17? Also, what is the weather like in Tokyo?');
console.log(response);
```

## Key Features

### Provider Switching
Dynamically switch between different AI providers and models:

```typescript
// Switch to a faster model for simple tasks
robota.setCurrentAI('openai', 'gpt-3.5-turbo');

// Switch to a more capable model for complex reasoning
robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');

// Use Google's multimodal capabilities
robota.setCurrentAI('google', 'gemini-pro-vision');
```

### Conversation History
Built-in conversation management with configurable limits:

```typescript
const robota = new Robota({
    // ... provider config
    conversationHistoryLimit: 10, // Keep last 10 exchanges
    systemPrompt: 'You are a helpful assistant.'
});

// Conversation history is automatically maintained
await robota.run('My name is Alice');
await robota.run('What is my name?'); // AI will remember: "Your name is Alice"
```

### Streaming Responses
Real-time streaming support across all providers:

```typescript
const stream = await robota.runStream('Write a short story about AI');
for await (const chunk of stream) {
    if (chunk.content) {
        process.stdout.write(chunk.content);
    }
}
```

### Debug Mode
Comprehensive logging and debugging capabilities:

```typescript
const robota = new Robota({
    // ... config
    debug: true,
    logger: {
        info: (msg, ...args) => console.log('INFO:', msg, ...args),
        debug: (msg, ...args) => console.log('DEBUG:', msg, ...args),
        warn: (msg, ...args) => console.warn('WARN:', msg, ...args),
        error: (msg, ...args) => console.error('ERROR:', msg, ...args)
    }
});
```

## Architecture

Robota SDK is built with a modular architecture:

- **`@robota-sdk/core`**: Core agent functionality, conversation management, and provider interfaces
- **`@robota-sdk/openai`**: OpenAI provider integration with GPT models
- **`@robota-sdk/anthropic`**: Anthropic provider integration with Claude models  
- **`@robota-sdk/google`**: Google AI provider integration with Gemini models
- **`@robota-sdk/tools`**: Comprehensive tool system with Zod schemas and function calling

## Environment Setup

Create a `.env` file in your project root:

```env
# Required: At least one AI provider API key
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Additional providers
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_API_KEY=your_google_api_key_here

# Optional: Organization settings
OPENAI_ORGANIZATION=your_openai_org_id
```

## Documentation

### Getting Started
- [AI Providers & Tools](./providers.md) - Learn about supported providers and tools
- [Examples](./examples/examples.md) - Comprehensive examples and tutorials
- [API Reference](./api-reference.md) - Complete API documentation

### Advanced Topics
- [Development Guidelines](./development-guidelines.md) - Development best practices
- [Environment Setup](./environment-setup.md) - Detailed setup instructions

### Package Documentation
- [Core Package](./packages/core.md) - Core functionality and interfaces
- [OpenAI Package](./packages/openai.md) - OpenAI provider documentation
- [Anthropic Package](./packages/anthropic.md) - Anthropic provider documentation
- [Google Package](./packages/google.md) - Google AI provider documentation
- [Tools Package](./packages/tools.md) - Function calling and tools

## Examples

Check out our comprehensive examples in the [`apps/examples`](./examples/examples.md) directory:

- **Basic Examples**: Simple conversations, provider switching, multi-provider setup
- **Function Tools**: Zod-based tools, custom providers, complex integrations
- **Advanced Integrations**: MCP integration, OpenAPI tools, external APIs

## Contributing

We welcome contributions! Please read our [Development Guidelines](./development-guidelines.md) for coding standards and best practices.

## License

MIT License - see LICENSE file for details. 