# Robota Development Environment Setup

The Robota project is structured as a monorepo using pnpm workspace and runs examples using bun.

## Required Tools

The following tools are required for Robota development:

- [Node.js](https://nodejs.org/) v18 or higher
- [pnpm](https://pnpm.io/) v8 or higher
- [Bun](https://bun.sh/) v1 or higher

## Installation

### Installing pnpm

```bash
# Install via npm
npm install -g pnpm

# macOS (Homebrew)
brew install pnpm
```

### Installing Bun

```bash
# macOS, Linux
curl -fsSL https://bun.sh/install | bash

# Windows (with WSL)
curl -fsSL https://bun.sh/install | bash
```

## Project Setup

1. Clone the repository and install dependencies:

```bash
git clone https://github.com/woojubb/robota.git
cd robota
pnpm install
```

2. Build packages:

```bash
pnpm build
```

## Running Examples

All examples are located in the `apps/examples` directory. First, navigate to that directory:

```bash
cd apps/examples
```

### Method 1: Using Package Scripts

```bash
# Run individual examples
pnpm start:simple-conversation
pnpm start:using-ai-client
pnpm start:multi-ai-providers
pnpm start:provider-switching
pnpm start:zod-function-provider
pnpm start:using-tool-providers

# Run example groups
pnpm start:all-basic          # All basic examples
pnpm start:all-tool-providers # All tool provider examples
pnpm start:all-examples       # All examples sequentially
pnpm start:all                # Quick demo
```

### Method 2: Direct File Execution

```bash
# Using bun (fastest)
bun run 01-basic/01-simple-conversation.ts
bun run 01-basic/02-ai-with-tools.ts
bun run 01-basic/03-multi-ai-providers.ts

# Using pnpm + tsx
pnpm tsx 01-basic/01-simple-conversation.ts
pnpm tsx 02-functions/01-zod-function-tools.ts
pnpm tsx 03-integrations/01-mcp-client.ts
```

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

## Notes

- Package references use the format `@robota-sdk/core`, `@robota-sdk/openai`, etc.
- pnpm workspace is used to manage dependencies between packages.
- To ensure cross-platform compatibility, avoid using symbolic links. Instead, copy files or use relative paths for references. 