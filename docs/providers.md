---
title: AI Providers
description: Various AI providers in Robota
lang: en-US
---

# AI Providers

Robota supports a variety of AI providers to leverage different LLM services. Each provider is designed to communicate with a specific API and utilize the unique features of that service.

## Supported Providers

### Currently Implemented

#### OpenAI

OpenAI's GPT models and integration. Supports GPT-3.5, GPT-4, etc.

See [OpenAI Provider Documentation](providers/openai.md) for more details.

#### Anthropic

Anthropic's Claude models and integration. Supports Claude, Claude Instant, etc.

See [Anthropic Provider Documentation](providers/anthropic.md) for more details.

### Protocol Providers

#### MCP (Model Context Protocol)

Provider for integrating models that support Model Context Protocol. You can create MCP-based tool providers using the `createMcpToolProvider` function.

See [Model Context Protocol](protocols/model-context-protocol.md) for more details.

### Custom Providers

You can implement a custom provider directly to integrate your own AI service or a service that is not supported.

See [Custom Provider Guide](providers/custom.md) for more details.

## Using Providers

Each provider is used through a consistent interface. You need to inject the API client directly:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import OpenAI from 'openai';

// Create OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION
});

// Set OpenAI provider (client injection is required)
const provider = new OpenAIProvider({
  model: 'gpt-4',
  temperature: 0.7,
  client: openaiClient
});

// Connect provider to Robota instance
const robota = new Robota({ provider });

// Execute
const result = await robota.run('Hello! How's the weather today?');
```

### Client Instance Injection (Required)

Robota uses external-generated API clients. This allows:

1. Maintaining consistent client settings across the application
2. Improving testability and mocking
3. More fine-grained control over client settings

```typescript
import { Robota } from '@robota-sdk/core';
import { AnthropicProvider } from '@robota-sdk/provider-anthropic';
import Anthropic from '@anthropic-ai/sdk';

// Create Anthropic client
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Set Anthropic provider (client injection is required)
const provider = new AnthropicProvider({
  model: 'claude-3-opus',
  temperature: 0.7,
  client: anthropicClient
});

// Connect provider to Robota instance
const robota = new Robota({ provider });
```

### Using MCP Client

To use a model that supports Model Context Protocol:

```typescript
import { Robota, createMcpToolProvider } from '@robota-sdk/core';
import { Client, StdioClientTransport } from '@modelcontextprotocol/sdk';

// Create MCP client
const transport = new StdioClientTransport(/* configuration */);
const mcpClient = new Client(transport);

// Initialize MCP provider
const provider = createMcpToolProvider(mcpClient, {
  model: 'model-name',
  temperature: 0.7
});

// Connect provider to Robota instance
const robota = new Robota({ provider });

// Execute
const result = await robota.run('Hello!');
```

## Using Multiple Providers

You can use multiple providers simultaneously to leverage the advantages of various AI models:

```typescript
import { Robota, ProviderRouter } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { AnthropicProvider } from '@robota-sdk/provider-anthropic';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// Create clients
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Set multiple providers
const openaiProvider = new OpenAIProvider({
  model: 'gpt-4',
  client: openaiClient
});

const anthropicProvider = new AnthropicProvider({
  model: 'claude-3-opus',
  client: anthropicClient
});

// Use router to use multiple providers
const router = new ProviderRouter({
  defaultProvider: openaiProvider,
  providers: {
    openai: openaiProvider,
    anthropic: anthropicProvider
  },
  routingStrategy: (message, context) => {
    // Select appropriate provider based on message content
    if (message.includes('creative') || message.includes('creative')) {
      return 'anthropic';
    }
    return 'openai'; // Default value
  }
});

// Use router as provider
const robota = new Robota({ provider: router });

// Each question is routed to the appropriate provider
const creativeResult = await robota.run('Write a creative poem');  // Routed to Anthropic
const factualResult = await robota.run('What is the value of pi?');  // Routed to OpenAI
```

## Provider Configuration Options

Each provider supports service-specific unique configuration options. The following are the default options supported across all providers:

```typescript
interface ProviderOptions {
  model: string;       // Name of the model to use
  temperature?: number; // Randomness/creativity of the response (0~1)
  maxTokens?: number;   // Maximum number of tokens to generate
  stopSequences?: string[]; // Stop sequences during generation
  streamMode?: boolean; // Enable streaming mode
  functionCallMode?: 'auto' | 'disabled' | 'force'; // Function call mode
  forcedFunction?: string; // Name of the function to force execute (when functionCallMode is 'force')
  forcedArguments?: Record<string, any>; // Arguments for the forced function (when functionCallMode is 'force')
}
```

## Detailed Provider Documentation

- [OpenAI Provider](providers/openai.md)
- [Anthropic Provider](providers/anthropic.md)
- [Creating Custom Provider](providers/custom.md) 