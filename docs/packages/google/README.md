# @robota-sdk/google

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fgoogle.svg)](https://www.npmjs.com/package/@robota-sdk/google)

Google AI integration package for Robota SDK - Multimodal capabilities with Gemini 1.5 Pro and Gemini Flash.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/google @robota-sdk/core @google/generative-ai
```

## Overview

The `@robota-sdk/google` package provides comprehensive integration with Google's Generative AI models through the Robota SDK. It includes multimodal capabilities, long context support, and seamless communication with Google AI services for building advanced AI agents.

## Key Features

### 🎯 **Advanced Models**
- **Gemini 1.5 Pro**: Advanced reasoning with long context support
- **Gemini 1.5 Flash**: Fast responses with multimodal capabilities
- **Gemini Pro**: Balanced performance for general tasks
- **Gemini Pro Vision**: Advanced vision and image understanding

### 🎨 **Multimodal Support**
- Text, image, and document processing
- Vision capabilities for image analysis
- Long context windows for extensive content
- Advanced reasoning across multiple modalities

### ⚡ **Real-Time Streaming**
- Real-time streaming responses for better user experience
- Chunk-based processing for immediate feedback
- Background processing and asynchronous responses

### 🛠️ **Advanced Features**
- Type-safe function calling with Zod schema validation
- Automatic parameter validation and type inference
- Comprehensive error handling and logging
- Dynamic model switching and configuration

## Quick Start

```typescript
import { Robota } from '@robota-sdk/core';
import { GoogleProvider } from '@robota-sdk/google';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Google AI client
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY!);

// Create provider
const googleProvider = new GoogleProvider({
  client: genAI,
  model: 'gemini-1.5-pro',
  temperature: 0.7
});

// Use with Robota
const robota = new Robota({
  aiProviders: {
    google: googleProvider
  },
  currentProvider: 'google',
  currentModel: 'gemini-1.5-pro',
  systemPrompt: 'You are a helpful AI assistant powered by Google Gemini.'
});

const response = await robota.run('Hello, how are you?');
console.log(response);
```

## Streaming Responses

Experience real-time AI responses with streaming:

```typescript
// Streaming response for immediate feedback
const stream = await robota.runStream('Tell me about the future of AI technology');
for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

## Function Calling

Google provider supports advanced function calling capabilities:

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

// Create tool provider with functions
const toolProvider = createZodFunctionToolProvider({
  tools: {
    searchWeb: {
      name: 'searchWeb',
      description: 'Search the web for information',
      parameters: z.object({
        query: z.string().describe('Search query'),
        maxResults: z.number().default(5).describe('Maximum number of results')
      }),
      handler: async ({ query, maxResults }) => {
        // Implement web search logic
        return { 
          query,
          results: Array(maxResults).fill(0).map((_, i) => ({
            title: `Result ${i + 1} for ${query}`,
            url: `https://example.com/result-${i + 1}`,
            snippet: `This is a search result snippet for ${query}`
          }))
        };
      }
    },
    analyzeImage: {
      name: 'analyzeImage',
      description: 'Analyze an image for content and objects',
      parameters: z.object({
        imageUrl: z.string().describe('URL of the image to analyze'),
        analysisType: z.enum(['objects', 'text', 'sentiment']).default('objects')
      }),
      handler: async ({ imageUrl, analysisType }) => {
        // Implement image analysis logic
        return {
          imageUrl,
          analysisType,
          result: `${analysisType} analysis completed for image`,
          confidence: 0.92
        };
      }
    }
  }
});

const robota = new Robota({
  aiProviders: { google: googleProvider },
  currentProvider: 'google',
  currentModel: 'gemini-1.5-pro',
  toolProviders: [toolProvider]
});

const response = await robota.run('Search for "AI trends 2024" and analyze this image: https://example.com/ai-chart.jpg');
```

## Multi-Provider Setup

Seamlessly switch between Google and other providers:

```typescript
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

const robota = new Robota({
  aiProviders: {
    google: googleProvider,
    openai: openaiProvider,
    anthropic: anthropicProvider
  },
  currentProvider: 'google',
  currentModel: 'gemini-1.5-pro'
});

// Dynamic provider switching
robota.setCurrentAI('google', 'gemini-1.5-pro');
const geminiResponse = await robota.run('Analyze this complex data using Gemini Pro');

robota.setCurrentAI('google', 'gemini-1.5-flash');
const flashResponse = await robota.run('Quick response using Gemini Flash');
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