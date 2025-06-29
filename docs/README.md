---
layout: home
title: Robota SDK
description: A powerful TypeScript library for building AI agents with multi-provider support
lang: en-US
---

# Robota SDK

A powerful TypeScript library for building AI agents with multi-provider support, function calling, tool integration, and multi-agent team collaboration.

## Features

- **Multi-Provider Support**: OpenAI, Anthropic, Google AI with seamless switching
- **Multi-Agent Teams**: Create collaborative AI teams with specialized roles
- **Built-in Agent Templates**: 6 pre-configured templates for common use cases
- **Type-Safe Function Calling**: Zod schemas and tool integration
- **Streaming Support**: Real-time responses from all providers
- **Conversation Management**: Built-in history and context management
- **Team Workflow Analysis**: Generate flowcharts and relationship diagrams
- **Modular Architecture**: Clean separation of concerns

## Quick Start

### Single Agent
```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
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

### Multi-Agent Team
```typescript
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

const team = await createTeam({
    aiProviders: {
        openai: openaiProvider,
        anthropic: anthropicProvider
    }
});

const result = await team.execute(
    "Develop a marketing strategy for a new AI-powered fitness app"
);
console.log(result);
```

## Installation

```bash
# Core package
npm install @robota-sdk/agents

# AI Providers (choose one or more)
npm install @robota-sdk/openai openai
npm install @robota-sdk/anthropic @anthropic-ai/sdk
npm install @robota-sdk/google @google/generative-ai

# Tools for function calling
npm install @robota-sdk/tools zod

# Team collaboration
npm install @robota-sdk/team

# Session management
npm install @robota-sdk/sessions
```

## Built-in Agent Templates

Robota comes with 6 pre-configured agent templates:

- **Task Coordinator** - Analyzes and delegates complex tasks
- **Domain Researcher** - Deep research and analysis specialist
- **Creative Ideator** - Brainstorming and creative solutions
- **Ethical Reviewer** - Evaluates ethical implications
- **Fast Executor** - Quick task execution and implementation
- **Summarizer** - Content summarization and synthesis

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

| Provider | Models | Features |
|----------|--------|----------|
| **OpenAI** | GPT-4, GPT-3.5 | Function calling, streaming, vision |
| **Anthropic** | Claude 3.5 Sonnet, Claude 3 | Large context, advanced reasoning |
| **Google** | Gemini 1.5 Pro, Gemini Flash | Multimodal, long context |

## Team Collaboration Features

- **Automatic Agent Selection** - Natural language task assignment
- **Template-based Configuration** - Pre-optimized settings for each role
- **Workflow Visualization** - Generate Mermaid diagrams of team processes
- **Performance Analytics** - Track team efficiency and token usage
- **Cross-Provider Teams** - Mix different AI providers in one team

## License

MIT License - see LICENSE file for details. 
