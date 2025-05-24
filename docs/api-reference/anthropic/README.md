Anthropic API / [Exports](modules)

# Robota - AI Agent Framework

Robota is an AI agent framework written in JavaScript/TypeScript. This project is structured as a pnpm monorepo, with the option to run examples using bun.

## Project Structure

```
robota/
├── packages/           # Core packages
│   ├── core/           # Core functionality
│   ├── openai/         # OpenAI integration
│   ├── anthropic/      # Anthropic integration
│   ├── mcp/            # MCP implementation
│   ├── tools/          # Tool system
│   └── ...
└── apps/               # Applications
    ├── docs/           # Documentation app
    └── examples/       # Example code
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

### With pnpm

```bash
# Basic conversation example
pnpm example:basic

# Function calling example
pnpm example:function-calling

# Tools usage example
pnpm example:tools

# Agent example
pnpm example:agents

# System messages example
pnpm example:system-messages

# MCP integration example
pnpm example:mcp

# Run all examples
pnpm example:all
```

### Directly with bun

```bash
# Navigate to examples directory
cd src/examples

# Basic conversation example
bun run basic/simple-conversation.ts

# Function calling example
bun run function-calling/weather-calculator.ts

# Tools usage example
bun run tools/tool-examples.ts

# Agent example
bun run agents/research-agent.ts

# MCP integration example
bun run mcp/mcp-example.ts
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

## Key Features

### Model Context Protocol (MCP) Support

Robota now supports the Model Context Protocol. With MCP, you can communicate with various AI model providers in a standardized way:

```typescript
import { Robota, createMcpToolProvider } from 'robota';
import { Client, StdioClientTransport } from '@modelcontextprotocol/sdk';

// Create MCP client
const transport = new StdioClientTransport(/* config */);
const mcpClient = new Client(transport);

// Initialize MCP provider
const provider = createMcpToolProvider(mcpClient, {
  model: 'model-name', // Model name to use
  temperature: 0.7
});

// Connect provider to Robota instance
const robota = new Robota({ provider });

// Execute
const result = await robota.run('Hello! I am chatting with an AI model connected through MCP.');
```

## License

MIT
