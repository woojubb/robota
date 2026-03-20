---
layout: home
title: Robota SDK
description: A powerful TypeScript library for building AI agents with multi-provider support
lang: en-US
---

# Robota SDK

A powerful TypeScript library for building AI agents with multi-provider support, function calling, and tool integration.

## 🚀 Why Choose Robota SDK?

### 🎯 Streamlined Configuration

- **Runtime Model Switching**: Switch between AI providers and models dynamically using `setModel()`
- **Centralized Model Configuration**: Single source of truth for model settings through `defaultModel`

### 🔒 Enterprise-Grade Type Safety

- **100% TypeScript**: Complete type coverage — `any` prohibited in production code
- **Compile-time Validation**: Catch errors before they reach production
- **IntelliSense Everything**: Full IDE support for all APIs

### ⚡ Performance & Efficiency

- **Streaming Support**: Real-time responses from all providers with `runStream()`
- **Built-in Analytics**: Monitor performance, costs, and usage patterns through plugins
- **Conversation Management**: Built-in history tracking and context preservation

### 🌐 True Multi-Provider Freedom

- **Provider Agnostic**: Switch between OpenAI, Anthropic, and Google seamlessly
- **Unified Interface**: Same code works with all providers
- **Cross-Provider Workflows**: Mix different AI models in one workflow

### 🌍 Universal Platform Support

- **Cross-Platform**: Works in Node.js, browsers, and WebWorkers
- **Zero Breaking Changes**: Existing code runs everywhere unchanged
- **Framework Agnostic**: React, Vue, Svelte, or vanilla JavaScript
- **Security First**: Proxy server patterns for secure browser deployment

## Features

- **Multi-Provider Support**: OpenAI, Anthropic, Google AI with seamless switching
- **Cross-Platform Compatibility**: Node.js, browsers, WebWorkers support
- **assignTask MCP Tools**: Use `@robota-sdk/agent-team` for assignTask tool collection (team creation removed)
- **Type-Safe Function Calling**: Zod schemas and tool integration
- **Plugin System**: Extensible architecture with conversation history, analytics, and error handling plugins
- **Streaming Support**: Real-time responses from all providers
- **Conversation Management**: Built-in history and context management
- **Team Workflow Analysis**: Generate flowcharts and relationship diagrams
- **Modular Architecture**: Clean separation of concerns

## Quick Start

### Single Agent

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

const robota = new Robota({
  name: 'MyAssistant',
  aiProviders: [openaiProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4',
    systemMessage: 'You are a helpful AI assistant.',
  },
});

const response = await robota.run('Hello! How can I help you today?');
console.log(response);
```

### assignTask MCP Tool Collection (team package)

```typescript
import {
  createAssignTaskRelayTool,
  listTemplatesTool,
  getTemplateDetailTool,
} from '@robota-sdk/agent-team';
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

const tools = [
  listTemplatesTool,
  getTemplateDetailTool,
  // NOTE: eventService must be ownerPath-bound via bindWithOwnerPath()
  createAssignTaskRelayTool(eventService),
];

const robota = new Robota({
  name: 'Assistant',
  aiProviders: [openaiProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4',
  },
  tools,
});

const result = await robota.run('Summarize the advantages of TypeScript for large codebases.');
console.log(result);
```

### Browser Usage

```typescript
// Works the same way in browsers!
import { Robota, LoggingPlugin } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const robota = new Robota({
  name: 'BrowserAgent',
  aiProviders: [
    new OpenAIProvider({
      apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY, // or use proxy
    }),
  ],
  plugins: [
    new LoggingPlugin({ strategy: 'console', level: 'info' }), // browser-friendly
  ],
});

const response = await robota.run('Hello from browser!');
```

## Installation

```bash
# Core package
npm install @robota-sdk/agent-core

# AI Providers (choose one or more)
npm install @robota-sdk/agent-provider-openai openai
npm install @robota-sdk/agent-provider-anthropic @anthropic-ai/sdk
npm install @robota-sdk/agent-provider-google @google/generative-ai

# assignTask tool collection (team package)
npm install @robota-sdk/agent-team
```

## 📦 Package Ecosystem

### @robota-sdk/agent-core

**The Core Intelligence Hub**

- 🧠 Complete agent implementation with plugin system
- 🔌 Extensible architecture for custom functionality
- 📊 Built-in performance monitoring and analytics
- 🛠️ Type-safe tool integration framework

### @robota-sdk/agent-provider-openai

**OpenAI Integration Excellence**

- ✨ Full GPT-4, GPT-3.5 model support
- 🔄 Automatic retry with exponential backoff
- 📈 Token usage tracking and optimization
- 🖼️ Vision model support (GPT-4V)

### @robota-sdk/agent-provider-anthropic

**Claude AI Mastery**

- 🎭 Claude 3.5 Sonnet & Claude 3 family support
- 📚 100K+ token context window handling
- 🧪 Advanced reasoning capabilities
- 🔒 Privacy-focused AI interactions

### @robota-sdk/agent-provider-google

**Google AI Innovation**

- 🌟 Gemini 1.5 Pro & Flash models
- 🎨 Native multimodal support
- 📏 1M+ token context capability
- 🚀 Fastest response times

### @robota-sdk/agent-team

**assignTask Tool Collection**

- MCP-style tools: listTemplateCategories, listTemplates, getTemplateDetail, assignTask
- Built-in templates stored in package JSON
- Team creation removed; use Robota agents + assignTask tools instead

## Documentation

### For Users

- **[Getting Started](getting-started/)** - Installation, setup, and basic usage
- **[Guide](guide/)** - Core concepts and advanced features
- **[AI Providers](providers/)** - OpenAI, Anthropic, Google AI configuration
- **[Examples](examples/)** - Comprehensive examples and tutorials
- **[assignTask Tooling](team.md)** - assignTask MCP tool collection (team creation removed)
- **[Protocols](protocols/)** - Model Context Protocol and integrations

### For Developers

- **[Development](development/)** - Development guidelines and setup
- **[Project](project/)** - Project roadmap and information
- **[Packages](packages/)** - Individual package documentation

## Supported Providers

| Provider      | Models                       | Features                            | Best For                                 |
| ------------- | ---------------------------- | ----------------------------------- | ---------------------------------------- |
| **OpenAI**    | GPT-4, GPT-3.5               | Function calling, streaming, vision | General purpose, code generation         |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3  | Large context, advanced reasoning   | Complex analysis, ethical considerations |
| **Google**    | Gemini 1.5 Pro, Gemini Flash | Multimodal, long context            | Speed, multimedia processing             |

## assignTask Tool Collection

- **MCP-style tools** - `listTemplateCategories`, `listTemplates`, `getTemplateDetail`, `assignTask`
- **Bundled templates** - JSON templates shipped with `@robota-sdk/agent-team`
- **No team creation APIs** - Use Robota agents + tools; relationships come from events/ownerPath only

## 🎯 Key Benefits

- **Rapid Development**: Build AI agents with minimal boilerplate code
- **Type Safety**: Complete TypeScript coverage — `any` prohibited in production code
- **Provider Flexibility**: Easy switching between OpenAI, Anthropic, and Google AI
- **Extensible Architecture**: Plugin system for custom functionality

## License

MIT License - see LICENSE file for details.
