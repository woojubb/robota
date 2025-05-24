# @robota-sdk/openai

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
  model: 'gpt-4',
  client: openaiClient
});

// Create Robota instance with OpenAI provider
const robota = new Robota({
  provider,
  systemPrompt: 'You are a helpful AI assistant.'
});

// Run a simple conversation
const response = await robota.run('What can you tell me about artificial intelligence?');
console.log(response);
```

## Function Calling

OpenAI provider supports function calling capabilities:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import { z } from 'zod';

// Initialize provider with tools
const provider = new OpenAIProvider({
  model: 'gpt-4',
  client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  tools: [
    {
      name: 'getWeather',
      description: 'Get weather information for a location',
      parameters: z.object({
        location: z.string().describe('The city name'),
        unit: z.enum(['celsius', 'fahrenheit']).default('celsius')
      }),
      execute: async (params) => {
        // Implement weather lookup logic
        return { temperature: 22, condition: 'Sunny' };
      }
    }
  ]
});

const robota = new Robota({ provider });
const response = await robota.run('What's the weather like in Seoul?');
```

## Models

Supports all OpenAI models including:
- GPT-4
- GPT-3.5 Turbo
- And other compatible models

## License

MIT 