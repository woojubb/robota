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
