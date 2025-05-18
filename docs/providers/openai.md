# OpenAI Provider

Provider for integrating with OpenAI's GPT models. Supports various models like GPT-3.5, GPT-4, etc.

## Features

- Support for GPT models (gpt-3.5-turbo, gpt-4, gpt-4-turbo, etc.)
- Function calling feature support
- Streaming response support
- Control of various model parameters (temperature, top_p, etc.)

## Installation

```bash
npm install @robota-sdk/openai
```

## Usage

### Basic Usage

```typescript
import { Robota, OpenAIProvider } from 'robota';
import OpenAI from 'openai';

// Create OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION // Optional
});

// Initialize OpenAI provider
const provider = new OpenAIProvider({
  model: 'gpt-4',
  temperature: 0.7,
  client: openaiClient
});

// Connect provider to Robota instance
const robota = new Robota({ provider });

// Execute
const result = await robota.run('Hello! How is the weather today?');
console.log(result);
```

### Using Function Calling

```typescript
import { Robota, OpenAIProvider } from 'robota';
import OpenAI from 'openai';

// Create OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize OpenAI provider
const provider = new OpenAIProvider({
  model: 'gpt-4',
  client: openaiClient
});

// Create Robota instance
const robota = new Robota({ provider });

// Register functions
robota.registerFunctions({
  getWeather: async (location: string) => {
    // Weather lookup logic
    return { temperature: 22, condition: 'Clear', location };
  }
});

// Execute
const result = await robota.run('What is the weather in Seoul?');
console.log(result);
```

### Handling Streaming Responses

```typescript
import { Robota, OpenAIProvider } from 'robota';
import OpenAI from 'openai';

// Create OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize OpenAI provider
const provider = new OpenAIProvider({
  model: 'gpt-4',
  client: openaiClient
});

// Create Robota instance
const robota = new Robota({ provider });

// Handle streaming response
const stream = await robota.stream('Tell me a long story.');

for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

## Provider Options

OpenAI provider supports the following options:

```typescript
interface OpenAIProviderOptions extends ProviderOptions {
  // Required options
  model: string;       // Model name to use (e.g., 'gpt-4')
  client: OpenAI;      // OpenAI client instance

  // Optional options
  temperature?: number;  // Randomness/creativity of the response (0~1)
  maxTokens?: number;    // Maximum number of tokens to generate
  stopSequences?: string[]; // Stop sequences during generation
  topP?: number;         // Top-p sampling (0~1)
  presencePenalty?: number; // Discourage topic repetition (-2.0~2.0)
  frequencyPenalty?: number; // Discourage word repetition (-2.0~2.0)
  responseFormat?: {      // Specify response format
    type: 'text' | 'json_object'
  };
  user?: string;         // User identifier
}
```

## Model Selection Guide

| Model | Features | Recommended Use Cases |
|------|------|----------------|
| gpt-3.5-turbo | Fast and economical | Simple conversation, basic information processing |
| gpt-4 | More accurate and better reasoning | Complex problem solving, code writing |
| gpt-4-turbo | Latest data and enhanced features | Tasks requiring recent information |
| gpt-4-vision | Image understanding capability | Visual content analysis |

## Notes

- Always manage your OpenAI API key through environment variables or a secure secret management system.
- Setting the `maxTokens` option appropriately is recommended for cost management.
- Some features (e.g., token usage tracking) may be limited in streaming mode. 