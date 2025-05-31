# AI Providers

Robota SDK supports multiple AI providers, allowing you to switch between different models and services seamlessly.

## Supported Providers

- **[OpenAI](openai.md)** - GPT-4, GPT-3.5, and other OpenAI models
- **[Anthropic](anthropic.md)** - Claude 3.5 Sonnet, Claude 3 Haiku, and other Claude models  
- **[Google](google.md)** - Gemini Pro, Gemini Flash, and other Google AI models
- **[Custom Providers](custom.md)** - Build your own provider for any AI service

## Quick Start

Each provider has its own setup guide with examples. Start with the provider you want to use:

```typescript
// OpenAI Example
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const provider = new OpenAIProvider(openaiClient);
```

## Provider Features

All providers support:
- ✅ Text generation
- ✅ Function calling
- ✅ Streaming responses
- ✅ Conversation history
- ✅ Token usage tracking

## Next Steps

Choose a provider to get started, or learn about [Function Calling](../guide/function-calling.md) to add tools to your agents. 