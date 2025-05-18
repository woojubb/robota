---
title: System Messages and Function Calling Modes
description: Managing system messages and function calling modes in Robota
lang: en-US
---

# System Messages and Function Calling Modes

This document describes how to manage system messages and control function calling modes in Robota.

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

## Function Calling Modes

Robota supports three function calling modes: `auto`, `disabled`, `force`. These modes control how AI models call functions.

### Auto Mode (Default)

In `auto` mode, AI automatically calls functions when needed based on the conversation context:

```typescript
// Global setting
robota.setFunctionCallMode('auto');

// Or set in individual calls
const result = await robota.run('What is the weather in Seoul?', {
  functionCallMode: 'auto' // This is the default, so can be omitted
});
```

### Disabled Mode

In `disabled` mode, function calls are completely disabled:

```typescript
// Global setting
robota.setFunctionCallMode('disabled');

// Or set in individual calls
const result = await robota.run('What is the weather in Seoul?', {
  functionCallMode: 'disabled'
});
```

### Force Mode

In `force` mode, AI is instructed to call a specific function:

```typescript
// Global setting
robota.setFunctionCallMode('force');

// Specify function and arguments in individual calls
const result = await robota.run('What is the weather in Seoul?', {
  functionCallMode: 'force',
  forcedFunction: 'getWeather',
  forcedArguments: { location: 'Seoul' }
});
```

## Function Call Configuration Management

Global function call configuration can also be managed:

```typescript
// Set during initialization
const robota = new Robota({
  provider: openaiProvider,
  functionCallConfig: {
    defaultMode: 'auto', // Default mode
    maxCalls: 5, // Maximum number of function calls
    timeout: 10000, // Function call timeout (ms)
    allowedFunctions: ['getWeather'] // List of allowed functions
  }
});

// Change settings later
robota.configureFunctionCall({
  mode: 'auto',
  maxCalls: 10,
  timeout: 15000,
  allowedFunctions: ['getWeather', 'searchDatabase']
});
```

## Full Example

The following is a full example of using system messages and function calling modes together:

```typescript
import { Robota, OpenAIProvider, createFunction } from 'robota';
import OpenAI from 'openai';
import { z } from 'zod';

// Create OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Define function
const getWeather = createFunction({
  name: 'getWeather',
  description: 'Get current weather information for a specific location',
  parameters: z.object({
    location: z.string().describe('City name to check weather (e.g., Seoul, New York)'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit')
  }),
  execute: async (params) => {
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
});

// Create Robota instance
const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client
  }),
  systemMessages: [
    { role: 'system', content: 'You are a weather expert.' },
    { role: 'system', content: 'Always try to provide accurate information.' }
  ],
  functionCallConfig: {
    defaultMode: 'auto',
    allowedFunctions: ['getWeather']
  }
});

// Register function
robota.registerFunctions({ getWeather });

// Execute
const result = await robota.run('What is the weather in Seoul?');
console.log(result);
``` 