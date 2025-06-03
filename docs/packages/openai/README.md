# @robota-sdk/openai

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fopenai.svg)](https://www.npmjs.com/package/@robota-sdk/openai)

OpenAI integration package for Robota SDK.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/openai @robota-sdk/core openai
```

## Overview

`@robota-sdk/openai` provides integration with OpenAI models for Robota SDK. This package allows you to use OpenAI's GPT models with function calling capabilities in your AI agent applications.

## Basic Usage

```typescript
import { Robota } from '@robota-sdk/core';
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
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  systemPrompt: 'You are a helpful AI assistant.'
});

// Run a simple conversation
const response = await robota.run('What can you tell me about artificial intelligence?');
console.log(response);
```

## Function Calling

OpenAI provider supports function calling capabilities through tool providers:

```typescript
import { Robota } from '@robota-sdk/core';
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
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [toolProvider]
});

const response = await robota.run('What\'s the weather like in Seoul?');
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