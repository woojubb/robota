---
title: AI Providers & Tools
description: AI Providers and Tool Providers in Robota
lang: en-US
---

# AI Providers and Tool Providers

Robota operates with two main components:

1. **AI Providers**: Interfaces that communicate with various LLM services
2. **Tool Providers**: Interfaces that provide functions that AI models can call

## AI Providers

AI providers handle direct communication with LLM services like OpenAI, Anthropic, and Google AI. Each provider communicates with specific APIs and leverages the unique features of their respective services.

### Supported AI Providers

#### OpenAI

Integration with OpenAI's GPT models. Supports GPT-3.5, GPT-4, and more.

For detailed information, see the [OpenAI Provider Documentation](packages/openai/README.md).

#### Anthropic

Integration with Anthropic's Claude models. Supports Claude, Claude Instant, and more.

For detailed information, see the [Anthropic Provider Documentation](packages/anthropic/README.md).

#### Google AI

Integration with Google's Generative AI models. Supports Gemini Pro, Gemini Pro Vision, and more.

For detailed information, see the [Google AI Provider Documentation](providers/google.md).

### Using AI Providers

Each AI provider is used through a consistent interface. You must inject the API client directly:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// Create OpenAI API client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION
});

// Configure OpenAI provider (client injection required)
const openaiProvider = new OpenAIProvider({
  model: 'gpt-4',
  temperature: 0.7,
  client: openaiClient
});

// Connect AI provider to Robota instance
const robota = new Robota({
  aiProviders: {
    openai: openaiProvider
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4'
});

// Execute
const result = await robota.run('Hello! How is the weather today?');
```

### Client Instance Injection (Required)

Robota uses externally created API clients. This approach provides:

1. Consistent client configuration across the application
2. Improved testability and mocking capabilities
3. Fine-grained control over client settings

```typescript
import { Robota } from '@robota-sdk/core';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import Anthropic from '@anthropic-ai/sdk';

// Create Anthropic client
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Configure Anthropic provider (client injection required)
const anthropicProvider = new AnthropicProvider({
  model: 'claude-3-opus',
  temperature: 0.7,
  client: anthropicClient
});

// Connect AI provider to Robota instance
const robota = new Robota({
  aiProviders: {
    anthropic: anthropicProvider
  },
  currentProvider: 'anthropic',
  currentModel: 'claude-3-opus'
});
```

### Multiple Provider Setup

You can configure multiple providers and switch between them:

```typescript
import { GoogleProvider } from '@robota-sdk/google';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Create Google AI client
const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// Configure Google provider
const googleProvider = new GoogleProvider({
  model: 'gemini-pro',
  temperature: 0.7,
  client: googleClient
});

// Setup Robota with multiple providers
const robota = new Robota({
  aiProviders: {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    google: googleProvider
  },
  currentProvider: 'openai', // Default provider
  currentModel: 'gpt-4'
});

// Switch providers dynamically
robota.setCurrentProvider('google');
robota.setCurrentModel('gemini-pro');
```

## Tool Providers

Tool providers provide functions that AI models can call. This allows AI to interact with external systems or perform specific tasks.

### Supported Tool Provider Types

#### Zod Function Tool Provider

Provides a function tool based on Zod schema. This tool provider ensures type safety and performs runtime validation.

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIClient } from '@robota-sdk/openai-client';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

// OpenAI client setup
const aiClient = new OpenAIClient({ /* ... */ });

// Calculator tool definition
const calculatorTool = {
  name: 'calculate',
  description: 'Performs mathematical calculations',
  parameters: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number()
  }),
  handler: async ({ operation, a, b }) => {
    // Implementation of calculation logic
    switch (operation) {
      case 'add': return { result: a + b };
      case 'subtract': return { result: a - b };
      case 'multiply': return { result: a * b };
      case 'divide': return b !== 0 ? { result: a / b } : { error: 'Cannot divide by zero' };
    }
  }
};

// Zod function tool provider creation
const provider = createZodFunctionToolProvider({
  tools: { calculate: calculatorTool }
});

// Robota instance setup
const robota = new Robota({
  aiClient,
  provider
});

// Request AI to use the tool
const result = await robota.run('What is the result of adding 5 and 3?');
```

#### OpenAPI Tool Provider

Provides a tool based on OpenAPI specification. This allows easy integration with REST APIs.

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIClient } from '@robota-sdk/openai-client';
import { createOpenAPIToolProvider } from '@robota-sdk/core';

// OpenAI client setup
const aiClient = new OpenAIClient({ /* ... */ });

// OpenAPI tool provider creation
const provider = createOpenAPIToolProvider('https://api.example.com/openapi.json', {
  baseUrl: 'https://api.example.com'
});

// Robota instance setup
const robota = new Robota({
  aiClient,
  provider
});

// Request AI to call the API
const result = await robota.run('What is the weather in Seoul?');
```

#### MCP (Model Context Protocol) Tool Provider

Tool provider for integrating with models that support MCP. `createMcpToolProvider` function can be used to create MCP-based tool provider.

```typescript
import { Robota, createMcpToolProvider } from '@robota-sdk/core';
import { OpenAIClient } from '@robota-sdk/openai-client';
import { Client, StdioClientTransport } from '@modelcontextprotocol/sdk';

// OpenAI client setup
const aiClient = new OpenAIClient({ /* ... */ });

// MCP client creation
const transport = new StdioClientTransport(/* setup */);
const mcpClient = new Client(transport);

// MCP tool provider creation
const provider = createMcpToolProvider(mcpClient);

// Robota instance setup
const robota = new Robota({
  aiClient,
  provider
});

// Execute
const result = await robota.run('Hello!');
```

## Differences Between AI Providers and Tool Providers

| Feature | AI Provider | Tool Provider |
|---------|-------------|-------------|
| Primary Role | Communicate with LLM services | Provide functions for AI to call |
| Interaction Method | Send prompts and receive responses | Handle specific tool/function calls |
| Example | OpenAIClient, AnthropicClient | ZodFunctionToolProvider, OpenAPIToolProvider |
| Robota Connection | aiClient property usage | provider property usage |

## Detailed Documentation

- [OpenAI Provider](packages/openai/README.md)
- [Anthropic Provider](packages/anthropic/README.md)
- [Tool Provider](providers/tools.md)
- [Custom Implementation](providers/custom.md) 