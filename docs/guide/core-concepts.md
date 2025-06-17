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
  aiProviders: {
    openai: new OpenAIProvider({
      client: openaiClient,
      model: 'gpt-4'
    })
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  systemPrompt: 'You are a helpful AI assistant.',
  // Additional settings
});
```

You can also set multiple system messages:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';

const robota = new Robota({
  aiProviders: {
    openai: new OpenAIProvider({
      client: openaiClient,
      model: 'gpt-4'
    })
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
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
import Anthropic from '@anthropic-ai/sdk';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

// Create OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Create Anthropic client
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// OpenAI provider
const openaiProvider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4'
});

// Anthropic provider
const anthropicProvider = new AnthropicProvider({
  client: anthropicClient,
  model: 'claude-3-5-sonnet-20241022'
});
```

### 3. Tool Calling

This allows AI models to call specific tools. This enables you to perform tasks such as external API calls, database lookups, file system access, etc.

```typescript
import { Robota } from '@robota-sdk/core';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

// Tool definition
const tools = {
  searchDatabase: {
    name: 'searchDatabase',
    description: 'Search the database for information',
    parameters: z.object({
      query: z.string().describe('Search query')
    }),
    handler: async ({ query }) => {
      // Database search logic
      return { results: ['Result1', 'Result2'] };
    }
  }
};

// Create tool provider
const toolProvider = createZodFunctionToolProvider({ tools });

// Create Robota with tool provider
const robota = new Robota({
  aiProviders: { /* AI providers */ },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [toolProvider]
});
```

### 4. Tools

Tools are an extended concept of function calling. They provide more complex and structured functionality. Each tool includes metadata, parameter validation, and execution logic.

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

const calculatorToolProvider = createZodFunctionToolProvider({
  tools: {
    calculator: {
      name: 'calculator',
      description: 'Performs mathematical calculations',
      parameters: z.object({
        expression: z.string().describe('Expression to calculate')
      }),
      handler: async ({ expression }) => {
        return { result: eval(expression) };
      }
    }
  }
});

// Add to Robota instance
const robota = new Robota({
  // ... other options
  toolProviders: [calculatorToolProvider]
});
```

### 5. Agents

Agents are AI systems that use tools and reason to achieve a goal. Robota can implement various agent patterns.

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';

const researchToolProvider = createZodFunctionToolProvider({
  tools: { webSearch, summarize } // Tool definitions
});

const researchAgent = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [researchToolProvider],
  systemPrompt: 'You are a research agent that searches the web and summarizes information.'
});
```

### 6. Memory

This is a system for storing and managing conversation history, allowing the agent to remember and reference previous interactions.

```typescript
import { Robota, SimpleConversationHistory } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';

const conversationHistory = new SimpleConversationHistory();
const robota = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  conversationHistory
});
```

### 7. Model Context Protocol

This is a standardized method for communicating with specific models. It ensures compatibility between various model providers.

### 8. OpenAPI Integration

This feature provides the ability to automatically generate tools and functions from Swagger/OpenAPI specs.

```typescript
import { createOpenAPIToolProvider } from '@robota-sdk/tools';

const apiToolProvider = createOpenAPIToolProvider({
  specUrl: 'https://api.example.com/openapi.json',
  baseURL: 'https://api.example.com'
});

// Add to Robota instance
const robota = new Robota({
  // ... other options
  toolProviders: [apiToolProvider]
});
```

## Library Architecture

Robota is designed with the following layered structure:

1. **Core Layer**: Basic classes and interfaces
2. **Provider Layer**: Integration with various LLM APIs
3. **Tools Layer**: Abstraction of functions and tools
4. **Agents Layer**: Reasoning and planning patterns
5. **Utilities Layer**: Helper functions and common functionality

This structure maximizes modularity and extensibility to support various AI agent scenarios. 