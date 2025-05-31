# Robota SDK

A powerful TypeScript library for building AI agents with multi-provider support, function calling, and tool integration.

## Features

- **Multi-Provider Support**: OpenAI, Anthropic, Google AI with easy provider switching
- **Type-Safe Function Calling**: Zod-based tools, MCP integration, OpenAPI support
- **Conversation Management**: Built-in history management with configurable limits
- **Analytics & Monitoring**: Request tracking, token usage analytics, limit management
- **Streaming Support**: Real-time streaming across all providers

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

## Documentation

### For Users
- **[Getting Started Guide](guide/)** - Installation, setup, and basic usage
- **[AI Providers](providers/)** - OpenAI, Anthropic, Google AI configuration
- **[Examples](examples/)** - Comprehensive examples and tutorials
- **[API Reference](api-reference/)** - Complete API documentation

### For Contributors
- **[Development Setup](development-guidelines.md)** - Environment setup and architecture
- **[Testing Guidelines](testing-guidelines.md)** - Testing patterns and best practices
- **[Build & Deployment](build-and-deployment.md)** - CI/CD and release process

## Current Version

Core package: v0.3.2 - Latest stable release

## License

MIT License - see LICENSE file for details. 
