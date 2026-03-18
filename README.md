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

### 👥 **Multi-Agent Team System**

- **Task Coordination**: Primary agent coordinates with temporary specialist agents for complex tasks
- **Dynamic Agent Creation**: Creates temporary expert agents tailored for specific subtasks
- **Template-Based Specialists**: 7 pre-configured specialist templates (coordinator, researcher, creative, ethical reviewer, executor, summarizer, general)
- **Resource Management**: Automatic cleanup and lifecycle management of temporary agents
- **Team Analytics**: Performance monitoring and statistics through ExecutionAnalyticsPlugin
- **Cross-Provider Teams**: Mix different AI providers within the same team workflow

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

- Usage statistics through ExecutionAnalyticsPlugin and UsagePlugin
- Rate limiting and resource control through LimitsPlugin
- Comprehensive logging system for debugging through LoggingPlugin
- Plugin-based monitoring with configurable strategies

### 🔧 **Tool System**

- Type-safe function calling with Zod schema validation
- Extensible tool architecture for external integrations
- Built-in tool registry and management system

## Project Structure

```
robota/
├── packages/                       # Core packages
│   ├── agents/                     # Core agent functionality (Robota class, DI, plugins)
│   ├── event-service/              # Event bus and structured event delivery
│   ├── tools/                      # Tool implementations (FunctionTool, OpenAPITool, ToolRegistry)
│   ├── tool-mcp/                   # MCP tool implementations (MCPTool, RelayMcpTool)
│   ├── plugin-conversation-history/ # Conversation history plugin
│   ├── plugin-logging/             # Structured logging plugin
│   ├── plugin-usage/               # Token/cost usage tracking plugin
│   ├── plugin-performance/         # Execution performance metrics plugin
│   ├── plugin-execution-analytics/ # Execution analytics plugin
│   ├── plugin-error-handling/      # Error handling and recovery plugin
│   ├── plugin-limits/              # Rate limiting and resource control plugin
│   ├── plugin-event-emitter/       # Event emission bridge plugin
│   ├── plugin-webhook/             # Webhook delivery plugin
│   ├── openai/                     # OpenAI provider integration
│   ├── anthropic/                  # Anthropic provider integration
│   ├── google/                     # Google AI provider integration
│   ├── bytedance/                  # ByteDance provider integration
│   ├── sessions/                   # Multi-session management
│   ├── team/                       # assignTask MCP tool collection
│   ├── playground/                 # Playground UI package
│   ├── remote/                     # Remote execution client
│   ├── remote-server-core/         # Remote execution server core
│   └── dag-*/                      # DAG subsystem packages
└── apps/                           # Applications
    ├── web/                        # Agent Playground web app
    ├── dag-studio/                 # DAG Designer application
    ├── docs/                       # Documentation site
    ├── agent-server/               # AI provider proxy + WebSocket server
    ├── dag-runtime-server/         # DAG execution server
    └── dag-orchestrator-server/    # Orchestration gateway
```

## Quick Start Examples

### Basic Conversational AI

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

const robota = new Robota({
  name: 'Assistant',
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

### assignTask MCP Tool Collection

```typescript
import {
  createAssignTaskRelayTool,
  listTemplatesTool,
  getTemplateDetailTool,
} from '@robota-sdk/agent-team';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });

// Tools exposed to the agent (assignTask + template queries)
const tools = [
  listTemplatesTool,
  getTemplateDetailTool,
  createAssignTaskRelayTool(/* pass bound eventService here */),
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

const response = await robota.run('Create a business plan draft for a coffee shop.');
console.log(response);
```

### Session Management

```typescript
import { SessionManager } from '@robota-sdk/agent-sessions';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

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
import { createFunctionTool } from '@robota-sdk/agent-core';
import { z } from 'zod';

// Define calculator tool
const calculatorTool = createFunctionTool(
  'calculate',
  'Performs mathematical calculations',
  z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number(),
  }),
  async (params) => {
    const { operation, a, b } = params;
    switch (operation) {
      case 'add':
        return { result: a + b };
      case 'subtract':
        return { result: a - b };
      case 'multiply':
        return { result: a * b };
      case 'divide':
        return { result: a / b };
    }
  },
);

const robota = new Robota({
  name: 'Calculator Assistant',
  aiProviders: [openaiProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4',
    systemMessage: 'Use the calculator tool to solve mathematical problems.',
  },
  tools: [calculatorTool],
});

const response = await robota.run('Please calculate 15 multiplied by 7.');
```

### Multi-Provider Setup

```typescript
import { GoogleProvider } from '@robota-sdk/agent-provider-google';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const googleProvider = new GoogleProvider({ apiKey: process.env.GOOGLE_AI_API_KEY });
const anthropicProvider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

const robota = new Robota({
  name: 'Multi-Provider Assistant',
  aiProviders: [openaiProvider, googleProvider, anthropicProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4',
    systemMessage: 'You are a helpful AI assistant.',
  },
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

Examples are distributed per package under `packages/*/examples` (SSOT ownership).

```bash
# Build packages (recommended before running examples)
pnpm build

# Run a package-owned example from the repo root
npx tsx packages/agents/examples/basic-conversation.ts
npx tsx packages/agents/examples/tool-calling.ts
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

## Deployment

All deployments are manual-only. No automatic deployments are triggered on push or merge.

### Documentation (GitHub Pages)

Run from GitHub Actions UI: **Actions → Deploy Documentation → Run workflow**

Select the branch or tag to deploy from. Defaults to `main`.

### Web App (Vercel)

Run from GitHub Actions UI: **Actions → Deploy to Vercel → Run workflow**

Select the deployment target: `staging` or `production`.

### NPM Release

Run from GitHub Actions UI: **Actions → Release → Run workflow**

Enter the release tag (e.g., `v1.0.0`). This runs typecheck, lint, build, test, publishes to NPM, and deploys documentation.

### CI

CI runs automatically on pull requests targeting `main` or `develop`. No CI runs on push.

## License

MIT
