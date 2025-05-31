---
layout: home
title: Robota SDK
description: A powerful TypeScript library for building AI agents with multi-provider support
lang: en-US
---

# Robota SDK

A powerful TypeScript library for building AI agents with multi-provider support, function calling, and tool integration.

## Features

- **Multi-Provider Support**: OpenAI, Anthropic, Google AI with seamless switching
- **Type-Safe Function Calling**: Zod schemas and tool integration
- **Streaming Support**: Real-time responses from all providers
- **Conversation Management**: Built-in history and context management
- **Modular Architecture**: Clean separation of concerns

## Quick Start

```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiProvider = new OpenAIProvider(openaiClient);

const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    systemPrompt: 'You are a helpful AI assistant.'
});

const response = await robota.run('Hello! How can I help you today?');
console.log(response);
```

## Installation

```bash
# Core package
npm install @robota-sdk/core

# AI Providers (choose one or more)
npm install @robota-sdk/openai openai
npm install @robota-sdk/anthropic @anthropic-ai/sdk
npm install @robota-sdk/google @google/generative-ai

# Tools for function calling
npm install @robota-sdk/tools zod
```

## Documentation

### For Users
- **[Getting Started](guide/)** - Installation, setup, and basic usage
- **[AI Providers](providers/)** - OpenAI, Anthropic, Google AI configuration
- **[Examples](examples/)** - Comprehensive examples and tutorials
- **[API Reference](api-reference/)** - Complete API documentation

### For Contributors
- **[Development Setup](development-guidelines.md)** - Environment setup and architecture
- **[Testing Guidelines](testing-guidelines.md)** - Testing patterns and best practices
- **[Build & Deployment](build-and-deployment.md)** - CI/CD and release process

## Supported Providers

| Provider | Models | Features |
|----------|--------|----------|
| **OpenAI** | GPT-4, GPT-3.5 | Function calling, streaming, vision |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 | Large context, advanced reasoning |
| **Google** | Gemini 1.5 Pro, Gemini Flash | Multimodal, long context |

## License

MIT License - see LICENSE file for details. 