# @robota-sdk/google

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fgoogle.svg)](https://www.npmjs.com/package/@robota-sdk/google)

Google AI provider package for Robota SDK.

## Overview

The `@robota-sdk/google` package provides integration with Google's Generative AI models through the Robota SDK. It includes a provider implementation and conversation adapter for seamless communication with Google AI services.

## Installation

```bash
npm install @robota-sdk/google
# or
pnpm add @robota-sdk/google
# or
yarn add @robota-sdk/google
```

## Features

- **Google AI Provider**: Complete implementation of the AIProvider interface for Google Generative AI
- **Conversation Adapter**: Converts UniversalMessage format to Google AI's expected format
- **Function Calling Support**: Handles function calls and tool responses
- **System Message Handling**: Properly processes system instructions
- **TypeScript Support**: Full type safety with TypeScript definitions

## Quick Start

```typescript
import { GoogleProvider } from '@robota-sdk/google';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Google AI client
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// Create provider
const googleProvider = new GoogleProvider({
  client: genAI,
  model: 'gemini-pro',
  temperature: 0.7
});

// Use with Robota
import { Robota } from '@robota-sdk/core';

const robota = new Robota({
  aiProviders: {
    google: googleProvider
  },
  currentProvider: 'google',
  currentModel: 'gemini-pro'
});

const response = await robota.run('Hello, how are you?');
console.log(response);
```

## API Reference

### GoogleProvider

The main provider class that implements the AIProvider interface.

#### Constructor Options

```typescript
interface GoogleProviderOptions {
  client: GoogleGenerativeAI;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
```

#### Methods

- `chat(model: string, context: Context, options?: any): Promise<ModelResponse>`
- `chatStream(model: string, context: Context, options?: any): AsyncGenerator<StreamingResponseChunk>`
- `close(): Promise<void>`

### GoogleConversationAdapter

Utility class for converting between UniversalMessage and Google AI formats.

#### Static Methods

- `toGoogleFormat(messages: UniversalMessage[]): any[]`
- `convertMessage(msg: UniversalMessage): any`
- `extractSystemInstruction(messages: UniversalMessage[], fallbackSystemPrompt?: string): string | undefined`
- `processMessages(messages: UniversalMessage[], systemPrompt?: string): { contents: any[], systemInstruction?: string }`

## Message Format Conversion

The adapter handles conversion between Robota's UniversalMessage format and Google AI's expected format:

### UniversalMessage → Google AI Format

- `user` → `{ role: 'user', parts: [{ text: content }] }`
- `assistant` → `{ role: 'model', parts: [{ text: content }] }`
- `system` → Converted to system instruction or user message with `[System]:` prefix
- `tool` → `{ role: 'function', parts: [{ functionResponse: {...} }] }`

### Function Calls

Function calls are included in the `parts` array:

```typescript
{
  role: 'model',
  parts: [
    { text: content },
    {
      functionCall: {
        name: functionName,
        args: functionArguments
      }
    }
  ]
}
```

## Configuration

### Environment Variables

- `GOOGLE_API_KEY`: Your Google AI API key

### Provider Options

```typescript
const provider = new GoogleProvider({
  client: genAI,
  model: 'gemini-pro',           // Default model
  temperature: 0.7,              // Response creativity (0-1)
  maxTokens: 1000               // Maximum response length
});
```

## Error Handling

The provider includes comprehensive error handling:

```typescript
try {
  const response = await robota.run('Your message');
} catch (error) {
  if (error.message.includes('Google AI API call error')) {
    // Handle Google AI specific errors
  }
}
```

## Supported Models

The provider supports all Google Generative AI models, including:

- `gemini-pro`
- `gemini-pro-vision`
- `gemini-1.5-pro`
- `gemini-1.5-flash`

## Examples

### Basic Chat

```typescript
const response = await robota.run('Explain quantum computing');
```

### Streaming Response

```typescript
for await (const chunk of robota.runStream('Tell me a story')) {
  process.stdout.write(chunk.content || '');
}
```

### With System Prompt

```typescript
const robota = new Robota({
  aiProviders: { google: googleProvider },
  currentProvider: 'google',
  systemPrompt: 'You are a helpful coding assistant.'
});
```

## License

MIT License - see the [LICENSE](../../../LICENSE) file for details. 