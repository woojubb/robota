---
title: Core Concepts
description: Core concepts of the Robota library
lang: en-US
---

# Core Concepts

Robota is built on the following core concepts.

## Main Components

### 1. Robota Class

The entry point for the entire library. It provides an interface to initialize and run an AI agent.

```typescript
const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: openaiClient
  }),
  systemPrompt: 'You are a helpful AI assistant.',
  // Additional settings
});
```

You can also set multiple system messages:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: openaiClient
  }),
  systemMessages: [
    { role: 'system', content: 'You are an expert on weather.' },
    { role: 'system', content: 'Always strive to provide accurate information.' }
  ]
});
```

### 2. Providers

This is an abstraction layer that allows you to use various AI services. Each provider provides a way to communicate with specific LLM APIs (OpenAI, Anthropic, etc.).

```typescript
import OpenAI from 'openai';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { AnthropicProvider } from '@robota-sdk/provider-anthropic';

// Create OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// OpenAI provider
const openaiProvider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4'
});

// Anthropic provider
const anthropicProvider = new AnthropicProvider({
  client: anthropicClient,
  model: 'claude-3-opus'
});
```

### 3. Function Calling

This allows AI models to call specific functions. This enables you to perform tasks such as external API calls, database lookups, file system access, etc.

```typescript
import { Robota } from '@robota-sdk/core';

// Function definition
const functions = {
  searchDatabase: async (query: string) => {
    // Database search logic
    return { results: ['Result1', 'Result2'] };
  }
};

// Function registration
robota.registerFunctions(functions);

// Function call mode setting
robota.setFunctionCallMode('auto'); // Choose from 'auto', 'disabled', 'force'
```

### 4. Tools

Tools are an extended concept of function calling. They provide more complex and structured functionality. Each tool includes metadata, parameter validation, and execution logic.

```typescript
import { Tool } from '@robota-sdk/tools';
import { z } from 'zod';

const calculator = new Tool({
  name: 'calculator',
  description: 'Performs mathematical calculations',
  parameters: z.object({
    expression: z.string().describe('Expression to calculate')
  }),
  execute: async ({ expression }) => {
    return { result: eval(expression) };
  }
});

robota.registerTools([calculator]);
```

### 5. Agents

Agents are AI systems that use tools and reason to achieve a goal. Robota can implement various agent patterns.

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

const researchAgent = new Robota({
  name: 'Research Agent',
  description: 'Agent that searches the web and summarizes information',
  tools: [webSearch, summarize],
  provider: openaiProvider
});
```

### 6. Memory

This is a system for storing and managing conversation history, allowing the agent to remember and reference previous interactions.

```typescript
import { Robota } from '@robota-sdk/core';
import { ConversationMemory } from '@robota-sdk/memory';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

const memory = new ConversationMemory();
const robota = new Robota({
  provider: openaiProvider,
  memory
});
```

### 7. Model Context Protocol

This is a standardized method for communicating with specific models. It ensures compatibility between various model providers.

### 8. OpenAPI Integration

This feature provides the ability to automatically generate tools and functions from Swagger/OpenAPI specs.

```typescript
import { OpenAPIToolkit } from '@robota-sdk/openapi';

const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json');
robota.registerTools(apiTools);
```

## Library Architecture

Robota is designed with the following layered structure:

1. **Core Layer**: Basic classes and interfaces
2. **Provider Layer**: Integration with various LLM APIs
3. **Tools Layer**: Abstraction of functions and tools
4. **Agents Layer**: Reasoning and planning patterns
5. **Utilities Layer**: Helper functions and common functionality

This structure maximizes modularity and extensibility to support various AI agent scenarios. 