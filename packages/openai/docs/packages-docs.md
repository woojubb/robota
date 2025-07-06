# @robota-sdk/openai

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fopenai.svg)](https://www.npmjs.com/package/@robota-sdk/openai)

OpenAI integration package for Robota SDK - GPT-4, GPT-3.5 with function calling, streaming, and vision support.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/openai @robota-sdk/agents openai
```

## Overview

`@robota-sdk/openai` provides comprehensive integration with OpenAI models for Robota SDK. This package allows you to use OpenAI's GPT models with advanced capabilities including function calling, real-time streaming, and vision support in your AI agent applications.

## Key Features

### 🤖 **Model Support**
- **GPT-4**: Advanced reasoning and complex task handling
- **GPT-3.5 Turbo**: Fast and efficient conversational AI
- **Vision Models**: Image understanding and analysis capabilities
- **Function Calling**: Native OpenAI function calling support

### ⚡ **Real-Time Streaming**
- Real-time streaming responses for better user experience
- Chunk-based processing for immediate feedback
- Asynchronous response handling

### 🛠️ **Advanced Features**
- Type-safe function calling with Zod schema validation
- Automatic parameter validation and type inference
- Comprehensive error handling and logging
- Dynamic model switching and configuration

## Basic Usage

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// Initialize OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Create OpenAI provider
const provider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4',
  temperature: 0.7
});

// Create Robota instance with OpenAI provider
const robota = new Robota({
  aiProviders: {
    openai: provider
  },
  currentModel: 'gpt-4',
  systemPrompt: 'You are a helpful AI assistant.'
});

// Run a simple conversation
const response = await robota.run('What can you tell me about artificial intelligence?');
console.log(response);

// Clean up resources
await robota.close();
```

## Streaming Responses

Experience real-time AI responses with streaming:

```typescript
// Streaming response for immediate feedback
const stream = await robota.runStream('Tell me a story about AI');
for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

## Function Calling

OpenAI provider supports advanced function calling capabilities through tool providers:

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';

// Create tool provider with functions
const toolProvider = createZodFunctionToolProvider({
  tools: {
    getWeather: {
      name: 'getWeather',
      description: 'Get weather information for a location',
      parameters: z.object({
        location: z.string().describe('The city name'),
        unit: z.enum(['celsius', 'fahrenheit']).default('celsius')
      }),
      handler: async (params) => {
        // Implement weather lookup logic
        return { temperature: 22, condition: 'Sunny' };
      }
    },
    calculate: {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number(),
        b: z.number()
      }),
      handler: async ({ operation, a, b }) => {
        switch (operation) {
          case 'add': return { result: a + b };
          case 'subtract': return { result: a - b };
          case 'multiply': return { result: a * b };
          case 'divide': return { result: a / b };
        }
      }
    }
  }
});

// Initialize provider
const provider = new OpenAIProvider({
  client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  model: 'gpt-4',
  temperature: 0.7
});

const robota = new Robota({
  aiProviders: {
    openai: provider
  },
  currentModel: 'gpt-4',
  toolProviders: [toolProvider]
});

const response = await robota.run('What\'s the weather like in Seoul and calculate 15 * 7?');
```

## Multi-Provider Setup

Seamlessly switch between OpenAI and other providers:

```typescript
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';

const robota = new Robota({
  aiProviders: {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    google: googleProvider
  },
  currentModel: 'gpt-4'
});

// Switch between models
robota.setModel({ provider: 'openai', model: 'gpt-4' });
const gpt4Response = await robota.run('Solve this complex problem...');

robota.setModel({ provider: 'openai', model: 'gpt-3.5-turbo' });
const gpt35Response = await robota.run('Quick question...');
```

## Provider Options

```typescript
interface OpenAIProviderOptions {
  client: OpenAI;           // Required: OpenAI client instance
  model: string;            // Required: Model name (e.g., 'gpt-4')
  temperature?: number;     // Optional: 0-1, default 0.7
  maxTokens?: number;       // Optional: Max tokens to generate
  apiKey?: string;          // Optional: API key (if not set in client)
  organization?: string;    // Optional: OpenAI organization
  timeout?: number;         // Optional: Request timeout in ms
  baseURL?: string;         // Optional: Custom API base URL
  responseFormat?: 'json' | 'text';  // Optional: Response format
}
```

## Models

Supports all OpenAI models including:
- GPT-4
- GPT-3.5 Turbo
- And other compatible models

## License

MIT 