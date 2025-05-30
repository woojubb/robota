# Robota SDK Documentation

A powerful TypeScript library for building AI agents with multi-provider support, built with a modular Manager pattern architecture.

## Features

- **Multi-Provider Support**: OpenAI, Anthropic, Google AI with easy provider switching
- **Manager Pattern Architecture**: Clean separation with AIProviderManager, ToolProviderManager, SystemMessageManager, etc.
- **Type-Safe Function Calling**: Zod-based tools, MCP integration, OpenAPI support
- **Conversation Management**: Built-in history management with configurable limits
- **Analytics & Monitoring**: Request tracking, token usage analytics, limit management
- **Streaming Support**: Real-time streaming across all providers

## Documentation Structure

### Main Documentation

- [Home](index.md) - Overview and quick start guide
- [AI Providers & Tools](providers.md) - Learn about supported providers and tools
- [Examples](examples/examples.md) - Comprehensive examples and tutorials
- [API Reference](api-reference.md) - Complete API documentation

### Getting Started

- [Environment Setup](environment-setup.md) - Detailed setup instructions
- [Development Guidelines](development-guidelines.md) - Architecture patterns and best practices

### Core Documentation

- [Architecture Overview](development-guidelines.md#architecture-patterns) - Manager pattern and service layer
- [System Messages](system-messages.md) - System message management strategies

### Package Documentation

- [Core Package](packages/core/README.md) - Core functionality with Manager pattern
- [OpenAI Package](packages/openai/README.md) - OpenAI provider integration
- [Anthropic Package](packages/anthropic/README.md) - Anthropic provider integration
- [Google Package](packages/google/README.md) - Google AI provider integration
- [Tools Package](packages/tools/README.md) - Function calling and tool providers

### Development Standards

- [Testing Guidelines](testing-guidelines.md) - Mock usage and test organization
- [Build and Deployment](build-and-deployment.md) - Build configuration and CI/CD
- [Code Quality Standards](code-quality-standards.md) - Linting and console output guidelines
- [Code Improvements](code-improvements.md) - Implementation patterns and refactoring

### Advanced Topics

- [OpenAPI Integration](openapi-integration.md) - OpenAPI tool integration
- [Package Publishing](package-publishing.md) - Package publishing guidelines
- [Documentation Site Setup](documentation-site-setup.md) - Documentation website setup

### Project Management

- [Roadmap](roadmap.md) - Project roadmap and future plans

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

## Quick Links

- **Examples**: Check out comprehensive examples in [`apps/examples`](examples/examples.md)
- **Providers**: Learn about [AI Providers & Tools](providers.md)
- **Architecture**: Understand the [Manager Pattern](development-guidelines.md#architecture-patterns)
- **Contributing**: Read our [Development Guidelines](development-guidelines.md)

## Current Version

Core package: v0.3.2 - Latest stable release with Manager pattern architecture

## License

MIT License - see LICENSE file for details. 
