---
layout: home
title: Robota SDK
description: A powerful TypeScript library for building AI agents with multi-provider support
lang: en-US
---

# Robota SDK

A powerful TypeScript library for building AI agents with multi-provider support, function calling, tool integration, and multi-agent team collaboration.

## 🚀 Why Choose Robota SDK?

### 🎯 Streamlined Configuration
- **Runtime Model Switching**: Switch between AI providers and models dynamically using `setModel()`
- **Centralized Model Configuration**: Single source of truth for model settings through `defaultModel`

### 🔒 Enterprise-Grade Type Safety
- **100% TypeScript**: Complete type coverage with zero `any` types
- **Compile-time Validation**: Catch errors before they reach production
- **IntelliSense Everything**: Full IDE support for all APIs

### ⚡ Performance & Efficiency
- **Streaming Support**: Real-time responses from all providers with `runStream()`
- **Built-in Analytics**: Monitor performance, costs, and usage patterns through plugins
- **Conversation Management**: Built-in history tracking and context preservation

### 🌐 True Multi-Provider Freedom
- **Provider Agnostic**: Switch between OpenAI, Anthropic, and Google seamlessly
- **Unified Interface**: Same code works with all providers
- **Cross-Provider Teams**: Mix different AI models in one team

### 🌍 Universal Platform Support
- **Cross-Platform**: Works in Node.js, browsers, and WebWorkers
- **Zero Breaking Changes**: Existing code runs everywhere unchanged
- **Framework Agnostic**: React, Vue, Svelte, or vanilla JavaScript
- **Security First**: Proxy server patterns for secure browser deployment

## Features

- **Multi-Provider Support**: OpenAI, Anthropic, Google AI with seamless switching
- **Cross-Platform Compatibility**: Node.js, browsers, WebWorkers support
- **Multi-Agent Teams**: Create collaborative AI teams with specialized roles using `@robota-sdk/team`
- **Type-Safe Function Calling**: Zod schemas and tool integration
- **Plugin System**: Extensible architecture with conversation history, analytics, and error handling plugins
- **Streaming Support**: Real-time responses from all providers
- **Conversation Management**: Built-in history and context management
- **Team Workflow Analysis**: Generate flowcharts and relationship diagrams
- **Modular Architecture**: Clean separation of concerns

## Quick Start

### Single Agent
```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

const robota = new Robota({
    name: 'MyAssistant',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        systemMessage: 'You are a helpful AI assistant.'
    }
});

const response = await robota.run('Hello! How can I help you today?');
console.log(response);
```

### Multi-Agent Team
```typescript
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const anthropicProvider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const team = await createTeam({
    aiProviders: [openaiProvider, anthropicProvider]
});

const result = await team.execute(
    "Develop a marketing strategy for a new AI-powered fitness app"
);
console.log(result);
```

### Browser Usage
```typescript
// Works the same way in browsers!
import { Robota, LoggingPlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const robota = new Robota({
    name: 'BrowserAgent',
    aiProviders: [
        new OpenAIProvider({
            apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY // or use proxy
        })
    ],
    plugins: [
        new LoggingPlugin({ strategy: 'console' }) // browser-friendly
    ]
});

const response = await robota.run('Hello from browser!');
```

## Installation

```bash
# Core package
npm install @robota-sdk/agents

# AI Providers (choose one or more)
npm install @robota-sdk/openai openai
npm install @robota-sdk/anthropic @anthropic-ai/sdk
npm install @robota-sdk/google @google/generative-ai

# Team collaboration
npm install @robota-sdk/team
```

## 📦 Package Ecosystem

### @robota-sdk/agents
**The Core Intelligence Hub**
- 🧠 Complete agent implementation with plugin system
- 🔌 Extensible architecture for custom functionality
- 📊 Built-in performance monitoring and analytics
- 🛠️ Type-safe tool integration framework

### @robota-sdk/openai
**OpenAI Integration Excellence**
- ✨ Full GPT-4, GPT-3.5 model support
- 🔄 Automatic retry with exponential backoff
- 📈 Token usage tracking and optimization
- 🖼️ Vision model support (GPT-4V)

### @robota-sdk/anthropic
**Claude AI Mastery**
- 🎭 Claude 3.5 Sonnet & Claude 3 family support
- 📚 100K+ token context window handling
- 🧪 Advanced reasoning capabilities
- 🔒 Privacy-focused AI interactions

### @robota-sdk/google
**Google AI Innovation**
- 🌟 Gemini 1.5 Pro & Flash models
- 🎨 Native multimodal support
- 📏 1M+ token context capability
- 🚀 Fastest response times

### @robota-sdk/team
**Collaborative AI Orchestration**
- 👥 Automatic task delegation to specialized agents
- 🎯 Role-based agent selection
- 📊 Team performance analytics
- 🔄 Cross-provider collaboration

## Team Collaboration Templates

The `@robota-sdk/team` package includes pre-configured agent templates for team collaboration:

- **Task Coordinator** - Analyzes and delegates complex tasks to specialist agents
- **Domain Researcher** - Deep research and analysis using Anthropic models
- **Creative Ideator** - Brainstorming and creative solutions with higher temperature settings
- **Ethical Reviewer** - Evaluates ethical implications with focus on responsible AI
- **Fast Executor** - Quick task execution using efficient models
- **Summarizer** - Content summarization and synthesis

*Note: These templates are specifically designed for the team collaboration system and are not standalone agent configurations.*

## Documentation

### For Users
- **[Getting Started](getting-started/)** - Installation, setup, and basic usage
- **[Guide](guide/)** - Core concepts and advanced features
- **[AI Providers](providers/)** - OpenAI, Anthropic, Google AI configuration
- **[Examples](examples/)** - Comprehensive examples and tutorials
- **[Team Collaboration](team.md)** - Multi-agent team setup and workflows
- **[Protocols](protocols/)** - Model Context Protocol and integrations

### For Developers
- **[Development](development/)** - Development guidelines and setup
- **[Project](project/)** - Project roadmap and information
- **[Packages](packages/)** - Individual package documentation

## Supported Providers

| Provider | Models | Features | Best For |
|----------|--------|----------|----------|
| **OpenAI** | GPT-4, GPT-3.5 | Function calling, streaming, vision | General purpose, code generation |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 | Large context, advanced reasoning | Complex analysis, ethical considerations |
| **Google** | Gemini 1.5 Pro, Gemini Flash | Multimodal, long context | Speed, multimedia processing |

## Team Collaboration Features

- **Automatic Agent Selection** - Natural language task assignment
- **Template-based Configuration** - Pre-optimized settings for each role
- **Workflow Visualization** - Generate Mermaid diagrams of team processes
- **Performance Analytics** - Track team efficiency and token usage
- **Cross-Provider Teams** - Mix different AI providers in one team

## 🎯 Key Benefits

- **Rapid Development**: Build AI agents with minimal boilerplate code
- **Type Safety**: Complete TypeScript coverage with zero `any` types
- **Provider Flexibility**: Easy switching between OpenAI, Anthropic, and Google AI
- **Extensible Architecture**: Plugin system for custom functionality

## License

MIT License - see LICENSE file for details. 
