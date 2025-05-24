# @robota-sdk/core

Core package for Robota SDK - A TypeScript library for building AI agents with ease.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/core
```

## Overview

`@robota-sdk/core` provides the foundation for building AI agents with Robota SDK. It includes the core functionality for creating agents, managing conversations, and integrating with various AI providers.

**Note:** Tool and function creation utilities have moved to [`@robota-sdk/tools`](../tools/README.md). For tool-related functionality, please refer to the tools package documentation.

## Basic Usage

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';
import OpenAI from 'openai';

// Create tool providers
const toolProvider = createZodFunctionToolProvider({
  tools: {
    getWeather: {
      name: 'getWeather',
      description: 'Get weather information',
      parameters: z.object({
        location: z.string().describe('City name')
      }),
      handler: async ({ location }) => {
        return { temperature: 22, condition: 'Sunny' };
      }
    }
  }
});

// Create a new Robota instance
const robota = new Robota({
  aiProviders: {
    openai: new OpenAIProvider({
      client: new OpenAI({ apiKey: 'your-api-key' })
    })
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [toolProvider],
  systemPrompt: 'You are a helpful AI assistant.'
});

// Run a simple conversation
const response = await robota.run('Tell me about TypeScript');
console.log(response);

// Stream a response
const stream = await robota.runStream('What is the weather like?');
for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

## Features

- Provider-agnostic architecture
- Support for multiple AI models and providers
- Streaming responses
- Conversation memory management
- System message configuration
- Manager-based architecture for modularity
- Re-exports tool and function utilities from `@robota-sdk/tools`

## Architecture

The core package provides:
- **Robota**: Main agent class with conversation management
- **Managers**: AI provider, tool provider, system message, and function call managers
- **Memory**: Conversation memory interfaces and implementations
- **Services**: Conversation service for handling AI interactions
- **Interfaces**: Core interfaces for AI providers, messages, and contexts

Tool and function creation capabilities are provided by the `@robota-sdk/tools` package.

## License

MIT 