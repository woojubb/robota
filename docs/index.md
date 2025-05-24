---
layout: home
title: Robota
description: A simple, powerful library for building AI agents with JavaScript
lang: en-US
---

# Robota

A simple, powerful library for building AI agents with JavaScript

## Features

- **Easy Agent Building**: Build powerful AI agents with minimal code using our intuitive APIs
- **Multi-Provider Support**: Seamlessly work with OpenAI, Anthropic, Google AI, and more
- **Modular Architecture**: Clean separation between core functionality, providers, and tools
- **Type-Safe Tools**: Modern tool system with automatic schema validation using Zod
- **Function Calling**: Enable AI to interact with your application through custom functions
- **Streaming Support**: Real-time streaming responses from all supported providers
- **Provider Switching**: Dynamically switch between different AI providers and models
- **Rich Tool Ecosystem**: Support for Zod schemas, MCP (Model Context Protocol), and OpenAPI tools

## Quick Start

```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';

// Create OpenAI client
const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Create Robota instance
const robota = new Robota({
    aiProviders: {
        'openai': new OpenAIProvider(openaiClient)
    },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo'
});

// Simple conversation
const response = await robota.run('Hello! How can I help you today?');
console.log(response);
```

## Supported AI Providers

- **OpenAI** - GPT-3.5, GPT-4, GPT-4o and all variants
- **Anthropic** - Claude 3 Sonnet, Claude 3 Opus, Claude 3 Haiku
- **Google AI** - Gemini 1.5 Flash, Gemini 1.5 Pro, Gemini 1.0 Pro
- **Custom Providers** - Easy to implement your own provider

## Advanced Features

### Multi-Provider Setup

```typescript
import { GoogleProvider } from '@robota-sdk/google';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

const robota = new Robota({
    aiProviders: {
        openai: new OpenAIProvider(openaiClient),
        google: new GoogleProvider({ client: new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY) }),
        anthropic: new AnthropicProvider({ client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) })
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4'
});

// Switch providers dynamically
robota.setCurrentAI('google', 'gemini-1.5-flash');
robota.setCurrentAI('anthropic', 'claude-3-sonnet');
```

### Function Calling with Tools

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

const weatherTool = {
    name: 'getWeather',
    description: 'Get current weather for a location',
    parameters: z.object({
        location: z.string().describe('City name'),
        unit: z.enum(['celsius', 'fahrenheit']).optional()
    }),
    handler: async ({ location, unit = 'celsius' }) => {
        // Your weather API call here
        return { temperature: 22, condition: 'sunny', unit };
    }
};

const toolProvider = createZodFunctionToolProvider({
    tools: { getWeather: weatherTool }
});

const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    toolProviders: [toolProvider]
});

// AI will automatically use the weather tool
const response = await robota.run('What is the weather like in Tokyo?');
```

## Architecture

Robota is built with a modular architecture:

- **@robota-sdk/core**: Core agent functionality, conversation management, and AI provider integration
- **@robota-sdk/openai**: OpenAI provider integration with GPT models
- **@robota-sdk/anthropic**: Anthropic provider integration with Claude models  
- **@robota-sdk/google**: Google AI provider integration with Gemini models
- **@robota-sdk/tools**: Comprehensive tool system with BaseTool, ZodTool, McpTool, and OpenApiTool

## Installation

```bash
# Core package + OpenAI provider
npm install @robota-sdk/core @robota-sdk/openai openai

# Add other providers as needed
npm install @robota-sdk/anthropic @anthropic-ai/sdk
npm install @robota-sdk/google @google/generative-ai

# Tools for function calling
npm install @robota-sdk/tools zod
```

## Get Started

Ready to build your first AI agent? Check out our [Getting Started Guide](./guide/getting-started.md) to begin your journey with Robota!

### Quick Links

- [Getting Started](./guide/getting-started.md) - Start building your first agent
- [Core Concepts](./guide/core-concepts.md) - Understand Robota's architecture
- [Function Calling](./guide/function-calling.md) - Add custom tools to your AI
- [AI Providers](./providers.md) - Learn about supported AI providers
- [Examples](./examples.md) - View complete example projects 