---
title: Getting Started
description: Getting started with Robota
lang: en-US
---

# Getting Started

Learn how to build Agentic AI with Robota.

## Installation

Install using Bun:

```bash
bun install @robota-sdk/core @robota-sdk/provider-openai
```

Install using npm:

```bash
npm install @robota-sdk/core @robota-sdk/provider-openai
```

Install using yarn:

```bash
yarn add @robota-sdk/core @robota-sdk/provider-openai
```

## Basic Usage

Here's how to set up and use Robota in its most basic form:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

// Get API key from environment variable
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error('OPENAI_API_KEY environment variable is required');
}

// Create Robota instance
const robota = new Robota({
  provider: new OpenAIProvider({
    apiKey,
    model: 'gpt-4'
  })
});

// Run a simple query
const result = await robota.run('What is TypeScript?');
console.log(result);
```

## Using Function Calling

Set up AI to call functions:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

// Create Robota instance
const robota = new Robota({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
});

// Define functions
const functions = {
  getWeather: async (location: string) => {
    // In a real implementation, call a weather API here
    console.log(`Getting weather for ${location}...`);
    return { temperature: 20, condition: 'sunny' };
  },
  
  getCurrentTime: async (timezone: string = 'UTC') => {
    console.log(`Getting current time for ${timezone}...`);
    return new Date().toLocaleString('en-US', { timeZone: timezone });
  }
};

// Register functions
robota.registerFunctions(functions);

// Run
const result = await robota.run('Tell me the weather in New York and also the current time.');
console.log(result);
```

## Streaming Responses

Use streaming responses to get real-time results:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

const robota = new Robota({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
});

// Handle streaming response
const stream = await robota.runStream('Tell me 5 advantages of TypeScript');

for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

## Next Steps

- Read [Core Concepts](./core-concepts.md) to understand the components of Robota.
- Check out the [Examples Guide](../examples/index.md) to see various example codes. All examples are in the `apps/examples` directory.
- Learn about various [Providers](../providers.md).
- View detailed information about [Function Calling](./function-calling.md).
- Learn how to build complex [Agents](./building-agents.md). 