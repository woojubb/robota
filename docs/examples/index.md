# Robota SDK Examples

This directory contains comprehensive examples demonstrating how to use the Robota SDK effectively with its Manager pattern architecture.

## Main Examples Documentation

For complete examples and tutorials, see: [Examples Guide](./examples.md)

## Example Categories

### 📚 Basic Examples (`01-basic/`)
- **Simple Conversation**: Basic usage with `run()` and streaming
- **AI with Tools**: Function calling with Zod-based tools
- **Multi-AI Providers**: Working with OpenAI, Anthropic, and Google AI
- **Provider Switching**: Dynamic provider and model switching
- **Conversation History**: History management and persistence
- **Token & Request Limits**: Usage tracking and limit enforcement

### 🔧 Function Tools (`02-functions/`)
- **Zod Function Tools**: Type-safe function definitions with Zod schemas
- **Custom Function Provider**: Building custom tool providers
- **Complex Integrations**: Advanced tool usage patterns

### 🚀 Advanced Integrations (`03-integrations/`)
- **MCP Client**: Model Context Protocol integration
- **OpenAI Functions**: Native OpenAI function calling
- **API Integration**: External API integration patterns

## Running Examples

All examples are located in the `apps/examples` directory. You can run them in two ways:

### Method 1: Direct File Execution (Recommended)

```bash
# Navigate to examples directory
cd apps/examples

# Run examples directly with bun (fastest)
bun run 01-basic/01-simple-conversation.ts
bun run 01-basic/02-ai-with-tools.ts
bun run 01-basic/03-multi-ai-providers.ts

# Or with pnpm + tsx
pnpm tsx 01-basic/01-simple-conversation.ts
pnpm tsx 02-functions/01-zod-function-tools.ts
```

### Method 2: Using Package Scripts

The examples package provides convenient npm scripts:

```bash
# Navigate to examples directory
cd apps/examples

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
pnpm start:all                # Quick demo (selected examples)
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `start:simple-conversation` | Basic conversation example |
| `start:using-ai-client` | AI with tools integration |
| `start:multi-ai-providers` | Multiple AI providers |
| `start:provider-switching` | Provider switching demo |
| `start:provider-switching-simple` | Simple provider switching |
| `start:zod-function-provider` | Zod-based function tools |
| `start:using-tool-providers` | Custom tool providers |
| `start:all-basic` | Run all basic examples |
| `start:all-tool-providers` | Run all tool provider examples |
| `start:all-examples` | Run all examples sequentially |
| `start:all` | Quick demo with selected examples |

## Features Demonstrated

- **Manager Pattern Architecture**: AIProviderManager, ToolProviderManager, SystemMessageManager
- **Analytics & Monitoring**: Built-in usage tracking and limit enforcement
- **Multi-Provider Support**: Seamless switching between OpenAI, Anthropic, Google AI
- **Type-Safe Function Calling**: Zod schemas, MCP integration, custom providers
- **Real-time Streaming**: Streaming responses across all providers
- **Conversation Management**: History persistence and memory management
