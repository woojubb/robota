# Robota SDK Examples Documentation

Welcome to the Robota SDK examples documentation. This directory contains comprehensive guides and examples demonstrating various features and use cases of the Robota SDK.

## 📋 Table of Contents

### Getting Started
- [**Setup and Prerequisites**](./setup.md) - Initial setup, dependencies, and environment configuration

### Basic Examples
- [**Simple Conversation**](./basic-conversation.md) - Basic usage with OpenAI provider
- [**AI with Tools**](./ai-with-tools.md) - Integrating AI with function tools
- [**Multi-Provider Setup**](./multi-provider.md) - Working with multiple AI providers
- [**Provider Switching**](./provider-switching.md) - Dynamic provider and model switching
- [**Conversation History**](./conversation-history.md) - Managing conversation state and history
- [**Token and Request Limits**](./token-limits.md) - Usage tracking and rate limiting

### Function Tools
- [**Zod Function Tools**](./zod-function-tools.md) - Creating type-safe function tools with Zod
- [**Custom Function Providers**](./custom-function-providers.md) - Building custom tool providers

### Integrations
- [**MCP Client Integration**](./mcp-integration.md) - Model Context Protocol integration
- [**OpenAI Functions**](./openai-functions.md) - Direct OpenAI Functions API usage
- [**External API Integration**](./api-integration.md) - Integrating with external APIs

### Session Management
- [**Session Management**](./session-management.md) - Managing user sessions and chat history

## 🚀 Quick Start

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Run your first example**:
   ```bash
   cd apps/examples
   bun run 01-basic/01-simple-conversation.ts
   ```

## 📁 Example Structure

All example code is located in the `apps/examples` directory:

```
apps/examples/
├── 01-basic/              # Basic usage examples
├── 02-functions/          # Function tool examples
├── 03-integrations/       # Integration examples
└── 04-sessions/           # Session management examples
```

## 🛠️ Running Examples

Examples can be run directly from the `apps/examples` directory:

```bash
# Using bun (recommended)
bun run 01-basic/01-simple-conversation.ts

# Using pnpm + tsx
pnpm tsx 01-basic/01-simple-conversation.ts
```

## 💡 Best Practices

- Always set up environment variables before running examples
- Use appropriate error handling for production code
- Choose the right AI provider and model for your use case
- Monitor token usage and implement rate limiting
- Test with multiple providers for robustness

## 🆘 Troubleshooting

Common issues and solutions:

1. **Missing API Keys**: Ensure all required API keys are set in `.env`
2. **Provider Errors**: Verify client instances are properly configured
3. **Tool Registration**: Check that tools are correctly registered
4. **Model Access**: Confirm models are available for your API tier

For detailed troubleshooting, see individual example documentation.

## 📚 Additional Resources

- [Robota SDK Core Documentation](../../packages/core/README.md)
- [Tools Package Documentation](../../packages/tools/README.md)
- [Sessions Package Documentation](../../packages/sessions/README.md) 