# @robota-sdk/anthropic

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fanthropic.svg)](https://www.npmjs.com/package/@robota-sdk/anthropic)

Anthropic Claude integration package for Robota SDK.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/anthropic @robota-sdk/core @anthropic-ai/sdk
```

## Overview

`@robota-sdk/anthropic` provides integration with Anthropic's Claude models for Robota SDK. This package allows you to use Claude models within the Robota framework for building AI agents.

## Basic Usage

```typescript
import { Robota } from '@robota-sdk/core';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import Anthropic from '@anthropic-ai/sdk';

// Initialize Anthropic client
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Create Anthropic provider
const provider = new AnthropicProvider({
  client: anthropicClient
});

// Create Robota instance with Anthropic provider
const robota = new Robota({
  aiProviders: {
    anthropic: provider
  },
  currentProvider: 'anthropic',
  currentModel: 'claude-3-opus-20240229',
  systemPrompt: 'You are Claude, a helpful AI assistant.'
});

// Run a simple conversation
const response = await robota.run('Tell me about the benefits of AI assistants');
console.log(response);
```

## Function Calling

Anthropic provider supports Claude's tool use capabilities through tool providers:

```typescript
import { Robota } from '@robota-sdk/core';
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
    }
  }
});

// Initialize provider
const provider = new AnthropicProvider({
  client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
});

const robota = new Robota({
  aiProviders: {
    anthropic: provider
  },
  currentProvider: 'anthropic',
  currentModel: 'claude-3-opus-20240229',
  toolProviders: [toolProvider]
});

const response = await robota.run('Calculate 15 * 27 + 42');
```

## Supported Models

Works with all Claude models including:
- Claude 3 Opus
- Claude 3 Sonnet
- Claude 3 Haiku
- And future Claude models

## License

MIT 