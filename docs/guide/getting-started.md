---
title: Getting Started
description: Getting started with Robota
lang: en-US
---

# Getting Started

Learn how to build powerful AI agents with Robota.

## Installation

Install the core package along with your preferred AI provider:

```bash
# Using npm
npm install @robota-sdk/core @robota-sdk/openai
npm install openai  # OpenAI client

# Using pnpm
pnpm add @robota-sdk/core @robota-sdk/openai
pnpm add openai

# Using yarn
yarn add @robota-sdk/core @robota-sdk/openai
yarn add openai
```

### Available Providers

- `@robota-sdk/openai` - OpenAI GPT models (GPT-3.5, GPT-4, etc.)
- `@robota-sdk/anthropic` - Anthropic Claude models  
- `@robota-sdk/google` - Google AI Gemini models
- `@robota-sdk/tools` - Tool providers for function calling

## Basic Usage

Here's how to set up and use Robota for simple conversations:

```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    // Validate API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    // Create OpenAI client
    const openaiClient = new OpenAI({
        apiKey
    });

    // Create OpenAI Provider
    const openaiProvider = new OpenAIProvider(openaiClient);

    // Create Robota instance
    const robota = new Robota({
        aiProviders: {
            'openai': openaiProvider
        },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'You are a helpful AI assistant. Provide concise and useful responses.'
    });

    // Simple conversation
    const response = await robota.run('Hello! Tell me about TypeScript.');
    console.log('Response:', response);
}

main().catch(console.error);
```

## Streaming Responses

Get real-time streaming responses:

```typescript
// Streaming response example
console.log('Streaming response:');

const stream = await robota.runStream('Explain the advantages of TypeScript briefly.');

for await (const chunk of stream) {
    process.stdout.write(chunk.content || '');
}
console.log('\n');
```

## Multiple AI Providers

Use different AI providers and switch between them:

```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import { GoogleProvider } from '@robota-sdk/google';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';

// Create clients
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Create providers
const openaiProvider = new OpenAIProvider(openaiClient);
const googleProvider = new GoogleProvider({ client: googleClient });
const anthropicProvider = new AnthropicProvider({ client: anthropicClient });

// Setup Robota with multiple providers
const robota = new Robota({
    aiProviders: {
        openai: openaiProvider,
        google: googleProvider,
        anthropic: anthropicProvider
    },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo'
});

// Check current AI settings
const currentAI = robota.getCurrentAI();
console.log(`Current Provider: ${currentAI.provider}`);
console.log(`Current Model: ${currentAI.model}`);

// Switch to different provider/model
robota.setCurrentAI('google', 'gemini-1.5-flash');
const response = await robota.run('Hello from Google AI!');

// Switch to Anthropic
robota.setCurrentAI('anthropic', 'claude-3-sonnet');
const response2 = await robota.run('Hello from Anthropic!');
```

## Using Tools and Function Calling

Enhance your AI with custom tools:

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

// Define a calculator tool
const calculatorTool = {
    name: 'calculate',
    description: 'Performs mathematical calculations',
    parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('Operation to perform'),
        a: z.number().describe('First number'),
        b: z.number().describe('Second number')
    }),
    handler: async (params) => {
        const { operation, a, b } = params;
        console.log(`[Tool] Calculating: ${a} ${operation} ${b}`);
        
        let result;
        switch (operation) {
            case 'add': result = { result: a + b }; break;
            case 'subtract': result = { result: a - b }; break;
            case 'multiply': result = { result: a * b }; break;
            case 'divide': result = b !== 0 ? { result: a / b } : { error: 'Cannot divide by zero' }; break;
        }
        
        console.log(`[Tool] Result:`, result);
        return result;
    }
};

// Create tool provider
const toolProvider = createZodFunctionToolProvider({
    tools: {
        calculate: calculatorTool
    }
});

// AI with tools
const robota = new Robota({
    aiProviders: {
        'openai': openaiProvider
    },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    toolProviders: [toolProvider],
    systemPrompt: 'You are a helpful AI assistant. Use the calculate tool for mathematical operations.',
    debug: true  // Enable tool call logging
});

// AI will automatically use the calculator tool
const response = await robota.run('Please calculate 15 multiplied by 7 using the calculator tool.');
console.log('Response:', response);
```

## Environment Variables

Create a `.env` file in your project root:

```bash
# OpenAI
OPENAI_API_KEY=your_openai_api_key_here

# Google AI (optional)
GOOGLE_AI_API_KEY=your_google_ai_api_key_here

# Anthropic (optional)
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

## Next Steps

- Read [Core Concepts](./core-concepts.md) to understand Robota's architecture
- Explore [Function Calling](./function-calling.md) for advanced tool integration
- Learn about [Building Agents](./building-agents.md) for complex AI workflows
- Check out the [AI Providers](../providers.md) documentation
- View complete examples in the `apps/examples` directory of the repository 