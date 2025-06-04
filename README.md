# Robota - AI Agent Framework

Robota is a powerful AI agent framework written in JavaScript/TypeScript. This project is structured as a pnpm monorepo, with the option to run examples using bun.

## Key Features & Advantages

### 🚀 **Multi-Provider Support**
- **OpenAI**: GPT-4, GPT-3.5 - Function calling, streaming, vision support
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 - Large context, advanced reasoning
- **Google AI**: Gemini 1.5 Pro, Gemini Flash - Multimodal, long context
- Seamless switching between providers and dynamic configuration

### 🛠️ **Type-Safe Function Calling**
- Zod schema-based type-safe function definitions
- Automatic parameter validation and type inference
- Extensible tool system architecture

### ⚡ **Real-Time Streaming Responses**
- Real-time streaming support across all providers
- Chunk-based response processing for fast user experience
- Background processing and asynchronous responses

### 🧠 **Intelligent Agent System**
- Planning agents that plan and execute complex tasks
- Memory system that remembers and references conversation history
- External system integration through tools

### 👥 **Multi-Agent Management**
- **Session Management**: Create and manage multiple AI conversation sessions
- **Independent Workspaces**: Each agent can have its own configuration and chat history
- **Dynamic Agent Switching**: Seamlessly switch between different agent contexts
- **Conversation Persistence**: Automatic conversation history tracking and storage
- **Agent Orchestration**: Coordinate multiple agents for complex workflows

### 🏗️ **Modular Architecture**
- Clean separation of concerns with high extensibility
- Independent usage of each component
- Plugin-style tool and provider system

### 📡 **Model Context Protocol (MCP) Support**
- Standardized model communication protocol
- Compatibility guarantee with various AI model providers
- Consistent development experience through unified interface

### 📊 **Analytics & Monitoring**
- Detailed usage statistics including request count and token usage
- Real-time limit management (token and request limits)
- Comprehensive logging system for debugging

### 🔧 **OpenAPI Integration**
- Automatic tool generation from Swagger/OpenAPI specifications
- Quick AI agent integration with existing REST APIs
- Type-safe API client generation

## Project Structure

```
robota/
├── packages/           # Core packages
│   ├── core/           # Core functionality (Robota class, provider management)
│   ├── openai/         # OpenAI integration
│   ├── anthropic/      # Anthropic integration
│   ├── google/         # Google AI integration
│   ├── sessions/       # Multi-session and agent management
│   ├── mcp/            # Model Context Protocol implementation
│   ├── tools/          # Tool system (Zod-based function calling)
│   └── ...
└── apps/               # Applications
    ├── docs/           # Documentation app
    └── examples/       # Example code
```

## Quick Start Examples

### Basic Conversational AI

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

### Multi-Agent Session Management

```typescript
import { SessionManager } from '@robota-sdk/sessions';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

// Create a session manager for multiple agents
const sessionManager = new SessionManager();

// Create a customer support agent
const supportAgent = sessionManager.createSession({
    name: 'Customer Support Agent',
    provider: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4'
    }),
    systemPrompt: 'You are a helpful customer support agent.'
});

// Create a code review agent
const codeAgent = sessionManager.createSession({
    name: 'Code Review Agent',
    provider: new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: 'claude-3-5-sonnet-20241022'
    }),
    systemPrompt: 'You are an expert code reviewer focused on best practices.'
});

// Switch between agents dynamically
sessionManager.setActiveSession(supportAgent.id);
const supportResponse = await supportAgent.sendMessage('I need help with my order');

sessionManager.setActiveSession(codeAgent.id);
const codeResponse = await codeAgent.sendMessage('Please review this TypeScript code');

// Each agent maintains its own conversation history
console.log('Support history:', supportAgent.getChatHistory());
console.log('Code review history:', codeAgent.getChatHistory());
```

### AI Agent with Tools

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

// Define calculator tool
const calculatorTool = {
    name: 'calculate',
    description: 'Performs mathematical calculations',
    parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number(),
        b: z.number()
    }),
    handler: async (params) => {
        const { operation, a, b } = params;
        switch (operation) {
            case 'add': return { result: a + b };
            case 'subtract': return { result: a - b };
            case 'multiply': return { result: a * b };
            case 'divide': return { result: a / b };
        }
    }
};

const toolProvider = createZodFunctionToolProvider({
    tools: { calculate: calculatorTool }
});

const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    toolProviders: [toolProvider],
    systemPrompt: 'Use the calculator tool to solve mathematical problems.'
});

const response = await robota.run('Please calculate 15 multiplied by 7.');
```

### Multi-Provider Setup

```typescript
import { GoogleProvider } from '@robota-sdk/google';
import { AnthropicProvider } from '@robota-sdk/anthropic';

const robota = new Robota({
    aiProviders: {
        openai: openaiProvider,
        google: googleProvider,
        anthropic: anthropicProvider
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4'
});

// Dynamic provider switching
robota.setCurrentAI('google', 'gemini-1.5-pro');
const googleResponse = await robota.run('Please respond using Google AI.');

robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');
const anthropicResponse = await robota.run('Please respond using Claude.');
```

## Installation

### Requirements

- Node.js 18 or higher
- pnpm 8 or higher
- bun 1 or higher (optional)

### Setup

```bash
# Install pnpm (if not already installed)
npm install -g pnpm

# Install bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
pnpm install
```

## Running Examples

All examples are located in the `apps/examples` directory. Navigate there first:

```bash
cd apps/examples
```

### Method 1: Using Package Scripts

```bash
# Individual examples
pnpm start:simple-conversation
pnpm start:using-ai-client
pnpm start:multi-ai-providers
pnpm start:provider-switching
pnpm start:zod-function-provider
pnpm start:using-tool-providers

# Example groups
pnpm start:all-basic          # All basic examples
pnpm start:all-tool-providers # All tool provider examples
pnpm start:all-examples       # All examples sequentially
pnpm start:all                # Quick demo
```

### Method 2: Direct File Execution

```bash
# With bun (fastest)
bun run 01-basic/01-simple-conversation.ts
bun run 01-basic/02-ai-with-tools.ts
bun run 01-basic/03-multi-ai-providers.ts

# With pnpm + tsx
pnpm tsx 01-basic/01-simple-conversation.ts
pnpm tsx 02-functions/01-zod-function-tools.ts
pnpm tsx 03-integrations/01-mcp-client.ts
```

## Development

### Building Packages

```bash
# Build all packages
pnpm build

# Build core dependencies first
pnpm build:deps
```

### Type Checking

```bash
pnpm typecheck
```

## Environment Variables

To run examples, create a `.env` file in the project root and set the necessary environment variables:

```
# OpenAI API key (required)
OPENAI_API_KEY=your_api_key_here

# Weather API key (optional)
WEATHER_API_KEY=your_weather_api_key_here

# MCP API key (needed for MCP examples)
MCP_API_KEY=your_mcp_api_key_here
```

## License

MIT
