---
title: System Messages and Tool Calling
description: Managing system messages and tool calling in Robota
lang: en-US
---

# System Messages and Tool Calling

This document describes how to manage system messages and use tool calling functionality in Robota.

## System Message Management

Robota offers various ways to manage system messages. System messages are used to provide specific roles or action instructions to AI models.

### Single System Prompt

The simplest method is to use a single system prompt:

```typescript
// Set during initialization
const robota = new Robota({
  provider: openaiProvider,
  systemPrompt: 'You are a helpful AI assistant.'
});

// Change later
robota.setSystemPrompt('You are an AI assistant that provides weather information.');
```

### Multiple System Messages

For more complex instructions, multiple system messages can be set:

```typescript
// Set during initialization
const robota = new Robota({
  provider: openaiProvider,
  systemMessages: [
    { role: 'system', content: 'You are a weather expert.' },
    { role: 'system', content: 'Always try to provide accurate information.' },
    { role: 'system', content: 'It is good to ask users about their location.' }
  ]
});

// Set later
robota.setSystemMessages([
  { role: 'system', content: 'You are a professional chef.' },
  { role: 'system', content: 'Please teach users cooking recipes.' }
]);
```

### System Message Addition

New messages can also be added to existing system messages:

```typescript
// Start with a single system prompt
const robota = new Robota({
  provider: openaiProvider,
  systemPrompt: 'You are a helpful AI assistant.'
});

// Add additional system messages
robota.addSystemMessage('Always respond to users politely.');
robota.addSystemMessage('Try to answer concisely when possible.');
```

## Tool Calling

Robota supports tool calling functionality where AI models can automatically call available tools based on conversation context.

### Tool Calling Configuration

Tools are automatically available when registered with tool providers:

```typescript
// Tools are enabled by default when tool providers are registered
const robota = new Robota({
  provider: openaiProvider,
  toolProviders: [toolProvider] // Tools automatically available
});

// Execute with tool calling enabled
const result = await robota.run('What is the weather in Seoul?');
```

### Tool Provider Management

You can manage tool providers dynamically:

```typescript
// Add tool providers
robota.addToolProvider(weatherToolProvider);
robota.addToolProvider(databaseToolProvider);

// Remove tool providers
robota.removeToolProvider('weather-tools');

// Get available tools
const availableTools = robota.getAvailableTools();
```

## Full Example

The following is a full example of using system messages and tool calling together:

```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';

// Create OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Define tools
const tools = {
  getWeather: {
    name: 'getWeather',
    description: 'Get current weather information for a specific location',
    parameters: z.object({
      location: z.string().describe('City name to check weather (e.g., Seoul, New York)'),
      unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit')
    }),
    handler: async (params) => {
      console.log(`Searching weather: ${params.location}`);
      
      // Return virtual data instead of actual API call
      return {
        location: params.location,
        temperature: 23,
        condition: 'Clear',
        humidity: 60,
        unit: params.unit || 'celsius'
      };
    }
  }
};

// Create tool provider
const toolProvider = createZodFunctionToolProvider({ tools });

// Create Robota instance
const robota = new Robota({
  aiProviders: { 'openai': new OpenAIProvider(client) },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [toolProvider],
  systemMessages: [
    { role: 'system', content: 'You are a weather expert.' },
    { role: 'system', content: 'Always try to provide accurate information.' }
  ]
});

// Execute
const result = await robota.run('What is the weather in Seoul?');
console.log(result);
``` 