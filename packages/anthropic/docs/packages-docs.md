# @robota-sdk/anthropic

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fanthropic.svg)](https://www.npmjs.com/package/@robota-sdk/anthropic)

Anthropic Claude integration package for Robota SDK - Large context, advanced reasoning with Claude 3.5 Sonnet and Claude 3.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/anthropic @robota-sdk/agents @anthropic-ai/sdk
```

## Overview

`@robota-sdk/anthropic` provides comprehensive integration with Anthropic's Claude models for Robota SDK. This package allows you to use Claude models with their exceptional large context windows and advanced reasoning capabilities within the Robota framework for building AI agents.

## Key Features

### 🧠 **Advanced Models**
- **Claude 3.5 Sonnet**: Latest model with enhanced reasoning and coding capabilities
- **Claude 3 Opus**: Highest intelligence for complex tasks
- **Claude 3 Sonnet**: Balanced performance and speed
- **Claude 3 Haiku**: Fast responses for simple tasks

### 📚 **Large Context Support**
- Large context windows for processing extensive documents
- Superior document understanding and analysis
- Enhanced memory for complex conversations

### ⚡ **Real-Time Streaming**
- Real-time streaming responses for better user experience
- Chunk-based processing for immediate feedback
- Background processing and asynchronous responses

### 🛠️ **Advanced Features**
- Type-safe tool use with Zod schema validation
- Automatic parameter validation and type inference
- Comprehensive error handling and logging
- Dynamic model switching and configuration

## Basic Usage

```typescript
import { Robota } from '@robota-sdk/agents';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import Anthropic from '@anthropic-ai/sdk';

// Initialize Anthropic client
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Create Anthropic provider
const provider = new AnthropicProvider({
  client: anthropicClient,
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7
});

// Create Robota instance with Anthropic provider
const robota = new Robota({
  aiProviders: {
    anthropic: provider
  },
  currentModel: 'claude-3-5-sonnet-20241022',
  systemPrompt: 'You are Claude, a helpful AI assistant created by Anthropic.'
});

// Run a simple conversation
const response = await robota.run('Tell me about the benefits of AI assistants');
console.log(response);

// Clean up resources
await robota.close();
```

## Streaming Responses

Experience real-time AI responses with streaming:

```typescript
// Streaming response for immediate feedback
const stream = await robota.runStream('Write a detailed analysis of machine learning trends');
for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

## Tool Use (Function Calling)

Anthropic provider supports Claude's advanced tool use capabilities through tool providers:

```typescript
import { Robota } from '@robota-sdk/agents';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// Create tool provider with functions
const toolProvider = createZodFunctionToolProvider({
  tools: {
    calculate: {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: z.object({
        expression: z.string().describe('Mathematical expression to evaluate')
      }),
      handler: async (params) => {
        // Implement calculation logic
        return { result: eval(params.expression) };
      }
    },
    analyzeText: {
      name: 'analyzeText',
      description: 'Analyze text for sentiment and key themes',
      parameters: z.object({
        text: z.string().describe('Text to analyze'),
        analysisType: z.enum(['sentiment', 'themes', 'summary']).default('sentiment')
      }),
      handler: async ({ text, analysisType }) => {
        // Implement text analysis logic
        return { 
          type: analysisType,
          result: `Analysis of: ${text.substring(0, 50)}...`,
          confidence: 0.95
        };
      }
    }
  }
});

// Initialize provider
const provider = new AnthropicProvider({
  client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7
});

const robota = new Robota({
  aiProviders: {
    anthropic: provider
  },
  currentModel: 'claude-3-5-sonnet-20241022',
  toolProviders: [toolProvider]
});

const response = await robota.run('Calculate 15 * 27 + 42 and analyze the sentiment of "I love AI technology"');
```

## Multi-Provider Setup

Seamlessly switch between Anthropic and other providers:

```typescript
import { OpenAIProvider } from '@robota-sdk/openai';
import { GoogleProvider } from '@robota-sdk/google';

const robota = new Robota({
  aiProviders: {
    anthropic: anthropicProvider,
    openai: openaiProvider,
    google: googleProvider
  },
  currentModel: 'claude-3-5-sonnet-20241022'
});

// Switch between models
robota.setModel({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' });
const detailedResponse = await robota.run('Explain the theory of relativity');

robota.setModel({ provider: 'anthropic', model: 'claude-3-haiku-20240307' });
const quickResponse = await robota.run('What is 2+2?');
```

## Provider Options

```typescript
interface AnthropicProviderOptions {
  client: Anthropic;        // Required: Anthropic client instance
  model?: string;           // Optional: Model name (default: 'claude-2')
  temperature?: number;     // Optional: 0-1, default 0.7
  maxTokens?: number;       // Optional: Max tokens to generate
  apiKey?: string;          // Optional: API key (if not set in client)
  timeout?: number;         // Optional: Request timeout in ms
  baseURL?: string;         // Optional: Custom API base URL
}
```

## Supported Models

Works with all Claude models including:
- claude-3-5-sonnet-20241022
- claude-3-opus-20240229
- claude-3-sonnet-20240229
- claude-3-haiku-20240307
- And future Claude models

## License

MIT 