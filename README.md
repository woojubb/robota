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

### 👥 **Intelligent Multi-Agent Teams**
- **Template-Based Expert Selection**: AI automatically analyzes requests and selects optimal specialist templates (researchers, creative ideators, coordinators, etc.)
- **Dynamic Task Delegation**: Complex requests are decomposed and delegated to appropriate expert agents
- **Optimized AI Provider Selection**: Each expert template uses the most suitable AI provider and model for its specialty
- **Workflow Visualization**: Generate flowcharts and relationship diagrams for team interactions
- **Dynamic Task Delegation**: Complex requests broken down and distributed to specialized agents automatically
- **6 Built-in Expert Templates**: Task coordinator, summarizer, ethical reviewer, creative ideator, fast executor, domain researcher
- **Simplified Configuration**: Just provide AI providers - templates handle all configuration automatically
- **Seamless Result Integration**: Automatic synthesis of multiple agent outputs into cohesive responses

### 🏢 **Session Management**
- **Multiple AI Sessions**: Create and manage multiple independent AI conversation sessions
- **Independent Workspaces**: Each session maintains its own configuration and chat history
- **Dynamic Session Switching**: Seamlessly switch between different session contexts
- **Conversation Persistence**: Automatic conversation history tracking and storage

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
│   ├── sessions/       # Multi-session management
│   ├── team/           # Multi-agent team collaboration
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
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

const robota = new Robota({
    name: 'Assistant',
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

### Multi-Agent Team Collaboration

```typescript
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const anthropicProvider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

// Create a team with intelligent delegation capabilities
const team = await createTeam({
    aiProviders: [openaiProvider, anthropicProvider],
    maxMembers: 5,
    maxTokenLimit: 50000,
    logger: console,
    debug: true
});

// The team automatically delegates complex tasks to specialized agents
const response = await team.execute(`
    Create a comprehensive business plan for a coffee shop startup. 
    Include: 1) Market analysis, 2) Menu design, 3) Financial projections
`);

// Task coordinator intelligently analyzes the request and automatically:
// - Selects domain_researcher template for market analysis
// - Selects creative_ideator template for menu design  
// - Selects fast_executor template for financial projections
// - Synthesizes all results into a comprehensive business plan

console.log(response);
```

### Session Management

```typescript
import { SessionManager } from '@robota-sdk/sessions';
import { OpenAIProvider } from '@robota-sdk/openai';

// Create a session manager for multiple independent AI agents
const sessionManager = new SessionManager({
    maxSessions: 10,
    maxChatsPerSession: 5,
    enableWorkspaceIsolation: true,
});

// Create isolated workspaces for different purposes
const devWorkspace = sessionManager.createSession({
    name: 'Development Workspace',
    userId: 'developer-123',
    workspaceId: 'workspace-dev',
});

const researchWorkspace = sessionManager.createSession({
    name: 'Research Workspace',
    userId: 'researcher-456',
    workspaceId: 'workspace-research',
});

// Create specialized AI agents in each workspace
const codingAssistant = await sessionManager.createChat(devWorkspace, {
    name: 'Coding Assistant',
    agentConfig: {
        name: 'Coding Assistant',
        aiProviders: [new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4',
            temperature: 0.1,
            systemMessage: 'You are an expert programmer and coding assistant.',
        },
    },
});

const researchAssistant = await sessionManager.createChat(researchWorkspace, {
    name: 'Research Assistant',
    agentConfig: {
        name: 'Research Assistant',
        aiProviders: [new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4',
            temperature: 0.7,
            systemMessage: 'You are a knowledgeable research assistant.',
        },
    },
});

// Switch between agents and interact with them
sessionManager.switchChat(devWorkspace, codingAssistant);
const codingChat = sessionManager.getChat(codingAssistant);
await codingChat.sendMessage('Help me implement a binary search algorithm');

sessionManager.switchChat(researchWorkspace, researchAssistant);
const researchChat = sessionManager.getChat(researchAssistant);
await researchChat.sendMessage('What are the latest developments in AI?');

// Each workspace maintains completely isolated conversation history
```

### AI Agent with Tools

```typescript
import { createFunctionTool } from '@robota-sdk/agents';
import { z } from 'zod';

// Define calculator tool
const calculatorTool = createFunctionTool(
    'calculate',
    'Performs mathematical calculations',
    z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number(),
        b: z.number()
    }),
    async (params) => {
        const { operation, a, b } = params;
        switch (operation) {
            case 'add': return { result: a + b };
            case 'subtract': return { result: a - b };
            case 'multiply': return { result: a * b };
            case 'divide': return { result: a / b };
        }
    }
);

const robota = new Robota({
    name: 'Calculator Assistant',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        systemMessage: 'Use the calculator tool to solve mathematical problems.'
    },
    tools: [calculatorTool]
});

const response = await robota.run('Please calculate 15 multiplied by 7.');
```

### Multi-Provider Setup

```typescript
import { GoogleProvider } from '@robota-sdk/google';
import { AnthropicProvider } from '@robota-sdk/anthropic';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const googleProvider = new GoogleProvider({ apiKey: process.env.GOOGLE_AI_API_KEY });
const anthropicProvider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const robota = new Robota({
    name: 'Multi-Provider Assistant',
    aiProviders: [openaiProvider, googleProvider, anthropicProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        systemMessage: 'You are a helpful AI assistant.'
    }
});

// Dynamic model switching
robota.setModel({ provider: 'google', model: 'gemini-1.5-pro' });
const googleResponse = await robota.run('Please respond using Google AI.');

robota.setModel({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' });
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
