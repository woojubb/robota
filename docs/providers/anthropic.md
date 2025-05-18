# Anthropic Provider

Provider for integrating with Anthropic's Claude models. Supports various models like Claude, Claude Instant, etc.

## Features

- Support for Claude models (claude-3-opus, claude-3-sonnet, etc.)
- Function calling (Tool Use) support
- Streaming response support
- High-quality reasoning and safety mechanisms

## Installation

```bash
npm install @robota-sdk/anthropic
```

## Usage

### Basic Usage

```typescript
import { Robota, AnthropicProvider } from 'robota';
import Anthropic from '@anthropic-ai/sdk';

// Create Anthropic client
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Initialize Anthropic provider
const provider = new AnthropicProvider({
  model: 'claude-3-opus',
  temperature: 0.7,
  client: anthropicClient
});

// Connect provider to Robota instance
const robota = new Robota({ provider });

// Execute
const result = await robota.run('Hello! How is the weather today?');
console.log(result);
```

### Using Function Calling

```typescript
import { Robota, AnthropicProvider } from 'robota';
import Anthropic from '@anthropic-ai/sdk';

// Create Anthropic client
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Initialize Anthropic provider
const provider = new AnthropicProvider({
  model: 'claude-3-opus',
  client: anthropicClient
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
import { Robota, AnthropicProvider } from 'robota';
import Anthropic from '@anthropic-ai/sdk';

// Create Anthropic client
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Initialize Anthropic provider
const provider = new AnthropicProvider({
  model: 'claude-3-opus',
  client: anthropicClient
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

Anthropic provider supports the following options:

```typescript
interface AnthropicProviderOptions extends ProviderOptions {
  // Required options
  model: string;       // Model name to use (e.g., 'claude-3-opus')
  client: Anthropic;   // Anthropic client instance

  // Optional options
  temperature?: number;  // Randomness/creativity of the response (0~1)
  maxTokens?: number;    // Maximum number of tokens to generate
  stopSequences?: string[]; // Stop sequences during generation
  topP?: number;         // Top-p sampling (0~1)
  topK?: number;         // Top-k sampling
}
```

## Model Selection Guide

| Model | Features | Recommended Use Cases |
|------|------|----------------|
| claude-3-opus | Highest performance, complex reasoning | High-quality content generation, complex problem solving |
| claude-3-sonnet | Balanced performance and speed | General conversation, medium complexity tasks |
| claude-3-haiku | Fast speed, economical | Simple tasks, when high volume is needed |

## Notes

- Always manage your Anthropic API key through environment variables or a secure secret management system.
- Claude models use a different function calling mechanism (Tool Use) than OpenAI. Robota abstracts these differences, but there may be model-specific limitations for certain features.
- Content safety filtering may be stricter than other models. 