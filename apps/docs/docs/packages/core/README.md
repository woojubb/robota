# @robota-sdk/core

Core package for Robota SDK - A TypeScript library for building AI agents with ease.

## Installation

```bash
npm install @robota-sdk/core
```

## Overview

`@robota-sdk/core` provides the foundation for building AI agents with Robota SDK. It includes the core functionality for creating agents, managing conversations, and integrating with various AI providers.

## Basic Usage

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// Create a new Robota instance
const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: new OpenAI({ apiKey: 'your-api-key' })
  }),
  systemPrompt: 'You are a helpful AI assistant.'
});

// Run a simple conversation
const response = await robota.run('Tell me about TypeScript');
console.log(response);

// Stream a response
const stream = await robota.runStream('Explain AI agents');
for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

## Features

- Provider-agnostic architecture
- Support for multiple AI models and providers
- Streaming responses
- Structured function calling
- Type-safe API

## License

MIT 