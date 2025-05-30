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

## Quick Start

All examples are located in the `apps/examples` directory and showcase real-world usage patterns with the latest Manager pattern architecture.

```bash
# Navigate to examples directory
cd apps/examples

# Run basic conversation example
bun run 01-basic/01-simple-conversation.ts

# Run tool integration example  
bun run 01-basic/02-ai-with-tools.ts

# Run multi-provider example
bun run 01-basic/03-multi-ai-providers.ts
```

## Features Demonstrated

- **Manager Pattern Architecture**: AIProviderManager, ToolProviderManager, SystemMessageManager
- **Analytics & Monitoring**: Built-in usage tracking and limit enforcement
- **Multi-Provider Support**: Seamless switching between OpenAI, Anthropic, Google AI
- **Type-Safe Function Calling**: Zod schemas, MCP integration, custom providers
- **Real-time Streaming**: Streaming responses across all providers
- **Conversation Management**: History persistence and memory management
