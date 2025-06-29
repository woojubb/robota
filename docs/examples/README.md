# Examples

This directory contains practical examples demonstrating various features and use cases of the Robota SDK.

## 🚀 Getting Started

### Quick Setup

1. **Clone and Install**:
   ```bash
   git clone https://github.com/your-org/robota.git
   cd robota
   pnpm install
   ```

2. **Environment Setup**:
```bash
cd apps/examples
cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Run Examples**:
   ```bash
# Run any example
npx tsx 01-basic-conversation.ts
```

## 📋 Example Categories

### Basic Usage
- **[Basic Conversation](./basic-conversation.md)** - Simple AI conversation setup
- **[Agents Basic Usage](./agents-basic-usage.md)** - New @robota-sdk/agents package features
- **[Agents Streaming](./agents-streaming.md)** - Real-time streaming responses with performance monitoring
- **[AI with Tools](./ai-with-tools.md)** - Function calling and tool usage

### Multi-Provider & Templates
- **[Multi-Provider](./multi-provider.md)** - Using multiple AI providers (OpenAI, Anthropic, Google)
- **[Agent Templates](./team-templates.md)** - Specialized agent configurations for optimal performance

### Advanced Features
- **[Execution Analytics](./execution-analytics.md)** - Performance monitoring and analytics
- **[Team Collaboration](./team-collaboration.md)** - Multi-agent teamwork and coordination

### Learning Path
For new users, we recommend following this learning sequence:

1. **Start with Basics**: [Basic Conversation](./basic-conversation.md)
2. **Add Tools**: [AI with Tools](./ai-with-tools.md)
3. **Explore Streaming**: [Agents Streaming](./agents-streaming.md)
4. **Try Multi-Provider**: [Multi-Provider](./multi-provider.md)
5. **Use Templates**: [Agent Templates](./team-templates.md)
6. **Monitor Performance**: [Execution Analytics](./execution-analytics.md)
7. **Scale with Teams**: [Team Collaboration](./team-collaboration.md)

## 🎯 Quick Feature Overview

### New Unified Architecture (`@robota-sdk/agents`)
The examples showcase the powerful new unified architecture:

- **Zero `any` Types**: Complete TypeScript safety
- **Plugin System**: Modular functionality with built-in plugins
- **Multi-Provider**: Seamless switching between OpenAI, Anthropic, Google
- **Advanced Analytics**: Built-in execution monitoring and performance tracking
- **Tool System**: Type-safe function calling with automatic schema conversion
- **Streaming Support**: Real-time response streaming with metadata

### Core Capabilities Demonstrated

| Feature | Examples | Description |
|---------|----------|-------------|
| **Basic AI Chat** | 01, 10 | Simple conversations and basic setup |
| **Function Calling** | 02 | Tool integration and automated function calls |
| **Multi-Provider** | 03, 07 | OpenAI, Anthropic, Google AI provider usage |
| **Streaming** | 11 | Real-time response streaming |
| **Team Coordination** | 05, 09 | Multi-agent collaboration |
| **Performance Analytics** | 08, 09 | Execution monitoring and optimization |
| **Template Patterns** | 07 | Reusable agent configurations |

## 🔧 Running Examples

### Prerequisites

```bash
# Required environment variables
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key  # For multi-provider examples
GOOGLE_AI_API_KEY=your_google_key     # For Google AI examples
```

### Individual Examples

```bash
# Navigate to examples
cd apps/examples

# Basic conversation
npx tsx 01-basic-conversation.ts

# Advanced agents features
npx tsx 10-agents-basic-usage.ts

# Streaming responses
npx tsx 11-agents-streaming.ts

# Function calling
npx tsx 02-tool-calling.ts

# Multi-provider comparison
npx tsx 03-multi-providers.ts

# Agent templates
npx tsx 07-team-templates.ts

# Performance analytics
npx tsx 08-execution-analytics.ts
```

### Run All Examples

```bash
# Run a sequence of examples to see progression
npm run examples:basic     # Basic examples (01, 02, 10)
npm run examples:advanced  # Advanced examples (03, 07, 08, 11)
npm run examples:all       # All examples in sequence
```

## 🎨 Example Structure

Each example follows a consistent structure:

```typescript
/**
 * XX-example-name.ts
 * 
 * Brief description of what this example demonstrates:
 * - Key feature 1
 * - Key feature 2
 * - Key feature 3
 */

import { /* required imports */ } from '@robota-sdk/agents';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    try {
        // Example implementation
        console.log('🚀 Example Started...');
        
        // Create agents, configure providers, demonstrate features
        
        console.log('✅ Example Completed!');
            } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    } finally {
        // Cleanup resources
        process.exit(0);
            }
        }

main();
```

## 📊 Performance Considerations

The examples are optimized for learning and demonstration:

- **Minimal Token Usage**: Short queries to reduce API costs
- **Error Handling**: Robust error handling and recovery
- **Resource Cleanup**: Proper cleanup to prevent memory leaks
- **Performance Monitoring**: Built-in timing and analytics

## 🔗 Related Documentation

- **[Getting Started Guide](../getting-started/README.md)** - Initial setup and basic concepts
- **[Core Concepts](../guide/core-concepts.md)** - Understanding the architecture
- **[API Reference](../api-reference/README.md)** - Complete API documentation
- **[Provider Guides](../providers/README.md)** - Provider-specific documentation

## 💡 Tips for Learning

1. **Start Simple**: Begin with basic conversation example
2. **Read Comments**: Each example has detailed inline comments
3. **Experiment**: Modify examples to explore different configurations
4. **Check Output**: Expected output is documented for each example
5. **Use TypeScript**: Examples showcase full type safety benefits
6. **Monitor Performance**: Use analytics examples to optimize your usage

Happy coding with Robota! 🤖 